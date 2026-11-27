import * as THREE from 'three';
import { SimplexNoise } from './Noise.js';

export const CAVE_CELL_SIZE = 320.0;
export const MAX_SHADER_CAVES = 8;

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0.0, Math.min(1.0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3.0 - 2.0 * t);
}

/**
 * CaveSystem
 * Procedurally carves seamless, irregular pass-through caves into prominent alpine hills.
 *
 * Design:
 * - Grades smooth exterior approach aprons into each cave mouth so the terrain floor flows
 *   directly into the cave without sharp cutout lips or floor drop-offs.
 * - Uses TerrainMaterial per-pixel irregular arch cutouts (above floorY) on hillside slopes,
 *   melting surrounding snow organically into triplanar PBR rock.
 * - Solves exact portal curve intersections against the chunk's PlaneGeometry surface and seals
 *   behind the hillside with an uphill buried rock lintel collar (zero hollow gaps, zero extrusion).
 * - Renders both cave rock walls (mode 2.0) and cave snow floor (mode 1.0) using TerrainMaterial
 *   with smooth ambient occlusion darkening (aCaveAO), eliminating any material/lighting seam.
 */
export class CaveSystem {
  /**
   * @param {Object} options
   * @param {number} [options.seed=1337]
   * @param {TerrainHeightmap} options.heightmap
   * @param {TerrainMaterialFactory} [options.materialFactory]
   */
  constructor(options = {}) {
    this.seed = options.seed || 1337;
    this.heightmap = options.heightmap;
    this.materialFactory = options.materialFactory || null;
    this._cellCache = new Map();
    this._rockNoise = new SimplexNoise(this.seed + 4219);
  }

