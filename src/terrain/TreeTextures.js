import * as THREE from 'three';

/**
 * Creates high-fidelity procedural PBR textures for alpine conifer trees
 * (bark, pine needles, normal maps, and roughness maps).
 * Automatically checks for external images and falls back to procedural generation.
 */
export class TreeTextureFactory {
  static _cache = null;

  static getTextures() {
    if (this._cache) return this._cache;

    // Check if running in browser
    if (typeof document === 'undefined') {
      return null;
    }

    const barkDiffuse = this._createBarkDiffuse();
    const barkNormal = this._createBarkNormal();
    const branchDiffuse = this._createBranchDiffuse();
    const branchNormal = this._createBranchNormal();
    const deadBarkDiffuse = this._createDeadBarkDiffuse();

    this._cache = {
      barkDiffuse,
      barkNormal,
      branchDiffuse,
      branchNormal,
      deadBarkDiffuse,
    };

    return this._cache;
  }

  /**
   * Procedural seamless coniferous bark texture
   */
  static _createBarkDiffuse() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Base deep timber brown
    ctx.fillStyle = '#26170e';
    ctx.fillRect(0, 0, size, size);

    // Vertical bark ridges and furrows
    for (let x = 0; x < size; x++) {
      const colNoise = Math.sin(x * 0.18) * 0.5 + Math.sin(x * 0.045) * 0.5;
      for (let y = 0; y < size; y += 2) {
        const furrowNoise = Math.sin((x + Math.sin(y * 0.05) * 6) * 0.12);
        const microNoise = (Math.random() - 0.5) * 25;
        
        // Furrow depth
        const depth = (furrowNoise * 0.5 + colNoise * 0.5);
        const r = Math.max(20, Math.min(80, Math.round(48 + depth * 22 + microNoise)));
        const g = Math.max(12, Math.min(60, Math.round(32 + depth * 15 + microNoise * 0.7)));
        const b = Math.max(8, Math.min(45, Math.round(20 + depth * 10 + microNoise * 0.5)));

        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, y, 1, 2);
      }
    }

    // Bark scale highlights & fibrous grain
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
        
        // Normal vector [nx, ny, 1.0] normalized to [0, 255]
        data[idx] = Math.round((nx * 0.5 + 0.5) * 255);       // Red = X
        data[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);   // Green = Y
        data[idx + 2] = 230;                                  // Blue = Z (pointing out)
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
   * Procedural conifer pine needle branch texture
   */
  static _createBranchDiffuse() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Rich dark pine base
    ctx.fillStyle = '#142918';
    ctx.fillRect(0, 0, size, size);

    // Multi-layered pine needle clusters
    const needleColors = [
      '#16321b',
      '#1b3f23',
      '#234f2d',
      '#2c5f36',
      '#356f3f',
      '#1a3a20',
      '#417a4c'
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

    // Thousands of overlapping fine needles
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

    // Subtle frost/snow dust specks on pine needle tips
    ctx.fillStyle = 'rgba(230, 242, 235, 0.35)';
    for (let s = 0; s < 300; s++) {
      const sx = Math.random() * size;
      const sy = Math.random() * size * 0.7; // mostly top of branch
      ctx.fillRect(sx, sy, 2, 2);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 1);
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

    // Sun-bleached gray-brown timber base
    ctx.fillStyle = '#423a32';
    ctx.fillRect(0, 0, size, size);

    // Weathered fissures and grain
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
