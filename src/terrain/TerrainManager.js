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

    this.chunkSize = options.chunkSize || 128;
    this.chunkSegments = options.chunkSegments || 20; // High-detail resolution for near chunks
    this.renderDistance = options.renderDistance || 6; // Expanded view radius in chunks
    this.maxBuildsPerFrame = options.maxBuildsPerFrame || 1;
    this.treeShadowRange = options.treeShadowRange || 48; // Proximity range in meters for real-time tree shadows

    this.seed = options.seed !== undefined ? options.seed : 1337;
    this.terrainConfig = {
      mountainIntensity: options.mountainIntensity ?? 1.0,
      cliffIntensity: options.cliffIntensity ?? 1.0,
      parkIntensity: options.parkIntensity ?? 1.0,
      corridorWalls: options.corridorWalls ?? 1.0,
      rollerScale: options.rollerScale ?? 1.0,
      kickerScale: options.kickerScale ?? 1.0,
      biomeFrequency: options.biomeFrequency ?? 0.0016,
    };
    this.heightmap = new TerrainHeightmap(this.seed, this.terrainConfig);
    this.materialFactory = new TerrainMaterialFactory();

    // Active model identifier ('/models/...', 'all', etc.)
    const initialTreeModel = options.treeModel || options.treeModelPath || (TREE_MODEL_LIST.length > 0 ? TREE_MODEL_LIST[0].path : null);

    // Active renderer for impostor baking
    this.renderer = options.renderer || null;

    // Procedural tree generator with model preloading & caching
    this.treeGenerator = new TreeGenerator({
      seed: this.seed,
      heightmap: this.heightmap,
      treeModel: initialTreeModel,
      chunkSize: this.chunkSize,
      treeGridStep: options.treeGridStep,
      treeDensity: options.treeDensity,
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
          chunk.buildTrees(this.scene, dist <= this.treeShadowRange, dist, this.cameraFrustum);
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

    // Re-meshing queue for asynchronous, frame-budgeted terrain LOD transitions
    this.remeshQueue = [];
    this.queuedRemeshKeys = new Set();

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
   * Rebuilds both terrain meshes and tree instances across all active chunks immediately.
   */
  rebuildAllTerrain() {
    this.remeshQueue = [];
    this.queuedRemeshKeys.clear();
    for (const chunk of this.loadedChunks.values()) {
      chunk.rebuildMesh();
      chunk.rebuildTrees(this.scene);
    }
  }

  /**
   * Returns current terrain generation configuration.
   */
  getTerrainConfig() {
    return this.heightmap.getConfig();
  }

  /**
   * Updates terrain configuration and immediately re-meshes active chunks if rebuild=true.
   * @param {Object} newConfig
   * @param {boolean} [rebuild=true]
   */
  setTerrainConfig(newConfig, rebuild = true) {
    this.heightmap.setConfig(newConfig);
    if (rebuild) {
      this.rebuildAllTerrain();
    }
  }

  /**
   * Sets an individual terrain property.
   * @param {string} key
   * @param {number} val
   * @param {boolean} [rebuild=true]
   */
  setTerrainProperty(key, val, rebuild = true) {
    this.heightmap.setProperty(key, val);
    if (rebuild) {
      this.rebuildAllTerrain();
    }
  }

  /**
   * Queries biome classification and continuous blend weights at a world position.
   * @param {number} worldX
   * @param {number} worldZ
   * @returns {{ raw: number, wCirque: number, wPark: number, wBowls: number, primary: 'cirque'|'park'|'bowls' }}
   */
  getBiomeAt(worldX, worldZ) {
    return this.heightmap.getBiomeData(worldX, worldZ);
  }

  /**
   * Checks whether a given world coordinate is near or on a frozen lake.
   * @param {number} worldX
   * @param {number} worldZ
   * @param {number} [clearance=10.0]
   * @returns {boolean}
   */
  isNearLake(worldX, worldZ, clearance = 10.0) {
    return this.heightmap.isNearLake(worldX, worldZ, clearance);
  }

  /**
   * Finds the nearest flat frozen lake to a world position.
   * @param {number} worldX
   * @param {number} worldZ
   */
  getNearestLake(worldX, worldZ) {
    return this.heightmap.getNearestLake(worldX, worldZ);
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
    const frameStartTime = performance.now();
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
    this._processBuildQueue(frameStartTime);

    // Process queued chunk LOD remeshing (rate-limited per frame for smooth 60fps)
    this._processRemeshQueue(frameStartTime);
  }

  /**
   * Updates tree frustum culling and distance-culled shadows for full 3D trees:
   * - Frustum Culled: Trees not intersecting camera frustum or shadow caster bounds are culled
   * - Full 3D Rendering: All trees render as detailed 3D conifer models at all view distances
   * - Proximity Shadow Culling (> treeShadowRange): Distant chunks skip shadow pass to keep performance high
   * @private
   */
  _updateTreeLODs(px, pz, cameraFrustum = null) {
    const frustum = cameraFrustum || this.cameraFrustum;
    for (const chunk of this.loadedChunks.values()) {
      const distSq = this._getChunkBoundaryDistanceSq(chunk, px, pz);
      chunk.updateTreeLOD(distSq, frustum, this.treeShadowRange, true);
    }
  }

  /**
   * Computes squared Euclidean distance from a world point (px, pz) to the nearest boundary edge of a chunk.
   * Avoids Math.hypot / sqrt across 100+ chunks per frame.
   * @private
   */
  _getChunkBoundaryDistanceSq(chunk, px, pz) {
    const half = chunk.size * 0.5;
    const clampedX = Math.max(chunk.worldCenterX - half, Math.min(px, chunk.worldCenterX + half));
    const clampedZ = Math.max(chunk.worldCenterZ - half, Math.min(pz, chunk.worldCenterZ + half));
    const dx = clampedX - px;
    const dz = clampedZ - pz;
    return dx * dx + dz * dz;
  }

  /**
   * Computes exact Euclidean distance from a world point (px, pz) to the nearest boundary edge of a chunk.
   * @private
   */
  _getChunkBoundaryDistance(chunk, px, pz) {
    return Math.sqrt(this._getChunkBoundaryDistanceSq(chunk, px, pz));
  }

  /**
   * Backwards-compatible alias
   * @private
   */
  _updateShadowCulling(px, pz) {
    this._updateTreeLODs(px, pz);
  }

  /**
   * Distance-scaled terrain polygon resolution with harmonious steps and hysteresis deadbands:
   * Prevents boundary thrashing/fluttering when the player moves along chunk boundaries:
   * - Near (distSq <= 2, ~0-180m): Full resolution (20 segments, 400 quads)
   * - Mid (distSq <= 6, ~180-310m): Medium detail (16 segments, 256 quads - ~36% reduction)
   * - Far (distSq <= 12, ~310-440m): Low detail (12 segments, 144 quads - ~64% reduction)
   * - Very Far (distSq > 12, > 440m up to 768m): Distant detail (8 segments, 64 quads - ~84% reduction)
   * Combined with perimeter terrain skirts, ensures 100% sealed boundaries with zero cracks.
   * @param {number} [distSq]
   * @param {number|null} [currentSegments] - Current segment count to apply hysteresis
   * @returns {number}
   */
  getChunkSegmentsForDistSq(distSq = 0, currentSegments = null) {
    if (currentSegments === null || currentSegments === undefined) {
      if (distSq <= 2) return this.chunkSegments;
      if (distSq <= 6) return 16;
      if (distSq <= 12) return 12;
      return 8;
    }

    // Hysteresis deadbands: require moving farther away before downgrading LOD
    if (currentSegments >= this.chunkSegments) {
      // Currently at 20: stay at 20 until distSq >= 3
      if (distSq < 3) return this.chunkSegments;
      if (distSq <= 6) return 16;
      if (distSq <= 12) return 12;
      return 8;
    } else if (currentSegments >= 16) {
      // Currently at 16
      if (distSq <= 2) return this.chunkSegments; // Upgrade to 20
      if (distSq <= 7) return 16; // Stay at 16 (hysteresis band 6..7)
      if (distSq <= 12) return 12;
      return 8;
    } else if (currentSegments >= 12) {
      // Currently at 12
      if (distSq <= 2) return this.chunkSegments;
      if (distSq <= 5) return 16; // Upgrade to 16
      if (distSq <= 13) return 12; // Stay at 12 (hysteresis band 12..13)
      return 8;
    } else {
      // Currently at 8
      if (distSq <= 2) return this.chunkSegments;
      if (distSq <= 5) return 16;
      if (distSq <= 11) return 12; // Upgrade to 12
      return 8; // Stay at 8
    }
  }

  _updateGrid(centerCX, centerCZ, isInitial = false) {
    const r = this.renderDistance;
    const rSq = r * r;
    const unloadDistSq = (r + 1.2) * (r + 1.2);

    // 1. Identify chunks to unload (hysteresis buffer prevents thrashing at borders)
    for (const [key, chunk] of this.loadedChunks.entries()) {
      const dx = chunk.chunkX - centerCX;
      const dz = chunk.chunkZ - centerCZ;
      const distSq = dx * dx + dz * dz;

      if (distSq > unloadDistSq) {
        chunk.dispose(this.scene);
        this.loadedChunks.delete(key);
        this.queuedRemeshKeys.delete(key);
      } else {
        // Enqueue LOD changes with hysteresis instead of synchronously stalling the frame
        const targetSegments = this.getChunkSegmentsForDistSq(distSq, chunk.segments);
        if (chunk.segments !== targetSegments && !this.queuedRemeshKeys.has(key)) {
          this.queuedRemeshKeys.add(key);
          this.remeshQueue.push({
            chunk,
            key,
            targetSegments,
            distSq,
            isUpgrade: targetSegments > chunk.segments
          });
        }
      }
    }

    // Refresh and prune any pending items in remeshQueue
    this.remeshQueue = this.remeshQueue.filter(item => {
      if (!this.loadedChunks.has(item.key) || item.chunk.isDisposed) {
        this.queuedRemeshKeys.delete(item.key);
        return false;
      }
      const dx = item.chunk.chunkX - centerCX;
      const dz = item.chunk.chunkZ - centerCZ;
      item.distSq = dx * dx + dz * dz;
      item.targetSegments = this.getChunkSegmentsForDistSq(item.distSq, item.chunk.segments);
      item.isUpgrade = item.targetSegments > item.chunk.segments;
      if (item.targetSegments === item.chunk.segments) {
        this.queuedRemeshKeys.delete(item.key);
        return false;
      }
      return true;
    });

    // Sort remeshQueue: prioritize upgrades (especially nearest player) before downgrades
    this.remeshQueue.sort((a, b) => {
      if (a.isUpgrade !== b.isUpgrade) {
        return a.isUpgrade ? -1 : 1;
      }
      return a.distSq - b.distSq;
    });

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
            const isNear = distSq <= 4;
            const segments = this.getChunkSegmentsForDistSq(distSq);
            // If initial load and within immediate 5x5 radius, build immediately
            if (isInitial && isNear) {
              const chunk = new TerrainChunk(
                cx,
                cz,
                this.chunkSize,
                segments,
                this.heightmap,
                this.materialFactory,
                this.treeGenerator,
                true,
                this.treeShadowRange
              );
              this.scene.add(chunk.mesh);
              const playerX = (this.lastPlayerChunkX ?? 0) * this.chunkSize;
              const playerZ = (this.lastPlayerChunkZ ?? 0) * this.chunkSize;
              const dist = this._getChunkBoundaryDistance(chunk, playerX, playerZ);
              if (this.treeGenerator.isLoaded) {
                chunk.buildTrees(this.scene, dist <= this.treeShadowRange, dist, this.cameraFrustum);
              } else {
                chunk.updateTreeLOD(dist, this.cameraFrustum, this.treeShadowRange);
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

  _processBuildQueue(startTime = performance.now()) {
    let buildsThisFrame = 0;

    while (this.buildQueue.length > 0 && buildsThisFrame < this.maxBuildsPerFrame) {
      // Hard time budget: never spend more than 3ms on chunk creation to guarantee 60 FPS pacing
      if (buildsThisFrame > 0 && (performance.now() - startTime) > 3.0) {
        break;
      }

      const item = this.buildQueue.shift();
      const key = this._chunkKey(item.cx, item.cz);
      this.queuedKeys.delete(key);

      // Verify still within active range before constructing geometry
      const dx = item.cx - (this.lastPlayerChunkX ?? 0);
      const dz = item.cz - (this.lastPlayerChunkZ ?? 0);
      const distSq = dx * dx + dz * dz;

      if (distSq <= (this.renderDistance + 1) * (this.renderDistance + 1)) {
        if (!this.loadedChunks.has(key)) {
          const isNear = distSq <= 2;
          const segments = this.getChunkSegmentsForDistSq(distSq);

          const chunk = new TerrainChunk(
            item.cx,
            item.cz,
            this.chunkSize,
            segments,
            this.heightmap,
            this.materialFactory,
            this.treeGenerator,
            isNear,
            this.treeShadowRange
          );

          this.scene.add(chunk.mesh);
          const playerX = (this.lastPlayerChunkX ?? 0) * this.chunkSize;
          const playerZ = (this.lastPlayerChunkZ ?? 0) * this.chunkSize;
          const dist = this._getChunkBoundaryDistance(chunk, playerX, playerZ);
          if (this.treeGenerator.isLoaded) {
            chunk.buildTrees(this.scene, dist <= this.treeShadowRange, dist, this.cameraFrustum);
          } else {
            chunk.updateTreeLOD(dist, this.cameraFrustum, this.treeShadowRange);
          }
          this.loadedChunks.set(key, chunk);
          buildsThisFrame++;
        }
      }
    }
  }

  /**
   * Processes LOD geometry re-meshing asynchronously across frames.
   * Rate limits re-meshing to at most 1 chunk per frame (or max 2.0ms time budget),
   * eliminating any frame drop or stutter when moving between distance tiers.
   * @private
   */
  _processRemeshQueue(startTime = performance.now(), maxBudgetMs = 2.0) {
    if (this.remeshQueue.length === 0) return;

    let remeshedCount = 0;
    const maxRemeshPerFrame = 1;

    while (this.remeshQueue.length > 0 && remeshedCount < maxRemeshPerFrame) {
      // Time budget guard: if earlier tasks (or a prior remesh) used up the budget, postpone to next frame
      if ((performance.now() - startTime) > maxBudgetMs) {
        break;
      }

      const item = this.remeshQueue.shift();
      this.queuedRemeshKeys.delete(item.key);

      const chunk = this.loadedChunks.get(item.key);
      if (!chunk || chunk.isDisposed) {
        continue;
      }

      const dx = chunk.chunkX - (this.lastPlayerChunkX ?? 0);
      const dz = chunk.chunkZ - (this.lastPlayerChunkZ ?? 0);
      const distSq = dx * dx + dz * dz;

      const targetSegments = this.getChunkSegmentsForDistSq(distSq, chunk.segments);
      if (chunk.segments !== targetSegments) {
        chunk.setTargetSegments(targetSegments);
        remeshedCount++;
      }
    }
  }

  /**
   * Diagnostic telemetry for active vs culled tree chunks.
   * Useful for performance profiling and validation.
   */
  getTreeShadowRange() {
    return this.treeShadowRange;
  }

  setTreeShadowRange(range) {
    this.treeShadowRange = Math.max(0, range);
    for (const chunk of this.loadedChunks.values()) {
      chunk.treeShadowRange = this.treeShadowRange;
    }
    const px = (this.lastPlayerChunkX ?? 0) * this.chunkSize;
    const pz = (this.lastPlayerChunkZ ?? 0) * this.chunkSize;
    this._updateTreeLODs(px, pz, this.cameraFrustum);
  }

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
      if (casts3D) {
        shadowCasting++;
      }
    }

    return {
      totalChunks: total,
      visible3D,
      visibleImp,
      culled,
      shadowCasting,
      treeShadowRange: this.treeShadowRange,
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
  getNormalAt(worldX, worldZ, out = null) {
    return this.heightmap.getNormal(worldX, worldZ, 0.85, out);
  }

  /**
   * Retrieves tree trunk colliders near the specified world position.
   * Efficiently queries only the terrain chunks intersecting the search circle.
   * Reuses an internal array by default to guarantee ZERO garbage collection per frame.
   * @param {number} px - World X coordinate
   * @param {number} pz - World Z coordinate
   * @param {number} [searchRadius=12.0] - Search radius in meters
   * @param {Array} [outResults] - Optional destination array
   * @returns {Array<Object>} Array of tree trunk colliders { x, y, z, radius, height, branchRadius }
   */
  getNearbyTrunkColliders(px, pz, searchRadius = 12.0, outResults = null) {
    if (!outResults) {
      if (!this._cachedNearbyTrunks) this._cachedNearbyTrunks = [];
      outResults = this._cachedNearbyTrunks;
    }
    outResults.length = 0;

    const minChunkX = Math.floor((px - searchRadius) / this.chunkSize);
    const maxChunkX = Math.floor((px + searchRadius) / this.chunkSize);
    const minChunkZ = Math.floor((pz - searchRadius) / this.chunkSize);
    const maxChunkZ = Math.floor((pz + searchRadius) / this.chunkSize);

    for (let cx = minChunkX; cx <= maxChunkX; cx++) {
      for (let cz = minChunkZ; cz <= maxChunkZ; cz++) {
        const chunk = this.loadedChunks.get(`${cx},${cz}`);
        if (!chunk || !chunk.treeColliders) continue;

        const colliders = chunk.treeColliders;
        const count = colliders.length;
        for (let i = 0; i < count; i++) {
          const t = colliders[i];
          const dx = t.x - px;
          if (dx > searchRadius || dx < -searchRadius) continue;
          const dz = t.z - pz;
          if (dz > searchRadius || dz < -searchRadius) continue;
          outResults.push(t);
        }
      }
    }
    return outResults;
  }

  getLoadedChunkCount() {
    return this.loadedChunks.size;
  }

  getPendingChunkCount() {
    return this.buildQueue.length;
  }
}
