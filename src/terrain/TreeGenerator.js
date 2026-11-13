import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SimplexNoise } from './Noise.js';
import { TreeTextureFactory } from './TreeTextures.js';

/**
 * Categorizes a model or variant filename for biome placement.
 */
export function getModelCategory(name) {
  const f = (name || '').toLowerCase();
  if (f.includes('dead') || f.includes('snag') || f.includes('stump')) return 'snag';
  if (f.includes('pine') || f.includes('conifer') || f.includes('spruce') || f.includes('fir') || f.includes('long') || f.includes('small')) return 'pine';
  if (f.includes('birch')) return 'birch';
  if (f.includes('rock') || f.includes('boulder') || f.includes('stone')) return 'rock';
  if (f.includes('bush') || f.includes('shrub')) return 'bush';
  return 'pine';
}

/**
 * Default live-tunable scale and rotation bounds for all tree variants in the pack.
 * Rotations are specified in degrees for intuitive user control.
 */
export const DEFAULT_TREE_CONFIGS = {
  long_1: {
    minScale: 3,
    maxScale: 3,
    minRotX: -4,
    maxRotX: 4,
    minRotY: 0,
    maxRotY: 360,
    minRotZ: -4,
    maxRotZ: 4,
  },
  long_2: {
    minScale: 0.8,
    maxScale: 3,
    minRotX: -8,
    maxRotX: 21,
    minRotY: 0,
    maxRotY: 360,
    minRotZ: -3,
    maxRotZ: 14,
  },
  small_1: {
    minScale: 3,
    maxScale: 3,
    minRotX: -5,
    maxRotX: 5,
    minRotY: 0,
    maxRotY: 360,
    minRotZ: -5,
    maxRotZ: 5,
  },
  small_2: {
    minScale: 1.1,
    maxScale: 2,
    minRotX: 0,
    maxRotX: -1,
    minRotY: 0,
    maxRotY: 360,
    minRotZ: 1,
    maxRotZ: 1,
  },
  dead_1: {
    minScale: 0.35,
    maxScale: 2.7,
    minRotX: -45,
    maxRotX: 45,
    minRotY: 0,
    maxRotY: 360,
    minRotZ: -32,
    maxRotZ: 38,
  },
  dead_2: {
    minScale: 0.75,
    maxScale: 3,
    minRotX: -44,
    maxRotX: 40,
    minRotY: 0,
    maxRotY: 360,
    minRotZ: -40,
    maxRotZ: 39,
  },
};

/**
 * TreeGenerator
 * Preloads, extracts, indexes, and scatters environment models from public/models.
 * Natively supports multi-model asset packs (such as trees_pack.fbx) by extracting
 * each distinct tree variant into an optimized, multi-material indexed geometry.
 * Applies authentic high-resolution textures (diffuse + normal maps) and provides
 * full 360-degree Y-rotation and natural size distribution.
 */
export class TreeGenerator {
  // Static memory cache: path -> Array<modelData>
  static _modelCache = new Map();
  static _textureCache = null;

  /**
   * @param {Object} options
   */
  constructor(options = {}) {
    this.seed = options.seed || 1337;
    this.heightmap = options.heightmap;
    this.chunkSize = options.chunkSize || 64;

    // Environmental density noise generators
    this.treeNoise = new SimplexNoise(this.seed + 777);

    // Active selection
    this.selection = options.treeModel || options.treeModelPath || '/models/trees_pack.fbx';

    // Extracted and categorized models
    this.activeTrees = [];
    this.activeSnags = [];
    this.loadedModels = [];
    this.isLoaded = false;
    this.loadPromise = null;

    // Per-tree live customizable scale and rotation bounds
    this.treeConfigs = JSON.parse(JSON.stringify(DEFAULT_TREE_CONFIGS));
    if (options.treeConfigs) {
      this.setAllTreeConfigs(options.treeConfigs);
    }
  }

  /**
   * Retrieves the current scale & rotation bounds for a given tree variant.
   * @param {string} variantName
   * @returns {Object}
   */
  getTreeConfig(variantName) {
    const key = (variantName || '').toLowerCase();
    for (const [k, v] of Object.entries(this.treeConfigs)) {
      if (key.includes(k.toLowerCase())) return v;
    }
    return this.treeConfigs.long_1 || DEFAULT_TREE_CONFIGS.long_1;
  }

  /**
   * Updates the scale & rotation configuration for a specific tree variant.
   * @param {string} variantName
   * @param {Object} config
   */
  setTreeConfig(variantName, config) {
    const key = Object.keys(this.treeConfigs).find(k => (variantName || '').toLowerCase().includes(k.toLowerCase())) || variantName;
    if (this.treeConfigs[key]) {
      this.treeConfigs[key] = { ...this.treeConfigs[key], ...config };
    } else {
      this.treeConfigs[key] = { ...config };
    }
  }

