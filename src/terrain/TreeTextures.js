import * as THREE from 'three';
import {
  createTreeLeafMaterial,
  TreeLeafMaterial,
  applyTreeLeafShader,
  LEAF_COLOR_PRESETS,
} from './TreeLeafShader.js';

export {
  createTreeLeafMaterial,
  TreeLeafMaterial,
  applyTreeLeafShader,
  LEAF_COLOR_PRESETS,
};

/**
 * Texture asset paths for conifer trees.
 * BranchMat_diffuse_green.png is the single base leaf texture for all trees;
 * all foliage variations (autumn amber, silver frost, golden larch, ruby crimson, blue spruce)
 * are generated dynamically by TreeLeafShader based on the world seed.
 */
export const TREE_TEXTURE_PATHS = {
  branchGreen: '/textures/BranchMat_diffuse_green.png',
  branchNormal: '/textures/BranchMat_normal.png',
  barkDiffuse: '/textures/BarkMat_diffuse.png',
  barkNormal: '/textures/BarkMat_normal.png',
};

/**
 * TreeTextureFactory
 * Loads and manages high-resolution conifer tree textures:
 * - Green pine needles (BranchMat_diffuse_green.png)
 * - Conifer bark diffuse & normal maps
 *
 * All color variations are produced via TreeLeafShader in GPU HSL space.
 * Provides procedural generation fallbacks if texture image files are not available.
 */
export class TreeTextureFactory {
  static _cache = null;

  /**
   * Asynchronously loads all tree textures with procedural fallbacks.
   * @returns {Promise<Object>}
   */
  static async loadTextures() {
    if (this._cache) return this._cache;

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

    const [
      barkDiff,
      barkNorm,
      branchDiffGreen,
      branchNorm,
    ] = await Promise.all([
      loadTex(TREE_TEXTURE_PATHS.barkDiffuse, true, 1, 1),
      loadTex(TREE_TEXTURE_PATHS.barkNormal, false, 1, 1),
      loadTex(TREE_TEXTURE_PATHS.branchGreen, true, 1, 1),
      loadTex(TREE_TEXTURE_PATHS.branchNormal, false, 1, 1),
    ]);

    const proc = this.getTextures() || {};
    const greenTex = branchDiffGreen || proc.branchDiffuseGreen;

    this._cache = {
      barkDiffuse: barkDiff || proc.barkDiffuse,
      barkNormal: barkNorm || proc.barkNormal,
      branchNormal: branchNorm || proc.branchNormal,
      deadBarkDiffuse: proc.deadBarkDiffuse,
      // Single leaf texture serving as base for all shader-generated leaf color variations
      branchDiffuseGreen: greenTex,
      branchDiffuseSnow: greenTex,
      branchDiffuseOrange: greenTex,
      branchDiffuses: [greenTex],
      branchDiffuse: greenTex,
    };

    return this._cache;
  }

  /**
   * Synchronous getter returning cached textures, generating procedural textures if not cached.
   * @returns {Object|null}
   */
  static getTextures() {
    if (this._cache) return this._cache;

    if (typeof document === 'undefined') {
      return null;
    }

    const barkDiffuse = this._createBarkDiffuse();
    const barkNormal = this._createBarkNormal();
    const branchNormal = this._createBranchNormal();
    const deadBarkDiffuse = this._createDeadBarkDiffuse();
    const branchDiffuseGreen = this._createBranchDiffuseGreen();

    this._cache = {
      barkDiffuse,
      barkNormal,
      branchNormal,
      deadBarkDiffuse,
      branchDiffuseGreen,
      branchDiffuseSnow: branchDiffuseGreen,
      branchDiffuseOrange: branchDiffuseGreen,
      branchDiffuses: [branchDiffuseGreen],
      branchDiffuse: branchDiffuseGreen,
    };

    return this._cache;
  }

  /**
   * Returns a random branch diffuse texture from [snow, green, orange].
   * @param {number} [rng] - Optional random float in [0, 1) or integer
   * @returns {THREE.Texture}
   */
  static getRandomBranchTexture(rng) {
    const textures = this.getTextures();
    if (!textures || !textures.branchDiffuses) return null;
    const list = textures.branchDiffuses;
    const val = rng !== undefined ? rng : Math.random();
    const idx = Math.floor(Math.abs(val) * list.length) % list.length;
    return list[idx];
  }

