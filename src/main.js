import * as THREE from 'three';
window.THREE = THREE;
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { TerrainManager } from './terrain/TerrainManager.js';
import { PlayerController } from './player/PlayerController.js';
import { FpsCounter } from './perf/FpsCounter.js';
import { LoadingOverlay } from './ui/LoadingOverlay.js';
import './style.css';

// --- Loading Overlay Manager ---
const loadingOverlay = new LoadingOverlay();

let loadedItemsCount = 0;
let estimatedTotalItems = 11;

THREE.DefaultLoadingManager.onStart = (url, itemsLoaded, itemsTotal) => {
  estimatedTotalItems = Math.max(estimatedTotalItems, itemsTotal);
  loadedItemsCount = itemsLoaded;
  const pct = Math.min(88, Math.round((loadedItemsCount / estimatedTotalItems) * 90));
  loadingOverlay.setProgress(pct);
};

THREE.DefaultLoadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
  estimatedTotalItems = Math.max(estimatedTotalItems, itemsTotal);
  loadedItemsCount = itemsLoaded;
  const pct = Math.min(88, Math.round((loadedItemsCount / estimatedTotalItems) * 90));
  loadingOverlay.setProgress(pct);
};

THREE.DefaultLoadingManager.onError = (url) => {
  console.warn('Asset loading error:', url);
};

// --- Scene Setup ---
const scene = new THREE.Scene();

// Atmosphere / Horizon Fog to blend distant mountain peaks into the skybox
const fogColor = new THREE.Color(0xc6cdd5);
scene.fog = new THREE.Fog(fogColor, 30, 260);

// --- Camera ---
const camera = new THREE.PerspectiveCamera(
  65,
  window.innerWidth / window.innerHeight,
  0.1,
  1500
);

// --- Renderer ---
const canvas = document.querySelector('#webgl');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setSize(window.innerWidth, window.innerHeight);
// Clamping pixel ratio to 1.0 maximizes fillrate performance on high-DPI/Retina screens
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.0));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// Enable soft real-time dynamic shadow mapping
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// --- Lighting & HDRI Skybox ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff5e6, 1.8);
sunLight.position.set(130, 190, 90);
sunLight.castShadow = true;
// Ultra-lightweight 512x512 shadow map: 75% fewer texels than 1024 (89% fewer than 1536)
// Combines with PCFSoftShadowMap to give smooth alpine shadows with near-zero fillrate cost
sunLight.shadow.mapSize.width = 512;
sunLight.shadow.mapSize.height = 512;
sunLight.shadow.camera.near = 15;
sunLight.shadow.camera.far = 360;

// Optimized shadow frustum: forward-biased along skier view direction
const shadowCoverage = 65;
sunLight.shadow.camera.left = -shadowCoverage;
sunLight.shadow.camera.right = shadowCoverage;
sunLight.shadow.camera.top = shadowCoverage;
sunLight.shadow.camera.bottom = -shadowCoverage;
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 0.05;
sunLight.shadow.radius = 1.4;

scene.add(sunLight);
scene.add(sunLight.target);

// Skybox & IBL
let skyboxTexture = null;
const skyboxPromise = new Promise((resolve) => {
  const rgbeLoader = new RGBELoader();
  rgbeLoader.load(
    '/kloppenheim_06_puresky_2k.hdr',
    (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      scene.background = texture;
      scene.environment = texture;
      skyboxTexture = texture;

      // Refresh impostor billboard lighting with full HDRI environment once loaded
      if (terrainManager?.treeGenerator?.isLoaded) {
        terrainManager.treeGenerator.initImpostors(renderer, texture);
      }
      resolve(texture);
    },
    undefined,
    (err) => {
      console.error('Failed to load skybox HDRI:', err);
      scene.background = fogColor;
      resolve(null);
    }
  );
});

