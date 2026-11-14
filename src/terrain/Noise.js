/**
 * Simplex Noise & Geologically Natural Terrain Height Generator
 * Generates vast alpine valleys, gradual foothill ascents,
 * dramatic rocky mountain ranges, smooth arêtes, and towering peaks.
 */

export class SimplexNoise {
  constructor(seed = 1337) {
    this.p = new Uint8Array(256);
    this.perm = new Uint8Array(512);
    this.permMod12 = new Uint8Array(512);

    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    const nextRandom = () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };

    for (let i = 0; i < 256; i++) {
      this.p[i] = i;
    }

    for (let i = 255; i > 0; i--) {
      const r = Math.floor(nextRandom() * (i + 1));
      const tmp = this.p[i];
      this.p[i] = this.p[r];
      this.p[r] = tmp;
    }

    for (let i = 0; i < 512; i++) {
      this.perm[i] = this.p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }

  noise2D(xin, yin) {
    const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
    const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;

    let n0 = 0, n1 = 0, n2 = 0;

    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = xin - X0;
    const y0 = yin - Y0;

    let i1, j1;
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    } else {
      i1 = 0;
      j1 = 1;
    }

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1.0 + 2.0 * G2;
    const y2 = y0 - 1.0 + 2.0 * G2;

    const ii = i & 255;
    const jj = j & 255;

    const grad3 = [
      [1, 1], [-1, 1], [1, -1], [-1, -1],
      [1, 0], [-1, 0], [1, 0], [-1, 0],
      [0, 1], [0, -1], [0, 1], [0, -1]
    ];

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      const gi0 = this.permMod12[ii + this.perm[jj]];
      const g0 = grad3[gi0];
      t0 *= t0;
      n0 = t0 * t0 * (g0[0] * x0 + g0[1] * y0);
    }

    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      const gi1 = this.permMod12[ii + i1 + this.perm[jj + j1]];
      const g1 = grad3[gi1];
      t1 *= t1;
      n1 = t1 * t1 * (g1[0] * x1 + g1[1] * y1);
    }

    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      const gi2 = this.permMod12[ii + 1 + this.perm[jj + 1]];
      const g2 = grad3[gi2];
      t2 *= t2;
      n2 = t2 * t2 * (g2[0] * x2 + g2[1] * y2);
    }

    return 70.0 * (n0 + n1 + n2);
  }

  fbm(x, y, octaves = 5, lacunarity = 2.0, persistence = 0.5) {
    let total = 0;
    let frequency = 1.0;
    let amplitude = 1.0;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      total += this.noise2D(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      frequency *= lacunarity;
      amplitude *= persistence;
    }

    return total / maxValue;
  }

  /**
   * C^2 Smooth Ridged Multifractal Noise
   * Replaces sharp derivative discontinuities with smooth hyperbolic curves,
   * eliminating normal shock jumps and polygonal sawtooth aliasing along ridges.
   */
  ridged(x, y, octaves = 5, lacunarity = 2.0, persistence = 0.5) {
    let total = 0;
    let frequency = 1.0;
    let amplitude = 1.0;
    let maxValue = 0;
    let weight = 1.0;

    for (let i = 0; i < octaves; i++) {
      let raw = this.noise2D(x * frequency, y * frequency);
      // C^2 continuous hyperbolic smoothing on the ridge cusp
      let signal = Math.sqrt(raw * raw + 0.025);
      signal = 1.0 - signal;
      signal = signal * signal;
      signal *= weight;
      weight = Math.min(1.0, Math.max(0.0, signal * 2.0));

      total += signal * amplitude;
      maxValue += amplitude;
      frequency *= lacunarity;
      amplitude *= persistence;
    }

    return total / maxValue;
  }
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0.0, Math.min(1.0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3.0 - 2.0 * t);
}

/**
 * Natural Geological Terrain Heightmap
 * Realistic balance: broad open ski valleys, gradual foothill ascents,
 * dramatic rocky mountain ranges, smooth arêtes, and towering peaks.
 */
