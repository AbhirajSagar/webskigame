import * as THREE from 'three';

const MAX_SNOW_DUST_PARTICLES = 280;

/**
 * SnowDustSystem
 * GPU-instanced powder snow-dust VFX using the cloud textures (/textures/cloud3.png & /textures/cloud.png).
 * Spawns billowing white powder plumes when the player lands, drifts/brakes, or carves sharp turns.
 *
 * Performance:
 * - Single InstancedBufferGeometry draw call on Layer 0 (worldCamera).
 * - Pre-allocated TypedArrays with ring-buffer allocation (zero per-frame heap allocations).
 * - Early vertex-shader culling for inactive/transparent slots and soft near-camera fade.
 */
export class SnowDustSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {Object} [options={}]
   */
  constructor(scene, options = {}) {
    this.scene = scene;
    this.maxParticles = options.maxParticles || MAX_SNOW_DUST_PARTICLES;
    this.fogColor = options.fogColor || new THREE.Color(0xc6cdd5);
    this.fogNear = options.fogNear ?? 200.0;
    this.fogFar = options.fogFar ?? 850.0;

    this.activeCount = 0;
    this._cursor = 0;
    this._emitAccumulator = 0;

    // CPU simulation state
    this._px = new Float32Array(this.maxParticles);
    this._py = new Float32Array(this.maxParticles);
    this._pz = new Float32Array(this.maxParticles);
    this._vx = new Float32Array(this.maxParticles);
    this._vy = new Float32Array(this.maxParticles);
    this._vz = new Float32Array(this.maxParticles);
    this._ages = new Float32Array(this.maxParticles);
    this._lifetimes = new Float32Array(this.maxParticles);
    this._startScales = new Float32Array(this.maxParticles);
    this._endScales = new Float32Array(this.maxParticles);
    this._rotations = new Float32Array(this.maxParticles);
    this._rotSpeeds = new Float32Array(this.maxParticles);
    this._baseAlphas = new Float32Array(this.maxParticles);
    this._texChoices = new Float32Array(this.maxParticles);

    this._init();
  }

  _init() {
    const loader = new THREE.TextureLoader();

    const configureTex = (url) => {
      const tex = loader.load(url);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      return tex;
    };

    // Soft misty cloud3 + billowing cloud1 for organic powder snow dust
    this.textureSoft = configureTex('/textures/cloud3.png');
    this.textureBillow = configureTex('/textures/cloud.png');

    const basePlane = new THREE.PlaneGeometry(1, 1);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setAttribute('position', basePlane.attributes.position);
    this.geometry.setAttribute('uv', basePlane.attributes.uv);
    this.geometry.setIndex(basePlane.index);
    this.geometry.instanceCount = this.maxParticles;

    this._gpuPos = new Float32Array(this.maxParticles * 3);
    this._gpuScale = new Float32Array(this.maxParticles);
    this._gpuRot = new Float32Array(this.maxParticles);
    this._gpuAlpha = new Float32Array(this.maxParticles);
    this._gpuTex = new Float32Array(this.maxParticles);

    this._posAttr = new THREE.InstancedBufferAttribute(this._gpuPos, 3);
    this._scaleAttr = new THREE.InstancedBufferAttribute(this._gpuScale, 1);
    this._rotAttr = new THREE.InstancedBufferAttribute(this._gpuRot, 1);
    this._alphaAttr = new THREE.InstancedBufferAttribute(this._gpuAlpha, 1);
    this._texAttr = new THREE.InstancedBufferAttribute(this._gpuTex, 1);

    this._posAttr.setUsage(THREE.DynamicDrawUsage);
    this._scaleAttr.setUsage(THREE.DynamicDrawUsage);
    this._rotAttr.setUsage(THREE.DynamicDrawUsage);
    this._alphaAttr.setUsage(THREE.DynamicDrawUsage);

    this.geometry.setAttribute('aPosition', this._posAttr);
    this.geometry.setAttribute('aScale', this._scaleAttr);
    this.geometry.setAttribute('aRotation', this._rotAttr);
    this.geometry.setAttribute('aAlpha', this._alphaAttr);
    this.geometry.setAttribute('aTexChoice', this._texAttr);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTexSoft: { value: this.textureSoft },
        uTexBillow: { value: this.textureBillow },
        uFogColor: { value: this.fogColor },
        uFogNear: { value: this.fogNear },
        uFogFar: { value: this.fogFar },
      },
      vertexShader: `
        attribute vec3 aPosition;
        attribute float aScale;
        attribute float aRotation;
        attribute float aAlpha;
        attribute float aTexChoice;

        varying vec2 vUv;
        varying float vAlpha;
        varying float vTexChoice;
        varying float vDistToCamera;

        void main() {
          if (aAlpha <= 0.002 || aScale <= 0.001) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            vAlpha = 0.0;
            vUv = uv;
            vTexChoice = aTexChoice;
            vDistToCamera = 0.0;
            return;
          }

          vUv = uv;
          vTexChoice = aTexChoice;

          vec3 toCamera = cameraPosition - aPosition;
          float distToCam = length(toCamera);
          vDistToCamera = distToCam;

          // Fade smoothly only right before hitting camera near plane
          float nearFade = smoothstep(0.35, 1.15, distToCam);
          vAlpha = aAlpha * nearFade;

          vec3 norm = (distToCam > 0.001) ? (toCamera / distToCam) : vec3(0.0, 0.0, 1.0);
          vec3 worldUp = vec3(0.0, 1.0, 0.0);
          vec3 right = cross(worldUp, norm);
          float rightLen = length(right);
          right = (rightLen > 0.001) ? (right / rightLen) : vec3(1.0, 0.0, 0.0);
          vec3 up = cross(norm, right);

          float c = cos(aRotation);
          float s = sin(aRotation);
          vec2 local = position.xy * aScale;
          vec3 worldPos = aPosition
            + right * (c * local.x - s * local.y)
            + up * (s * local.x + c * local.y);

          gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uTexSoft;
        uniform sampler2D uTexBillow;
        uniform vec3 uFogColor;
        uniform float uFogNear;
        uniform float uFogFar;

        varying vec2 vUv;
        varying float vAlpha;
        varying float vTexChoice;
        varying float vDistToCamera;

        void main() {
          if (vAlpha <= 0.003) discard;

          vec4 tex;
          if (vTexChoice < 0.5) {
            tex = texture2D(uTexSoft, vUv);
            // cloud3.png has max alpha ~0.40; normalize it to full [0, 1] powder density
            tex.a = min(1.0, tex.a * 2.5);
          } else {
            tex = texture2D(uTexBillow, vUv);
          }

          if (tex.a < 0.015) discard;

          // Bright alpine powder shading with subtle cool sky shadow at puff base so it reads against snow
          float vertShade = smoothstep(0.15, 0.85, vUv.y);
          vec3 shadowWhite = vec3(0.82, 0.89, 0.98);
          vec3 brightWhite = vec3(1.0, 1.0, 1.0);
          vec3 snowTint = mix(shadowWhite, brightWhite, 0.35 + 0.65 * vertShade * smoothstep(0.2, 0.85, tex.r));
          float fogFactor = smoothstep(uFogNear, uFogFar, vDistToCamera);
          vec3 finalColor = mix(snowTint, uFogColor, fogFactor * 0.65);

          float alpha = pow(tex.a, 0.65) * vAlpha;
          if (alpha < 0.004) discard;

          gl_FragColor = vec4(finalColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'SnowDustVFX';
    this.mesh.layers.set(0);
    this.mesh.layers.disable(1);
    this.mesh.renderOrder = 45;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;

    if (this.scene) {
      this.scene.add(this.mesh);
    }
  }

  /**
   * Allocates one snow-dust puff in the ring buffer.
   * @private
   */
  _spawnPuff(x, y, z, vx, vy, vz, startScale, endScale, lifetime, baseAlpha) {
    const i = this._cursor;
    this._cursor = (this._cursor + 1) % this.maxParticles;

    if (this._lifetimes[i] <= 0) {
      this.activeCount++;
      if (this.mesh && !this.mesh.visible) {
        this.mesh.visible = true;
      }
    }

    this._px[i] = x;
    this._py[i] = y;
    this._pz[i] = z;
    this._vx[i] = vx;
    this._vy[i] = vy;
    this._vz[i] = vz;
    this._ages[i] = 0;
    this._lifetimes[i] = lifetime;
    this._startScales[i] = startScale;
    this._endScales[i] = endScale;
    this._rotations[i] = Math.random() * Math.PI * 2;
    this._rotSpeeds[i] = (Math.random() - 0.5) * 1.4;
    this._baseAlphas[i] = baseAlpha;
    this._texChoices[i] = Math.random() < 0.65 ? 0.0 : 1.0;

    this._gpuTex[i] = this._texChoices[i];
    this._texAttr.needsUpdate = true;
  }

  /**
   * Spawns a radial powder burst when landing on snow, biased into the rider's forward view.
   * @param {THREE.Vector3} position
   * @param {THREE.Vector3} velocity
   * @param {THREE.Vector3} normal
   * @param {number} impactSpeed
   * @param {THREE.Vector3} [forwardXZ]
   */
  spawnLanding(position, velocity, normal, impactSpeed, forwardXZ = null) {
    const intensity = Math.min(1.0, Math.max(0.25, (impactSpeed - 1.5) / 16.0));
    const count = Math.round(14 + intensity * 20);

    const nx = normal ? normal.x : 0;
    const ny = normal ? normal.y : 1;
    const nz = normal ? normal.z : 0;

    const fwdX = forwardXZ ? forwardXZ.x : 0;
    const fwdZ = forwardXZ ? forwardXZ.z : 0;

    for (let k = 0; k < count; k++) {
      const angle = (k / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.45;
      const radialDist = 0.7 + Math.random() * (1.3 + intensity * 0.9);
      const dirX = Math.cos(angle);
      const dirZ = Math.sin(angle);

      // Bias center ~2.2m forward along travel/gaze so landing spray fills lower viewport instead of spawning under feet
      const leadDist = 1.4 + Math.random() * 2.2;
      const x = position.x + fwdX * leadDist + dirX * radialDist;
      const z = position.z + fwdZ * leadDist + dirZ * radialDist;
      const y = position.y + 0.35 + Math.random() * 0.65;

      const outSpeed = (2.6 + Math.random() * 3.8) * (0.65 + intensity * 0.75);
      const upSpeed = (2.0 + Math.random() * 3.2) * (0.65 + intensity * 0.75);

      const vx = dirX * outSpeed + velocity.x * 0.72 + nx * 0.8;
      const vy = upSpeed * ny;
      const vz = dirZ * outSpeed + velocity.z * 0.72 + nz * 0.8;

      const startScale = 1.0 + Math.random() * 0.75;
      const endScale = startScale + 2.2 + intensity * 2.4 + Math.random() * 1.0;
      const lifetime = 1.15 + intensity * 0.65 + Math.random() * 0.4;
      const alpha = 0.62 + intensity * 0.28;

      this._spawnPuff(x, y, z, vx, vy, vz, startScale, endScale, lifetime, alpha);
    }
  }

  /**
   * Continuously emits carving / drifting / sharp-turn snow dust along the board edge.
   * @param {number} dt
   * @param {THREE.Vector3} position
   * @param {THREE.Vector3} velocity
   * @param {THREE.Vector3} forwardXZ
   * @param {THREE.Vector3} rightXZ
   * @param {number} intensity - Normalized intensity in [0, 1]
   * @param {number} spraySign - Lateral spray direction (+1 right, -1 left)
   */
  emitCarveDust(dt, position, velocity, forwardXZ, rightXZ, intensity, spraySign = 1) {
    if (intensity <= 0.02 || dt <= 0) return;

    const rate = 24.0 + intensity * 56.0;
    this._emitAccumulator = Math.min(10.0, this._emitAccumulator + rate * dt);

    const count = Math.floor(this._emitAccumulator);
    if (count <= 0) return;
    this._emitAccumulator -= count;

    const sign = spraySign >= 0 ? 1.0 : -1.0;

    for (let k = 0; k < count; k++) {
      // Spawn 1.6m..3.8m ahead and to the carving side so plumes billow clearly in the lower-side view
      const fwdOffset = 1.5 + Math.random() * 2.3;
      const sideOffset = sign * (0.55 + Math.random() * 1.15);

      const x = position.x + forwardXZ.x * fwdOffset + rightXZ.x * sideOffset;
      const z = position.z + forwardXZ.z * fwdOffset + rightXZ.z * sideOffset;
      const y = position.y + 0.28 + Math.random() * 0.55;

      const lateralSpeed = (2.4 + Math.random() * 3.4) * (0.6 + intensity * 0.85);
      const liftSpeed = (1.6 + Math.random() * 2.6) * (0.6 + intensity * 0.85);

      // Inherit 78% of forward speed so the rider doesn't outrun the plume in 2 frames
      const vx = velocity.x * 0.78 + rightXZ.x * (sign * lateralSpeed) + (Math.random() - 0.5) * 0.9;
      const vy = liftSpeed;
      const vz = velocity.z * 0.78 + rightXZ.z * (sign * lateralSpeed) + (Math.random() - 0.5) * 0.9;

      const startScale = 0.80 + Math.random() * 0.55;
      const endScale = startScale + 1.6 + intensity * 1.8 + Math.random() * 0.8;
      const lifetime = 0.90 + intensity * 0.60 + Math.random() * 0.30;
      const alpha = 0.55 + intensity * 0.35;

      this._spawnPuff(x, y, z, vx, vy, vz, startScale, endScale, lifetime, alpha);
    }
  }

  /**
   * Advances snow-dust simulation and uploads dynamic GPU instance buffers.
   * @param {number} dt
   */
  update(dt) {
    if (this.activeCount <= 0) return;

    let anyAlive = false;
    const drag = Math.max(0, 1.0 - 1.6 * dt);

    for (let i = 0; i < this.maxParticles; i++) {
      const life = this._lifetimes[i];
      if (life <= 0) continue;

      const age = this._ages[i] + dt;
      if (age >= life) {
        this._lifetimes[i] = 0;
        this._gpuAlpha[i] = 0;
        this._gpuScale[i] = 0;
        this.activeCount = Math.max(0, this.activeCount - 1);
        continue;
      }

      anyAlive = true;
      this._ages[i] = age;

      // Air drag + gentle settling
      this._vx[i] *= drag;
      this._vz[i] *= drag;
      this._vy[i] = (this._vy[i] - 1.35 * dt) * drag;

      this._px[i] += this._vx[i] * dt;
      this._py[i] += this._vy[i] * dt;
      this._pz[i] += this._vz[i] * dt;
      this._rotations[i] += this._rotSpeeds[i] * dt;

      const t = age / life;
      // Fast billow expansion at start, easing out as cloud disperses
      const easeOut = 1.0 - (1.0 - t) * (1.0 - t);
      const scale = this._startScales[i] + (this._endScales[i] - this._startScales[i]) * easeOut;

      // Quick fade-in (first 12%), smooth exponential-like fade-out over remaining life
      const fadeIn = Math.min(1.0, t / 0.12);
      const fadeOut = Math.pow(1.0 - t, 1.35);

      const i3 = i * 3;
      this._gpuPos[i3] = this._px[i];
      this._gpuPos[i3 + 1] = this._py[i];
      this._gpuPos[i3 + 2] = this._pz[i];
      this._gpuScale[i] = scale;
      this._gpuRot[i] = this._rotations[i];
      this._gpuAlpha[i] = this._baseAlphas[i] * fadeIn * fadeOut;
    }

    this._posAttr.needsUpdate = true;
    this._scaleAttr.needsUpdate = true;
    this._rotAttr.needsUpdate = true;
    this._alphaAttr.needsUpdate = true;

    if (!anyAlive) {
      this.activeCount = 0;
      if (this.mesh && this.mesh.visible) {
        this.mesh.visible = false;
      }
    }
  }

  dispose(scene) {
    if (this.mesh) {
      if (scene) scene.remove(this.mesh);
      else if (this.scene) this.scene.remove(this.mesh);
      this.mesh = null;
    }
    if (this.geometry) this.geometry.dispose();
    if (this.material) this.material.dispose();
    if (this.textureSoft) this.textureSoft.dispose();
    if (this.textureBillow) this.textureBillow.dispose();
  }
}
