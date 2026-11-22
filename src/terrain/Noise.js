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

export const LAKE_CELL_SIZE = 580.0;

/**
 * Natural Geological Terrain Heightmap
 * Realistic alpine balance: dynamic alpine cirques, razor arêtes, banked halfpipe canyons,
 * camel-hump rollers, natural kicker lips, stepped rock benches (pillow drops),
 * and flowing ski valleys framed by flanking mountain walls.
 */
export class TerrainHeightmap {
  constructor(seed = 9876, options = {}) {
    this.seed = seed;
    this.options = {
      mountainIntensity: options.mountainIntensity ?? 1.0,
      cliffIntensity: options.cliffIntensity ?? 1.0,
      parkIntensity: options.parkIntensity ?? 1.0,
      corridorWalls: options.corridorWalls ?? 1.0,
      rollerScale: options.rollerScale ?? 1.0,
      kickerScale: options.kickerScale ?? 1.0,
      biomeFrequency: options.biomeFrequency ?? 0.0016,
    };

    this.simplexBase = new SimplexNoise(seed);
    this.simplexMountains = new SimplexNoise(seed + 101);
    this.simplexHills = new SimplexNoise(seed + 202);
    this.simplexWarp = new SimplexNoise(seed + 303);
    this.simplexCrags = new SimplexNoise(seed + 404);
    this.simplexRollers = new SimplexNoise(seed + 505);
    this.simplexBiome = new SimplexNoise(seed + 606);
    this.simplexPark = new SimplexNoise(seed + 707);
    this.simplexCanyon = new SimplexNoise(seed + 808);
    this._lakeCellCache = new Map();
  }

  getConfig() {
    return { ...this.options };
  }

  setConfig(newOptions) {
    if (!newOptions) return;
    Object.assign(this.options, newOptions);
    this._lakeCellCache.clear();
  }

  setProperty(key, value) {
    if (key in this.options) {
      this.options[key] = value;
      this._lakeCellCache.clear();
    }
  }

  /**
   * Evaluates macro-scale biome coordinates and returns blended zone weights.
   * Faster cycle (~600m wavelength) ensures players encounter rich variety within normal runs:
   * 1. Cirque: High Alpine arêtes, sweeping amphitheaters, sheer rock couloirs (Freeride Steeps)
   * 2. Park: Banked half-pipe canyons, rhythmic camel-hump rollers, natural kicker lips (Terrain Park)
   * 3. Bowls: Rolling alpine meadows, undulating powder spines, wide cruisers (Glade Skiing)
   * @param {number} x
   * @param {number} z
   * @returns {{ raw: number, wCirque: number, wPark: number, wBowls: number, primary: 'cirque'|'park'|'bowls' }}
   */
  getBiomeData(x, z) {
    const freq = this.options.biomeFrequency;
    const warp1 = this.simplexWarp.noise2D(x * 0.0012, z * 0.0012) * 50.0;
    const warp2 = this.simplexWarp.noise2D((x + 65.3) * 0.0030, (z + 41.7) * 0.0030) * 14.0;
    const wx = x + warp1 + warp2;
    const wz = z + this.simplexWarp.noise2D((x + 120.0) * 0.0012, (z + 85.0) * 0.0012) * 50.0 + warp2;

    const biomeRaw = this.simplexBiome.fbm(wx * freq + 37.0, wz * freq + 83.0, 3, 2.0, 0.5);
    const wCirque = smoothstep(0.08, 0.45, biomeRaw);
    const wPark = smoothstep(-0.35, 0.05, biomeRaw) * (1.0 - smoothstep(0.12, 0.48, biomeRaw));
    const wBowls = Math.max(0.0, 1.0 - wCirque - wPark);

    let primary = 'bowls';
    if (wCirque > wPark && wCirque > wBowls) primary = 'cirque';
    else if (wPark > wCirque && wPark > wBowls) primary = 'park';

    return { raw: biomeRaw, wCirque, wPark, wBowls, primary };
  }