  /**
   * Returns all available branch diffuse textures.
   * @returns {THREE.Texture[]}
   */
  static getBranchTextures() {
    const textures = this.getTextures();
    return textures?.branchDiffuses || [];
  }

  /**
   * Creates standard PBR materials for trees using the loaded textures.
   * Uses BranchMat_diffuse_green.png as the single base leaf texture and generates
   * distinct foliage variants (green, autumn amber, silver frost, golden larch, ruby crimson, blue spruce)
   * via TreeLeafShader based on the world seed.
   * @param {Object} [textures]
   * @param {number} [seed=1337]
   * @returns {Object}
   */
  static createMaterials(textures = null, seed = 1337) {
    const tex = textures || this.getTextures() || {};
    const branchGreen = tex.branchDiffuseGreen || tex.branchDiffuse;
    const normalMap = tex.branchNormal || null;

    const makeNeedleMaterial = (name, hslOptions = {}) => {
      return createTreeLeafMaterial({
        name,
        color: 0xffffff,
        map: branchGreen || null,
        normalMap,
        normalScale: new THREE.Vector2(0.8, 0.8),
        roughness: 1.0,
        metalness: 0.0,
        side: THREE.DoubleSide,
        transparent: true,
        alphaTest: 0.40,
        depthWrite: true,
        seed,
        ...hslOptions,
      });
    };

    // Shader-generated leaf color variations from the single BranchMat_diffuse_green texture:
    const needlesGreen = makeNeedleMaterial('AlpinePineNeedles_Green', {
      preset: 'green',
      instanceVariation: [0.015, 0.05, 0.05], // subtle organic HSL variation per tree instance
    });
    const needlesOrange = makeNeedleMaterial('AlpinePineNeedles_Orange', {
      preset: 'autumnOrange',
      instanceVariation: [0.02, 0.06, 0.06],
    });
    const needlesSnow = makeNeedleMaterial('AlpinePineNeedles_Snow', {
      preset: 'frostSilver',
      instanceVariation: [0.015, 0.05, 0.06],
    });
    const needlesGold = makeNeedleMaterial('AlpinePineNeedles_Gold', {
      preset: 'goldenLarch',
      instanceVariation: [0.02, 0.06, 0.05],
    });
    const needlesCrimson = makeNeedleMaterial('AlpinePineNeedles_Crimson', {
      preset: 'crimsonMaple',
      instanceVariation: [0.02, 0.06, 0.05],
    });
    const needlesSpruce = makeNeedleMaterial('AlpinePineNeedles_Spruce', {
      preset: 'blueSpruce',
      instanceVariation: [0.015, 0.05, 0.05],
    });

    const livingBark = new THREE.MeshStandardMaterial({
      name: 'AlpinePineTrunk',
      color: 0xffffff,
      map: tex.barkDiffuse || null,
      normalMap: tex.barkNormal || null,
      normalScale: new THREE.Vector2(1.1, 1.1),
      roughness: 0.85,
      metalness: 0.02,
    });

    const deadBark = new THREE.MeshStandardMaterial({
      name: 'AlpineDeadBark',
      color: 0xffffff,
      map: tex.barkDiffuse || null,
      normalMap: tex.barkNormal || null,
      normalScale: new THREE.Vector2(1.1, 1.1),
      roughness: 0.90,
      metalness: 0.02,
    });

    const allNeedleMaterials = [
      needlesGreen,
      needlesOrange,
      needlesSnow,
      needlesGold,
      needlesCrimson,
      needlesSpruce,
    ];

    return {
      needles: needlesGreen,
      needlesGreen,
      needlesOrange,
      needlesSnow,
      needlesGold,
      needlesCrimson,
      needlesSpruce,
      needlesVariations: allNeedleMaterials,
      livingBark,
      deadBark,
      createNeedleVariant(name, hslOptions) {
        return makeNeedleMaterial(name, hslOptions);
      },
      getRandomNeedleMaterial(rng) {
        const val = rng !== undefined ? rng : Math.random();
        const idx = Math.floor(Math.abs(val) * allNeedleMaterials.length) % allNeedleMaterials.length;
        return allNeedleMaterials[idx];
      },
    };
  }

