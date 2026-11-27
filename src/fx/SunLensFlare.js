import * as THREE from 'three';

const _scratchSunPos = new THREE.Vector3();
const _scratchCamFwd = new THREE.Vector3();

/**
 * SunLensFlare
 * Natural, multi-coated optical lens flare driven by the directional sun light.
 * Combines soft atmospheric veiling glare, organic multi-harmonic diffraction rays,
 * and subtly chromatic-fringed aperture bokeh ghosts, with terrain heightmap occlusion.
 */
export class SunLensFlare {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} sunDirection - Vector pointing toward the sun
   * @param {Object} [options={}]
   */
  constructor(scene, sunDirection, options = {}) {
    this.scene = scene;
    this.sunDir = (sunDirection ? sunDirection.clone() : new THREE.Vector3(130, 190, 90)).normalize();
    this.maxIntensity = options.intensity ?? 0.58;

    this.intensity = 0.0;
    this._occlusionTimer = 0.0;
    this._cachedOccluded = false;
    this._initMesh();
  }

  _initMesh() {
    this.uniforms = {
      uSunNDC: { value: new THREE.Vector2(0, 0) },
      uIntensity: { value: 0.0 },
      uAspect: { value: 1.0 },
      uRoll: { value: 0.0 },
    };

    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.x, position.y, 0.0, 1.0);
      }
    `;

    const fragmentShader = `
      uniform vec2 uSunNDC;
      uniform float uIntensity;
      uniform float uAspect;
      uniform float uRoll;

      varying vec2 vUv;

      // Soft rounded hexagonal bokeh distance for authentic aperture reflections
      float hexApertureDist(vec2 p) {
        vec2 q = abs(p);
        return max(q.x * 0.866025 + q.y * 0.5, q.y);
      }

      // Soft Gaussian optical ghost with subtle radial chromatic aberration (R/G/B dispersion)
      vec3 chromaticGhost(vec2 ndc, vec2 center, float radius, vec2 aspectScale, vec2 axisDir, float dispersion) {
        vec2 offset = (ndc - center) * aspectScale;
        float dR = hexApertureDist(offset - axisDir * dispersion);
        float dG = hexApertureDist(offset);
        float dB = hexApertureDist(offset + axisDir * dispersion);

        // Soft feathered disc + faint bright rim (typical of multi-coated camera lenses)
        vec3 d = vec3(dR, dG, dB) / max(0.001, radius);
        vec3 disc = exp(-d * d * 2.4) * 0.55;
        vec3 rim = smoothstep(1.05, 0.78, d) * smoothstep(0.45, 0.88, d) * 0.45;
        return disc + rim;
      }

      void main() {
        if (uIntensity <= 0.001) discard;

        vec2 ndc = vUv * 2.0 - 1.0;
        vec2 aspectScale = (uAspect >= 1.0) ? vec2(uAspect, 1.0) : vec2(1.0, 1.0 / max(0.25, uAspect));
        vec2 delta = (ndc - uSunNDC) * aspectScale;
        float dist = length(delta);

        // 1. Natural solar bloom & atmospheric veiling glare
        float core = exp(-dist * 34.0) * 0.85;
        float innerCorona = exp(-dist * 7.5) * 0.32;
        float veilingGlare = exp(-dist * 1.9) * 0.095;

        // 2. Organic multi-harmonic optical diffraction rays (subtle, non-uniform)
        float ang = atan(delta.y, delta.x) + uRoll * 0.45;
        float rayA = pow(abs(cos(ang * 3.0 + 0.15)), 20.0);
        float rayB = pow(abs(cos(ang * 5.0 - 0.40)), 26.0) * 0.65;
        float fineShimmer = 0.75 + 0.25 * sin(ang * 23.0 + dist * 12.0);
        float rays = (rayA + rayB) * fineShimmer * exp(-dist * 5.2) * 0.22;

        // 3. Soft feathered anamorphic sheen (subtle warm-to-cool horizontal dispersion)
        float anamorphic = exp(-abs(delta.y) * 26.0) * exp(-abs(delta.x) * 3.4) * 0.14;

        vec3 flareColor = vec3(1.00, 0.97, 0.91) * core
                        + vec3(1.00, 0.90, 0.72) * innerCorona
                        + vec3(1.00, 0.93, 0.82) * veilingGlare
                        + vec3(1.00, 0.92, 0.78) * rays
                        + vec3(0.88, 0.93, 1.00) * anamorphic;

        // 4. Subtle, feathered chromatic lens ghosts along the sun-to-center optical axis
        float sunDistFromCenter = length(uSunNDC);
        vec2 axisDir = (sunDistFromCenter > 0.001) ? (-uSunNDC / sunDistFromCenter) : vec2(1.0, 0.0);
        // Ghosts appear strongest when the sun is slightly off-center, fading naturally at screen edges
        float ghostEnvelope = smoothstep(0.03, 0.28, sunDistFromCenter) * (1.0 - smoothstep(0.75, 1.45, sunDistFromCenter));

        if (ghostEnvelope > 0.002) {
          vec3 g1 = chromaticGhost(ndc, mix(uSunNDC, -uSunNDC, 0.34), 0.075, aspectScale, axisDir, 0.004);
          vec3 g2 = chromaticGhost(ndc, mix(uSunNDC, -uSunNDC, 0.62), 0.115, aspectScale, axisDir, 0.007);
          vec3 g3 = chromaticGhost(ndc, mix(uSunNDC, -uSunNDC, 0.88), 0.048, aspectScale, axisDir, 0.005);
          vec3 g4 = chromaticGhost(ndc, mix(uSunNDC, -uSunNDC, 1.18), 0.155, aspectScale, axisDir, 0.010);
          vec3 g5 = chromaticGhost(ndc, mix(uSunNDC, -uSunNDC, 1.46), 0.090, aspectScale, axisDir, 0.008);

          vec3 ghosts = g1 * vec3(1.00, 0.86, 0.66) * 0.055
                      + g2 * vec3(0.76, 0.90, 1.00) * 0.045
                      + g3 * vec3(0.82, 0.96, 0.90) * 0.040
                      + g4 * vec3(0.92, 0.82, 0.96) * 0.035
                      + g5 * vec3(1.00, 0.88, 0.72) * 0.042;

          flareColor += ghosts * ghostEnvelope;
        }

        gl_FragColor = vec4(flareColor * uIntensity, 1.0);
      }
    `;

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'SunLensFlare';
    this.mesh.layers.set(0);
    this.mesh.layers.disable(1);
    this.mesh.renderOrder = 200;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;

    if (this.scene) {
      this.scene.add(this.mesh);
    }
  }

  /**
   * Raymarches against the procedural terrain heightmap to detect mountain ridge occlusion.
   * @private
   */
  _isOccludedByTerrain(camPos, terrainManager) {
    const heightmap = terrainManager?.heightmap;
    if (!heightmap || !heightmap.getHeight) return false;

    const dx = this.sunDir.x;
    const dy = this.sunDir.y;
    const dz = this.sunDir.z;

    const steps = 14;
    let dist = 15.0;
    for (let i = 0; i < steps; i++) {
      const rx = camPos.x + dx * dist;
      const ry = camPos.y + dy * dist;
      const rz = camPos.z + dz * dist;

      if (ry > 280.0) return false;

      if (heightmap.getHeight(rx, rz) > ry + 0.5) {
        return true;
      }
      dist *= 1.32;
    }
    return false;
  }

  /**
   * Updates sun projection, terrain occlusion, and flare intensity.
   * @param {number} dt
   * @param {THREE.Camera} camera
   * @param {Object} [terrainManager]
   */
  update(dt, camera, terrainManager = null) {
    if (!camera || !this.mesh) return;

    camera.getWorldDirection(_scratchCamFwd);
    const sunDot = _scratchCamFwd.dot(this.sunDir);

    let targetIntensity = 0.0;

    if (sunDot > 0.12) {
      _scratchSunPos.copy(camera.position).addScaledVector(this.sunDir, 1500.0);
      _scratchSunPos.project(camera);

      if (_scratchSunPos.z < 1.0) {
        const edge = Math.max(Math.abs(_scratchSunPos.x), Math.abs(_scratchSunPos.y));
        if (edge < 1.30) {
          const edgeT = Math.max(0.0, Math.min(1.0, (edge - 0.80) / (1.30 - 0.80)));
          const screenFade = 1.0 - edgeT * edgeT * (3.0 - 2.0 * edgeT);

          // Natural smooth swell as gaze centers toward the sun
          const angleNorm = Math.min(1.0, (sunDot - 0.12) / 0.45);
          const angleFade = angleNorm * Math.sqrt(angleNorm);

          this._occlusionTimer -= dt || 0.016;
          if (this._occlusionTimer <= 0) {
            this._occlusionTimer = 0.05;
            this._cachedOccluded = this._isOccludedByTerrain(camera.position, terrainManager);
          }

          if (!this._cachedOccluded) {
            targetIntensity = this.maxIntensity * screenFade * angleFade;
          }

          this.uniforms.uSunNDC.value.set(_scratchSunPos.x, _scratchSunPos.y);
        }
      }
    }

    const safeDt = Math.max(0.001, Math.min(0.05, dt || 0.016));
    this.intensity = THREE.MathUtils.damp(this.intensity, targetIntensity, 12.0, safeDt);

    this.uniforms.uIntensity.value = this.intensity;
    this.uniforms.uAspect.value = camera.aspect || 1.0;
    this.uniforms.uRoll.value = camera.rotation?.z || 0.0;
    this.mesh.visible = this.intensity > 0.002;
  }

  dispose(scene) {
    if (this.mesh) {
      if (scene) scene.remove(this.mesh);
      else if (this.scene) this.scene.remove(this.mesh);
      this.mesh = null;
    }
    if (this.geometry) this.geometry.dispose();
    if (this.material) this.material.dispose();
  }
}
