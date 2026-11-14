import * as THREE from 'three';
import { TerrainChunk } from './TerrainChunk.js';
import { TerrainHeightmap } from './Noise.js';
import { TerrainMaterialFactory } from './TerrainMaterial.js';
import { TreeGenerator, TREE_MODEL_LIST } from './TreeGenerator.js';

/**
 * TerrainManager
 * Handles dynamic streaming of procedural chunks around player position.
 * Features asynchronous phased chunk generation and seeded noise-based tree distribution.
 */
export class TerrainManager {
  /**
   * @param {THREE.Scene} scene
   * @param {Object} options
   */
  constructor(scene, options = {}) {
    this.scene = scene;

    this.chunkSize = options.chunkSize || 64;
    this.chunkSegments = options.chunkSegments || 64;
    this.renderDistance = options.renderDistance || 4; // Chunk radius
    this.maxBuildsPerFrame = options.maxBuildsPerFrame || 2;

    this.heightmap = new TerrainHeightmap(options.seed || 1337);
    this.materialFactory = new TerrainMaterialFactory();

    // Active model identifier ('/models/...', 'all', etc.)
    const initialTreeModel = options.treeModel || options.treeModelPath || (TREE_MODEL_LIST.length > 0 ? TREE_MODEL_LIST[0].path : null);

    // Active renderer for impostor baking
    this.renderer = options.renderer || null;

    // Procedural tree generator with model preloading & caching
    this.treeGenerator = new TreeGenerator({
      seed: options.seed || 1337,
      heightmap: this.heightmap,
      treeModel: initialTreeModel,
      chunkSize: this.chunkSize,
      renderer: this.renderer,
      scene: this.scene,
    });

    // Zero-allocation camera frustum for hierarchical tree & chunk view culling
    this.cameraFrustum = new THREE.Frustum();
    this.projScreenMatrix = new THREE.Matrix4();

    this.treeGenerator.load().then(() => {
      // Build trees on any chunks loaded prior to model finish
      const px = (this.lastPlayerChunkX ?? 0) * this.chunkSize;
      const pz = (this.lastPlayerChunkZ ?? 0) * this.chunkSize;
      for (const chunk of this.loadedChunks.values()) {
        if (!chunk.treeMesh3D && !chunk.treeMeshImpostor) {
          const dist = this._getChunkBoundaryDistance(chunk, px, pz);
          chunk.buildTrees(this.scene, dist <= 95, dist, this.cameraFrustum);
        }
      }
      this._updateTreeLODs(px, pz, this.cameraFrustum);
    }).catch((err) => {
      console.warn('TerrainManager tree generation disabled due to load error:', err);
    });

    // Map of active chunks: key "${chunkX},${chunkZ}" -> TerrainChunk
    this.loadedChunks = new Map();

    // Generation queue: array of { chunkX, chunkZ, distSq }
    this.buildQueue = [];
    this.queuedKeys = new Set();

    this.lastPlayerChunkX = null;
    this.lastPlayerChunkZ = null;
  }

  /**
   * Dynamically switches the tree model across the entire world on the fly.
   * @param {string|number} modelSelection
   */
  async setTreeModel(modelSelection) {
    await this.treeGenerator.setModel(modelSelection);
    this.rebuildAllTrees();
  }

  /**
   * Rebuilds tree instances across all currently active chunks immediately.
   */
  rebuildAllTrees() {
    for (const chunk of this.loadedChunks.values()) {
      chunk.rebuildTrees(this.scene);
    }
  }

  /**
   * Fast in-place matrix update of tree instances across all loaded chunks without geometry disposal.
   * Runs in < 0.2ms, enabling 60 FPS real-time transforms while dragging sliders.
   * @param {string} [targetVariant]
   */
  updateTreeTransforms(targetVariant) {
    if (this.treeGenerator && this.treeGenerator.updateTreeTransforms) {
      this.treeGenerator.updateTreeTransforms(targetVariant, this.loadedChunks.values());
    }
  }

  getCurrentTreeModel() {
    return this.treeGenerator.modelSelection;
  }

  getTreeModelList() {
    return TREE_MODEL_LIST;
  }

  setLakeProperty(key, value) {
    this.materialFactory.setLakeProperty(key, value);
  }

  getLakeConfig() {
    return this.materialFactory.getLakeConfig();
  }

  resetLakeConfig() {
    this.materialFactory.resetLakeConfig();
  }

  getSnowConfig() {
    return this.materialFactory.getSnowConfig();
  }

  setSnowProperty(key, val) {
    this.materialFactory.setSnowProperty(key, val);
  }

  setSnowConfig(cfg) {
    this.materialFactory.setSnowConfig(cfg);
  }

  resetSnowConfig() {
    this.materialFactory.resetSnowConfig();
  }

  _chunkKey(cx, cz) {
    return `${cx},${cz}`;
  }

