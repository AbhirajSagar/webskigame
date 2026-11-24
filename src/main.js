import * as THREE from 'three';
window.THREE = THREE;
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { TerrainManager } from './terrain/TerrainManager.js';
import { PlayerController } from './player/PlayerController.js';
import { LoadingOverlay } from './ui/LoadingOverlay.js';
import { CloudSystem } from './environment/CloudSystem.js';
import { VideoRecorder } from './ui/VideoRecorder.js';
import { SpeedEffects } from './fx/SpeedEffects.js';
import { SunLensFlare } from './fx/SunLensFlare.js';
import { FpsCounter } from './perf/FpsCounter.js';
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

// Atmosphere / Horizon Fog to blend distant mountain peaks into the skybox
const fogColor = new THREE.Color(0xc6cdd5);
scene.fog = new THREE.Fog(fogColor, 200, 850);

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
  // Clamping pixel ratio to 1.5 preserves crisp edges on pine needles and alpine ridges
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
}

resizeViewport();
window.addEventListener('resize', resizeViewport);

renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// Enable soft real-time dynamic shadow mapping
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

// --- Lighting & HDRI Skybox ---
// Crisp cool sky ambient paired with warm sunlight for clear alpine contrast
const ambientLight = new THREE.AmbientLight(0xd0e2f7, 0.17);
ambientLight.layers.enable(0);
ambientLight.layers.enable(1);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffeacc, 2.3);
sunLight.position.set(130, 190, 90);
sunLight.castShadow = true;
sunLight.layers.enable(0);
sunLight.shadow.camera.layers.set(0);
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

// Dedicated lightweight lighting for Pass 2 characterScene (avoids world traversal)
const charAmbientLight = new THREE.AmbientLight(0xd0e2f7, 0.17);
charAmbientLight.layers.enable(1);
characterScene.add(charAmbientLight);
const charSunLight = new THREE.DirectionalLight(0xffeacc, 2.3);
charSunLight.position.set(130, 190, 90);
charSunLight.layers.enable(1);
characterScene.add(charSunLight);

// Update shadow map explicitly when shadow frustum snaps or on cadence (saves redundant shadow passes)
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;

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
      characterScene.environment = texture;
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
  treeGridStep: 11.0,    // Denser conifer forest spacing across expansive slopes
  treeDensity: 0.68,     // Lush alpine forest density
  treeShadowRange: 48,   // Proximity shadow range for real-time conifer shadows
  maxBuildsPerFrame: 1,  // Smooth 60fps chunk streaming
  seed: Math.random() * 10000, // Randomized terrain generation seed
  treeModel: '/models/Pine_4m.glb', // Populate world with authentic Pine 4m conifer trees
  renderer,              // WebGLRenderer for offscreen GPU features
});

// --- Player Controller (First-Person FPS Skater & Snowboard System) ---
const player = new PlayerController(worldCamera, canvas, terrainManager, scene, characterCamera, characterScene);

// --- Alpine Volumetric Particle Cloud System ---
const cloudSystem = new CloudSystem(scene, {
  clusterCount: 64,
  particlesPerCluster: 32, // 2048 dense camera-facing billboard particles forming volumetric clouds
  wrapRadius: 1350,
  windSpeed: new THREE.Vector3(3.2, 0.0, 1.6),
  sunDirection: new THREE.Vector3(130, 190, 90).normalize(),
  fogColor,
  fogNear: 200,
  fogFar: 850,
});

// --- Speed Effects System (Peripheral Wind Streaks, Speed Vignette, Procedural Wind Audio - muted) ---
const speedEffects = new SpeedEffects(worldCamera, scene, { muted: true });

// --- Procedural Sun Lens Flare (Terrain-Occluded Optical Flare) ---
const sunLensFlare = new SunLensFlare(scene, sunLight.position);

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
      renderer.compile(characterScene, characterCamera);
      renderer.shadowMap.needsUpdate = true;
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
  speedEffects.start();
});

// --- Instagram Reels 60 FPS Video Recorder (Canvas capture, zero UI in video) ---
const videoRecorder = new VideoRecorder(canvas, { fps: 60, bitrate: 16000000 });

// Expose handle for runtime telemetry and debugging (clean recording mode, no HUD UI)
window.__GAME = { scene, camera: worldCamera, worldCamera, characterCamera, renderer, player, terrainManager, cloudSystem, videoRecorder, speedEffects, sunLensFlare };

// --- Minimal Top-Left FPS Counter ---
const fpsCounter = new FpsCounter();

// --- Simulation & Render Loop ---
const clock = new THREE.Clock();

// Pre-allocated math vectors for 0-allocation per-frame render loop
const sunOffset = new THREE.Vector3(130, 190, 90);
const forwardDir = new THREE.Vector3();
const shadowCenter = new THREE.Vector3();
const shadowTexelSize = (2 * shadowCoverage) / 1024;
let lastShadowSnapX = Infinity;
let lastShadowSnapZ = Infinity;
let shadowFrameCounter = 0;

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

  // Forward-biased sun shadow frustum: biases shadow coverage around rider
  worldCamera.getWorldDirection(forwardDir);
  forwardDir.y = 0;
  if (forwardDir.lengthSq() > 0.001) forwardDir.normalize();

  shadowCenter.copy(player.position).addScaledVector(forwardDir, 16);

  // Discrete texel grid snapping: locks shadow map coordinates to whole texels
  shadowCenter.x = Math.floor(shadowCenter.x / shadowTexelSize) * shadowTexelSize;
  shadowCenter.z = Math.floor(shadowCenter.z / shadowTexelSize) * shadowTexelSize;

  shadowFrameCounter++;
  if (shadowCenter.x !== lastShadowSnapX || shadowCenter.z !== lastShadowSnapZ || (shadowFrameCounter % 3) === 0) {
    lastShadowSnapX = shadowCenter.x;
    lastShadowSnapZ = shadowCenter.z;
    sunLight.position.copy(shadowCenter).add(sunOffset);
    sunLight.target.position.copy(shadowCenter);
    sunLight.target.updateMatrixWorld();
    renderer.shadowMap.needsUpdate = true;
  }

  // 2. Stream procedural chunks, update camera frustum culling, tree LODs & dynamic material uniforms
  terrainManager.update(player.position, elapsedTime, worldCamera);

  // Update volumetric cloud particles (wind drift, billow pulse, toroidal wrapping around player)
  cloudSystem.update(elapsedTime, player.position);

  // Update sun lens flare projection & mountain occlusion
  sunLensFlare.update(delta, worldCamera, terrainManager);

  // 3. Two-Camera Composite Render:
  // Pass 1: Render world (terrain, trees, shadows, environment) with worldCamera
  renderer.autoClear = true;
  renderer.render(scene, worldCamera);

  // Pass 2: Render isolated character & snowboard overlay on top (skips traversing world chunks)
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(characterScene, characterCamera);
}

animate();
