/**
 * Simplex Noise & Geologically Natural Terrain Height Generator
 * Generates vast plains, gentle valleys, gradual foothill ascents,
 * and realistic mountain ranges with alpine peaks.
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

  ridged(x, y, octaves = 5, lacunarity = 2.0, persistence = 0.5) {
    let total = 0;
    let frequency = 1.0;
    let amplitude = 1.0;
    let maxValue = 0;
    let weight = 1.0;

    for (let i = 0; i < octaves; i++) {
      let signal = Math.abs(this.noise2D(x * frequency, y * frequency));
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
 * Realistic balance: broad open plains, gentle river valleys,
 * gradual foothill ascents, and high alpine mountain ranges.
 */
export class TerrainHeightmap {
  constructor(seed = 9876) {
    this.simplexBase = new SimplexNoise(seed);
    this.simplexMountains = new SimplexNoise(seed + 101);
    this.simplexHills = new SimplexNoise(seed + 202);
    this.simplexWarp = new SimplexNoise(seed + 303);
  }

  /**
   * Continuous world height function.
   * Produces smooth, natural slopes without unnatural spikes, extrusions or seams.
   */
  getHeight(x, z) {
    // 1. Organic domain warp for natural meandering rivers & curved mountain chains
    const warpScale = 0.001;
    const warpStrength = 55.0;
    const wx = x + warpStrength * this.simplexWarp.noise2D(x * warpScale, z * warpScale);
    const wz = z + warpStrength * this.simplexWarp.noise2D((x + 52.3) * warpScale, (z + 87.1) * warpScale);

    // 2. Continental / Mountain Belt Mask (determines where plains vs mountains exist)
    // Low frequency continental variation (wavelength ~1500m)
    const continentalNoise = this.simplexBase.fbm(wx * 0.0006, wz * 0.0006, 3, 2.0, 0.5);
    const continentalMask = (continentalNoise + 1.0) * 0.5; // [0, 1]

    // 3. Vast Plains & Wide Valleys (Dominant in continentalMask < 0.45)
    // Very gentle rolling plains (elevation variation ~4 to 8 meters)
    const plains = this.simplexBase.fbm(wx * 0.002, wz * 0.002, 3, 2.0, 0.45) * 6.0;

    // Valley / drainage depression channel
    const valleyNoise = this.simplexBase.noise2D(wx * 0.0012 + 10.0, wz * 0.0012 + 20.0);
    const valleyDepression = (valleyNoise * valleyNoise) * -5.0;

    // 4. Foothills & Gradual Slopes (ascends smoothly from plains)
    // Wavelength ~300m, height ~20-35m
    const hillWeight = smoothstep(0.30, 0.60, continentalMask);
    const hills = this.simplexHills.fbm(wx * 0.003, wz * 0.003, 4, 2.0, 0.48) * 32.0;

    // 5. Alpine Mountains & Sharp Peaks (Dominant in continentalMask > 0.55)
    // Mountain mask with smooth ascent threshold
    const mountainWeight = smoothstep(0.48, 0.80, continentalMask);

    // Ridged noise creates geological mountain chains and sharp ridges
    const ridge1 = this.simplexMountains.ridged(wx * 0.0025, wz * 0.0025, 5, 2.1, 0.52);
    // Secondary billow layer for mountain mass and natural shoulder slopes
    const billow = Math.abs(this.simplexMountains.noise2D(wx * 0.0018 + 45.0, wz * 0.0018 + 72.0));
    
    // Non-linear elevation shaping: peaks rise dramatically from their shoulders
    const shapedRidge = Math.pow(ridge1, 1.6) * 1.3;
    const mountainHeight = (shapedRidge * 80.0 + billow * 35.0);

    // 6. Natural Synthesis & Layering
    // Base elevation of plains and valleys
    let elevation = plains + valleyDepression;

    // Gradual rise into foothills
    elevation += hills * hillWeight;

    // Ascent into mountain ranges and high peaks
    elevation += mountainHeight * mountainWeight;

    // 7. Subtle surface micro-undulation (smooth, zero jagged artifacts)
    const micro = this.simplexBase.noise2D(wx * 0.012, wz * 0.012) * 0.6;

    return elevation + micro;
  }

  /**
   * Continuous analytical finite-difference normal.
   * Guarantees 100% seamless lighting and shading across chunk borders.
   */
  getNormal(x, z, epsilon = 0.25) {
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