  /**
   * Main per-frame update loop.
   * Checks player coordinates, dispatches chunk loading/unloading, updates terrain material uniforms,
   * and builds queued chunks.
   * @param {THREE.Vector3} playerPosition
   * @param {number} [time] - Elapsed simulation time in seconds
   * @param {THREE.Camera|THREE.Vector3} [cameraOrPosition] - Current active camera (for frustum culling) or position
   */
  update(playerPosition, time, cameraOrPosition) {
    let cameraPosition = playerPosition;
    let cameraFrustum = null;

    if (cameraOrPosition) {
      if (cameraOrPosition.isCamera) {
        cameraPosition = cameraOrPosition.position;
        // Compute camera view frustum in place (0 runtime heap allocations)
        this.projScreenMatrix.multiplyMatrices(
          cameraOrPosition.projectionMatrix,
          cameraOrPosition.matrixWorldInverse
        );
        this.cameraFrustum.setFromProjectionMatrix(this.projScreenMatrix);
        cameraFrustum = this.cameraFrustum;
      } else if (cameraOrPosition.isVector3) {
        cameraPosition = cameraOrPosition;
      }
    }

    // 0. Update dynamic material uniforms (time, camera position for glints & drift)
    if (time !== undefined && this.materialFactory) {
      this.materialFactory.update(time, cameraPosition);
    }

    const px = playerPosition.x;
    const pz = playerPosition.z;

    const currentChunkX = Math.floor(px / this.chunkSize);
    const currentChunkZ = Math.floor(pz / this.chunkSize);

    // Refresh chunk radius if player crossed into a new chunk or on initial run
    const isFirstRun = this.lastPlayerChunkX === null;
    if (currentChunkX !== this.lastPlayerChunkX || currentChunkZ !== this.lastPlayerChunkZ) {
      this.lastPlayerChunkX = currentChunkX;
      this.lastPlayerChunkZ = currentChunkZ;
      this._updateGrid(currentChunkX, currentChunkZ, isFirstRun);
    }

    // Continuously update tree LODs, view frustum culling, and distance-culled shadows
    this._updateTreeLODs(px, pz, cameraFrustum);

    // Process queued chunk builds (rate-limited per frame for smooth 60fps)
    this._processBuildQueue();
  }

  /**
   * Distance-gates tree LODs, frustum-culls trees not in view, and manages shadow casting:
   * - Frustum Culled: Trees not intersecting camera frustum or shadow caster bounds are set to visible = false
   * - Near (<= 65m nearest chunk edge): Full 3D instanced conifer models
   * - Distant (> 65m nearest chunk edge): 4-poly cross-quad billboard impostors with baked scene lighting
   * - Shadow Culling (> 95m): Far chunks skip shadow pass completely
   * @private
   */
  _updateTreeLODs(px, pz, cameraFrustum = null) {
    const frustum = cameraFrustum || this.cameraFrustum;
    for (const chunk of this.loadedChunks.values()) {
      const dist = this._getChunkBoundaryDistance(chunk, px, pz);
      chunk.updateTreeLOD(dist, frustum);
    }
  }

  /**
   * Computes exact Euclidean distance from a world point (px, pz) to the nearest boundary edge of a chunk.
   * Eliminates the 32m-45m center-point offset delay so LOD switches occur at the exact intended distance.
   * @private
   */
  _getChunkBoundaryDistance(chunk, px, pz) {
    const half = chunk.size * 0.5;
    const clampedX = Math.max(chunk.worldCenterX - half, Math.min(px, chunk.worldCenterX + half));
    const clampedZ = Math.max(chunk.worldCenterZ - half, Math.min(pz, chunk.worldCenterZ + half));
    return Math.hypot(clampedX - px, clampedZ - pz);
  }

  /**
   * Backwards-compatible alias
   * @private
   */
  _updateShadowCulling(px, pz) {
    this._updateTreeLODs(px, pz);
  }