export class TerrainHeightmap {
  constructor(seed = 9876) {
    this.simplexBase = new SimplexNoise(seed);
    this.simplexMountains = new SimplexNoise(seed + 101);
    this.simplexHills = new SimplexNoise(seed + 202);
    this.simplexWarp = new SimplexNoise(seed + 303);
    this.simplexCrags = new SimplexNoise(seed + 404);
    this._lakeCellCache = new Map();
  }

  /**
   * Calculates pure geological terrain elevation prior to any lake carving.
   * @param {number} x
   * @param {number} z
   * @returns {number}
   */
  getBaseHeight(x, z) {
    const warpScale = 0.0011;
    const warpStrength = 65.0;
    const wx = x + warpStrength * this.simplexWarp.noise2D(x * warpScale, z * warpScale);
    const wz = z + warpStrength * this.simplexWarp.noise2D((x + 52.3) * warpScale, (z + 87.1) * warpScale);

    const continentalNoise = this.simplexBase.fbm(wx * 0.00075, wz * 0.00075, 3, 2.0, 0.5);
    const continentalMask = (continentalNoise + 1.0) * 0.5;

    const valley = this.simplexBase.fbm(wx * 0.0018, wz * 0.0018, 3, 2.0, 0.45) * 8.0;
    const valleyNoise = this.simplexBase.noise2D(wx * 0.0012 + 10.0, wz * 0.0012 + 20.0);
    const valleyDepression = (valleyNoise * valleyNoise) * -4.0;

    const hillWeight = smoothstep(0.24, 0.55, continentalMask);
    const hills = this.simplexHills.fbm(wx * 0.0028, wz * 0.0028, 4, 2.0, 0.48) * 36.0;

    const mountainWeight = smoothstep(0.38, 0.82, continentalMask);
    const ridge1 = this.simplexMountains.ridged(wx * 0.0020, wz * 0.0020, 5, 2.1, 0.55);
    const ridge2 = this.simplexMountains.ridged(wx * 0.0045, wz * 0.0045, 4, 2.0, 0.50);
    const rawBillow = this.simplexMountains.noise2D(wx * 0.0015 + 45.0, wz * 0.0015 + 72.0);
    const billow = Math.sqrt(rawBillow * rawBillow + 0.02);
    const shapedRidge = Math.pow(ridge1, 1.40) * 1.20;
    const mountainMass = (shapedRidge * 120.0 + ridge2 * 32.0 + billow * 40.0);

    const cragNoise = this.simplexCrags.noise2D(wx * 0.006, wz * 0.006);
    const rockyCrags = cragNoise * 3.5;

    return valley + valleyDepression + hills * hillWeight + (mountainMass + rockyCrags) * mountainWeight;
  }

  /**
   * Helper to retrieve continental mountain belt mask [0, 1]
   * @private
   */
  _getContinentalMask(x, z) {
    const warpScale = 0.0011;
    const warpStrength = 65.0;
    const wx = x + warpStrength * this.simplexWarp.noise2D(x * warpScale, z * warpScale);
    const wz = z + warpStrength * this.simplexWarp.noise2D((x + 52.3) * warpScale, (z + 87.1) * warpScale);
    const continentalNoise = this.simplexBase.fbm(wx * 0.00075, wz * 0.00075, 3, 2.0, 0.5);
    return (continentalNoise + 1.0) * 0.5;
  }