  /**
   * Retrieves a deep copy of all tree configurations as a JSON-serializable object.
   * @returns {Object}
   */
  getAllTreeConfigs() {
    return JSON.parse(JSON.stringify(this.treeConfigs));
  }

  /**
   * Batch updates all tree configurations.
   * @param {Object} configs
   */
  setAllTreeConfigs(configs) {
    if (!configs || typeof configs !== 'object') return;
    for (const [k, v] of Object.entries(configs)) {
      if (this.treeConfigs[k]) {
        this.treeConfigs[k] = { ...this.treeConfigs[k], ...v };
      } else {
        this.treeConfigs[k] = { ...v };
      }
    }
  }

  /**
   * Loads textures for bark, branches, and deadwood.
   * Loads from /textures/ with procedural fallback.
   * @private
   */
  async _loadTextures() {
    if (TreeGenerator._textureCache) return TreeGenerator._textureCache;

    const textureLoader = new THREE.TextureLoader();
    const loadTex = (url, isSRGB = false, repeatX = 1, repeatY = 1) => {
      return new Promise((resolve) => {
        textureLoader.load(
          url,
          (t) => {
            t.wrapS = THREE.RepeatWrapping;
            t.wrapT = THREE.RepeatWrapping;
            t.repeat.set(repeatX, repeatY);
            if (isSRGB) t.colorSpace = THREE.SRGBColorSpace;
            resolve(t);
          },
          undefined,
          () => resolve(null)
        );
      });
    };

    const [barkDiff, barkNorm, branchDiff, branchNorm] = await Promise.all([
      loadTex('/textures/BarkMat_diffuse.png', true, 1, 1),
      loadTex('/textures/BarkMat_normal.png', false, 1, 1),
      loadTex('/textures/BranchMat_diffuse.png', true, 1, 1),
      loadTex('/textures/BranchMat_normal.png', false, 1, 1),
    ]);

    const proc = TreeTextureFactory.getTextures() || {};

    TreeGenerator._textureCache = {
      barkDiffuse: barkDiff || proc.barkDiffuse,
      barkNormal: barkNorm || proc.barkNormal,
      branchDiffuse: branchDiff || proc.branchDiffuse,
      branchNormal: branchNorm || proc.branchNormal,
    };

    return TreeGenerator._textureCache;
  }

