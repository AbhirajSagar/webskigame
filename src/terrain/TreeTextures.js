import * as THREE from 'three';

/**
 * Texture asset paths for Pine 4m conifer tree.
 * Uses authentic diffuse and normal maps:
 * - pine-trunk-diff.png / pine-trunk-norm.png
 * - pine-branch-diff.png / pine-branch-norm.png
 * - pine-leaf-diff.png / pine-leaf-norm.png
 */
export const TREE_TEXTURE_PATHS = {
  trunkDiffuse: '/textures/pine-trunk-diff.png',
  trunkNormal: '/textures/pine-trunk-norm.png',
  branchDiffuse: '/textures/pine-branch-diff.png',
  branchNormal: '/textures/pine-branch-norm.png',
  leafDiffuse: '/textures/pine-leaf-diff.png',
  leafNormal: '/textures/pine-leaf-norm.png',
};

/**
 * TreeTextureFactory
 * Loads and manages high-resolution conifer tree textures for Pine 4m.
 * Uses standard Three.js PBR materials (MeshStandardMaterial) without custom shaders.
 */
export class TreeTextureFactory {
  static _cache = null;
  static _loaded = false;
  static _loadPromise = null;

  /**
   * Asynchronously loads all tree textures with procedural fallbacks.
   * @returns {Promise<Object>}
   */
  static async loadTextures() {
    if (this._loaded && this._cache) return this._cache;
    if (this._loadPromise) return this._loadPromise;

    this._loadPromise = (async () => {
      const textureLoader = new THREE.TextureLoader();
      const loadTex = (url, isSRGB = false, repeatX = 1, repeatY = 1) => {
        return new Promise((resolve) => {
          textureLoader.load(
            url,
            (t) => {
              // GLB/glTF UVs use V=0 at top of image; disable flipY so PNGs match Pine_4m.glb UVs
              t.flipY = false;
              t.wrapS = THREE.RepeatWrapping;
              t.wrapT = THREE.RepeatWrapping;
              t.repeat.set(repeatX, repeatY);
              if (isSRGB) t.colorSpace = THREE.SRGBColorSpace;
              t.needsUpdate = true;
              resolve(t);
            },
            undefined,
            () => resolve(null)
          );
        });
      };

      const [
        trunkDiff,
        trunkNorm,
        branchDiff,
        branchNorm,
        leafDiff,
        leafNorm,
      ] = await Promise.all([
        loadTex(TREE_TEXTURE_PATHS.trunkDiffuse, true, 1, 1),
        loadTex(TREE_TEXTURE_PATHS.trunkNormal, false, 1, 1),
        loadTex(TREE_TEXTURE_PATHS.branchDiffuse, true, 1, 1),
        loadTex(TREE_TEXTURE_PATHS.branchNormal, false, 1, 1),
        loadTex(TREE_TEXTURE_PATHS.leafDiffuse, true, 1, 1),
        loadTex(TREE_TEXTURE_PATHS.leafNormal, false, 1, 1),
      ]);

      const proc = (!trunkDiff || !trunkNorm || !branchDiff || !branchNorm || !leafDiff || !leafNorm)
        ? (this.getTextures() || {})
        : {};

      this._cache = {
        trunkDiffuse: trunkDiff || proc.trunkDiffuse,
        trunkNormal: trunkNorm || proc.trunkNormal,
        branchDiffuse: branchDiff || proc.branchDiffuse,
        branchNormal: branchNorm || proc.branchNormal,
        leafDiffuse: leafDiff || proc.leafDiffuse,
        leafNormal: leafNorm || proc.leafNormal,
        // Backward compatibility aliases
        barkDiffuse: trunkDiff || proc.trunkDiffuse,
        barkNormal: trunkNorm || proc.trunkNormal,
        branchDiffuseGreen: leafDiff || proc.leafDiffuse,
        branchDiffuses: [leafDiff || proc.leafDiffuse],
      };
      this._loaded = true;

      return this._cache;
    })();

    return this._loadPromise;
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

    const trunkDiffuse = this._createBarkDiffuse();
    const trunkNormal = this._createBarkNormal();
    const branchDiffuse = this._createBranchDiffuseGreen();
    const branchNormal = this._createBranchNormal();
    const leafDiffuse = this._createBranchDiffuseGreen();
    const leafNormal = this._createBranchNormal();

    this._cache = {
      trunkDiffuse,
      trunkNormal,
      branchDiffuse,
      branchNormal,
      leafDiffuse,
      leafNormal,
      barkDiffuse: trunkDiffuse,
      barkNormal: trunkNormal,
      branchDiffuseGreen: leafDiffuse,
      branchDiffuses: [leafDiffuse],
    };

    return this._cache;
  }

  /**
   * Returns all available branch/leaf diffuse textures.
   * @returns {THREE.Texture[]}
   */
  static getBranchTextures() {
    const textures = this.getTextures();
    return textures?.branchDiffuses || [];
  }

  /**
   * Creates standard PBR materials for Pine 4m tree using loaded textures.
   * Uses standard THREE.MeshStandardMaterial without custom shaders.
   * @param {Object} [textures]
   * @param {number} [seed=1337]
   * @returns {Object}
   */
  static createMaterials(textures = null, seed = 1337) {
    const tex = textures || this.getTextures() || {};

    const trunkMaterial = new THREE.MeshStandardMaterial({
      name: 'PineTrunk',
      color: 0xffffff,
      map: tex.trunkDiffuse || tex.barkDiffuse || null,
      normalMap: tex.trunkNormal || tex.barkNormal || null,
      normalScale: new THREE.Vector2(1.0, 1.0),
      roughness: 0.85,
      metalness: 0.02,
    });

    const branchMaterial = new THREE.MeshStandardMaterial({
      name: 'PineBranch',
      color: 0xffffff,
      map: tex.branchDiffuse || null,
      normalMap: tex.branchNormal || null,
      normalScale: new THREE.Vector2(1.0, 1.0),
      roughness: 0.80,
      metalness: 0.0,
      side: THREE.DoubleSide,
      transparent: false,
      alphaTest: 0.35,
      depthWrite: true,
    });

    const leafMaterial = new THREE.MeshStandardMaterial({
      name: 'PineLeaf',
      color: 0xffffff,
      map: tex.leafDiffuse || tex.branchDiffuseGreen || null,
      normalMap: tex.leafNormal || null,
      normalScale: new THREE.Vector2(1.0, 1.0),
      roughness: 1.0,
      metalness: 0.0,
      side: THREE.DoubleSide,
      transparent: false,
      alphaTest: 0.35,
      depthWrite: true,
    });

    return {
      trunk: trunkMaterial,
      livingBark: trunkMaterial,
      deadBark: trunkMaterial,
      branch: branchMaterial,
      leaf: leafMaterial,
      needles: leafMaterial,
      needlesGreen: leafMaterial,
      needlesOrange: leafMaterial,
      needlesSnow: leafMaterial,
      needlesGold: leafMaterial,
      needlesCrimson: leafMaterial,
      needlesSpruce: leafMaterial,
      needlesVariations: [leafMaterial],
    };
  }

  // =========================================================================
  // Procedural Texture Generators (Offline / Fallback Support)
  // =========================================================================

  /**
   * Procedural seamless coniferous bark texture fallback
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

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 4);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /**
   * Procedural normal map for bark relief fallback
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
   * Procedural green conifer pine needle branch texture fallback
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

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /**
   * Procedural normal map for pine needle texture fallback
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
}
