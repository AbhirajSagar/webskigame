import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { TerrainManager } from './terrain/TerrainManager.js';
import { PlayerController } from './player/PlayerController.js';
import { FpsCounter } from './perf/FpsCounter.js';
import './style.css';

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
// Clamping pixel ratio to 1.25 maximizes fillrate performance on high-DPI/Retina screens
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
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
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 10;
sunLight.shadow.camera.far = 420;

// High-resolution shadow frustum surrounding the skiing player
const shadowCoverage = 90;
sunLight.shadow.camera.left = -shadowCoverage;
sunLight.shadow.camera.right = shadowCoverage;
sunLight.shadow.camera.top = shadowCoverage;
sunLight.shadow.camera.bottom = -shadowCoverage;
sunLight.shadow.bias = -0.0003;
sunLight.shadow.normalBias = 0.04;

scene.add(sunLight);
scene.add(sunLight.target);

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

  // Center sun shadow frustum on player for continuous tree shadows while skiing
  const sunOffset = new THREE.Vector3(130, 190, 90);
  sunLight.position.copy(player.position).add(sunOffset);
  sunLight.target.position.copy(player.position);
  sunLight.target.updateMatrixWorld();

  // 2. Stream procedural chunks around player position & dynamic material uniforms
  terrainManager.update(player.position, elapsedTime, camera.position);

  // 3. Render scene
  renderer.render(scene, camera);

  // 4. Update FPS & Ski Telemetry
  fpsCounter.update(player.getSpeedKmh(), player.isAirborne());
}

animate();