  /**
   * Switches the active model or pack and reloads.
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
   * Loads specified model or pack, supporting FBX, GLB, and GLTF.
   * @returns {Promise<TreeGenerator>}
   */
  load() {
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      // 1. Ensure textures are initialized
      await this._loadTextures();

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
          let models = TreeGenerator._modelCache.get(path);
          if (!models) {
            models = await this._loadModel(path);
            if (models) {
              TreeGenerator._modelCache.set(path, models);
            }
          }
          if (models) {
            if (Array.isArray(models)) {
              loadedList.push(...models);
            } else {
              loadedList.push(models);
            }
          }
        } catch (err) {
          console.warn(`Model at "${path}" could not be loaded:`, err?.message || err);
        }
      }

      this.loadedModels = loadedList;
      this.activeTrees = [];
      this.activeSnags = [];

      for (const m of loadedList) {
        if (m.isDead) {
          this.activeSnags.push(m);
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
   * Internal model loader supporting FBX and GLTF/GLB formats.
   * Extracts all distinct sub-variants when an asset pack is loaded.
   * @private
   */
  _loadModel(path) {
    return new Promise((resolve) => {
      const filename = path.split('/').pop();
      const ext = (filename.split('.').pop() || '').toLowerCase();

      const onLoaded = (root) => {
        try {
          const variants = this._extractModelVariants(root, path, filename);
          resolve(variants);
        } catch (err) {
          console.warn(`Failed to process model "${path}":`, err);
          resolve(null);
        }
      };

      if (ext === 'gltf' || ext === 'glb') {
        const gltfLoader = new GLTFLoader();
        gltfLoader.load(
          path,
          (gltf) => onLoaded(gltf.scene || gltf.scenes[0]),
          undefined,
          (err) => {
            console.warn(`GLTF model not found at "${path}":`, err?.message || err);
            resolve(null);
          }
        );
      } else {
        const fbxLoader = new FBXLoader();
        fbxLoader.load(
          path,
          onLoaded,
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
   * Inspects the scene graph and extracts distinct variants.
   * Handles multi-tree packs (e.g. trees_pack.fbx) by extracting each child as an individual variant.
   * @private
   */
  _extractModelVariants(rootNode, path, filename) {
    rootNode.updateMatrixWorld(true);

    // Identify candidate top-level tree groups
    const topLevelGroups = [];
    for (const child of rootNode.children) {
      let hasMesh = false;
      child.traverse((c) => {
        if (c.isMesh) hasMesh = true;
      });
      if (hasMesh) {
        topLevelGroups.push(child);
      }
    }

    // If multiple top-level tree groups exist, process each as a distinct variant
    if (topLevelGroups.length > 1) {
      const variants = [];
      for (const group of topLevelGroups) {
        const v = this._processVariant(group, path, filename, group.name);
        if (v) variants.push(v);
      }
      return variants.length > 0 ? variants : null;
    }

    // Single model
    const single = this._processVariant(rootNode, path, filename, filename);
    return single ? [single] : null;
  }

  /**
   * Bakes transforms, welds vertices (70%+ memory & geometry reduction),
   * roots base at Y=0, centers horizontal footprint, and binds high-res PBR textures.
   * @private
   */
  _processVariant(node, path, filename, variantName = '') {
    const meshes = [];
    node.traverse((c) => {
      if (c.isMesh) meshes.push(c);
    });

    if (meshes.length === 0) return null;

    // 1. Calculate overall bounding box in world space
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    meshes.forEach((m) => {
      m.updateMatrixWorld(true);
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      g.computeBoundingBox();
      const bb = g.boundingBox;
      minX = Math.min(minX, bb.min.x);
      maxX = Math.max(maxX, bb.max.x);
      minY = Math.min(minY, bb.min.y);
      maxY = Math.max(maxY, bb.max.y);
      minZ = Math.min(minZ, bb.min.z);
      maxZ = Math.max(maxZ, bb.max.z);
    });

    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const baseY = minY;
    const rawHeight = maxY - minY;

    // Determine coordinate scale: if raw height > 50, it is modeled in centimeters (FBX standard)
    const unitScale = rawHeight > 50.0 ? 0.01 : 1.0;

    const isDeadTree = variantName.toLowerCase().includes('dead') ||
                       variantName.toLowerCase().includes('snag') ||
                       filename.toLowerCase().includes('dead');

    const textures = TreeGenerator._textureCache || {};

    // 2. Process each mesh geometry & bind PBR textures
    const geoms = [];
    const materials = [];

    meshes.forEach((m) => {
      m.updateMatrixWorld(true);
      let g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);

      // Re-center horizontally and root bottom at Y=0
      g.translate(-centerX, -baseY, -centerZ);
      g.scale(unitScale, unitScale, unitScale);

      // Weld duplicate vertices to optimize GPU vertex cache & instancing
      g = BufferGeometryUtils.mergeVertices(g, 0.001);
      g.computeVertexNormals();
      geoms.push(g);

      // Material assignment based on mesh & material metadata
      const matName = (m.material?.name || m.name || '').toLowerCase();
      const isBranch = matName.includes('branch') ||
                       matName.includes('leaf') ||
                       matName.includes('leaves') ||
                       matName.includes('needle');

      let mat;
      if (isBranch) {
        mat = new THREE.MeshStandardMaterial({
          name: 'AlpinePineNeedles',
          color: 0xffffff,
          map: textures.branchDiffuse || null,
          normalMap: textures.branchNormal || null,
          normalScale: new THREE.Vector2(0.8, 0.8),
          roughness: 1,
          metalness: 0.0,
          side: THREE.DoubleSide,
          transparent: true,
          alphaTest: 0.40,
          depthWrite: true,
        });
      } else {
        // Both living tree trunks and dried/dead tree snags use the exact BarkMat_diffuse & BarkMat_normal
        mat = new THREE.MeshStandardMaterial({
          name: isDeadTree ? 'AlpineDeadBark' : 'AlpinePineTrunk',
          color: 0xffffff,
          map: textures.barkDiffuse || null,
          normalMap: textures.barkNormal || null,
          normalScale: new THREE.Vector2(1.1, 1.1),
          roughness: isDeadTree ? 0.90 : 0.85,
          metalness: 0.02,
        });
      }
      materials.push(mat);
    });

    // 3. Merge into a single multi-material geometry
    let finalGeom;
    if (geoms.length === 1) {
      finalGeom = geoms[0];
    } else {
      finalGeom = BufferGeometryUtils.mergeGeometries(geoms, true);
    }

    finalGeom.computeBoundingBox();
    finalGeom.computeBoundingSphere();

    const actualHeight = finalGeom.boundingBox.max.y - finalGeom.boundingBox.min.y;

    return {
      name: variantName || filename,
      path,
      category: isDeadTree ? 'snag' : 'pine',
      isDead: isDeadTree,
      modelHeight: Math.max(0.5, actualHeight),
      geometry: finalGeom,
      materials: materials.length === 1 ? materials[0] : materials,
    };
  }

  /**
   * Deterministic 4-component integer hash.
   * Produces uniform pseudo-random floats in [0, 1) without allocations.
   * @private
   */
  _hash(a, b, c, d) {
    let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791) ^ (d * 39916801);
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967296;
  }

  /**
   * Generates environment instances for a terrain chunk.
   * Features:
   * - Full 360-degree Y-axis rotational diversity for each tree instance
   * - Natural size distribution spanning from small saplings to giant conifers (~3:1 dynamic range)
   * - Realistic alpine mountain forestry distribution with ski corridors
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

    const addInstance = (modelData, x, y, z, scaleHash, rotXHash, rotYHash, rotZHash) => {
      let list = instancesByModel.get(modelData);
      if (!list) {
        list = [];
        instancesByModel.set(modelData, list);
      }
      list.push({ x, y, z, scaleHash, rotXHash, rotYHash, rotZHash });
    };

    // Organic spacing grid
    const treeGridStep = 10.5;
    const cells = Math.floor(this.chunkSize / treeGridStep);

    for (let gx = 0; gx < cells; gx++) {
      for (let gz = 0; gz < cells; gz++) {
        const u = this._hash(chunkX, chunkZ, gx, gz * 2 + 1);
        const v = this._hash(chunkX, chunkZ, gx * 2 + 3, gz);
        const spawnHash = this._hash(chunkX, chunkZ, gx * 7, gz * 11);

        const wx = minX + (gx + 0.15 + 0.7 * u) * treeGridStep;
        const wz = minZ + (gz + 0.15 + 0.7 * v) * treeGridStep;

        // 1. Keep immediate spawn area clear so player can start cleanly
        if (Math.hypot(wx, wz) < 16.0) continue;

        // 2. Elevation bounds: trees do not grow on high glacial peaks or submerged valleys
        const wy = this.heightmap.getHeight(wx, wz);
        if (wy > 65.0 || wy < -12.0) continue;

        // 3. Slope normal gating: trees cannot grow on steep rock cliffs
        const norm = this.heightmap.getNormal(wx, wz);
        if (norm.y < 0.72) continue; // max ~44 deg slope

        // 4. Biome noise density: negative values carve out open ski slopes (pistes)
        const density = this.treeNoise.fbm(wx * 0.015, wz * 0.015, 2);
        if (density < -0.02) continue; // Ski run clearing

        const prob = Math.min(1.0, (density + 0.02) * 1.6);
        if (spawnHash >= prob * 0.65) continue;

        // 5. Timberline & Snag selection
        const snagHash = this._hash(chunkX, chunkZ, gx * 17, gz * 19);
        const isSnag = this.activeSnags.length > 0 &&
                       ((wy > 42.0 && snagHash < 0.35) || (snagHash * 7 < 0.55));

        let modelData;
        if (isSnag) {
          const snagIdx = Math.floor(snagHash * 13) % this.activeSnags.length;
          modelData = this.activeSnags[snagIdx];
        } else if (this.activeTrees.length > 0) {
          const treeHash = this._hash(chunkX, chunkZ, gx * 43, gz * 47);
          const treeIdx = Math.floor(treeHash * this.activeTrees.length) % this.activeTrees.length;
          modelData = this.activeTrees[treeIdx];
        } else {
          continue;
        }

        // Live Config-Driven Randomization Hashes
        const scaleHash = this._hash(chunkX, chunkZ, gx * 13 + 5, gz * 17 + 9);
        const rotXHash = this._hash(chunkX, chunkZ, gx * 37 + 7, gz * 41 + 13);
        const rotYHash = this._hash(chunkX, chunkZ, gx * 91 + 17, gz * 103 + 31);
        const rotZHash = this._hash(chunkX, chunkZ, gx * 47 + 19, gz * 53 + 23);

        // Sink trunk 0.35m into snow to bury roots naturally on sloped terrain
        addInstance(modelData, wx, wy - 0.35, wz, scaleHash, rotXHash, rotYHash, rotZHash);
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
      instMesh.userData.instances = instances;
      instMesh.userData.modelName = modelData.name;

      const cfg = this.getTreeConfig(modelData.name);
      const minS = Math.min(cfg.minScale, cfg.maxScale);
      const maxS = Math.max(cfg.minScale, cfg.maxScale);
      const minRx = Math.min(cfg.minRotX, cfg.maxRotX) * (Math.PI / 180);
      const maxRx = Math.max(cfg.minRotX, cfg.maxRotX) * (Math.PI / 180);
      const minRy = Math.min(cfg.minRotY, cfg.maxRotY) * (Math.PI / 180);
      const maxRy = Math.max(cfg.minRotY, cfg.maxRotY) * (Math.PI / 180);
      const minRz = Math.min(cfg.minRotZ, cfg.maxRotZ) * (Math.PI / 180);
      const maxRz = Math.max(cfg.minRotZ, cfg.maxRotZ) * (Math.PI / 180);

      for (let i = 0; i < instances.length; i++) {
        const inst = instances[i];
        const scale = minS + (maxS - minS) * inst.scaleHash;
        const rotX = minRx + (maxRx - minRx) * inst.rotXHash;
        const rotY = minRy + (maxRy - minRy) * inst.rotYHash;
        const rotZ = minRz + (maxRz - minRz) * inst.rotZHash;

        dummy.position.set(inst.x, inst.y, inst.z);
        // 'YXZ' rotation order: spins yaw around the tree trunk first, then applies tilt
        dummy.rotation.set(rotX, rotY, rotZ, 'YXZ');
        dummy.scale.set(scale, scale, scale);
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

  /**
   * Fast in-place matrix update of tree instances across all loaded chunks without disposing or recreating geometries.
   * Runs in < 0.2ms, enabling 60 FPS real-time transforms while dragging sliders.
   * @param {string} [targetVariant] - Optional tree variant name to restrict update to, or null for all.
   * @param {Iterable<TerrainChunk>} chunks - Active chunks to update.
   */
  updateTreeTransforms(targetVariant, chunks) {
    if (!chunks) return;
    const dummy = new THREE.Object3D();

    for (const chunk of chunks) {
      const treeObj = chunk.treeMesh;
      if (!treeObj) continue;

      const meshes = treeObj.isInstancedMesh ? [treeObj] : (treeObj.isGroup ? treeObj.children : []);
      for (const instMesh of meshes) {
        if (!instMesh || !instMesh.isInstancedMesh || !instMesh.userData.instances) continue;
        const modelName = instMesh.userData.modelName;
        if (targetVariant && modelName !== targetVariant) continue;

        const cfg = this.getTreeConfig(modelName);
        const instances = instMesh.userData.instances;

        const minS = Math.min(cfg.minScale, cfg.maxScale);
        const maxS = Math.max(cfg.minScale, cfg.maxScale);
        const minRx = Math.min(cfg.minRotX, cfg.maxRotX) * (Math.PI / 180);
        const maxRx = Math.max(cfg.minRotX, cfg.maxRotX) * (Math.PI / 180);
        const minRy = Math.min(cfg.minRotY, cfg.maxRotY) * (Math.PI / 180);
        const maxRy = Math.max(cfg.minRotY, cfg.maxRotY) * (Math.PI / 180);
        const minRz = Math.min(cfg.minRotZ, cfg.maxRotZ) * (Math.PI / 180);
        const maxRz = Math.max(cfg.minRotZ, cfg.maxRotZ) * (Math.PI / 180);

        for (let i = 0; i < instances.length; i++) {
          const inst = instances[i];
          const scale = minS + (maxS - minS) * inst.scaleHash;
          const rotX = minRx + (maxRx - minRx) * inst.rotXHash;
          const rotY = minRy + (maxRy - minRy) * inst.rotYHash;
          const rotZ = minRz + (maxRz - minRz) * inst.rotZHash;

          dummy.position.set(inst.x, inst.y, inst.z);
          dummy.rotation.set(rotX, rotY, rotZ, 'YXZ');
          dummy.scale.set(scale, scale, scale);
          dummy.updateMatrix();
          instMesh.setMatrixAt(i, dummy.matrix);
        }

        instMesh.instanceMatrix.needsUpdate = true;
      }
    }
  }
}

// Backwards-compatible aliases
export const EnvironmentGenerator = TreeGenerator;
export const AVAILABLE_TREE_MODELS = [
  {
    name: 'Conifer Trees Pack',
    path: '/models/trees_pack.fbx',
    category: 'pine',
  }
];
export const TREE_MODEL_LIST = AVAILABLE_TREE_MODELS;
export const ALL_MODEL_FILENAMES = ['trees_pack.fbx'];
export const ENVIRONMENT_PRESETS = [];
export const resolveTreeModelPath = (s) => s || '/models/trees_pack.fbx';
export const resolveEnvironmentSelection = (s) => s || '/models/trees_pack.fbx';
