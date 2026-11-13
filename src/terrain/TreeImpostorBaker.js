import * as THREE from 'three';

/**
 * TreeImpostorBaker
 * Automatically generates high-resolution 2D captures of 3D tree variants under current scene lighting,
 * and builds 4-triangle cross-quad billboard impostors that precisely match the 3D tree bounding boxes.
 *
 * Performance benefits:
 * - Replaces 5,700-8,700 triangles per conifer with 4 triangles (99.95% geometry reduction).
 * - Drastically cuts vertex processing and alpha-test fillrate in main and shadow passes.
 * - Uses baked sunlit/ambient/HDRI skybox lighting on an ultra-lightweight MeshBasicMaterial that integrates with scene fog.
 */
export class TreeImpostorBaker {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {Object} [options]
   */
  constructor(renderer, options = {}) {
    this.renderer = renderer;
    // 256x256 texture size cuts memory and fillrate by 75% while remaining pixel-perfect for distant LODs (>65m)
    this.textureSize = options.textureSize || 256;
    this.sunPosition = options.sunPosition || new THREE.Vector3(130, 190, 90);
    this.sunColor = options.sunColor || 0xfff5e6;
    this.sunIntensity = options.sunIntensity ?? 1.8;
    this.ambientColor = options.ambientColor || 0xffffff;
    this.ambientIntensity = options.ambientIntensity ?? 0.45;
    this.groundBounceColor = options.groundBounceColor || 0xe8f0f8;
    this.groundBounceIntensity = options.groundBounceIntensity ?? 0.45;
    this.environment = options.environment || null;
  }

  /**
   * Bakes 2D billboard textures and generates cross-quad geometries for all provided models.
   * @param {Array<Object>} loadedModels - Array of modelData objects from TreeGenerator
   * @param {THREE.Texture|null} [environment] - Optional HDR skybox environment map for true IBL lighting
   * @returns {Map<string, Object>} Map from model name to impostor definition
   */
  bake(loadedModels, environment = null) {
    const impostors = new Map();
    if (!this.renderer || !loadedModels || loadedModels.length === 0) {
      return impostors;
    }

    if (environment) {
      this.environment = environment;
    }

    const prevRenderTarget = this.renderer.getRenderTarget();
    const prevClearColor = this.renderer.getClearColor(new THREE.Color());
    const prevClearAlpha = this.renderer.getClearAlpha();

    for (const model of loadedModels) {
      if (!model || !model.geometry) continue;

      try {
        const impostorData = this._bakeModel(model, this.environment);
        if (impostorData) {
          impostors.set(model.name, impostorData);
        }
      } catch (err) {
        console.warn(`TreeImpostorBaker: Failed to bake impostor for "${model.name}":`, err);
      }
    }

    // Restore renderer state
    this.renderer.setRenderTarget(prevRenderTarget);
    this.renderer.setClearColor(prevClearColor, prevClearAlpha);

    return impostors;
  }

  /**
   * Bakes an individual model variant with exact main scene sun, ambient, HDRI skybox, and snow bounce.
   * @private
   */
  _bakeModel(model, environment = null) {
    model.geometry.computeBoundingBox();
    const bb = model.geometry.boundingBox;
    const height = bb.max.y - bb.min.y;
    const width = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);

    // Padding ensures tip and root branch cutouts are not clipped by orthographic frustum
    const camWidth = width * 1.08;
    const camHeight = height * 1.04;
    const halfW = camWidth / 2;
    const bottom = -height * 0.02;
    const top = bottom + camHeight;
    const centerY = (bottom + top) / 2;

    // 1. Isolated baking scene matching exact in-game lighting environment
    const bakeScene = new THREE.Scene();

    const env = environment || this.environment;
    if (env) {
      bakeScene.environment = env;
    }

    // Main directional sunlight
    const sun = new THREE.DirectionalLight(this.sunColor, this.sunIntensity);
    sun.position.copy(this.sunPosition).normalize().multiplyScalar(50);
    bakeScene.add(sun);

    // Flat ambient skylight matching main scene
    const amb = new THREE.AmbientLight(this.ambientColor, this.ambientIntensity);
    bakeScene.add(amb);

    // Snow ground bounce: pure white alpine snow (albedo ~0.85) reflects sunlight upward into branches
    const groundBounce = new THREE.DirectionalLight(this.groundBounceColor, this.groundBounceIntensity);
    groundBounce.position.set(0, -30, 0);
    bakeScene.add(groundBounce);

