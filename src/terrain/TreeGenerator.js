import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SimplexNoise } from './Noise.js';

/**
 * Categorizes a model filename for biome placement and proportional scale
 */
export function getModelCategory(filename) {
  const f = (filename || '').toLowerCase();
  if (f.includes('pine') || f.includes('conifer') || f.includes('spruce') || f.includes('fir')) return 'pine';
  if (f.includes('birch')) return 'birch';
  if (f.includes('willow')) return 'willow';
  if (f.includes('palm')) return 'palm';
  if (f.includes('rock') || f.includes('boulder') || f.includes('stone') || f.includes('cliff')) return 'rock';
  if (f.includes('bush') || f.includes('shrub') || f.includes('berry')) return 'bush';
  if (f.includes('log') || f.includes('timber') || f.includes('branch')) return 'log';
  if (f.includes('stump')) return 'stump';
  if (f.includes('tree')) return 'common';
  return 'vegetation';
}

/**
 * Natural target height in world meters based on species category
 */
export function getBaseTargetHeight(category) {
  switch (category) {
    case 'pine': return 11.5;
    case 'common': return 9.5;
    case 'birch': return 9.0;
    case 'willow': return 9.0;
    case 'palm': return 8.5;
    case 'rock': return 2.2;
    case 'bush': return 1.2;
    case 'stump': return 0.8;
    case 'log': return 0.7;
    case 'vegetation': return 0.8;
    default: return 8.0;
  }
}

/**
 * TreeGenerator / EnvironmentGenerator
 * Preloads, centers, caches, and scatters environment models from public/models
 * using deterministic seeded Simplex noise across terrain chunks.
 * Handles missing / empty models gracefully without crashing the terrain system.
 */
export class TreeGenerator {
  // Static memory cache: path -> { filename, geometry, materials, modelHeight, category }
  static _modelCache = new Map();

  /**
   * @param {Object} options
   */
  constructor(options = {}) {
    this.seed = options.seed || 1337;
    this.heightmap = options.heightmap;
    this.chunkSize = options.chunkSize || 64;

    // Environmental density noises
    this.treeNoise = new SimplexNoise(this.seed + 777);
    this.rockNoise = new SimplexNoise(this.seed + 888);
    this.foliageNoise = new SimplexNoise(this.seed + 999);

    // Active selection (model path, filename, or array)
    this.selection = options.treeModel || options.treeModelPath || options.preset || null;

    // Categorized active models
    this.activeTrees = [];
    this.activeRocks = [];
    this.activeFoliage = [];
    this.loadedModels = [];
    this.isLoaded = false;
    this.loadPromise = null;
  }

  /**
   * Switches the active model or models and reloads.
   * @param {string|string[]} newSelection
   * @returns {Promise<TreeGenerator>}
   */
  async setModel(newSelection) {
    this.selection = newSelection;
    this.isLoaded = false;
    this.loadPromise = null;
    return this.load();
  }