  /**
   * Calculates pure geological terrain elevation prior to any lake carving.
   * Features dynamic multi-biome alpine terrain with C^2 smooth continuous profiles:
   * - High Alpine Cirques: soaring mountain massifs, smooth arêtes, and sheer rock couloirs
   * - Natural Terrain Park: parabolic U-shaped halfpipes with rideable banked walls, camel-hump roller jumps
   * - Rolling Glades: flowing alpine powder bowls and undulating moraines
   * - Natural Kicker Lips: sculpted launch lips on convex drop-offs
   * - Meandering Alpine Ski Valleys: canyon corridors with flanking mountain walls
   * @param {number} x
   * @param {number} z
   * @returns {number}
   */
  getBaseHeight(x, z) {
    // 1. Dual-tier domain warping for organic winding valleys and curved ridges
    const warp1 = this.simplexWarp.noise2D(x * 0.0009, z * 0.0009) * 55.0;
    const warp2 = this.simplexWarp.noise2D((x + 73.0) * 0.0028, (z + 41.0) * 0.0028) * 15.0;
    const wx = x + warp1 + warp2;
    const wz = z + this.simplexWarp.noise2D((x + 130.0) * 0.0009, (z + 85.0) * 0.0009) * 55.0 + warp2;

    // 2. Continental Mountain Distribution (Wavelength ~1100m)
    const contNoise = this.simplexBase.fbm(wx * 0.00085, wz * 0.00085, 3, 2.0, 0.5);
    const continental = (contNoise + 1.0) * 0.5;

    // 3. Meandering Alpine Ski Valley Corridor & Descent
    const valMeander = Math.sin(wz * 0.0016) * 75.0 + Math.sin(wz * 0.0042) * 32.0;
    // C^inf smooth distance to valley axis (eliminates crease at valley center)
    const distToValley = Math.sqrt((wx - valMeander) * (wx - valMeander) + 25.0);

    // Natural undulating valley grade: waves of gentle descent and mountain passes (-15m to +15m)
    const valleyWave = Math.sin(wz * 0.0018) * 13.0 + Math.cos(wz * 0.0036) * 5.5;

    // Flanking mountain walls rise with rocky cliff buttresses along the ski corridor
    const wallBase = Math.pow(smoothstep(45.0, 280.0, distToValley), 1.4);
    const cliffButtress = this.simplexCrags.noise2D(wx * 0.0035 + 17.0, wz * 0.0035 + 41.0);
    const corridorWalls = wallBase * (85.0 + Math.max(0.0, cliffButtress) * 35.0) * this.options.corridorWalls;

    // Biome weights
    const biome = this.getBiomeData(x, z);

    // 4. Alpine Mountain Massifs & Ridge Formations (Cirque Zone)
    // Uses C^2 smooth hyperbolic ridged multifractals (zero piecewise cusps or sawtooth steps)
    const mountainWeight = smoothstep(0.24, 0.68, continental);
    const ridge1 = this.simplexMountains.ridged(wx * 0.0011, wz * 0.0011, 5, 2.05, 0.52);
    const ridge2 = this.simplexMountains.ridged(wx * 0.0024 + 43.0, wz * 0.0024 + 71.0, 4, 2.0, 0.48);
    
    // Smooth high alpine peak mass with C^2 quadratic ridge profile
    const cirqueMultiplier = 1.0 + biome.wCirque * 0.45;
    const shapedRidge = (ridge1 * ridge1 * 175.0 + ridge2 * 48.0) * mountainWeight * cirqueMultiplier * this.options.mountainIntensity;

    // Natural billow peaks and mountain shoulders
    const rawBillow = this.simplexMountains.noise2D(wx * 0.0008 + 45.0, wz * 0.0008 + 72.0);
    const billow = Math.sqrt(rawBillow * rawBillow + 0.03) * 58.0 * mountainWeight;

    const alpineMass = shapedRidge + billow + corridorWalls;

    // 5. Alpine Cliff Escarpments & Cirque Headwalls (Sheer Rock Walls)
    // Geological fault-line cliffs cutting across cirques, ridge flanks, and couloirs
    const cliffIntensity = this.options.cliffIntensity ?? 1.0;
    const cragWarp = this.simplexWarp.noise2D(wx * 0.0030, wz * 0.0030) * 12.0;
    const cragCoordX = (wx + cragWarp) * 0.0018;
    const cragCoordZ = (wz + cragWarp) * 0.0018;
    const cragNoise = this.simplexCrags.fbm(cragCoordX, cragCoordZ, 3, 2.1, 0.48);
    
    // Asymmetric cliff step: drops sharply over a tight threshold, creating sheer 55°-75° drop-offs
    const cliffStep = smoothstep(-0.06, 0.06, cragNoise);
    const cliffHeight = (18.0 + biome.wCirque * 22.0) * smoothstep(0.18, 0.55, continental) * cliffIntensity;
    const escarpmentCliff = (cliffStep - 0.5) * cliffHeight;

    // 6. Stepped Rock Benches & Freeride Cliff Bands (Pillow Drops)
    // Terraced rock drops on mid-to-high slopes for airtime cliff jumps
    const benchMask = smoothstep(0.15, 0.65, Math.abs(cragNoise)) * smoothstep(0.20, 0.60, continental);
    const rawElevForBenches = alpineMass * 0.4 + escarpmentCliff;
    const stepSize = 14.0;
    const stepNorm = rawElevForBenches / stepSize;
    const stepFloor = Math.floor(stepNorm);
    const stepFrac = stepNorm - stepFloor;
    const cliffFace = smoothstep(0.35, 0.65, stepFrac);
    const terracedElevation = (stepFloor + cliffFace) * stepSize;
    const cliffBands = (terracedElevation - rawElevForBenches) * benchMask * 0.65 * cliffIntensity;

    // 7. Banked Halfpipe Canyons & Snowboard Gullies (Park Zone)
    // C^2 smooth hyperbolic cross-section
    const canyonRaw = this.simplexCanyon.noise2D(wx * 0.0022 + 18.0, wz * 0.0022 + 51.0);
    const canyonSmooth = Math.sqrt(canyonRaw * canyonRaw + 0.04);
    const canyonBank = (Math.pow(canyonSmooth, 1.4) * 2.0 - 0.70) * 13.0;
    const parkCanyon = canyonBank * (biome.wPark * 0.85 + 0.20) * this.options.parkIntensity;

    // 8. Rolling Powder Bowls & Foothill Glades (Bowls Zone)
    const hillsFbm = this.simplexHills.fbm(wx * 0.0018, wz * 0.0018, 4, 2.0, 0.50) * 35.0;
    const billowRaw = this.simplexHills.noise2D(wx * 0.0030 + 25.0, wz * 0.0030 + 63.0);
    const billowSpines = Math.sqrt(billowRaw * billowRaw + 0.04) * 18.0;
    const rollingBowls = (hillsFbm + billowSpines) * smoothstep(0.08, 0.46, continental);

    // 9. Camel-Hump Rollers & Kicker Lips (Smooth Airtime)
    const rollerWave = Math.sin(wx * 0.034 + wz * 0.015) * Math.cos(wz * 0.024);
    const smoothRoller = smoothstep(0.0, 0.85, Math.max(0.0, rollerWave));
    const camelHump = smoothRoller * smoothRoller * 5.8 * this.options.rollerScale;

    const kickerRaw = this.simplexRollers.noise2D(wx * 0.016 + 71.0, wz * 0.016 + 93.0);
    const kickerSmooth = smoothstep(0.05, 0.80, Math.max(0.0, kickerRaw));
    const kickerLip = kickerSmooth * kickerSmooth * 3.8 * (biome.wPark * 0.70 + 0.35) * this.options.kickerScale;

    // 10. Moraine Floor & Sastrugi
    const moraineFloor = this.simplexBase.fbm(wx * 0.0024, wz * 0.0024, 3, 2.0, 0.48) * 9.0;
    const sastrugi = this.simplexBase.noise2D(wx * 0.012, wz * 0.012) * 0.65;

    // Combine features
    let baseTotal = valleyWave + alpineMass + escarpmentCliff + cliffBands + parkCanyon + rollingBowls + camelHump + kickerLip + moraineFloor + sastrugi;

    // 11. Drop-In Launch Ramp at Spawn (0, 0)
    // Ensures a clean, picturesque ~19° slope facing directly down -Z
    const spawnDist = Math.hypot(x, z);
    if (spawnDist < 140.0) {
      const spawnBlend = 1.0 - smoothstep(15.0, 140.0, spawnDist);
      const spawnRamp = (z * 0.42) * spawnBlend;
      baseTotal = baseTotal * (1.0 - spawnBlend * 0.88) + spawnRamp + 16.0 * spawnBlend;
    }

    return baseTotal;
  }

