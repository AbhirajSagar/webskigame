import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SimplexNoise } from './Noise.js';
import { TreeTextureFactory } from './TreeTextures.js';
import { TreeImpostorBaker } from './TreeImpostorBaker.js';

/**
 * Deterministically maps a world position (x, z) and terrain seed to a tree foliage type.
 *
 * @param {number} x - World X position
 * @param {number} z - World Z position
 * @param {number} [seed=1337] - World generation seed
 * @returns {'pine'}
 */
export function getTreeFoliageType(x, z, seed = 1337) {
  const ix = Math.round(x * 100) | 0;
  const iz = Math.round(z * 100) | 0;
  const iseed = Math.round(seed * 100) | 0;

  let h = Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663) ^ Math.imul(iseed, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  const val = ((h ^ (h >>> 16)) >>> 0) / 4294967296;

  // Authentic snowy alpine foliage distribution:
  // 42% Subalpine Pine Green, 24% Rocky Mountain Blue Spruce, 14% Silver Frost Fir,
  // 10% Winter Russet Bronze Pine, 7% Alpine Golden Larch, 3% Winter Mahogany
  if (val < 0.42) return 'green';
  if (val < 0.66) return 'spruce';
  if (val < 0.80) return 'snow';
  if (val < 0.90) return 'orange';
  if (val < 0.97) return 'gold';
  return 'crimson';
}

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
 * Default live-tunable scale, rotation, and position offset bounds for all tree variants in the pack.
 * Rotations are specified in degrees and position offsets in world meters for intuitive user control.
 */
export const DEFAULT_TREE_CONFIGS = {
  pine_4m: {
    minScale: 3,
    maxScale: 8,
    minRotX: -15,
    maxRotX: 15,
    minRotY: 0,
    maxRotY: 360,
    minRotZ: -16,
    maxRotZ: 15,
    posOffset: { x: 0, y: -1.5, z: 0 },
  },
  pine: {
    minScale: 1.8,
    maxScale: 3.2,
    minRotX: -4,
    maxRotX: 4,
    minRotY: 0,
    maxRotY: 360,
    minRotZ: -4,
    maxRotZ: 4,
    posOffset: { x: 0, y: -0.75, z: 0 },
  },
};

/**
 * TreeGenerator
 * Preloads, extracts, indexes, and scatters Pine 4m environment models from public/models.
 * Extracts tree variants into optimized, multi-material indexed geometry.
 * Applies authentic high-resolution textures (diffuse + normal maps) and provides
 * full 360-degree Y-rotation and natural size distribution.
 */
export class TreeGenerator {
  // Static memory cache: path -> Array<modelData>
  static _modelCache = new Map();
  static _textureCache = null;
  static _materialCache = null;
  static _materialCacheSeed = null;

  /**
   * Retrieves or instantiates shared materials across all tree models and chunks.
   * Eliminates GPU shader switches, texture re-bindings, and uniform state changes.
   * @param {number} [seed=1337]
   */
  static getSharedMaterials(seed = 1337) {
    if (this._materialCache && this._materialCacheSeed === seed) return this._materialCache;
    const textures = TreeGenerator._textureCache || TreeTextureFactory.getTextures() || {};
    this._materialCache = TreeTextureFactory.createMaterials(textures, seed);
    this._materialCacheSeed = seed;
    return this._materialCache;
  }

  /**
   * @param {Object} options
   */
  constructor(options = {}) {
    this.seed = options.seed || 1337;
    this.heightmap = options.heightmap;
    this.chunkSize = options.chunkSize || 64;
    this.treeGridStep = options.treeGridStep || 11.0; // Denser conifer spacing across alpine slopes
    this.treeDensity = options.treeDensity !== undefined ? options.treeDensity : 0.68; // Increased forest density multiplier

    // Environmental density noise generators
    this.treeNoise = new SimplexNoise(this.seed + 777);

    // Active selection
    this.selection = options.treeModel || options.treeModelPath || '/models/Pine_4m.glb';

    // Extracted and categorized models
    this.activeTrees = [];
    this.activeSnags = [];
    this.activeTreesByFoliage = {
      green: [],
      orange: [],
      snow: [],
      gold: [],
      crimson: [],
      spruce: [],
    };
    this.loadedModels = [];
    this.isLoaded = false;
    this.loadPromise = null;

    // Impostor baking and LOD system
    this.renderer = options.renderer || null;
    this.scene = options.scene || null;
    this.impostors = new Map();

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
    return this.treeConfigs.pine_4m || this.treeConfigs.pine || DEFAULT_TREE_CONFIGS.pine_4m;
  }

