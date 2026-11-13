import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { TerrainManager } from './terrain/TerrainManager.js';
import { PlayerController } from './player/PlayerController.js';
import { StatsMonitor } from './perf/StatsMonitor.js';
import { TreeSelectorUI } from './ui/TreeSelectorUI.js';
import './style.css';

// --- Scene Setup ---
const scene = new THREE.Scene();

// Atmosphere / Horizon Fog to blend distant chunks into the skybox
const fogColor = new THREE.Color(0xa0c6e8);
scene.fog = new THREE.Fog(fogColor, 210, 340);

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
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// --- Lighting & HDRI Skybox ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff5e6, 1.6);
sunLight.position.set(150, 220, 100);
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

// Read URL query parameter if present (?model=... or ?tree=...)
const urlParams = new URLSearchParams(window.location.search);
const selectedModel = urlParams.get('model') || urlParams.get('tree') || null;

// --- Modular Procedural Terrain System with Multi-Layer Environment Generation ---
const terrainManager = new TerrainManager(scene, {
  chunkSize: 64,         // World units per chunk
  chunkSegments: 48,     // Smooth geometric resolution
  renderDistance: 5,     // Expanded view distance for landscape vista
  maxBuildsPerFrame: 2,  // Smooth frame pacing
  seed: 4812,
  treeModel: selectedModel, // Ready for replacement models
});

// --- Player Controller ---
const player = new PlayerController(camera, canvas, terrainManager);

// --- Performance Monitor (FPS + JS Heap) ---
const statsMonitor = new StatsMonitor();

// --- Interactive Environment Status Overlay ---
new TreeSelectorUI(terrainManager, selectedModel);

// --- Window Resize Listener ---
window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

// --- Simulation & Render Loop ---
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  statsMonitor.begin();

  const delta = clock.getDelta();

  // 1. Update player physics & camera
  player.update(delta);

  // 2. Stream procedural chunks around player position
  terrainManager.update(player.position);

  // 3. Render scene
  renderer.render(scene, camera);

  statsMonitor.end();
}

animate();