  _hash(a, b, c) {
    let h = Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /**
   * Resolves the best natural hill tunnel candidate in a cellular terrain block.
   * @param {number} cellX
   * @param {number} cellZ
   * @returns {Object|null}
   */
  _getCellCave(cellX, cellZ) {
    const key = (cellX + 32768) * 65536 + (cellZ + 32768);
    const cached = this._cellCache.get(key);
    if (cached !== undefined) return cached;

    if (!this.heightmap) {
      this._cellCache.set(key, null);
      return null;
    }

    const cellRoll = this._hash(cellX, cellZ, Math.round(this.seed) + 17);
    if (cellRoll > 0.78) {
      this._cellCache.set(key, null);
      return null;
    }

    const cellSize = CAVE_CELL_SIZE;
    let best = null;
    let bestScore = -Infinity;
    const angles = [0.0, 0.42, -0.42, 0.75, -0.75];

    for (let gx = 0; gx < 4; gx++) {
      for (let gz = 0; gz < 4; gz++) {
        const jx = this._hash(cellX * 4 + gx, cellZ * 4 + gz, 11);
        const jz = this._hash(cellX * 4 + gx, cellZ * 4 + gz, 23);
        const hx = (cellX + (gx + 0.25 + 0.5 * jx) / 4.0) * cellSize;
        const hz = (cellZ + (gz + 0.25 + 0.5 * jz) / 4.0) * cellSize;

        if (Math.hypot(hx, hz) < 110.0) continue;

        const hMid = this.heightmap.getBaseHeight(hx, hz);
        if (hMid < -15.0) continue;

        for (let aIdx = 0; aIdx < angles.length; aIdx++) {
          const ang = angles[aIdx];
          const dx = Math.sin(ang);
          const dz = -Math.cos(ang);
          const halfLen = 42.0;

          const inX = hx - dx * halfLen;
          const inZ = hz - dz * halfLen;
          const outX = hx + dx * halfLen;
          const outZ = hz + dz * halfLen;

          if (this.heightmap.isNearLake) {
            if (
              this.heightmap.isNearLake(hx, hz, 24.0) ||
              this.heightmap.isNearLake(inX, inZ, 18.0) ||
              this.heightmap.isNearLake(outX, outZ, 18.0)
            ) {
              continue;
            }
          }

          const hIn = this.heightmap.getHeight(inX, inZ);
          const hOut = this.heightmap.getHeight(outX, outZ);

          const prominence = hMid - Math.max(hIn, hOut);
          if (prominence < 12.0) continue;

          const drop = hIn - hOut;
          if (drop < -4.0 || drop > 42.0) continue;

          const hQ1 = this.heightmap.getHeight(hx - dx * (halfLen * 0.45), hz - dz * (halfLen * 0.45));
          const hQ3 = this.heightmap.getHeight(hx + dx * (halfLen * 0.45), hz + dz * (halfLen * 0.45));
          const floorMid = (hIn + hOut) * 0.5;
          if (Math.min(hQ1, hQ3) < floorMid + 6.0) continue;

          const score = prominence - Math.abs(ang) * 3.0;
          if (score > bestScore) {
            bestScore = score;
            const tunnelHeight = Math.max(7.2, Math.min(10.5, prominence * 0.66));
            const halfWidth = 8.5 + this._hash(cellX, cellZ, 97) * 2.0;
            const caveSeed = this._hash(cellX, cellZ, 131) * 25.0;

            best = {
              cx: hx,
              cz: hz,
              dirX: dx,
              dirZ: dz,
              rightX: -dz,
              rightZ: dx,
              halfLen,
              halfWidth,
              tunnelHeight,
              hIn,
              hOut,
              hMid,
              caveSeed,
            };
          }
        }
      }
    }

    this._cellCache.set(key, best);
    return best;
  }

  /**
   * Shared irregular half-width profile along s (matched identically in TerrainMaterial GLSL).
   */
  getEffectiveHalfWidth(cave, s) {
    const sideIrreg = Math.sin(s * 0.17 + cave.caveSeed) * 1.15
      + Math.cos(s * 0.41 - cave.caveSeed * 0.7) * 0.45;
    return cave.halfWidth + sideIrreg;
  }

  /**
   * Shared irregular ceiling offset profile (matched identically in TerrainMaterial GLSL).
   */
  getCeilingIrregularity(cave, s, u) {
    return Math.sin(s * 0.23 - u * 0.29 + cave.caveSeed * 1.3) * 0.85
      + Math.cos(s * 0.53 + u * 0.41) * 0.40;
  }

  /**
   * Computes tunnel floor elevation along s (matched identically in TerrainMaterial GLSL).
   */
  getCaveFloorY(cave, s) {
    const t = Math.max(0.0, Math.min(1.0, (s + cave.halfLen) / (2.0 * cave.halfLen)));
    return cave.hIn + (cave.hOut - cave.hIn) * t;
  }

  /**
   * Computes irregular arch roof height at local coordinates (s, u).
   */
  getCaveRoofY(cave, s, u) {
    const floorY = this.getCaveFloorY(cave, s);
    const effHalfW = this.getEffectiveHalfWidth(cave, s);
    const normU = Math.min(1.0, Math.abs(u) / Math.max(1.0, effHalfW));
    const localH = cave.tunnelHeight + this.getCeilingIrregularity(cave, s, u);
    const archH = localH * Math.sqrt(Math.max(0.0, 1.0 - normU * normU));
    return floorY + archH;
  }

  /**
   * Returns exterior terrain height smoothly graded at cave entrance/exit aprons
   * so snow approaches meet the cave floor seamlessly without horizon cut lines.
   */
  getTerrainHeight(x, z) {
    const baseY = this.heightmap.getHeight(x, z);
    const hit = this.getCaveAt(x, z, 20.0, 11.0);
    if (!hit) return baseY;

    const { cave, s, u, effHalfW } = hit;
    const absS = Math.abs(s);

    // Never touch the hill ridge inside the cave roof zone
    if (absS < cave.halfLen - 3.5) return baseY;

    let wS = 0.0;
    if (absS >= cave.halfLen) {
      wS = 1.0 - smoothstep(cave.halfLen, cave.halfLen + 18.0, absS);
    } else {
      wS = smoothstep(cave.halfLen - 3.5, cave.halfLen, absS);
    }
    if (wS <= 0.001) return baseY;

    const absU = Math.abs(u);
    const wU = absU <= effHalfW + 1.0
      ? 1.0
      : 1.0 - smoothstep(effHalfW + 1.0, effHalfW + 11.0, absU);
    if (wU <= 0.001) return baseY;

    const mouthY = this.getCaveFloorY(cave, s);
    const blend = wS * wU;
    return baseY * (1.0 - blend) + mouthY * blend;
  }

  /**
   * Computes smooth exterior terrain normal incorporating graded cave approach aprons.
   */
  getTerrainNormal(x, z, step = 0.85, out = null) {
    const hit = this.getCaveAt(x, z, 22.0, 13.0);
    if (!hit) {
      return this.heightmap.getNormal(x, z, step, out);
    }
    const hL = this.getTerrainHeight(x - step, z);
    const hR = this.getTerrainHeight(x + step, z);
    const hD = this.getTerrainHeight(x, z - step);
    const hU = this.getTerrainHeight(x, z + step);
    const dhdx = (hR - hL) / (2.0 * step);
    const dhdz = (hU - hD) / (2.0 * step);
    const nx = -dhdx;
    const ny = 1.0;
    const nz = -dhdz;
    const invLen = 1.0 / Math.sqrt(nx * nx + ny * ny + nz * nz);
    const target = out || { x: 0, y: 1, z: 0 };
    target.x = nx * invLen;
    target.y = ny * invLen;
    target.z = nz * invLen;
    return target;
  }

  /**
   * Evaluates the exact barycentric triangle height of the PlaneGeometry terrain chunk at (wx, wz).
   */
  getChunkSurfaceY(wx, wz, chunkSize = 128, segments = 20) {
    const step = chunkSize / segments;
    const chunkX = Math.floor(wx / chunkSize);
    const chunkZ = Math.floor(wz / chunkSize);
    const localX = wx - chunkX * chunkSize;
    const localZ = wz - chunkZ * chunkSize;

    const ix = Math.min(segments - 1, Math.max(0, Math.floor(localX / step)));
    const iz = Math.min(segments - 1, Math.max(0, Math.floor(localZ / step)));
    const fx = Math.max(0.0, Math.min(1.0, (localX - ix * step) / step));
    const fz = Math.max(0.0, Math.min(1.0, (localZ - iz * step) / step));

    const x0 = chunkX * chunkSize + ix * step;
    const z0 = chunkZ * chunkSize + iz * step;

    const h00 = this.getTerrainHeight(x0, z0);
    const h01 = this.getTerrainHeight(x0, z0 + step);
    const h10 = this.getTerrainHeight(x0 + step, z0);
    const h11 = this.getTerrainHeight(x0 + step, z0 + step);

    // Matches THREE.PlaneGeometry(s, s, n, n).rotateX(-PI/2):
    // tri 0: (x0,z0)-(x0,z1)-(x1,z0) where fx+fz <= 1; tri 1: (x0,z1)-(x1,z1)-(x1,z0) where fx+fz > 1
    if (fx + fz <= 1.0) {
      return h00 + fx * (h10 - h00) + fz * (h01 - h00);
    }
    return h11 + (1.0 - fx) * (h01 - h11) + (1.0 - fz) * (h10 - h11);
  }

  /**
   * Finds the exact intersection s where archY(s, u(s)) == chunkSurfaceY(s, u(s)).
   * @private
   */
  _findPortalS(cave, cosT, sinT, isEntry, chunkSize, segments) {
    const startS = isEntry ? -cave.halfLen : cave.halfLen;
    const stepDir = isEntry ? 0.5 : -0.5;
    const maxSteps = Math.floor((cave.halfLen * 1.4) / 0.5);

    const evalDiff = (s) => {
      const effHalfW = this.getEffectiveHalfWidth(cave, s);
      const u = cosT * effHalfW;
      const wx = cave.cx + cave.dirX * s + cave.rightX * u;
      const wz = cave.cz + cave.dirZ * s + cave.rightZ * u;
      const surfY = this.getChunkSurfaceY(wx, wz, chunkSize, segments);
      const floorY = this.getCaveFloorY(cave, s);
      const localH = cave.tunnelHeight + this.getCeilingIrregularity(cave, s, u);
      const archY = floorY + sinT * localH;
      return surfY - archY;
    };

    let prevS = startS;
    let prevDiff = evalDiff(prevS);
    if (prevDiff > 0.01) {
      return startS;
    }

    for (let i = 1; i <= maxSteps; i++) {
      const currS = startS + i * stepDir;
      const currDiff = evalDiff(currS);
      if (currDiff >= 0.0) {
        let lo = prevS;
        let hi = currS;
        for (let b = 0; b < 12; b++) {
          const mid = 0.5 * (lo + hi);
          if (evalDiff(mid) >= 0.0) {
            hi = mid;
          } else {
            lo = mid;
          }
        }
        return hi;
      }
      prevS = currS;
      prevDiff = currDiff;
    }

    return startS + stepDir * 4.0;
  }

  /**
   * Returns up to MAX_SHADER_CAVES nearest caves around a world position for GPU per-pixel cutouts.
   */
  getNearestCaves(px, pz, maxCount = MAX_SHADER_CAVES) {
    const cMinX = Math.floor(px / CAVE_CELL_SIZE) - 2;
    const cMaxX = Math.floor(px / CAVE_CELL_SIZE) + 2;
    const cMinZ = Math.floor(pz / CAVE_CELL_SIZE) - 2;
    const cMaxZ = Math.floor(pz / CAVE_CELL_SIZE) + 2;

    const candidates = [];
    for (let cx = cMinX; cx <= cMaxX; cx++) {
      for (let cz = cMinZ; cz <= cMaxZ; cz++) {
        const cave = this._getCellCave(cx, cz);
        if (!cave) continue;
        const dx = cave.cx - px;
        const dz = cave.cz - pz;
        candidates.push({ cave, distSq: dx * dx + dz * dz });
      }
    }
    candidates.sort((a, b) => a.distSq - b.distSq);
    return candidates.slice(0, maxCount).map((c) => c.cave);
  }

  /**
   * Finds any cave containing (x, z) within its corridor + optional margin.
   */
  getCaveAt(x, z, marginLen = 0.0, marginWidth = 0.0) {
    const cx = Math.floor(x / CAVE_CELL_SIZE);
    const cz = Math.floor(z / CAVE_CELL_SIZE);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cave = this._getCellCave(cx + dx, cz + dz);
        if (!cave) continue;

        const relX = x - cave.cx;
        const relZ = z - cave.cz;
        const s = relX * cave.dirX + relZ * cave.dirZ;
        if (Math.abs(s) > cave.halfLen + marginLen) continue;

        const u = relX * cave.rightX + relZ * cave.rightZ;
        const effHalfW = this.getEffectiveHalfWidth(cave, s);
        if (Math.abs(u) > effHalfW + marginWidth) continue;

        return { cave, s, u, effHalfW };
      }
    }
    return null;
  }

  /**
   * Returns true if (x, z) is near a cave entrance/exit or inside an open cave mouth
   * so trees don't block cave openings, while still allowing trees atop the hill roof.
   */
  isTreeBlocked(worldX, worldY, worldZ) {
    const hit = this.getCaveAt(worldX, worldZ, 16.0, 4.0);
    if (!hit) return false;
    const { cave, s, u } = hit;
    if (Math.abs(s) >= cave.halfLen - 4.0) return true;
    const roofY = this.getCaveRoofY(cave, s, u);
    return worldY < roofY + 3.0;
  }

  /**
   * Resolves ride surface height, normal, ceiling, and wall containment when inside a cave.
   */
  queryPlayerCaveState(x, y, z) {
    const hit = this.getCaveAt(x, z, 2.0, 1.0);
    if (!hit) return null;

    const { cave, s, u, effHalfW } = hit;
    const floorY = this.getCaveFloorY(cave, s);
    const roofY = this.getCaveRoofY(cave, s, u);

    if (y > roofY + 0.25) return null;

    const slope = (cave.hOut - cave.hIn) / (2.0 * cave.halfLen);
    const nx = -cave.dirX * slope;
    const ny = 1.0;
    const nz = -cave.dirZ * slope;
    const invLen = 1.0 / Math.sqrt(nx * nx + ny * ny + nz * nz);

    return {
      cave,
      s,
      u,
      effHalfW,
      floorY,
      roofY,
      normal: { x: nx * invLen, y: ny * invLen, z: nz * invLen },
    };
  }

  /**
   * Builds watertight hillside-integrated rock caverns and seamless snow floors for caves centered in the chunk.
   */
  generateChunkCaves(chunkX, chunkZ, chunkSize, chunkSegments = 20) {
    const minX = chunkX * chunkSize;
    const maxX = minX + chunkSize;
    const minZ = chunkZ * chunkSize;
    const maxZ = minZ + chunkSize;

    const cMinX = Math.floor(minX / CAVE_CELL_SIZE) - 1;
    const cMaxX = Math.floor(maxX / CAVE_CELL_SIZE) + 1;
    const cMinZ = Math.floor(minZ / CAVE_CELL_SIZE) - 1;
    const cMaxZ = Math.floor(maxZ / CAVE_CELL_SIZE) + 1;

    const group = new THREE.Group();
    group.name = `ChunkCaves_${chunkX}_${chunkZ}`;
    let caveCount = 0;

    for (let cx = cMinX; cx <= cMaxX; cx++) {
      for (let cz = cMinZ; cz <= cMaxZ; cz++) {
        const cave = this._getCellCave(cx, cz);
        if (!cave) continue;

        if (cave.cx < minX || cave.cx >= maxX || cave.cz < minZ || cave.cz >= maxZ) {
          continue;
        }

        const caveMesh = this._buildCaveMesh(cave, chunkSize, chunkSegments);
        if (caveMesh) {
          group.add(caveMesh);
          caveCount++;
        }
      }
    }

    return caveCount > 0 ? group : null;
  }

  /**
   * Constructs the watertight rock cavern lining (with buried uphill portal collars) and snow floor,
   * both rendered using the shared TerrainMaterial for 100% seamless shader continuity.
   * @private
   */
  _buildCaveMesh(cave, chunkSize = 128, chunkSegments = 20) {
    const caveGroup = new THREE.Group();
    const sharedMat = this.materialFactory
      ? this.materialFactory.getMaterial()
      : new THREE.MeshStandardMaterial({ color: 0x777d85, roughness: 0.9, side: THREE.DoubleSide });

    // --- 1. Watertight Rock Arch Shell with Buried Uphill Lintel Seals ---
    const uSegs = 28;
    const innerRings = 24;
    // Rings: [0: entryBuriedFar, 1: entryBuriedMid, 2: entryExactLip, 3..(3+innerRings): tunnel, ..., exitLip, exitMid, exitFar]
    const totalRings = innerRings + 7;
    const vertCount = totalRings * (uSegs + 1);

    const positions = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const lakeData = new Float32Array(vertCount * 2);
    const caveFloorAttr = new Float32Array(vertCount);
    const caveAOAttr = new Float32Array(vertCount);
    const indices = [];

    for (let iu = 0; iu <= uSegs; iu++) {
      // Cluster slightly near theta = 0 and PI so the vertical cave side walls are smooth
      const lin = iu / uSegs;
      const cosCluster = 0.5 - 0.5 * Math.cos(lin * Math.PI);
      const theta = (lin * 0.45 + cosCluster * 0.55) * Math.PI;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      let sIn = this._findPortalS(cave, cosT, sinT, true, chunkSize, chunkSegments);
      let sOut = this._findPortalS(cave, cosT, sinT, false, chunkSize, chunkSegments);
      if (sOut < sIn + 2.5) {
        const mid = 0.5 * (sIn + sOut);
        sIn = mid - 1.25;
        sOut = mid + 1.25;
      }

      const span = sOut - sIn;
      const lipMargin = Math.min(1.6, span * 0.16);
      const sInnerStart = sIn + Math.min(1.1, span * 0.08);
      const sInnerEnd = sOut - Math.min(1.1, span * 0.08);

      for (let is = 0; is < totalRings; is++) {
        let s;
        let mode = 'tunnel';

        if (is === 0) {
          s = Math.min(0.0, sIn + lipMargin);
          mode = 'buriedFar';
        } else if (is === 1) {
          s = Math.min(0.0, sIn + lipMargin * 0.45);
          mode = 'buriedMid';
        } else if (is === 2) {
          s = sIn;
          mode = 'lip';
        } else if (is === totalRings - 3) {
          s = sOut;
          mode = 'lip';
        } else if (is === totalRings - 2) {
          s = Math.max(0.0, sOut - lipMargin * 0.45);
          mode = 'buriedMid';
        } else if (is === totalRings - 1) {
          s = Math.max(0.0, sOut - lipMargin);
          mode = 'buriedFar';
        } else {
          const frac = (is - 3) / innerRings;
          s = sInnerStart + frac * (sInnerEnd - sInnerStart);
        }

        const effHalfW = this.getEffectiveHalfWidth(cave, s);
        const u = cosT * effHalfW;
        const wx = cave.cx + cave.dirX * s + cave.rightX * u;
        const wz = cave.cz + cave.dirZ * s + cave.rightZ * u;

        const floorY = this.getCaveFloorY(cave, s);
        const localH = cave.tunnelHeight + this.getCeilingIrregularity(cave, s, u);
        const archY = floorY + sinT * localH;
        const surfY = this.getChunkSurfaceY(wx, wz, chunkSize, chunkSegments);

        let wy;
        let ao;
        if (mode === 'buriedFar') {
          // Tucked cleanly underneath uncut TerrainChunk surface (seals upward wedge with 0 extrusion)
          wy = surfY - 0.05;
          ao = 1.0;
        } else if (mode === 'buriedMid') {
          wy = surfY - 0.025;
          ao = 1.0;
        } else if (mode === 'lip') {
          // Exact portal rim match with zero hollow gap
          wy = surfY + 0.002;
          ao = 1.0;
        } else {
          const tTunnel = Math.max(0.0, Math.min(1.0, (s - sIn) / Math.max(1.0, span)));
          const reliefMask = Math.sin(tTunnel * Math.PI);
          // Subtle rocky ceiling/wall relief bulging slightly inward or into rock, strictly below surfY
          const noiseVal = this._rockNoise.noise2D(s * 0.24, theta * 2.4);
          const relief = noiseVal * 0.55 * reliefMask * Math.min(1.0, sinT * 1.8);
          const wallSink = (iu === 0 || iu === uSegs)
            ? -1.4 * Math.min(1.0, Math.min(s - sIn, sOut - s) * 0.35)
            : 0.0;
          wy = Math.min(surfY - 0.05, archY + relief) + wallSink;

          const distMouth = Math.min(Math.abs(s - sIn), Math.abs(sOut - s));
          const darkFactor = smoothstep(0.0, 15.0, distMouth);
          ao = 1.0 - darkFactor * 0.70;
        }

        const idx = is * (uSegs + 1) + iu;
        positions[idx * 3 + 0] = wx;
        positions[idx * 3 + 1] = wy;
        positions[idx * 3 + 2] = wz;

        uvs[idx * 2 + 0] = lin * 2.5;
        uvs[idx * 2 + 1] = is / Math.max(1, totalRings - 1);

        caveFloorAttr[idx] = 2.0; // Interior PBR rock wall mode in TerrainMaterial
        caveAOAttr[idx] = ao;
      }
    }

    for (let is = 0; is < totalRings - 1; is++) {
      for (let iu = 0; iu < uSegs; iu++) {
        const a = is * (uSegs + 1) + iu;
        const b = (is + 1) * (uSegs + 1) + iu;
        const c = (is + 1) * (uSegs + 1) + (iu + 1);
        const d = is * (uSegs + 1) + (iu + 1);

        // Inward-facing winding (normals point INTO cave cavity)
        indices.push(a, d, b);
        indices.push(b, d, c);
      }
    }

    const rockGeo = new THREE.BufferGeometry();
    rockGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    rockGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    rockGeo.setAttribute('aLakeData', new THREE.BufferAttribute(lakeData, 2));
    rockGeo.setAttribute('aCaveFloor', new THREE.BufferAttribute(caveFloorAttr, 1));
    rockGeo.setAttribute('aCaveAO', new THREE.BufferAttribute(caveAOAttr, 1));
    rockGeo.setIndex(indices);
    rockGeo.computeVertexNormals();
    rockGeo.computeBoundingBox();
    rockGeo.computeBoundingSphere();

    const rockMesh = new THREE.Mesh(rockGeo, sharedMat);
    rockMesh.castShadow = true;
    rockMesh.receiveShadow = true;
    caveGroup.add(rockMesh);

    // --- 2. Seamless Snow Floor Ribbon Using Exterior TerrainMaterial ---
    const fCols = 10;
    const fRows = 22;
    const fTotalLen = (cave.halfLen + 2.0) * 2.0;
    const fStartS = -(cave.halfLen + 2.0);
    const fCount = (fRows + 1) * (fCols + 1);
    const fPos = new Float32Array(fCount * 3);
    const fNorm = new Float32Array(fCount * 3);
    const fUvs = new Float32Array(fCount * 2);
    const fLake = new Float32Array(fCount * 2);
    const fCaveFloor = new Float32Array(fCount);
    const fCaveAO = new Float32Array(fCount);
    const fIndices = [];

    const slope = (cave.hOut - cave.hIn) / (2.0 * cave.halfLen);
    const fnx = -cave.dirX * slope;
    const fnz = -cave.dirZ * slope;
    const invLen = 1.0 / Math.sqrt(fnx * fnx + 1.0 + fnz * fnz);

    for (let is = 0; is <= fRows; is++) {
      const fracS = is / fRows;
      const s = fStartS + fracS * fTotalLen;
      const effHalfW = this.getEffectiveHalfWidth(cave, s) + 1.4;
      const endMargin = cave.halfLen - Math.abs(s);
      const floorDark = endMargin <= 0.0 ? 0.0 : smoothstep(0.0, 14.0, endMargin);
      const ao = 1.0 - floorDark * 0.56;

      for (let iu = 0; iu <= fCols; iu++) {
        const fracU = iu / fCols;
        const u = (fracU - 0.5) * 2.0 * effHalfW;
        const wx = cave.cx + cave.dirX * s + cave.rightX * u;
        const wz = cave.cz + cave.dirZ * s + cave.rightZ * u;
        // Outside [-halfLen, +halfLen], tuck floor ends slightly beneath graded approach snow
        const wy = Math.abs(s) > cave.halfLen
          ? this.getTerrainHeight(wx, wz) - 0.04
          : this.getCaveFloorY(cave, s);

        const idx = is * (fCols + 1) + iu;
        fPos[idx * 3 + 0] = wx;
        fPos[idx * 3 + 1] = wy;
        fPos[idx * 3 + 2] = wz;

        fNorm[idx * 3 + 0] = fnx * invLen;
        fNorm[idx * 3 + 1] = invLen;
        fNorm[idx * 3 + 2] = fnz * invLen;

        fUvs[idx * 2 + 0] = fracU * 2.0;
        fUvs[idx * 2 + 1] = fracS * 6.0;

        fCaveFloor[idx] = 1.0;
        fCaveAO[idx] = ao;
      }
    }

    for (let is = 0; is < fRows; is++) {
      for (let iu = 0; iu < fCols; iu++) {
        const a = is * (fCols + 1) + iu;
        const b = (is + 1) * (fCols + 1) + iu;
        const c = (is + 1) * (fCols + 1) + (iu + 1);
        const d = is * (fCols + 1) + (iu + 1);
        fIndices.push(a, b, d);
        fIndices.push(b, c, d);
      }
    }

    const floorGeo = new THREE.BufferGeometry();
    floorGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3));
    floorGeo.setAttribute('normal', new THREE.BufferAttribute(fNorm, 3));
    floorGeo.setAttribute('uv', new THREE.BufferAttribute(fUvs, 2));
    floorGeo.setAttribute('aLakeData', new THREE.BufferAttribute(fLake, 2));
    floorGeo.setAttribute('aCaveFloor', new THREE.BufferAttribute(fCaveFloor, 1));
    floorGeo.setAttribute('aCaveAO', new THREE.BufferAttribute(fCaveAO, 1));
    floorGeo.setIndex(fIndices);
    floorGeo.computeBoundingBox();
    floorGeo.computeBoundingSphere();

    const floorMesh = new THREE.Mesh(floorGeo, sharedMat);
    floorMesh.castShadow = false;
    floorMesh.receiveShadow = true;
    caveGroup.add(floorMesh);

    return caveGroup;
  }
}