  // =========================================================================
  // Procedural Texture Generators (Offline / Fallback Support)
  // =========================================================================

  /**
   * Procedural seamless coniferous bark texture
   */
  static _createBarkDiffuse() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#26170e';
    ctx.fillRect(0, 0, size, size);

    for (let x = 0; x < size; x++) {
      const colNoise = Math.sin(x * 0.18) * 0.5 + Math.sin(x * 0.045) * 0.5;
      for (let y = 0; y < size; y += 2) {
        const furrowNoise = Math.sin((x + Math.sin(y * 0.05) * 6) * 0.12);
        const microNoise = (Math.random() - 0.5) * 25;
        const depth = furrowNoise * 0.5 + colNoise * 0.5;
        const r = Math.max(20, Math.min(80, Math.round(48 + depth * 22 + microNoise)));
        const g = Math.max(12, Math.min(60, Math.round(32 + depth * 15 + microNoise * 0.7)));
        const b = Math.max(8, Math.min(45, Math.round(20 + depth * 10 + microNoise * 0.5)));

        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, y, 1, 2);
      }
    }

    for (let i = 0; i < 900; i++) {
      const rx = Math.random() * size;
      const ry = Math.random() * size;
      const rw = 2 + Math.random() * 4;
      const rh = 12 + Math.random() * 35;
      const alpha = 0.12 + Math.random() * 0.22;
      const tone = Math.random() > 0.4 ? '68, 44, 28' : '22, 13, 8';
      ctx.fillStyle = `rgba(${tone}, ${alpha})`;
      ctx.fillRect(rx, ry, rw, rh);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 4);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /**
   * Procedural normal map for bark relief
   */
  static _createBarkNormal() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(size, size);
    const data = imgData.data;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const nx = Math.sin(x * 0.12 + Math.sin(y * 0.05) * 4) * 0.45;
        const ny = Math.cos(y * 0.05) * 0.15;

        data[idx] = Math.round((nx * 0.5 + 0.5) * 255);
        data[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        data[idx + 2] = 230;
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 4);
    return tex;
  }

  /**
   * Procedural green conifer pine needle branch texture
   */
  static _createBranchDiffuseGreen() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#142918';
    ctx.fillRect(0, 0, size, size);

    const needleColors = [
      '#16321b',
      '#1b3f23',
      '#234f2d',
      '#2c5f36',
      '#356f3f',
      '#1a3a20',
      '#417a4c',
    ];

    ctx.lineWidth = 4;
    ctx.strokeStyle = '#2b1b11';
    for (let b = 0; b < 6; b++) {
      ctx.beginPath();
      const startX = size * 0.5 + (b - 3) * 60;
      ctx.moveTo(startX, size);
      ctx.quadraticCurveTo(startX + (Math.random() - 0.5) * 40, size * 0.5, startX + (Math.random() - 0.5) * 80, 0);
      ctx.stroke();
    }

    for (let i = 0; i < 4500; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const angle = (Math.random() - 0.5) * 1.4 - Math.PI / 2;
      const len = 14 + Math.random() * 24;
      const col = needleColors[Math.floor(Math.random() * needleColors.length)];

      ctx.strokeStyle = col;
      ctx.lineWidth = 1.2 + Math.random() * 1.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(230, 242, 235, 0.35)';
    for (let s = 0; s < 300; s++) {
      const sx = Math.random() * size;
      const sy = Math.random() * size * 0.7;
      ctx.fillRect(sx, sy, 2, 2);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /**
   * Procedural snow-covered alpine conifer pine needle branch texture
   */
  static _createBranchDiffuseSnow() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Muted winter evergreen base
    ctx.fillStyle = '#1e3024';
    ctx.fillRect(0, 0, size, size);

    const needleColors = [
      '#1b3323',
      '#24452e',
      '#30573c',
      '#436d4f',
      '#628a6f',
    ];

    // Branch spines
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#281d16';
    for (let b = 0; b < 6; b++) {
      ctx.beginPath();
      const startX = size * 0.5 + (b - 3) * 60;
      ctx.moveTo(startX, size);
      ctx.quadraticCurveTo(startX + (Math.random() - 0.5) * 40, size * 0.5, startX + (Math.random() - 0.5) * 80, 0);
      ctx.stroke();
    }

    // Needles
    for (let i = 0; i < 4000; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const angle = (Math.random() - 0.5) * 1.4 - Math.PI / 2;
      const len = 14 + Math.random() * 22;
      const col = needleColors[Math.floor(Math.random() * needleColors.length)];

      ctx.strokeStyle = col;
      ctx.lineWidth = 1.3 + Math.random() * 1.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
      ctx.stroke();
    }

    // Heavy alpine snow pillow drifts on upper needle surfaces
    for (let d = 0; d < 70; d++) {
      const dx = Math.random() * size;
      const dy = Math.random() * size * 0.85;
      const radX = 12 + Math.random() * 32;
      const radY = 6 + Math.random() * 16;
      const grad = ctx.createRadialGradient(dx, dy, 2, dx, dy, radX);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      grad.addColorStop(0.6, 'rgba(240, 246, 252, 0.82)');
      grad.addColorStop(1, 'rgba(220, 235, 245, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(dx, dy, radX, radY, (Math.random() - 0.5) * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Thousands of frost and snow crystals
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    for (let s = 0; s < 1200; s++) {
      const sx = Math.random() * size;
      const sy = Math.random() * size;
      const sz = 1.5 + Math.random() * 2.5;
      ctx.fillRect(sx, sy, sz, sz);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /**
   * Procedural orange / autumn larch conifer branch texture
   */
  static _createBranchDiffuseOrange() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Deep warm russet base
    ctx.fillStyle = '#42240e';
    ctx.fillRect(0, 0, size, size);

    const autumnColors = [
      '#a24c16',
      '#bf5f19',
      '#d7761f',
      '#e58e26',
      '#f39c12',
      '#d35400',
      '#e67e22',
      '#c0392b',
      '#f1c40f',
    ];

    // Branch spines
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#2b1b11';
    for (let b = 0; b < 6; b++) {
      ctx.beginPath();
      const startX = size * 0.5 + (b - 3) * 60;
      ctx.moveTo(startX, size);
      ctx.quadraticCurveTo(startX + (Math.random() - 0.5) * 40, size * 0.5, startX + (Math.random() - 0.5) * 80, 0);
      ctx.stroke();
    }

    // Autumn needles
    for (let i = 0; i < 4500; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const angle = (Math.random() - 0.5) * 1.4 - Math.PI / 2;
      const len = 14 + Math.random() * 24;
      const col = autumnColors[Math.floor(Math.random() * autumnColors.length)];

      ctx.strokeStyle = col;
      ctx.lineWidth = 1.2 + Math.random() * 1.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
      ctx.stroke();
    }

    // Golden sun highlights
    ctx.fillStyle = 'rgba(255, 230, 160, 0.4)';
    for (let s = 0; s < 400; s++) {
      const sx = Math.random() * size;
      const sy = Math.random() * size * 0.7;
      ctx.fillRect(sx, sy, 2, 2);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /**
   * Procedural normal map for pine needle texture
   */
  static _createBranchNormal() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(size, size);
    const data = imgData.data;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const n1 = Math.sin(x * 0.25) * 0.35;
        const n2 = Math.cos(y * 0.25) * 0.35;
        data[idx] = Math.round((n1 * 0.5 + 0.5) * 255);
        data[idx + 1] = Math.round((n2 * 0.5 + 0.5) * 255);
        data[idx + 2] = 220;
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  /**
   * Procedural weathered timber snag texture
   */
  static _createDeadBarkDiffuse() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#423a32';
    ctx.fillRect(0, 0, size, size);

    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y += 2) {
        const fissure = Math.sin(x * 0.08 + Math.sin(y * 0.03) * 8) * 0.5;
        const micro = (Math.random() - 0.5) * 20;
        const v = Math.max(30, Math.min(100, Math.round(62 + fissure * 25 + micro)));
        ctx.fillStyle = `rgb(${v}, ${Math.round(v * 0.9)}, ${Math.round(v * 0.82)})`;
        ctx.fillRect(x, y, 1, 2);
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 4);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
}
