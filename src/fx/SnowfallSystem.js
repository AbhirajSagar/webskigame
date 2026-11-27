import * as THREE from 'three';

/**
 * SnowfallSystem
 * Lightweight GPU-wrapped snowfall particle system anchored around the active camera.
 */
export class SnowfallSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {Object} [options={}]
   */
  constructor(scene, options = {}) {
    this.scene = scene;
    this.count = options.count || 1600;
    this.boxSize = new THREE.Vector3(76, 42, 76);

    this.enabled = false;
    this.density = 0.65;
    this.speed = 6.5;
    this.size = 0.28;
    this.opacity = 0.72;
    this.wind = new THREE.Vector3(1.8, 0.0, 0.9);
    this.color = new THREE.Color('#ffffff');

    this._init();
  }

  _init() {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.count * 3);
    const seeds = new Float32Array(this.count);
    const sizes = new Float32Array(this.count);

    let s = 9173;
    const rnd = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };

    for (let i = 0; i < this.count; i++) {
      positions[i * 3 + 0] = (rnd() - 0.5) * this.boxSize.x;
      positions[i * 3 + 1] = (rnd() - 0.5) * this.boxSize.y;
      positions[i * 3 + 2] = (rnd() - 0.5) * this.boxSize.z;
      seeds[i] = rnd();
      sizes[i] = 0.55 + rnd() * 0.9;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aScale', new THREE.BufferAttribute(sizes, 1));

    this.uniforms = {
      uTime: { value: 0.0 },
      uCameraPos: { value: new THREE.Vector3() },
      uBoxSize: { value: this.boxSize },
      uFallSpeed: { value: this.speed },
      uWind: { value: this.wind },
      uSize: { value: this.size },
      uDensity: { value: this.density },
      uOpacity: { value: this.opacity },
      uColor: { value: this.color },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        attribute float aSeed;
        attribute float aScale;

        uniform float uTime;
        uniform vec3 uCameraPos;
        uniform vec3 uBoxSize;
        uniform float uFallSpeed;
        uniform vec3 uWind;
        uniform float uSize;
        uniform float uDensity;

        varying float vAlpha;

        void main() {
          if (aSeed > uDensity) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            gl_PointSize = 0.0;
            vAlpha = 0.0;
            return;
          }

          vec3 p = position;
          float speedScale = 0.75 + aSeed * 0.5;
          p.y -= uTime * uFallSpeed * speedScale;
          p.x += uTime * uWind.x * speedScale + sin(uTime * 1.3 + aSeed * 25.0) * 0.9;
          p.z += uTime * uWind.z * speedScale + cos(uTime * 1.1 + aSeed * 19.0) * 0.9;

          vec3 halfBox = uBoxSize * 0.5;
          p.x = mod(p.x - uCameraPos.x + halfBox.x, uBoxSize.x) - halfBox.x + uCameraPos.x;
          p.y = mod(p.y - uCameraPos.y + halfBox.y, uBoxSize.y) - halfBox.y + uCameraPos.y;
          p.z = mod(p.z - uCameraPos.z + halfBox.z, uBoxSize.z) - halfBox.z + uCameraPos.z;

          vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
          float dist = -mvPos.z;
          if (dist < 0.8 || dist > 48.0) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            gl_PointSize = 0.0;
            vAlpha = 0.0;
            return;
          }

          float nearFade = smoothstep(0.8, 3.0, dist);
          float farFade = 1.0 - smoothstep(26.0, 48.0, dist);
          vAlpha = nearFade * farFade * (0.55 + 0.45 * aSeed);

          gl_PointSize = clamp((uSize * aScale * 340.0) / max(1.0, dist), 1.5, 14.0);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform float uOpacity;
        uniform vec3 uColor;
        varying float vAlpha;

        void main() {
          if (vAlpha <= 0.005) discard;
          vec2 c = gl_PointCoord - vec2(0.5);
          float r = length(c) * 2.0;
          if (r > 1.0) discard;
          float soft = smoothstep(1.0, 0.15, r);
          gl_FragColor = vec4(uColor, soft * vAlpha * uOpacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
    });

    this.geometry = geometry;
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = 'SnowfallSystem';
    this.points.layers.set(0);
    this.points.layers.disable(1);
    this.points.renderOrder = 60;
    this.points.frustumCulled = false;
    this.points.visible = false;

    this.scene?.add(this.points);
  }

  configure(cfg = {}) {
    this.enabled = Boolean(cfg.enabled);
    if (this.points) {
      this.points.visible = this.enabled;
    }
    if (cfg.density !== undefined) this.uniforms.uDensity.value = Math.max(0, Math.min(1, Number(cfg.density)));
    if (cfg.speed !== undefined) this.uniforms.uFallSpeed.value = Number(cfg.speed);
    if (cfg.size !== undefined) this.uniforms.uSize.value = Number(cfg.size);
    if (cfg.opacity !== undefined) this.uniforms.uOpacity.value = Number(cfg.opacity);
    if (cfg.windX !== undefined) this.wind.x = Number(cfg.windX);
    if (cfg.windZ !== undefined) this.wind.z = Number(cfg.windZ);
    if (cfg.color) this.uniforms.uColor.value.set(cfg.color);
  }

  update(elapsedTime, cameraPosition) {
    if (!this.enabled || !this.points?.visible) return;
    this.uniforms.uTime.value = elapsedTime;
    if (cameraPosition) {
      this.uniforms.uCameraPos.value.copy(cameraPosition);
    }
  }

  dispose() {
    if (this.points) this.scene?.remove(this.points);
    this.geometry?.dispose();
    this.material?.dispose();
  }
}