  /**
   * Merges incoming config updates while preserving nested posOffset axes.
   * @private
   */
  _mergeTreeConfig(existing, incoming) {
    if (!existing) {
      const copy = { ...incoming };
      if (incoming?.posOffset && typeof incoming.posOffset === 'object') {
        copy.posOffset = { x: 0, y: 0, z: 0, ...incoming.posOffset };
      }
      return copy;
    }
    const merged = { ...existing, ...incoming };
    if (
      incoming?.posOffset &&
      typeof incoming.posOffset === 'object' &&
      existing.posOffset &&
      typeof existing.posOffset === 'object'
    ) {
      merged.posOffset = { ...existing.posOffset, ...incoming.posOffset };
    }
    return merged;
  }

  /**
   * Updates the scale, rotation & position offset configuration for a specific tree variant.
   * @param {string} variantName
   * @param {Object} config
   */
  setTreeConfig(variantName, config) {
    const key = Object.keys(this.treeConfigs).find(k => (variantName || '').toLowerCase().includes(k.toLowerCase())) || variantName;
    this.treeConfigs[key] = this._mergeTreeConfig(this.treeConfigs[key], config);
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
      this.treeConfigs[k] = this._mergeTreeConfig(this.treeConfigs[k], v);
    }
  }

  /**
   * Resolves a variant config's position offset into { x, y, z } world meters.
   * Supports `{ x, y, z }` objects, scalar Y numbers, or flat `posOffsetX/Y/Z` keys.
   * @private
   */
  _resolvePosOffset(cfg) {
    if (!cfg) return { x: 0, y: 0, z: 0 };
    const po = cfg.posOffset;
    if (typeof po === 'number') {
      return { x: 0, y: Number.isFinite(po) ? po : 0, z: 0 };
    }
    if (po && typeof po === 'object') {
      return {
        x: Number.isFinite(po.x) ? po.x : 0,
        y: Number.isFinite(po.y) ? po.y : 0,
        z: Number.isFinite(po.z) ? po.z : 0,
      };
    }
    return {
      x: Number.isFinite(cfg.posOffsetX) ? cfg.posOffsetX : 0,
      y: Number.isFinite(cfg.posOffsetY) ? cfg.posOffsetY : 0,
      z: Number.isFinite(cfg.posOffsetZ) ? cfg.posOffsetZ : 0,
    };
  }

  /**
   * Computes normalized scale, radian rotation, and position offset bounds from a tree config.
   * @private
   */
  _getTransformBounds(cfg) {
    const degToRad = Math.PI / 180;
    const { x: offsetX, y: offsetY, z: offsetZ } = this._resolvePosOffset(cfg);
    return {
      minS: Math.min(cfg.minScale, cfg.maxScale),
      maxS: Math.max(cfg.minScale, cfg.maxScale),
      minRx: Math.min(cfg.minRotX, cfg.maxRotX) * degToRad,
      maxRx: Math.max(cfg.minRotX, cfg.maxRotX) * degToRad,
      minRy: Math.min(cfg.minRotY, cfg.maxRotY) * degToRad,
      maxRy: Math.max(cfg.minRotY, cfg.maxRotY) * degToRad,
      minRz: Math.min(cfg.minRotZ, cfg.maxRotZ) * degToRad,
      maxRz: Math.max(cfg.minRotZ, cfg.maxRotZ) * degToRad,
      offsetX,
      offsetY,
      offsetZ,
    };
  }

  /**
   * Loads textures for bark, branches (snow, green, orange), and deadwood.
   * Loads from /textures/ with procedural fallback via TreeTextureFactory.
   * @private
   */
  async _loadTextures() {
    if (TreeGenerator._textureCache) return TreeGenerator._textureCache;
    TreeGenerator._textureCache = await TreeTextureFactory.loadTextures();
    TreeGenerator._materialCache = null;
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
      this.activeTreesByFoliage = {
        pine: [],
        green: [],
        orange: [],
        snow: [],
        gold: [],
        crimson: [],
        spruce: [],
      };

      for (const m of loadedList) {
        if (m.isDead) {
          this.activeSnags.push(m);
        } else {
          this.activeTrees.push(m);
          const fType = m.foliageType || 'pine';
          if (!this.activeTreesByFoliage[fType]) {
            this.activeTreesByFoliage[fType] = [];
          }
          this.activeTreesByFoliage[fType].push(m);
          // Also link to alias pools for backward compatibility
          for (const key of ['green', 'orange', 'snow', 'gold', 'crimson', 'spruce']) {
            if (!this.activeTreesByFoliage[key].includes(m)) {
              this.activeTreesByFoliage[key].push(m);
            }
          }
        }
      }

      // Bake 2D cross-quad impostor billboards if WebGL renderer is available
      if (this.renderer) {
        this.initImpostors(this.renderer);
      }

      this.isLoaded = true;
      return this;
    })();

    return this.loadPromise;
  }

  /**
   * Generates or re-bakes 2D billboard impostors for all loaded tree models.
   * @param {THREE.WebGLRenderer} [renderer]
   * @param {THREE.Texture} [environment]
   */
  initImpostors(renderer, environment = null) {
    if (renderer) this.renderer = renderer;
    if (!this.renderer || !this.loadedModels || this.loadedModels.length === 0) return;

    const env = environment || this.scene?.environment || null;

    try {
      const baker = new TreeImpostorBaker(this.renderer, {
        environment: env,
        sunPosition: new THREE.Vector3(130, 190, 90),
        sunColor: 0xffeacc,
        sunIntensity: 2.3,
        ambientColor: 0xd0e2f7,
        ambientIntensity: 0.17,
        groundBounceColor: 0xf2f5f9,
        groundBounceIntensity: 0.35,
      });
      this.impostors = baker.bake(this.loadedModels, env);
      for (const m of this.loadedModels) {
        m.impostor = this.impostors.get(m.name) || null;
      }
    } catch (err) {
      console.warn('TreeGenerator: Failed to bake tree impostors:', err);
    }
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
        const treeManager = new THREE.LoadingManager();
        treeManager.setURLModifier((url) => {
          if (url.includes('pine-leaf-diff')) return '/textures/pine-leaf-diff.png';
          if (url.includes('pine-leaf-norm')) return '/textures/pine-leaf-norm.png';
          if (url.includes('pine-branch-diff')) return '/textures/pine-branch-diff.png';
          if (url.includes('pine-branch-norm')) return '/textures/pine-branch-norm.png';
          if (url.includes('pine-trunk-diff')) return '/textures/pine-trunk-diff.png';
          if (url.includes('pine-trunk-norm')) return '/textures/pine-trunk-norm.png';
          return url;
        });
        const fbxLoader = new FBXLoader(treeManager);
        fbxLoader.setResourcePath('/textures/');
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
   * Handles model packs and single models by extracting each child as an individual variant.
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
        // Exclude the bigger dried tree (dead_2) completely from the project
        if ((group.name || '').toLowerCase().includes('dead_2')) continue;

        const v = this._processVariant(group, path, filename, group.name);
        if (v) {
          if (Array.isArray(v)) variants.push(...v);
          else variants.push(v);
        }
      }
      return variants.length > 0 ? variants : null;
    }

    // Single model
    const single = this._processVariant(rootNode, path, filename, filename);
    if (!single) return null;
    return Array.isArray(single) ? single : [single];
  }

  /**
   * Bakes transforms, welds vertices (70%+ memory & geometry reduction),
   * roots base at Y=0, centers horizontal footprint, and binds high-res PBR textures.
   * Produces separate foliage variants (snow, green, orange) for live conifer trees.
   * @private
   */
  _processVariant(node, path, filename, variantName = '') {
    // Exclude the bigger dried tree (dead_2) completely from the project
    if ((variantName || filename || '').toLowerCase().includes('dead_2')) return null;

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

    // 2. Process each mesh geometry & identify branch vs trunk sub-meshes
    const geoms = [];
    const isBranchFlags = [];

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
      isBranchFlags.push(isBranch);
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

    // Calculate trunk-only collision radius (excludes branches, foliage & needles)
    let maxTrunkDistSq = 0;
    let trunkSampleCount = 0;

    for (let idx = 0; idx < meshes.length; idx++) {
      const isBranch = isBranchFlags[idx];
      // If separate trunk meshes exist, measure only non-branch meshes.
      // If all meshes are unified (e.g. dead snag), measure trunk region near base.
      if (isBranch && meshes.length > 1) continue;

      const g = geoms[idx];
      if (!g || !g.attributes.position) continue;

      const pos = g.attributes.position;
      // Sample vertices near the trunk base (between 0.2m and 1.8m above ground)
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y >= 0.2 && y <= 1.8) {
          const x = pos.getX(i);
          const z = pos.getZ(i);
          const distSq = x * x + z * z;
          if (distSq > maxTrunkDistSq) {
            maxTrunkDistSq = distSq;
          }
          trunkSampleCount++;
        }
      }
    }

    let measuredRadius = (trunkSampleCount > 0 && maxTrunkDistSq > 0)
      ? Math.sqrt(maxTrunkDistSq)
      : 0.12;
    // Clamp to realistic tree trunk bounds (0.08m to 0.16m in unscaled base model units, so 3x scaled trunks have realistic 0.25m-0.45m radius)
    const trunkRadius = Math.max(0.08, Math.min(0.16, measuredRadius));

    // Calculate actual 3D branch / canopy horizontal extent from geometry vertices
    let maxBranchDistSq = 0;
    for (let idx = 0; idx < meshes.length; idx++) {
      const g = geoms[idx];
      if (!g || !g.attributes.position) continue;
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const distSq = x * x + z * z;
        if (distSq > maxBranchDistSq) {
          maxBranchDistSq = distSq;
        }
      }
    }
    const branchRadius = Math.max(0.8, Math.min(2.0, maxBranchDistSq > 0 ? Math.sqrt(maxBranchDistSq) : 1.5));

    const sharedMats = TreeGenerator.getSharedMaterials(this.seed);

    // Map each mesh to authentic Pine 4m PBR materials (trunk, branch, leaf)
    const mats = meshes.map((m) => {
      const matName = (m.material?.name || m.name || '').toLowerCase();
      if (matName.includes('leaf') || matName.includes('needle')) return sharedMats.leaf;
      if (matName.includes('branch')) return sharedMats.branch;
      if (matName.includes('trunk') || matName.includes('bark') || matName.includes('stamm')) return sharedMats.trunk;
      return sharedMats.trunk;
    });

    return [{
      name: variantName || 'pine_4m',
      baseName: variantName || 'pine_4m',
      foliageType: 'pine',
      path,
      category: 'pine',
      isDead: false,
      modelHeight: Math.max(0.5, actualHeight),
      trunkRadius,
      branchRadius,
      geometry: finalGeom,
      materials: mats.length === 1 ? mats[0] : mats,
    }];
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
   * Produces full high-poly 3D models for all trees (billboard impostor LOD removed).
   * @param {number} chunkX
   * @param {number} chunkZ
   * @returns {{ mesh3D: THREE.InstancedMesh|THREE.Group|null, meshImpostor: null, treeColliders: Array }}
   */
  generateChunkTrees(chunkX, chunkZ) {
    if (!this.isLoaded || !this.heightmap || this.loadedModels.length === 0) {
      return { mesh3D: null, meshImpostor: null };
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
    const treeGridStep = this.treeGridStep || 11.0;
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

        // Keep frozen lake ice and shorelines clear of trees (strict zero-tree margin)
        if (this.heightmap.isNearLake) {
          if (this.heightmap.isNearLake(wx, wz, 14.0)) continue;
        } else if (this.heightmap.getLakeData) {
          const lake = this.heightmap.getLakeData(wx, wz);
          if (lake.factor > 0.001) continue;
        }

        // 2. Elevation bounds: trees do not grow on high glacial peaks or submerged valleys
        const wy = this.heightmap.getHeight(wx, wz);
        if (wy > 220.0 || wy < -35.0) continue;

        // 3. Slope normal gating: trees cannot grow on steep rock cliffs
        const norm = this.heightmap.getNormal(wx, wz);
        if (norm.y < 0.72) continue; // max ~44 deg slope

        // 4. Biome-aware density & Ski Piste clearings
        const biome = this.heightmap.getBiomeData ? this.heightmap.getBiomeData(wx, wz) : null;
        const wCirque = biome ? biome.wCirque : 0.0;
        const wPark = biome ? biome.wPark : 0.0;

        // Cirque peaks are rugged and windswept with 65% sparser trees
        const biomeDensityFactor = 1.0 - wCirque * 0.65;

        const density = this.treeNoise.fbm(wx * 0.006, wz * 0.006, 2);
        // Ski run clearing (piste corridors)
        if (density < -0.02) continue;

        const prob = Math.min(1.0, (density + 0.02) * 1.6) * biomeDensityFactor;
        if (spawnHash >= prob * (this.treeDensity || 0.68)) continue;

        // 5. Timberline & Snag selection
        // Dried trees (snags) are natural alpine accents: balanced at ~8% in valleys and ski slopes,
        // increasing to ~15%-20% near harsh timberline ridges and rocky cirques (~10% overall)
        const timberline = 145.0 - wCirque * 40.0;
        const snagHash = this._hash(chunkX, chunkZ, gx * 17, gz * 19);
        const snagProbability = wy > timberline ? (0.14 + wCirque * 0.08) : 0.08;
        const isSnag = this.activeSnags.length > 0 && snagHash < snagProbability;

        let modelData;
        if (isSnag) {
          const snagIdx = Math.floor(snagHash * 13) % this.activeSnags.length;
          modelData = this.activeSnags[snagIdx];
        } else if (this.activeTrees.length > 0) {
          // Deterministically select foliage type (green, orange, snow) based on seed and world position
          const foliageType = getTreeFoliageType(wx, wz, this.seed);
          const pool = (this.activeTreesByFoliage[foliageType] && this.activeTreesByFoliage[foliageType].length > 0)
            ? this.activeTreesByFoliage[foliageType]
            : this.activeTrees;
          const treeHash = this._hash(chunkX, chunkZ, gx * 43, gz * 47);
          const treeIdx = Math.floor(treeHash * pool.length) % pool.length;
          modelData = pool[treeIdx];
        } else {
          continue;
        }

        // Live Config-Driven Randomization Hashes
        const scaleHash = this._hash(chunkX, chunkZ, gx * 13 + 5, gz * 17 + 9);
        const rotXHash = this._hash(chunkX, chunkZ, gx * 37 + 7, gz * 41 + 13);
        const rotYHash = this._hash(chunkX, chunkZ, gx * 91 + 17, gz * 103 + 31);
        const rotZHash = this._hash(chunkX, chunkZ, gx * 47 + 19, gz * 53 + 23);

        // Store terrain surface anchor; per-variant posOffset in treeConfigs keeps the trunk grounded on land
        addInstance(modelData, wx, wy, wz, scaleHash, rotXHash, rotYHash, rotZHash);
      }
    }

    if (instancesByModel.size === 0) {
      return { mesh3D: null, meshImpostor: null, treeColliders: [] };
    }

    const dummy = new THREE.Object3D();
    const createdMeshes3D = [];
    const createdMeshesImp = [];
    const treeColliders = [];

    for (const [modelData, instances] of instancesByModel.entries()) {
      if (instances.length === 0) continue;

      // Full 3D instanced mesh (for near & mid-distance)
      const instMesh3D = new THREE.InstancedMesh(
        modelData.geometry,
        modelData.materials,
        instances.length
      );
      instMesh3D.userData.instances = instances;
      instMesh3D.userData.modelName = modelData.name;

      // 4-triangle cross-quad impostor instanced mesh (for far-away trees only)
      let instMeshImp = null;
      if (modelData.impostor) {
        instMeshImp = new THREE.InstancedMesh(
          modelData.impostor.geometry,
          modelData.impostor.material,
          instances.length
        );
        instMeshImp.userData.instances = instances;
        instMeshImp.userData.modelName = modelData.name;
      }

      const cfg = this.getTreeConfig(modelData.name);
      const { minS, maxS, minRx, maxRx, minRy, maxRy, minRz, maxRz, offsetX, offsetY, offsetZ } = this._getTransformBounds(cfg);

      for (let i = 0; i < instances.length; i++) {
        const inst = instances[i];
        const scale = minS + (maxS - minS) * inst.scaleHash;
        const rotX = minRx + (maxRx - minRx) * inst.rotXHash;
        const rotY = minRy + (maxRy - minRy) * inst.rotYHash;
        const rotZ = minRz + (maxRz - minRz) * inst.rotZHash;
        const posX = inst.x + offsetX;
        const posY = inst.y + offsetY;
        const posZ = inst.z + offsetZ;

        dummy.position.set(posX, posY, posZ);
        // 'YXZ' rotation order: spins yaw around the tree trunk first, then applies tilt
        dummy.rotation.set(rotX, rotY, rotZ, 'YXZ');
        dummy.scale.set(scale, scale, scale);
        dummy.updateMatrix();

        instMesh3D.setMatrixAt(i, dummy.matrix);
        if (instMeshImp) {
          instMeshImp.setMatrixAt(i, dummy.matrix);
        }

        // Record trunk-only collider for physics (branches and foliage are non-collidable)
        // and physical branchRadius for foliage brush particle effects.
        // Identifies dry / dead trees (snags) so they do not shed foliage leaves.
        const isDeadTree = Boolean(modelData.isDead);
        treeColliders.push({
          x: posX,
          y: posY,
          z: posZ,
          radius: (modelData.trunkRadius || 0.22) * scale,
          height: (modelData.modelHeight || 8.0) * scale,
          branchRadius: isDeadTree ? 0 : ((modelData.branchRadius || 4.5) * scale),
          isDead: isDeadTree,
          isDry: isDeadTree,
          category: modelData.category || (isDeadTree ? 'snag' : 'pine'),
          foliageType: isDeadTree ? 'none' : (modelData.foliageType || null),
        });
      }

      instMesh3D.instanceMatrix.needsUpdate = true;
      instMesh3D.computeBoundingSphere();
      instMesh3D.computeBoundingBox();
      instMesh3D.castShadow = true;
      instMesh3D.receiveShadow = false; // Disabling PCF shadow sampling on foliage saves millions of texture fetches while snow terrain receives shadows
      createdMeshes3D.push(instMesh3D);

      if (instMeshImp) {
        instMeshImp.instanceMatrix.needsUpdate = true;
        instMeshImp.computeBoundingSphere();
        instMeshImp.computeBoundingBox();
        instMeshImp.castShadow = false;
        instMeshImp.receiveShadow = false;
        createdMeshesImp.push(instMeshImp);
      }
    }

    let finalMesh3D = null;
    if (createdMeshes3D.length === 1) {
      finalMesh3D = createdMeshes3D[0];
    } else if (createdMeshes3D.length > 1) {
      finalMesh3D = new THREE.Group();
      for (const mesh of createdMeshes3D) {
        finalMesh3D.add(mesh);
      }
    }

    let finalMeshImp = null;
    if (createdMeshesImp.length === 1) {
      finalMeshImp = createdMeshesImp[0];
    } else if (createdMeshesImp.length > 1) {
      finalMeshImp = new THREE.Group();
      for (const mesh of createdMeshesImp) {
        finalMeshImp.add(mesh);
      }
    }

    return {
      mesh3D: finalMesh3D,
      meshImpostor: finalMeshImp,
      treeColliders,
    };
  }

  /**
   * Backward-compatible alias returning the full 3D mesh.
   * @param {number} chunkX
   * @param {number} chunkZ
   * @returns {THREE.InstancedMesh|THREE.Group|null}
   */
  generateChunkTreeMesh(chunkX, chunkZ) {
    const { mesh3D } = this.generateChunkTrees(chunkX, chunkZ);
    return mesh3D;
  }

  /**
   * Fast in-place matrix update of tree instances across all loaded chunks without disposing or recreating geometries.
   * Updates 3D tree instances synchronously in < 0.2ms, enabling 60 FPS real-time transforms while dragging sliders.
   * @param {string} [targetVariant] - Optional tree variant name to restrict update to, or null for all.
   * @param {Iterable<TerrainChunk>} chunks - Active chunks to update.
   */
  updateTreeTransforms(targetVariant, chunks) {
    if (!chunks) return;
    const dummy = new THREE.Object3D();

    for (const chunk of chunks) {
      if (chunk.treeColliders) {
        chunk.treeColliders.length = 0;
      }
      const treeObjects = [chunk.treeMesh3D, chunk.treeMeshImpostor].filter(Boolean);
      for (const treeObj of treeObjects) {
        const isPrimary3D = (treeObj === chunk.treeMesh3D);
        const meshes = treeObj.isInstancedMesh ? [treeObj] : (treeObj.isGroup ? treeObj.children : []);
        for (const instMesh of meshes) {
          if (!instMesh || !instMesh.isInstancedMesh || !instMesh.userData.instances) continue;
          const modelName = instMesh.userData.modelName;
          if (targetVariant && modelName !== targetVariant) continue;

          const cfg = this.getTreeConfig(modelName);
          const instances = instMesh.userData.instances;
          const modelData = this.loadedModels.find(m => m.name === modelName);
          const baseRad = modelData?.trunkRadius || 0.22;
          const baseHeight = modelData?.modelHeight || 8.0;

          const { minS, maxS, minRx, maxRx, minRy, maxRy, minRz, maxRz, offsetX, offsetY, offsetZ } = this._getTransformBounds(cfg);

          for (let i = 0; i < instances.length; i++) {
            const inst = instances[i];
            const scale = minS + (maxS - minS) * inst.scaleHash;
            const rotX = minRx + (maxRx - minRx) * inst.rotXHash;
            const rotY = minRy + (maxRy - minRy) * inst.rotYHash;
            const rotZ = minRz + (maxRz - minRz) * inst.rotZHash;
            const posX = inst.x + offsetX;
            const posY = inst.y + offsetY;
            const posZ = inst.z + offsetZ;

            dummy.position.set(posX, posY, posZ);
            dummy.rotation.set(rotX, rotY, rotZ, 'YXZ');
            dummy.scale.set(scale, scale, scale);
            dummy.updateMatrix();
            instMesh.setMatrixAt(i, dummy.matrix);

            if (isPrimary3D && chunk.treeColliders) {
              const isDeadTree = Boolean(modelData?.isDead);
              chunk.treeColliders.push({
                x: posX,
                y: posY,
                z: posZ,
                radius: baseRad * scale,
                height: baseHeight * scale,
                branchRadius: isDeadTree ? 0 : ((modelData?.branchRadius || 4.5) * scale),
                isDead: isDeadTree,
                isDry: isDeadTree,
                category: modelData?.category || (isDeadTree ? 'snag' : 'pine'),
                foliageType: isDeadTree ? 'none' : (modelData?.foliageType || 'green'),
              });
            }
          }

          instMesh.instanceMatrix.needsUpdate = true;
        }
      }
    }
  }
}

// Backwards-compatible aliases
export const EnvironmentGenerator = TreeGenerator;
export const AVAILABLE_TREE_MODELS = [
  {
    name: 'Pine 4m',
    path: '/models/Pine_4m.glb',
    category: 'pine',
  }
];
export const TREE_MODEL_LIST = AVAILABLE_TREE_MODELS;
export const ALL_MODEL_FILENAMES = ['Pine_4m.glb'];
export const ENVIRONMENT_PRESETS = [];
export const resolveTreeModelPath = (s) => s || '/models/Pine_4m.glb';
export const resolveEnvironmentSelection = (s) => s || '/models/Pine_4m.glb';