    const bakeMesh = new THREE.Mesh(model.geometry, model.materials);
    bakeScene.add(bakeMesh);

    // 2. Orthographic capture camera looking at tree from side (+Z looking towards -Z)
    const orthoCam = new THREE.OrthographicCamera(
      -halfW,
      halfW,
      top - centerY,
      bottom - centerY,
      0.1,
      100
    );
    orthoCam.position.set(0, centerY, 30);
    orthoCam.lookAt(0, centerY, 0);

    // 3. Render target (512x512 LinearSRGBColorSpace)
    // Note: Using LinearSRGBColorSpace preserves raw linear HDR values, preventing double-gamma darkening
    let rt = model.impostor?.renderTarget;
    if (!rt) {
      rt = new THREE.WebGLRenderTarget(this.textureSize, this.textureSize, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        colorSpace: THREE.LinearSRGBColorSpace,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: true,
      });
    }

    this.renderer.setRenderTarget(rt);
    this.renderer.setClearColor(0x000000, 0.0);
    this.renderer.clear();
    this.renderer.render(bakeScene, orthoCam);

    // Clean up temporary bake objects
    bakeScene.remove(bakeMesh);
    bakeScene.remove(sun);
    bakeScene.remove(amb);
    bakeScene.remove(groundBounce);

    // If impostor already exists, texture is refreshed in-place
    if (model.impostor) {
      model.impostor.texture = rt.texture;
      model.impostor.material.map = rt.texture;
      model.impostor.material.needsUpdate = true;
      model.impostor.depthMaterial.map = rt.texture;
      model.impostor.depthMaterial.needsUpdate = true;
      return model.impostor;
    }

    // 4. Construct 4-triangle cross-quad geometry
    // Two intersecting vertical planes (XY and ZY) rooted at y = 0
    const plane1 = new THREE.PlaneGeometry(camWidth, camHeight);
    plane1.translate(0, centerY, 0);

    const plane2 = new THREE.PlaneGeometry(camWidth, camHeight);
    plane2.rotateY(Math.PI / 2);
    plane2.translate(0, centerY, 0);

    const pos1 = plane1.attributes.position.array;
    const uv1 = plane1.attributes.uv.array;
    const idx1 = plane1.index.array;

    const pos2 = plane2.attributes.position.array;
    const uv2 = plane2.attributes.uv.array;
    const idx2 = plane2.index.array;

    const mergedPositions = new Float32Array(pos1.length + pos2.length);
    mergedPositions.set(pos1, 0);
    mergedPositions.set(pos2, pos1.length);

    const mergedUvs = new Float32Array(uv1.length + uv2.length);
    mergedUvs.set(uv1, 0);
    mergedUvs.set(uv2, uv1.length);

    const mergedIndices = new Uint16Array(idx1.length + idx2.length);
    mergedIndices.set(idx1, 0);
    const offset = pos1.length / 3;
    for (let i = 0; i < idx2.length; i++) {
      mergedIndices[idx1.length + i] = idx2[i] + offset;
    }

    const crossGeo = new THREE.BufferGeometry();
    crossGeo.setAttribute('position', new THREE.BufferAttribute(mergedPositions, 3));
    crossGeo.setAttribute('uv', new THREE.BufferAttribute(mergedUvs, 2));
    crossGeo.setIndex(new THREE.BufferAttribute(mergedIndices, 1));
    crossGeo.computeVertexNormals();
    crossGeo.computeBoundingBox();
    crossGeo.computeBoundingSphere();

    plane1.dispose();
    plane2.dispose();

    // 5. Impostor materials
    const alphaCutoff = model.isDead ? 0.35 : 0.28;

    const material = new THREE.MeshBasicMaterial({
      name: `ImpostorMat_${model.name}`,
      map: rt.texture,
      transparent: true,
      alphaTest: alphaCutoff,
      depthWrite: true,
      side: THREE.DoubleSide,
      fog: true,
    });

    const depthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: rt.texture,
      alphaTest: alphaCutoff,
      side: THREE.DoubleSide,
    });

    return {
      name: model.name,
      geometry: crossGeo,
      material,
      depthMaterial,
      renderTarget: rt,
      texture: rt.texture,
      modelHeight: height,
      camWidth,
      camHeight,
      centerY,
    };
  }
}
