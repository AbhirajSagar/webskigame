import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { TerrainManager } from './terrain/TerrainManager.js';
import { PlayerController } from './player/PlayerController.js';
import { FpsCounter } from './perf/FpsCounter.js';
import { TreeConfigUI } from './ui/TreeConfigUI.js';
import './style.css';

// --- Scene Setup ---
const scene = new THREE.Scene();

// Atmosphere / Horizon Fog to blend distant mountain peaks into the skybox
const fogColor = new THREE.Color(0xa0c6e8);
scene.fog = new THREE.Fog(fogColor, 320, 680);

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
// Clamping pixel ratio to 1.25 maximizes fillrate performance on high-DPI/Retina screens
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// --- Lighting & HDRI Skybox ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff5e6, 1.6);
sunLight.position.set(160, 220, 110);
scene.add(sunLight);

// Skybox & IBL
const rgbeLoader = new RGBELoader();
rgbeLoader.load(
  '/kloppenheim_06_puresky_2k.hdr',
  (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = texture;
    scene.environment = texture;
  },
  undefined,
  (err) => {
    console.error('Failed to load skybox HDRI:', err);
    scene.background = fogColor;
  }
);

// --- Modular Procedural Terrain System with Mountains and Rock Texturing ---
const terrainManager = new TerrainManager(scene, {
  chunkSize: 64,         // World units per chunk
  chunkSegments: 48,     // Optimized vertex budget: 45% less geometry while retaining smooth silhouettes
  renderDistance: 5,     // Expanded view distance for landscape vista
  maxBuildsPerFrame: 2,  // Smooth frame pacing
  seed: 4812,
  treeModel: '/models/trees_pack.fbx', // Populate world with coniferous trees pack
});

// --- Player Controller ---
const player = new PlayerController(camera, canvas, terrainManager);

// Expose handle for runtime telemetry
window.__GAME = { scene, camera, player, terrainManager };

// --- High-Performance FPS & Telemetry Counter (Top Left) ---
const fpsCounter = new FpsCounter();

// --- Live Interactive Tree Configuration UI (Top Right / [T] key) ---
const treeConfigUI = new TreeConfigUI(terrainManager);

// --- Window Resize Listener ---
window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
});

// --- Simulation & Render Loop ---
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  const elapsedTime = clock.getElapsedTime();

  // 1. Update player physics & camera
  player.update(delta);

  // 2. Stream procedural chunks around player position & dynamic material uniforms
  terrainManager.update(player.position, elapsedTime, camera.position);

  // 3. Render scene
  renderer.render(scene, camera);

  // 4. Update FPS & Ski Telemetry
  fpsCounter.update(player.getSpeedKmh(), player.isAirborne());
}

animate();
