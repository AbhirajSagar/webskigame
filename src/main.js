import * as THREE from 'three';
window.THREE = THREE;
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { TerrainManager } from './terrain/TerrainManager.js';
import { PlayerController } from './player/PlayerController.js';
import { FpsCounter } from './perf/FpsCounter.js';
import { LoadingOverlay } from './ui/LoadingOverlay.js';
import { CloudSystem } from './environment/CloudSystem.js';
import { WireframeToggleUI } from './ui/WireframeToggleUI.js';
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
scene.fog = new THREE.Fog(fogColor, 200, 850);

// --- Dual-Camera Setup ---
// Camera 2: World Camera (renders terrain, mountains, trees, skybox, snow spray, and scenery)
const worldCamera = new THREE.PerspectiveCamera(
  65,
  window.innerWidth / window.innerHeight,
  0.5,
  2500
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
renderer.shadowMap.type = THREE.PCFShadowMap;

// --- Lighting & HDRI Skybox ---
// Soft sky-tinted ambient with balanced intensity ensures shadows are deep, clear, and visible
const ambientLight = new THREE.AmbientLight(0xd6e5f7, 0.22);
ambientLight.layers.enable(0);
ambientLight.layers.enable(1);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff5e6, 2.1);
sunLight.position.set(130, 190, 90);
sunLight.castShadow = true;
sunLight.layers.enable(0);
sunLight.layers.enable(1);
sunLight.shadow.camera.layers.enable(0);
sunLight.shadow.camera.layers.enable(1);
// Crisp 1024x1024 shadow map: sharp branch and trunk silhouettes on snow
sunLight.shadow.mapSize.width = 1024;
sunLight.shadow.mapSize.height = 1024;
sunLight.shadow.camera.near = 15;
sunLight.shadow.camera.far = 650;

// Optimized shadow frustum: forward-biased along skier view direction
const shadowCoverage = 58;
sunLight.shadow.camera.left = -shadowCoverage;
sunLight.shadow.camera.right = shadowCoverage;
sunLight.shadow.camera.top = shadowCoverage;
sunLight.shadow.camera.bottom = -shadowCoverage;
sunLight.shadow.bias = -0.0003;
sunLight.shadow.normalBias = 0.03;
sunLight.shadow.radius = 1.2;

scene.add(sunLight);
scene.add(sunLight.target);

// Auto-update shadow map during world render pass
renderer.shadowMap.autoUpdate = true;

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
  chunkSize: 128,        // Expanded chunk size for vast alpine terrain scale (was 96)
  chunkSegments: 22,     // High-fidelity uniform mesh resolution (guarantees zero T-junction cracks)
  renderDistance: 6,     // 768m view distance matching expanded atmosphere fog
  treeGridStep: 15.0,    // Natural organic conifer spacing across expansive slopes
  treeDensity: 0.42,     // Balanced organic tree density
  treeShadowRange: 48,   // Proximity shadow range for real-time conifer shadows
  maxBuildsPerFrame: 1,  // Smooth 60fps chunk streaming
  seed: Math.random() * 10000, // Randomized terrain generation seed
  treeModel: '/models/trees_pack.fbx', // Populate world with coniferous trees pack
  renderer,              // WebGLRenderer for offscreen GPU features
});

// --- Player Controller (First-Person FPS Skater & Snowboard System) ---
const player = new PlayerController(worldCamera, canvas, terrainManager, scene, characterCamera);

// --- Alpine Volumetric Particle Cloud System ---
const cloudSystem = new CloudSystem(scene, {
  clusterCount: 36,
  particlesPerCluster: 24, // 864 dense camera-facing billboard particles forming volumetric clouds
  wrapRadius: 1350,
  windSpeed: new THREE.Vector3(3.2, 0.0, 1.6),
  sunDirection: new THREE.Vector3(130, 190, 90).normalize(),
  fogColor,
  fogNear: 200,
  fogFar: 850,
});

// Expose handle for runtime telemetry and debugging
window.__GAME = { scene, camera: worldCamera, worldCamera, characterCamera, renderer, player, terrainManager, cloudSystem, wireframeUI: null };

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

// --- Wireframe / Solid Rendering Toggle UI Button (Top Right HUD) ---
const wireframeUI = new WireframeToggleUI({
  scene,
  player,
  terrainManager,
  cloudSystem,
});

// Expose handle for runtime telemetry and debugging
window.__GAME = { scene, camera: worldCamera, worldCamera, characterCamera, renderer, player, terrainManager, cloudSystem, wireframeUI };

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
const shadowTexelSize = (2 * shadowCoverage) / 1024;

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

  // 2. Stream procedural chunks, update camera frustum culling, tree LODs & dynamic material uniforms
  terrainManager.update(player.position, elapsedTime, worldCamera);

  // Update volumetric cloud particles (wind drift, billow pulse, toroidal wrapping around player)
  cloudSystem.update(elapsedTime, player.position);

  // 3. Two-Camera Composite Render:
  // Pass 1: Render world (terrain, trees, shadows, environment) with worldCamera
  renderer.autoClear = true;
  renderer.render(scene, worldCamera);

  // Pass 2: Render character & snowboard always on top with 1st camera (characterCamera)
  // Disable shadowMap autoUpdate during character overlay pass to avoid redundant re-rendering
  renderer.shadowMap.autoUpdate = false;
  const savedBg = scene.background;
  scene.background = null;
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(scene, characterCamera);
  scene.background = savedBg;
  renderer.shadowMap.autoUpdate = true;

  // 4. Update FPS & Ski / Flight Telemetry (including real-time airborne height)
  fpsCounter.update(player.getSpeedKmh(), player.isAirborne(), player.mode, player.getAltitude());
}

animate();
