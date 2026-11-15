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
let estimatedTotalItems = 12;

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

// --- Dual-Camera Setup ---
// Camera 2: World Camera (renders terrain, mountains, trees, skybox, snow spray, and scenery)
const worldCamera = new THREE.PerspectiveCamera(
  65,
  window.innerWidth / window.innerHeight,
  0.1,
  1500
);
worldCamera.layers.set(0);

// Camera 1: Character & Snowboard Camera (renders on top of the world)
const characterCamera = new THREE.PerspectiveCamera(
  65,
  window.innerWidth / window.innerHeight,
  0.05,
  100
);
characterCamera.layers.set(1);

// Backward-compatibility alias for modules referencing camera
const camera = worldCamera;

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
ambientLight.layers.enable(0);
ambientLight.layers.enable(1);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff5e6, 1.8);
sunLight.position.set(130, 190, 90);
sunLight.castShadow = true;
sunLight.layers.enable(0);
sunLight.layers.enable(1);
sunLight.shadow.camera.layers.enable(0);
sunLight.shadow.camera.layers.enable(1);
// Ultra-lightweight 512x512 shadow map: 75% fewer texels than 1024
// Combines with PCFSoftShadowMap to give smooth alpine shadows with near-zero fillrate cost
sunLight.shadow.mapSize.width = 512;
sunLight.shadow.mapSize.height = 512;
sunLight.shadow.camera.near = 15;
sunLight.shadow.camera.far = 360;

// Optimized shadow frustum: forward-biased along skier view direction
const shadowCoverage = 48;
sunLight.shadow.camera.left = -shadowCoverage;
sunLight.shadow.camera.right = shadowCoverage;
sunLight.shadow.camera.top = shadowCoverage;
sunLight.shadow.camera.bottom = -shadowCoverage;
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 0.05;
sunLight.shadow.radius = 1.4;

scene.add(sunLight);
scene.add(sunLight.target);

// Throttled shadow map updates: 50% GPU fillrate savings
renderer.shadowMap.autoUpdate = false;
sunLight.shadow.needsUpdate = true;
let shadowFrameCounter = 0;

// Skybox & IBL
let skyboxTexture = null;
const skyboxPromise = new Promise((resolve) => {
  const rgbeLoader = new RGBELoader();
  rgbeLoader.load(
    '/skybox.hdr',
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
  chunkSegments: 28,     // High-efficiency near vertex budget: smooth curves with low CPU overhead
  renderDistance: 4,     // 256m view distance perfectly matching fog distance (260m)
  maxBuildsPerFrame: 1,  // Strict 1-chunk build cap per frame with 4ms time budget
  seed: Math.random() * 10000, // Randomized terrain generation seed
  treeModel: '/models/trees_pack.fbx', // Populate world with coniferous trees pack
  renderer,              // WebGLRenderer for offscreen impostor baking & GPU features
});

// --- Player Controller (First-Person FPS Skater & Snowboard System) ---
const player = new PlayerController(worldCamera, canvas, terrainManager, scene, characterCamera);

// Expose handle for runtime telemetry and debugging
window.__GAME = { scene, camera: worldCamera, worldCamera, characterCamera, renderer, player, terrainManager };

// Trees and vegetation loading promise from TerrainManager
const treesPromise = terrainManager.treeGenerator.load();

// Character and snowboard 3D models loading promise (Skateboarding.fbx + board.fbx)
const riderPromise = player.character.load();

// Coordinate asset loading: wait until skybox, trees, and rider finish
const MAX_LOAD_TIMEOUT = 10000;
const timeoutPromise = new Promise((resolve) => setTimeout(resolve, MAX_LOAD_TIMEOUT));

Promise.race([
  Promise.all([skyboxPromise, treesPromise, riderPromise]),
  timeoutPromise,
])
  .then(() => {
    try {
      // If skybox loaded, ensure tree impostors have environment reflection
      if (skyboxTexture && terrainManager?.treeGenerator?.isLoaded) {
        terrainManager.treeGenerator.initImpostors(renderer, skyboxTexture);
      }

      // Pre-generate immediate terrain chunks and compile WebGL shaders
      terrainManager.update(player.position, 0, worldCamera);
      renderer.compile(scene, worldCamera);
      renderer.compile(scene, characterCamera);
      renderer.render(scene, worldCamera);
    } catch (err) {
      console.warn('Pre-warming WebGL render warning:', err);
    }

    // Transition loading overlay to reveal Play button
    loadingOverlay.setReady();
  })
  .catch((err) => {
    console.warn('Asset loader finished with warning:', err);
    loadingOverlay.setReady();
  });

// Launch downhill ski run when user clicks Play button
loadingOverlay.onPlay(() => {
  player.start();
});

// --- High-Performance FPS & Telemetry Counter (Top Left) ---
const fpsCounter = new FpsCounter();

// --- Window Resize Listener ---
window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;

  worldCamera.aspect = width / height;
  worldCamera.updateProjectionMatrix();

  characterCamera.aspect = width / height;
  characterCamera.updateProjectionMatrix();

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

function animate() {
  requestAnimationFrame(animate);

  // Delta time clamping prevents physics tunneling and loading spikes after tab switch / hitches
  const rawDelta = clock.getDelta();
  const delta = Math.min(rawDelta, 0.05);
  const elapsedTime = clock.getElapsedTime();

  // 1. Update player physics, cameras, rider animations, and snow spray
  player.update(delta);

  // Forward-biased sun shadow frustum: biases shadow coverage around rider
  worldCamera.getWorldDirection(forwardDir);
  forwardDir.y = 0;
  if (forwardDir.lengthSq() > 0.001) forwardDir.normalize();

  shadowCenter.copy(player.position).addScaledVector(forwardDir, 16);

  // Discrete texel grid snapping: locks shadow map coordinates to whole texels,
  // eliminating shadow edge shimmering and crawling artifacts while moving
  shadowCenter.x = Math.floor(shadowCenter.x / shadowTexelSize) * shadowTexelSize;
  shadowCenter.z = Math.floor(shadowCenter.z / shadowTexelSize) * shadowTexelSize;

  sunLight.position.copy(shadowCenter).add(sunOffset);
  sunLight.target.position.copy(shadowCenter);
  sunLight.target.updateMatrixWorld();

  // Throttle shadow map re-render pass to alternate frames: 50% GPU fillrate savings
  shadowFrameCounter++;
  if (shadowFrameCounter % 2 === 0) {
    sunLight.shadow.needsUpdate = true;
  }

  // 2. Stream procedural chunks, update camera frustum culling, tree LODs & dynamic material uniforms
  terrainManager.update(player.position, elapsedTime, worldCamera);

  // 3. Two-Camera Composite Render:
  // Pass 1: Render everything else with 2nd camera (worldCamera)
  renderer.autoClear = true;
  renderer.render(scene, worldCamera);

  // Pass 2: Render character & snowboard always on top with 1st camera (characterCamera)
  const savedBg = scene.background;
  scene.background = null;
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(scene, characterCamera);
  scene.background = savedBg;

  // 4. Update FPS & Ski / Flight Telemetry
  fpsCounter.update(player.getSpeedKmh(), player.isAirborne(), player.mode);
}

animate();