// --- Modular Procedural Terrain System with Mountains and Rock Texturing ---
const terrainManager = new TerrainManager(scene, {
  chunkSize: 64,         // World units per chunk
  chunkSegments: 36,     // High-efficiency vertex budget: 44% less geometry with smooth silhouettes
  renderDistance: 5,     // Expanded view distance for landscape vista
  maxBuildsPerFrame: 1,  // Strict 1-chunk build cap per frame to guarantee 60 FPS pacing without frame drops
  seed: Math.random() * 10000, // Randomized terrain generation seed
  treeModel: '/models/trees_pack.fbx', // Populate world with coniferous trees pack
  renderer,              // WebGLRenderer for offscreen impostor baking & GPU features
});

// --- Player Controller ---
const player = new PlayerController(camera, canvas, terrainManager);

// Expose handle for runtime telemetry
window.__GAME = { scene, camera, renderer, player, terrainManager };

// Trees and vegetation loading promise from TerrainManager
const treesPromise = terrainManager.treeGenerator.load();

// Coordinate asset loading: wait until skybox, tree pack models, and textures finish
const MAX_LOAD_TIMEOUT = 12000;
const timeoutPromise = new Promise((resolve) => setTimeout(resolve, MAX_LOAD_TIMEOUT));

Promise.race([
  Promise.all([skyboxPromise, treesPromise]),
  timeoutPromise
]).then(() => {
  // If skybox loaded, ensure tree impostors have environment reflection
  if (skyboxTexture && terrainManager?.treeGenerator?.isLoaded) {
    terrainManager.treeGenerator.initImpostors(renderer, skyboxTexture);
  }

  // Pre-generate immediate terrain chunks and compile WebGL shaders
  terrainManager.update(player.position, 0, camera);
  renderer.compile(scene, camera);
  renderer.render(scene, camera);

  // Transition loading overlay to reveal Play button
  loadingOverlay.setReady();
});

// Launch downhill ski run when user clicks Play button (fullscreen is handled inside loadingOverlay)
loadingOverlay.onPlay(() => {
  player.start();
});

// --- High-Performance FPS & Telemetry Counter (Top Left) ---
const fpsCounter = new FpsCounter();

// --- Window Resize Listener ---
window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.0));
});

// --- Simulation & Render Loop ---
const clock = new THREE.Clock();

// Pre-allocated math vectors for 0-allocation per-frame render loop
const sunOffset = new THREE.Vector3(130, 190, 90);
const forwardDir = new THREE.Vector3();
const shadowCenter = new THREE.Vector3();
const shadowTexelSize = (2 * shadowCoverage) / 512;

// Pre-warm WebGL shader pipelines to prevent initial frame compilation hitch
renderer.compile(scene, camera);

function animate() {
  requestAnimationFrame(animate);

  // Delta time clamping prevents physics tunneling and loading spikes after tab switch / hitches
  const rawDelta = clock.getDelta();
  const delta = Math.min(rawDelta, 0.05);
  const elapsedTime = clock.getElapsedTime();

  // 1. Update player physics & camera
  player.update(delta);

  // Forward-biased sun shadow frustum: biases shadow coverage 25m in front of skier,
  // focusing resolution where the camera looks and culling wasted off-screen shadows behind player
  camera.getWorldDirection(forwardDir);
  forwardDir.y = 0;
  if (forwardDir.lengthSq() > 0.001) {
    forwardDir.normalize();
  }
  shadowCenter.copy(player.position).addScaledVector(forwardDir, 25);

  // Discrete texel grid snapping: locks shadow map coordinates to whole texels,
  // eliminating shadow edge shimmering and crawling artifacts while moving
  shadowCenter.x = Math.floor(shadowCenter.x / shadowTexelSize) * shadowTexelSize;
  shadowCenter.z = Math.floor(shadowCenter.z / shadowTexelSize) * shadowTexelSize;

  sunLight.position.copy(shadowCenter).add(sunOffset);
  sunLight.target.position.copy(shadowCenter);
  sunLight.target.updateMatrixWorld();

  // 2. Stream procedural chunks, update camera frustum culling, tree LODs & dynamic material uniforms
  terrainManager.update(player.position, elapsedTime, camera);

  // 3. Render scene
  renderer.render(scene, camera);

  // 4. Update FPS & Ski / Flight Telemetry
  fpsCounter.update(player.getSpeedKmh(), player.isAirborne(), player.mode);
}

animate();
