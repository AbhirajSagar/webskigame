import * as THREE from 'three';
window.THREE = THREE;
import { TerrainManager } from './terrain/TerrainManager.js';
import { PlayerController } from './player/PlayerController.js';
import { LoadingOverlay } from './ui/LoadingOverlay.js';
import { CloudSystem } from './environment/CloudSystem.js';
import { SpeedEffects } from './fx/SpeedEffects.js';
import { FpsCounter } from './perf/FpsCounter.js';
import { LightingManager } from './environment/LightingManager.js';
import { LIGHTING_PRESETS } from './environment/LightingPresets.js';
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
const characterScene = new THREE.Scene();

// Atmosphere / Horizon Fog to completely mask map boundaries into the skybox
const fogColor = new THREE.Color(0xc6cdd5);
scene.fog = new THREE.Fog(fogColor, 90, 335);

const BASE_FOV = 65;

// --- Dual-Camera Setup ---
// Camera 2: World Camera (renders terrain, mountains, trees, skybox, clouds, and scenery)
const worldCamera = new THREE.PerspectiveCamera(
  BASE_FOV,
  window.innerWidth / window.innerHeight,
  0.5,
  2500
);
worldCamera.layers.set(0);

// Camera 1: Character & Snowboard Camera (renders on top of the world)
const characterCamera = new THREE.PerspectiveCamera(
  BASE_FOV,
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
  preserveDrawingBuffer: false, // Zero-copy swapchain flipping for maximum GPU throughput
});

function resizeViewport() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  worldCamera.aspect = width / height;
  worldCamera.updateProjectionMatrix();

  characterCamera.aspect = width / height;
  characterCamera.updateProjectionMatrix();

  renderer.setSize(width, height);
  // Clamping pixel ratio to 1.25 preserves crisp edges while keeping fragment fillrate high on HiDPI displays
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
}

resizeViewport();
window.addEventListener('resize', resizeViewport);

renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// Shadow mapping disabled (scene is lit purely by the equirectangular skybox environment)
renderer.shadowMap.enabled = false;

// --- Modular Procedural Terrain System with Mountains and Rock Texturing ---
const terrainManager = new TerrainManager(scene, {
  chunkSize: 128,        // Expanded chunk size for vast alpine terrain scale (was 96)
  chunkSegments: 18,     // Smooth high-fidelity close resolution with lower vertex overhead
  renderDistance: 4,     // 512m chunk radius (~49 chunks) for high-FPS gameplay matching horizon fog
  treeGridStep: 12.5,    // Lush alpine conifer spacing with reduced overdraw
  treeDensity: 0.68,     // Lush alpine forest density
  treeShadowRange: 36,   // Proximity shadow range for real-time conifer shadows
  maxBuildsPerFrame: 1,  // Smooth chunk streaming
  seed: Math.random() * 10000, // Randomized terrain generation seed
  treeModel: '/models/Pine_4m.glb', // Populate world with authentic Pine 4m conifer trees
  renderer,              // WebGLRenderer for offscreen GPU features
});

// --- Player Controller (First-Person FPS Skater & Snowboard System) ---
const player = new PlayerController(worldCamera, canvas, terrainManager, scene, characterCamera, characterScene);

// --- Alpine Volumetric Particle Cloud System (toggled per preset) ---
const cloudSystem = new CloudSystem(scene, {
  clusterCount: 56,
  particlesPerCluster: 18,
  wrapRadius: 1050,
  windSpeed: new THREE.Vector3(3.2, 0.0, 1.6),
  fogColor,
  fogNear: 260,
  fogFar: 1050,
});
if (cloudSystem.mesh) {
  cloudSystem.mesh.visible = false;
}

// --- Speed Effects System (Peripheral Wind Streaks, Speed Vignette, Procedural Wind Audio - muted) ---
const speedEffects = new SpeedEffects(worldCamera, scene, { muted: true });

// --- Lighting & Preset Manager ---
const lightingManager = new LightingManager({
  scene,
  characterScene,
  renderer,
  terrainManager,
  player,
  cloudSystem,
  initialPreset: 'default',
});

// Skybox & IBL (preload default skybox texture)
const skyboxPromise = lightingManager.loadSkybox(LIGHTING_PRESETS.default.skybox.path);

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
      // Ensure tree impostors match the active lighting & skybox environment
      if (terrainManager?.treeGenerator?.isLoaded) {
        lightingManager._rebakeTreeImpostors();
      }

      // Pre-generate immediate terrain chunks and compile WebGL shaders
      terrainManager.update(player.position, 0, worldCamera);
      renderer.compile(scene, worldCamera);
      renderer.compile(characterScene, characterCamera);
      renderer.render(scene, worldCamera);
    } catch (err) {
      console.warn('Pre-warming WebGL render warning:', err);
    }

    // Transition loading overlay to reveal preset choice buttons
    loadingOverlay.setReady();

    // Warm up alternate preset skybox in background for instant switching
    lightingManager.preloadSkybox(LIGHTING_PRESETS.pastelSunset.skybox.path);
  })
  .catch((err) => {
    console.warn('Asset loader finished with warning:', err);
    loadingOverlay.setReady();
  });

// Launch downhill ski run with the user's chosen lighting preset
loadingOverlay.onPlay((presetId) => {
  lightingManager.applyPreset(presetId);
  player.start();
  speedEffects.start();
});

// Expose handle for runtime telemetry and debugging
window.__GAME = {
  scene,
  camera: worldCamera,
  worldCamera,
  characterCamera,
  renderer,
  player,
  terrainManager,
  cloudSystem,
  speedEffects,
  lightingManager,
  LIGHTING_PRESETS,
  setLightingPreset: (id) => lightingManager.applyPreset(id),
};

// --- Minimal Top-Left FPS Counter ---
const fpsCounter = new FpsCounter();

// --- Simulation & Render Loop ---
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  fpsCounter.update();

  // Delta time clamping prevents physics tunneling and loading spikes after tab switch / hitches
  const rawDelta = clock.getDelta();
  const delta = Math.min(rawDelta, 0.05);
  const elapsedTime = clock.getElapsedTime();

  // 1. Update player physics, cameras, rider animations, and snow spray
  player.update(delta);

  // 2. Update visual and audio speed effects (peripheral wind streaks, speed vignette, procedural audio)
  speedEffects.update(delta, player.speed, player.velocity, player.isGrounded, elapsedTime);

  // Update directional shadow frustum if active preset uses directional shadows
  lightingManager.update(worldCamera);

  // 3. Stream procedural chunks, update camera frustum culling, tree LODs & dynamic material uniforms
  terrainManager.update(player.position, elapsedTime, worldCamera);

  // 4. Update volumetric clouds when enabled by the active preset
  if (cloudSystem.mesh?.visible) {
    cloudSystem.update(elapsedTime, player.position);
  }

  // 5. Two-Camera Composite Render:
  // Pass 1: Render world (terrain, trees, shadows, environment) with worldCamera
  renderer.autoClear = true;
  renderer.render(scene, worldCamera);

  // Pass 2: Render isolated character & snowboard overlay on top (skips traversing world chunks)
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(characterScene, characterCamera);
}

animate();