  /**
   * Helper to retrieve continental mountain belt mask [0, 1]
   * @private
   */
  _getContinentalMask(x, z) {
    const warp1 = this.simplexWarp.noise2D(x * 0.0010, z * 0.0010) * 60.0;
    const warp2 = this.simplexWarp.noise2D((x + 73.0) * 0.0032, (z + 41.0) * 0.0032) * 18.0;
    const wx = x + warp1 + warp2;
    const wz = z + this.simplexWarp.noise2D((x + 130.0) * 0.0010, (z + 85.0) * 0.0010) * 60.0 + warp2;
    const continentalNoise = this.simplexBase.fbm(wx * 0.0009, wz * 0.0009, 3, 2.0, 0.5);
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

    const cellSize = LAKE_CELL_SIZE;
    const h1x = Math.sin(cellX * 127.1 + cellZ * 311.7) * 43758.5453;
    const h1_x = h1x - Math.floor(h1x);

    // Balanced alpine tarns (~48% candidate probability per cell)
    if (h1_x > 0.48) {
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

    const radius = 55.0 + 35.0 * h2_y;
    const shoreWidth = 24.0;

    // Search 7 candidate locations across the cell for the flattest valley basin
    const candidates = [
      [(cellX + 0.2 + 0.6 * h1_y) * cellSize, (cellZ + 0.2 + 0.6 * h2_x) * cellSize],
      [(cellX + 0.5) * cellSize, (cellZ + 0.5) * cellSize],
      [(cellX + 0.25) * cellSize, (cellZ + 0.75) * cellSize],
      [(cellX + 0.75) * cellSize, (cellZ + 0.25) * cellSize],
      [(cellX + 0.35 + 0.3 * (h1_x - 0.5)) * cellSize, (cellZ + 0.35 + 0.3 * (h2_x - 0.5)) * cellSize],
      [(cellX + 0.65) * cellSize, (cellZ + 0.65) * cellSize],
      [(cellX + 0.5) * cellSize, (cellZ + 0.8) * cellSize]
    ];

    let best = null;
    let minSlope = Infinity;

    for (const [candX, candZ] of candidates) {
      // Avoid spawn radius
      if (Math.hypot(candX, candZ) < 110.0) continue;

      // 1. Continental mask check: avoid high mountain ridges and cirque peaks
      const mask = this._getContinentalMask(candX, candZ);
      if (mask > 0.42) continue;

      // 2. Strict slope & elevation difference check across candidate lake footprint
      const testR = radius * 0.7;
      const h0 = this.getBaseHeight(candX, candZ);
      const hE = this.getBaseHeight(candX + testR, candZ);
      const hW = this.getBaseHeight(candX - testR, candZ);
      const hN = this.getBaseHeight(candX, candZ + testR);
      const hS = this.getBaseHeight(candX, candZ - testR);
      const maxDiff = Math.max(Math.abs(hE - h0), Math.abs(hW - h0), Math.abs(hN - h0), Math.abs(hS - h0));
      const slope = maxDiff / testR;

      // Max allowed slope is ~9.4 degrees (0.165) - ensuring natural valley or plateau basin
      if (slope < 0.165 && slope < minSlope) {
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
    const micro = this.simplexBase.noise2D(wx * 0.010, wz * 0.010) * 0.35;

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
    const cellSize = LAKE_CELL_SIZE;
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

        const warp = Math.sin(x * 0.035 + z * 0.025) * 6.0 + Math.cos(x * 0.018 - z * 0.03) * 7.0;
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
    const cellSize = LAKE_CELL_SIZE;
    const cx = Math.floor(x / cellSize);
    const cz = Math.floor(z / cellSize);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const lake = this._getCellLake(cx + dx, cz + dz);
        if (!lake.isLake) continue;

        const warp = Math.sin(x * 0.035 + z * 0.025) * 6.0 + Math.cos(x * 0.018 - z * 0.03) * 7.0;
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
    const cellSize = LAKE_CELL_SIZE;
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
   * Uses epsilon=0.85m to band-limit derivatives to the mesh grid spacing,
   * eliminating sub-grid derivative oscillation and polygon sawtooth aliasing.
   */
  getNormal(x, z, epsilon = 0.85) {
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
