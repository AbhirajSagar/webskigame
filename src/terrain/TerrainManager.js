import { TerrainChunk } from './TerrainChunk.js';
import { TerrainHeightmap } from './Noise.js';
import { TerrainMaterialFactory } from './TerrainMaterial.js';

/**
 * TerrainManager
 * Handles dynamic streaming of procedural chunks around player position.
 * Features asynchronous phased chunk generation to avoid frame hitching.
 */
export class TerrainManager {
  /**
   * @param {THREE.Scene} scene
   * @param {Object} options
   */
  constructor(scene, options = {}) {
    this.scene = scene;

    this.chunkSize = options.chunkSize || 64;
    this.chunkSegments = options.chunkSegments || 48;
    this.renderDistance = options.renderDistance || 4; // Chunk radius
    this.maxBuildsPerFrame = options.maxBuildsPerFrame || 2;

    this.heightmap = new TerrainHeightmap(options.seed || 1337);
    this.materialFactory = new TerrainMaterialFactory();

    // Map of active chunks: key "${chunkX},${chunkZ}" -> TerrainChunk
    this.loadedChunks = new Map();

    // Generation queue: array of { chunkX, chunkZ, distSq }
    this.buildQueue = [];
    this.queuedKeys = new Set();

    this.lastPlayerChunkX = null;
    this.lastPlayerChunkZ = null;
  }

  _chunkKey(cx, cz) {
    return `${cx},${cz}`;
  }

  /**
   * Main per-frame update loop.
   * Checks player coordinates, dispatches chunk loading/unloading, and builds queued chunks.
   * @param {THREE.Vector3} playerPosition
   */
  update(playerPosition) {
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

    // Process queued chunk builds (rate-limited per frame for smooth 60fps)
    this._processBuildQueue();
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
                this.materialFactory
              );
              this.scene.add(chunk.mesh);
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
            this.materialFactory
          );

          this.scene.add(chunk.mesh);
          this.loadedChunks.set(key, chunk);
          buildsThisFrame++;
        }
      }
    }
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