  /**
   * Resolves flat alpine valley lake for a cellular grid block.
   * Lakes only spawn if the candidate location is verified flat (valley basin).
   * @private
   */
  _getCellLake(cellX, cellZ) {
    const key = `${cellX},${cellZ}`;
    if (this._lakeCellCache.has(key)) return this._lakeCellCache.get(key);

    const cellSize = 380.0;
    const h1x = Math.sin(cellX * 127.1 + cellZ * 311.7) * 43758.5453;
    const h1_x = h1x - Math.floor(h1x);

    // Lake candidate cell probability gate
    if (h1_x > 0.65) {
      const empty = { isLake: false };
      this._lakeCellCache.set(key, empty);
      return empty;
    }

    const h1y = Math.sin(cellX * 269.5 + cellZ * 183.3) * 43758.5453;
    const h2x = Math.sin((cellX + 53.1) * 127.1 + (cellZ + 91.7) * 311.7) * 43758.5453;
    const h2y = Math.sin((cellX + 53.1) * 269.5 + (cellZ + 91.7) * 183.3) * 43758.5453;
    const h1_y = h1y - Math.floor(h1y);
    const h2_x = h2x - Math.floor(h2x);
    const h2_y = h2y - Math.floor(h2y);

    const radius = 55.0 + 30.0 * h2_y;
    const shoreWidth = 22.0;

    // Search 5 candidate locations across the cell for the flattest valley basin
    const candidates = [
      [(cellX + 0.2 + 0.6 * h1_y) * cellSize, (cellZ + 0.2 + 0.6 * h2_x) * cellSize],
      [(cellX + 0.5) * cellSize, (cellZ + 0.5) * cellSize],
      [(cellX + 0.25) * cellSize, (cellZ + 0.75) * cellSize],
      [(cellX + 0.75) * cellSize, (cellZ + 0.25) * cellSize],
      [(cellX + 0.5 + 0.3 * (h1_x - 0.5)) * cellSize, (cellZ + 0.5 + 0.3 * (h2_x - 0.5)) * cellSize]
    ];

    let best = null;
    let minSlope = Infinity;

    for (const [candX, candZ] of candidates) {
      // 1. Continental mask check: strictly avoid mountain ranges and high foothills
      const mask = this._getContinentalMask(candX, candZ);
      if (mask > 0.36) continue;

      // 2. Strict slope & elevation difference check across candidate lake footprint
      const testR = radius * 0.7;
      const h0 = this.getBaseHeight(candX, candZ);
      const hE = this.getBaseHeight(candX + testR, candZ);
      const hW = this.getBaseHeight(candX - testR, candZ);
      const hN = this.getBaseHeight(candX, candZ + testR);
      const hS = this.getBaseHeight(candX, candZ - testR);
      const maxDiff = Math.max(Math.abs(hE - h0), Math.abs(hW - h0), Math.abs(hN - h0), Math.abs(hS - h0));
      const slope = maxDiff / testR;

      // Max allowed slope is ~4.5 degrees (0.08) - guaranteeing an authentic flat valley
      if (slope < 0.08 && slope < minSlope) {
        minSlope = slope;
        best = {
          isLake: true,
          x: candX,
          z: candZ,
          radius,
          shoreWidth,
          elevation: h0 - 0.2, // Lake ice sheet sits flush in the valley floor
          slope
        };
      }
    }

    const res = best || { isLake: false };
    this._lakeCellCache.set(key, res);
    return res;
  }

  /**
   * Continuous world height function.
   * Produces imposing alpine mountain ranges, rocky cliffs, and flat frozen valley lakes.
   */
  getHeight(x, z) {
    const baseElev = this.getBaseHeight(x, z);
    const wx = x;
    const wz = z;

    // Subtle surface micro-undulation for snow surface relief
    const micro = this.simplexBase.noise2D(wx * 0.012, wz * 0.012) * 0.4;

    // Frozen Alpine Lake Basins
    const lake = this.getLakeData(x, z);
    let elevation = baseElev;
    if (lake.factor > 0.0) {
      const flatT = smoothstep(0.0, 0.65, lake.factor);
      elevation = elevation * (1.0 - flatT) + lake.elevation * flatT;
    }

    // Ice sheets are mirror-flat without micro snow bumps
    const microWeight = 1.0 - smoothstep(0.15, 0.55, lake.factor);
    return elevation + micro * microWeight;
  }