  /**
   * Loads all specified models, supporting FBX, GLB, and GLTF.
   * Tolerates missing models gracefully so the application continues to run.
   * @returns {Promise<TreeGenerator>}
   */
  load() {
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      let pathsToLoad = [];

      if (Array.isArray(this.selection)) {
        pathsToLoad = this.selection;
      } else if (typeof this.selection === 'string' && this.selection.length > 0) {
        pathsToLoad = [this.selection];
      }

      // Normalize paths
      pathsToLoad = pathsToLoad.map((p) => {
        if (p.startsWith('/') || p.startsWith('http')) return p;
        if (p.startsWith('models/')) return '/' + p;
        return '/models/' + p;
      });

      const loadedList = [];

      for (const path of pathsToLoad) {
        try {
          let modelData = TreeGenerator._modelCache.get(path);
          if (!modelData) {
            modelData = await this._loadModel(path);
            if (modelData) {
              TreeGenerator._modelCache.set(path, modelData);
            }
          }
          if (modelData) {
            loadedList.push(modelData);
          }
        } catch (err) {
          console.warn(`Model at "${path}" could not be loaded:`, err?.message || err);
        }
      }

      this.loadedModels = loadedList;
      this.activeTrees = [];
      this.activeRocks = [];
      this.activeFoliage = [];

      for (const m of loadedList) {
        if (m.category === 'rock') {
          this.activeRocks.push(m);
        } else if (m.category === 'bush' || m.category === 'log' || m.category === 'stump' || m.category === 'vegetation') {
          this.activeFoliage.push(m);
        } else {
          this.activeTrees.push(m);
        }
      }

      this.isLoaded = true;
      return this;
    })();

    return this.loadPromise;
  }

  /**
   * Internal model loader supporting both FBX and GLTF/GLB formats.
   * @private
   */
  _loadModel(path) {
    return new Promise((resolve) => {
      const filename = path.split('/').pop();
      const ext = (filename.split('.').pop() || '').toLowerCase();

      if (ext === 'gltf' || ext === 'glb') {
        const gltfLoader = new GLTFLoader();
        gltfLoader.load(
          path,
          (gltf) => {
            try {
              const root = gltf.scene || gltf.scenes[0];
              const data = this._processSceneNode(root, path, filename);
              resolve(data);
            } catch (err) {
              console.warn(`Failed to process GLTF model "${path}":`, err);
              resolve(null);
            }
          },
          undefined,
          (err) => {
            console.warn(`GLTF model not found at "${path}":`, err?.message || err);
            resolve(null);
          }
        );
      } else {
        // Default to FBX loader
        const fbxLoader = new FBXLoader();
        fbxLoader.load(
          path,
          (fbx) => {
            try {
              const data = this._processSceneNode(fbx, path, filename);
              resolve(data);
            } catch (err) {
              console.warn(`Failed to process FBX model "${path}":`, err);
              resolve(null);
            }
          },
          undefined,
          (err) => {
            console.warn(`FBX model not found at "${path}":`, err?.message || err);
            resolve(null);
          }
        );
      }
    });
  }

  /**
   * Bakes node transforms, centers XZ at 0, roots base at Y=0, and creates PBR materials.
   * @private
   */
  _processSceneNode(rootNode, path, filename) {
    let meshNode = null;
    rootNode.traverse((child) => {
      if (child.isMesh && !meshNode) {
        meshNode = child;
      }
    });

    if (!meshNode) {
      console.warn(`No mesh found in "${path}"`);
      return null;
    }

    rootNode.updateMatrixWorld(true);
    const geom = meshNode.geometry.clone();
    geom.applyMatrix4(meshNode.matrixWorld);
    geom.computeBoundingBox();

    // Center XZ at 0 and root bottom at Y=0
    const centerX = (geom.boundingBox.min.x + geom.boundingBox.max.x) / 2;
    const centerZ = (geom.boundingBox.min.z + geom.boundingBox.max.z) / 2;
    const minY = geom.boundingBox.min.y;

    geom.translate(-centerX, -minY, -centerZ);
    geom.computeBoundingBox();
    geom.computeBoundingSphere();

    const modelHeight = Math.max(0.1, geom.boundingBox.max.y);
    const category = getModelCategory(filename);
    const targetHeight = getBaseTargetHeight(category);

    const rawMaterials = Array.isArray(meshNode.material)
      ? meshNode.material
      : [meshNode.material];

    const materials = rawMaterials.map((m) => this._createPbrMaterial(m));

    return {
      filename,
      path,
      category,
      targetHeight,
      modelHeight,
      geometry: geom,
      materials,
    };
  }

  /**
   * Converts imported materials into cohesive PBR MeshStandardMaterials.
   * @private
   */
  _createPbrMaterial(m) {
    const name = (m.name || '').toLowerCase();

    let color;
    let roughness = 0.80;
    let metalness = 0.04;

    if (name.includes('snow')) {
      color = new THREE.Color(0xf6f9fc);
      roughness = 0.70;
    } else if (name.includes('black')) {
      color = new THREE.Color(0x181818);
      roughness = 0.85;
    } else if (name.includes('white')) {
      color = new THREE.Color(0xd2dad4);
      roughness = 0.78;
    } else if (name.includes('darkgreen')) {
      color = new THREE.Color(0x1b3824);
      roughness = 0.76;
    } else if (name.includes('green') || name.includes('leaves') || name.includes('needle') || name.includes('leaf')) {
      color = new THREE.Color(0x28472e);
      roughness = 0.74;
    } else if (name.includes('cap') || name.includes('cut')) {
      color = new THREE.Color(0x735c42);
      roughness = 0.82;
    } else if (name.includes('orange') || name.includes('lightorange')) {
      color = new THREE.Color(0xd96b27);
      roughness = 0.76;
    } else if (name.includes('lightwood')) {
      color = new THREE.Color(0x8a6d52);
      roughness = 0.80;
    } else if (name.includes('wood') || name.includes('bark') || name.includes('trunk')) {
      color = new THREE.Color(0x3e2b20);
      roughness = 0.86;
    } else if (name.includes('rock') || name.includes('stone')) {
      color = new THREE.Color(0x5a5f66);
      roughness = 0.88;
      metalness = 0.06;
    } else if (m.color) {
      color = m.color.clone();
    } else {
      color = new THREE.Color(0xd2d8cc);
    }

    const pbr = new THREE.MeshStandardMaterial({
      name: m.name || 'EnvironmentMaterial',
      color,
      roughness,
      metalness,
      map: m.map || null,
      side: THREE.DoubleSide,
      flatShading: false,
    });

    if (name.includes('leaf') || name.includes('needle') || name.includes('leaves')) {
      pbr.alphaTest = 0.35;
      pbr.transparent = false;
    }

    return pbr;
  }

  /**
   * Deterministic 4-component integer hash.
   * Produces uniform pseudo-random numbers in [0, 1) without memory allocations.
   * @private
   */
  _hash(a, b, c, d) {
    let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791) ^ (d * 39916801);
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967296;
  }

  /**
   * Generates environment instances for a chunk.
   * If no models are loaded, returns null cleanly.
   * @param {number} chunkX
   * @param {number} chunkZ
   * @returns {THREE.InstancedMesh|THREE.Group|null}
   */
  generateChunkTreeMesh(chunkX, chunkZ) {
    if (!this.isLoaded || !this.heightmap || this.loadedModels.length === 0) {
      return null;
    }

    const minX = chunkX * this.chunkSize;
    const minZ = chunkZ * this.chunkSize;
    const instancesByModel = new Map();

    const addInstance = (modelData, x, y, z, scale, yaw, tiltX = 0, tiltZ = 0) => {
      let list = instancesByModel.get(modelData);
      if (!list) {
        list = [];
        instancesByModel.set(modelData, list);
      }
      list.push({ x, y, z, scale, yaw, tiltX, tiltZ });
    };

    // 1. Trees layer
    if (this.activeTrees.length > 0) {
      const treeGridStep = 8;
      const cells = Math.floor(this.chunkSize / treeGridStep);

      for (let gx = 0; gx < cells; gx++) {
        for (let gz = 0; gz < cells; gz++) {
          const u = this._hash(chunkX, chunkZ, gx, gz * 2 + 1);
          const v = this._hash(chunkX, chunkZ, gx * 2 + 3, gz);
          const spawnHash = this._hash(chunkX, chunkZ, gx * 7, gz * 11);

          const wx = minX + (gx + 0.15 + 0.7 * u) * treeGridStep;
          const wz = minZ + (gz + 0.15 + 0.7 * v) * treeGridStep;

          if (Math.hypot(wx, wz) < 6.0) continue;

          const wy = this.heightmap.getHeight(wx, wz);
          if (wy > 46.0 || wy < -20.0) continue;

          const norm = this.heightmap.getNormal(wx, wz);
          if (norm.y < 0.72) continue;

          const density = this.treeNoise.fbm(wx * 0.012, wz * 0.012, 2);
          const prob = Math.max(0, Math.min(1, (density + 0.22) / 0.65));
          if (spawnHash >= prob * 0.55) continue;

          const speciesHash = this._hash(chunkX, chunkZ, gx * 43, gz * 47);
          const modelIdx = Math.floor(speciesHash * this.activeTrees.length) % this.activeTrees.length;
          const modelData = this.activeTrees[modelIdx];

          const scaleHash = this._hash(chunkX, chunkZ, gx * 13, gz * 17);
          const rotHash = this._hash(chunkX, chunkZ, gx * 19, gz * 23);
          const tiltXHash = this._hash(chunkX, chunkZ, gx * 29, gz * 31);
          const tiltZHash = this._hash(chunkX, chunkZ, gx * 37, gz * 41);

          const h = modelData.targetHeight * (0.8 + 0.4 * scaleHash);
          const scale = h / modelData.modelHeight;
          const yaw = rotHash * Math.PI * 2;
          const tiltX = (tiltXHash - 0.5) * 0.08;
          const tiltZ = (tiltZHash - 0.5) * 0.08;

          addInstance(modelData, wx, wy - 0.25, wz, scale, yaw, tiltX, tiltZ);
        }
      }
    }

    // 2. Rocks layer
    if (this.activeRocks.length > 0) {
      const rockGridStep = 16;
      const cells = Math.floor(this.chunkSize / rockGridStep);

      for (let gx = 0; gx < cells; gx++) {
        for (let gz = 0; gz < cells; gz++) {
          const u = this._hash(chunkX, chunkZ, gx, gz * 3 + 1);
          const v = this._hash(chunkX, chunkZ, gx * 3 + 5, gz);
          const spawnHash = this._hash(chunkX, chunkZ, gx * 13, gz * 17);

          const wx = minX + (gx + 0.15 + 0.7 * u) * rockGridStep;
          const wz = minZ + (gz + 0.15 + 0.7 * v) * rockGridStep;

          if (Math.hypot(wx, wz) < 5.0) continue;

          const wy = this.heightmap.getHeight(wx, wz);
          if (wy < -18.0 || wy > 75.0) continue;

          const norm = this.heightmap.getNormal(wx, wz);
          if (norm.y < 0.45 || norm.y > 0.95) continue;

          const rockDensity = this.rockNoise.fbm(wx * 0.018, wz * 0.018, 2);
          if (spawnHash >= 0.28 + rockDensity * 0.15) continue;

          const modelHash = this._hash(chunkX, chunkZ, gx * 53, gz * 59);
          const modelIdx = Math.floor(modelHash * this.activeRocks.length) % this.activeRocks.length;
          const modelData = this.activeRocks[modelIdx];

          const scaleHash = this._hash(chunkX, chunkZ, gx * 61, gz * 67);
          const rotHash = this._hash(chunkX, chunkZ, gx * 71, gz * 73);

          const h = modelData.targetHeight * (0.7 + 0.6 * scaleHash);
          const scale = h / modelData.modelHeight;
          const yaw = rotHash * Math.PI * 2;

          addInstance(modelData, wx, wy - 0.35, wz, scale, yaw);
        }
      }
    }

    // 3. Foliage layer
    if (this.activeFoliage.length > 0) {
      const foliageGridStep = 12.8;
      const cells = Math.floor(this.chunkSize / foliageGridStep);

      for (let gx = 0; gx < cells; gx++) {
        for (let gz = 0; gz < cells; gz++) {
          const u = this._hash(chunkX, chunkZ, gx, gz * 4 + 3);
          const v = this._hash(chunkX, chunkZ, gx * 4 + 7, gz);
          const spawnHash = this._hash(chunkX, chunkZ, gx * 19, gz * 23);

          const wx = minX + (gx + 0.15 + 0.7 * u) * foliageGridStep;
          const wz = minZ + (gz + 0.15 + 0.7 * v) * foliageGridStep;

          if (Math.hypot(wx, wz) < 5.0) continue;

          const wy = this.heightmap.getHeight(wx, wz);
          if (wy < -18.0 || wy > 38.0) continue;

          const norm = this.heightmap.getNormal(wx, wz);
          if (norm.y < 0.78) continue;

          const foliageDensity = this.foliageNoise.fbm(wx * 0.022, wz * 0.022, 2);
          if (spawnHash >= 0.22 + foliageDensity * 0.12) continue;

          const modelHash = this._hash(chunkX, chunkZ, gx * 79, gz * 83);
          const modelIdx = Math.floor(modelHash * this.activeFoliage.length) % this.activeFoliage.length;
          const modelData = this.activeFoliage[modelIdx];

          const scaleHash = this._hash(chunkX, chunkZ, gx * 89, gz * 97);
          const rotHash = this._hash(chunkX, chunkZ, gx * 101, gz * 103);

          const h = modelData.targetHeight * (0.8 + 0.4 * scaleHash);
          const scale = h / modelData.modelHeight;
          const yaw = rotHash * Math.PI * 2;

          addInstance(modelData, wx, wy - 0.15, wz, scale, yaw);
        }
      }
    }

    if (instancesByModel.size === 0) return null;

    const dummy = new THREE.Object3D();
    const createdMeshes = [];

    for (const [modelData, instances] of instancesByModel.entries()) {
      if (instances.length === 0) continue;

      const instMesh = new THREE.InstancedMesh(
        modelData.geometry,
        modelData.materials,
        instances.length
      );

      for (let i = 0; i < instances.length; i++) {
        const inst = instances[i];
        dummy.position.set(inst.x, inst.y, inst.z);
        dummy.rotation.set(inst.tiltX, inst.yaw, inst.tiltZ);
        dummy.scale.set(inst.scale, inst.scale, inst.scale);
        dummy.updateMatrix();
        instMesh.setMatrixAt(i, dummy.matrix);
      }

      instMesh.instanceMatrix.needsUpdate = true;
      instMesh.computeBoundingSphere();
      instMesh.computeBoundingBox();
      instMesh.castShadow = true;
      instMesh.receiveShadow = true;

      createdMeshes.push(instMesh);
    }

    if (createdMeshes.length === 1) {
      return createdMeshes[0];
    }

    const group = new THREE.Group();
    for (const mesh of createdMeshes) {
      group.add(mesh);
    }
    return group;
  }
}

// Backwards-compatible aliases
export const EnvironmentGenerator = TreeGenerator;
export const AVAILABLE_TREE_MODELS = [];
export const TREE_MODEL_LIST = [];
export const ALL_MODEL_FILENAMES = [];
export const ENVIRONMENT_PRESETS = [];
export const resolveTreeModelPath = (s) => s || '';
export const resolveEnvironmentSelection = (s) => s || '';