  _updateGrid(centerCX, centerCZ, isInitial = false) {
    const r = this.renderDistance;
    const rSq = r * r;
    const unloadDistSq = (r + 1.2) * (r + 1.2);

    // 1. Identify chunks to unload (hysteresis buffer prevents thrashing at borders)
    for (const [key, chunk] of this.loadedChunks.entries()) {
      const dx = chunk.chunkX - centerCX;
      const dz = chunk.chunkZ - centerCZ;
      if (dx * dx + dz * dz > unloadDistSq) {
        chunk.dispose(this.scene);
        this.loadedChunks.delete(key);
      }
    }

    // 2. Identify missing chunks within render distance
    const needed = [];
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const distSq = dx * dx + dz * dz;
        if (distSq <= rSq) {
          const cx = centerCX + dx;
          const cz = centerCZ + dz;
          const key = this._chunkKey(cx, cz);

          if (!this.loadedChunks.has(key) && !this.queuedKeys.has(key)) {
            // If initial load and within immediate 3x3 radius, build immediately
            if (isInitial && Math.abs(dx) <= 1 && Math.abs(dz) <= 1) {
              const chunk = new TerrainChunk(
                cx,
                cz,
                this.chunkSize,
                this.chunkSegments,
                this.heightmap,
                this.materialFactory,
                this.treeGenerator
              );
              this.scene.add(chunk.mesh);
              const playerX = (this.lastPlayerChunkX ?? 0) * this.chunkSize;
              const playerZ = (this.lastPlayerChunkZ ?? 0) * this.chunkSize;
              const dist = this._getChunkBoundaryDistance(chunk, playerX, playerZ);
              if (this.treeGenerator.isLoaded) {
                chunk.buildTrees(this.scene, dist <= 95, dist, this.cameraFrustum);
              } else {
                chunk.updateTreeLOD(dist, this.cameraFrustum);
              }
              this.loadedChunks.set(key, chunk);
            } else {
              needed.push({ cx, cz, distSq });
            }
          }
        }
      }
    }

    // 3. Sort closest to player first
    needed.sort((a, b) => a.distSq - b.distSq);

    for (const item of needed) {
      const key = this._chunkKey(item.cx, item.cz);
      this.queuedKeys.add(key);
      this.buildQueue.push(item);
    }

    // Sort queue so nearest chunks are always built first
    this.buildQueue.sort((a, b) => {
      const distA = Math.hypot(a.cx - centerCX, a.cz - centerCZ);
      const distB = Math.hypot(b.cx - centerCX, b.cz - centerCZ);
      return distA - distB;
    });
  }

  _processBuildQueue() {
    let buildsThisFrame = 0;

    while (this.buildQueue.length > 0 && buildsThisFrame < this.maxBuildsPerFrame) {
      const item = this.buildQueue.shift();
      const key = this._chunkKey(item.cx, item.cz);
      this.queuedKeys.delete(key);

      // Verify still within active range before constructing geometry
      const dx = item.cx - (this.lastPlayerChunkX ?? 0);
      const dz = item.cz - (this.lastPlayerChunkZ ?? 0);
      if (dx * dx + dz * dz <= (this.renderDistance + 1) * (this.renderDistance + 1)) {
        if (!this.loadedChunks.has(key)) {
          const chunk = new TerrainChunk(
            item.cx,
            item.cz,
            this.chunkSize,
            this.chunkSegments,
            this.heightmap,
            this.materialFactory,
            this.treeGenerator
          );

          this.scene.add(chunk.mesh);
          const playerX = (this.lastPlayerChunkX ?? 0) * this.chunkSize;
          const playerZ = (this.lastPlayerChunkZ ?? 0) * this.chunkSize;
          const dist = this._getChunkBoundaryDistance(chunk, playerX, playerZ);
          if (this.treeGenerator.isLoaded) {
            chunk.buildTrees(this.scene, dist <= 95, dist, this.cameraFrustum);
          } else {
            chunk.updateTreeLOD(dist, this.cameraFrustum);
          }
          this.loadedChunks.set(key, chunk);
          buildsThisFrame++;
        }
      }
    }
  }

  /**
   * Diagnostic telemetry for active vs culled tree chunks.
   * Useful for performance profiling and validation.
   */
  getTreeTelemetry() {
    let total = 0;
    let visible3D = 0;
    let visibleImp = 0;
    let culled = 0;
    let shadowCasting = 0;

    for (const chunk of this.loadedChunks.values()) {
      total++;
      const is3D = chunk.treeMesh3D && chunk.treeMesh3D.visible;
      const isImp = chunk.treeMeshImpostor && chunk.treeMeshImpostor.visible;
      if (is3D) visible3D++;
      else if (isImp) visibleImp++;
      else culled++;

      const casts3D = chunk.treeMesh3D && (chunk.treeMesh3D.castShadow || (chunk.treeMesh3D.children && chunk.treeMesh3D.children.some((c) => c.castShadow)));
      const castsImp = chunk.treeMeshImpostor && (chunk.treeMeshImpostor.castShadow || (chunk.treeMeshImpostor.children && chunk.treeMeshImpostor.children.some((c) => c.castShadow)));
      if (casts3D || castsImp) {
        shadowCasting++;
      }
    }

    return {
      totalChunks: total,
      visible3D,
      visibleImp,
      culled,
      shadowCasting,
      cullPercentage: total > 0 ? Math.round((culled / total) * 100) : 0,
    };
  }

  /**
   * Helper to query height at any world position
   */
  getHeightAt(worldX, worldZ) {
    return this.heightmap.getHeight(worldX, worldZ);
  }

  /**
   * Helper to query normal at any world position
   */
  getNormalAt(worldX, worldZ) {
    return this.heightmap.getNormal(worldX, worldZ);
  }

  getLoadedChunkCount() {
    return this.loadedChunks.size;
  }

  getPendingChunkCount() {
    return this.buildQueue.length;
  }
}