  /**
   * Deterministic cellular query for flat frozen alpine lake basins.
   * @param {number} x
   * @param {number} z
   * @returns {{ factor: number, depth: number, elevation: number, isFrozenLake: boolean }}
   */
  getLakeData(x, z) {
    const cellSize = 380.0;
    const cx = Math.floor(x / cellSize);
    const cz = Math.floor(z / cellSize);

    let maxFactor = 0.0;
    let maxDepth = 0.0;
    let lakeElevation = 0.0;
    let isFrozenLake = false;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const lake = this._getCellLake(cx + dx, cz + dz);
        if (!lake.isLake) continue;

        const warp = Math.sin(x * 0.045 + z * 0.035) * 6.0 + Math.cos(x * 0.02 - z * 0.05) * 7.0;
        const dist = Math.hypot(x - lake.x, z - lake.z) + warp;

        if (dist < lake.radius + lake.shoreWidth) {
          const factor = Math.max(0.0, Math.min(1.0, (lake.radius + lake.shoreWidth - dist) / lake.shoreWidth));
          const depth = Math.max(0.0, Math.min(1.0, (lake.radius - dist) / lake.radius));
          if (factor > maxFactor) {
            maxFactor = factor;
            maxDepth = depth;
            lakeElevation = lake.elevation;
            if (factor > 0.35) {
              isFrozenLake = true;
            }
          }
        }
      }
    }

    return { factor: maxFactor, depth: maxDepth, elevation: lakeElevation, isFrozenLake };
  }

  /**
   * Checks whether a given world coordinate is inside or within clearance of a frozen lake.
   * Used to guarantee zero trees spawn on or near the lake.
   * @param {number} x
   * @param {number} z
   * @param {number} [clearance=10.0]
   * @returns {boolean}
   */
  isNearLake(x, z, clearance = 10.0) {
    const cellSize = 380.0;
    const cx = Math.floor(x / cellSize);
    const cz = Math.floor(z / cellSize);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const lake = this._getCellLake(cx + dx, cz + dz);
        if (!lake.isLake) continue;

        const warp = Math.sin(x * 0.045 + z * 0.035) * 6.0 + Math.cos(x * 0.02 - z * 0.05) * 7.0;
        const dist = Math.hypot(x - lake.x, z - lake.z) + warp;

        if (dist < lake.radius + lake.shoreWidth + clearance) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Finds the nearest flat frozen lake to a world position.
   * Useful for camera focus and instant player teleportation.
   * @param {number} x
   * @param {number} z
   * @returns {{ x: number, z: number, elevation: number, radius: number } | null}
   */
  getNearestLake(x, z) {
    const cellSize = 380.0;
    const cx = Math.floor(x / cellSize);
    const cz = Math.floor(z / cellSize);

    let nearest = null;
    let minDistSq = Infinity;

    for (let dx = -8; dx <= 8; dx++) {
      for (let dz = -8; dz <= 8; dz++) {
        const lake = this._getCellLake(cx + dx, cz + dz);
        if (!lake.isLake) continue;

        const dSq = (x - lake.x) * (x - lake.x) + (z - lake.z) * (z - lake.z);
        if (dSq < minDistSq) {
          minDistSq = dSq;
          nearest = { x: lake.x, z: lake.z, elevation: lake.elevation, radius: lake.radius };
        }
      }
    }
    return nearest;
  }

  /**
   * Continuous analytical finite-difference normal.
   * Uses epsilon=0.75m to band-limit derivatives to the mesh grid spacing,
   * eliminating sub-grid derivative oscillation and polygon sawtooth aliasing.
   */
  getNormal(x, z, epsilon = 0.75) {
    const lake = this.getLakeData(x, z);
    if (lake.factor > 0.65) {
      // Ice sheet is completely horizontal (zero slope)
      return { x: 0.0, y: 1.0, z: 0.0 };
    }

    const hL = this.getHeight(x - epsilon, z);
    const hR = this.getHeight(x + epsilon, z);
    const hD = this.getHeight(x, z - epsilon);
    const hU = this.getHeight(x, z + epsilon);

    const dhdx = (hR - hL) / (2.0 * epsilon);
    const dhdz = (hU - hD) / (2.0 * epsilon);

    const nx = -dhdx;
    const ny = 1.0;
    const nz = -dhdz;

    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    return {
      x: nx / len,
      y: ny / len,
      z: nz / len,
    };
  }
}
