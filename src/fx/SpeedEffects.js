import * as THREE from 'three';

/**
 * SpeedEffects
 * High-performance visual & audio speed effects system engineered for 9:16 vertical Reels.
 *
 * Visual Features:
 * 1. Peripheral Speed Streaks (LineSegments):
 *    120 dynamic 3D wind streaks concentrated in the outer 35% of the viewport,
 *    streaming past the camera with length, density, and opacity scaling with velocity.
 *    Center of the screen stays crystal clear for alpine navigation.
 * 2. Aerodynamic Speed Vignette (Custom Shader Quad):
 *    Full-screen NDC quad that activates at high speed (> 18 m/s / ~65 km/h),
 *    applying subtle aerodynamic tunnel vision, peripheral wind shimmer, and edge darkening.
 * 3. Procedural Alpine Wind Audio (Web Audio API):
 *    Zero-dependency, zero-download synthesized wind rush with dual-band filtering:
 *    - Deep low-end terrain roar (rumble that cuts out during airtime)
 *    - High-frequency aerodynamic wind whistle that howls at terminal speeds (> 50 m/s).
 */
export class SpeedEffects {
  /**
   * @param {THREE.Camera} camera - World perspective camera
   * @param {THREE.Scene} scene - Primary scene
   */
  constructor(camera, scene) {
    this.camera = camera;
    this.scene = scene;

    this.enabled = true;
    this.currentSpeed = 0.0;
    this.speedRatio = 0.0; // 0.0 (idle) to 1.0 (terminal speed >= 60 m/s)

    // Speed thresholds (m/s)
    this.minSpeedThreshold = 12.0; // ~43 km/h
    this.maxSpeedThreshold = 60.0; // ~216 km/h

    // 1. Initialize Peripheral Speed Streaks
    this.streakCount = 130;
    this._initSpeedStreaks();

    // 2. Initialize Aerodynamic Vignette Screen Quad
    this._initSpeedVignette();

    // 3. Initialize Procedural Web Audio Wind Synthesizer
    this._initAudio();
  }

  /**
   * Initializes 3D line streaks anchored to camera space.
   * Concentrated in outer margins (periphery) formatted for 9:16 portrait ratio.
   * @private
   */
  _initSpeedStreaks() {
    this.streakGroup = new THREE.Group();
    this.streakGroup.name = 'SpeedStreaks';
    this.streakGroup.layers.set(0);

    const count = this.streakCount;
    const vertexCount = count * 2;
    const positions = new Float32Array(vertexCount * 3);

    // Particle state attributes: angle, radius, z, speedMultiplier, baseLength
    this._streakAngles = new Float32Array(count);
    this._streakRadii = new Float32Array(count);
    this._streakDepths = new Float32Array(count);
    this._streakSpeeds = new Float32Array(count);
    this._streakLengths = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      // Angle around camera center
      this._streakAngles[i] = Math.random() * Math.PI * 2;

      // Outer radial band: r in [0.72, 1.45], leaving center r < 0.7 clear
      this._streakRadii[i] = 0.72 + Math.random() * 0.75;

      // Z depth in front of camera [-1.5 to -8.5 meters]
      this._streakDepths[i] = -1.5 - Math.random() * 7.0;

      // Individual speed variation & length
      this._streakSpeeds[i] = 0.85 + Math.random() * 0.45;
      this._streakLengths[i] = 0.35 + Math.random() * 0.55;
    }

    const geometry = new THREE.BufferGeometry();
    this._posAttr = new THREE.BufferAttribute(positions, 3);
    this._posAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this._posAttr);

    this.streakMaterial = new THREE.LineBasicMaterial({
      color: 0xeaf4ff,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });

    this.streakMesh = new THREE.LineSegments(geometry, this.streakMaterial);
    this.streakMesh.frustumCulled = false;
    this.streakMesh.layers.set(0);
    this.streakGroup.add(this.streakMesh);

    // Attach to camera so streaks automatically follow eye-line and orientation
    this.camera.add(this.streakGroup);
  }

  /**
   * Initializes full-screen NDC vignette quad with custom GLSL shader.
   * @private
   */
  _initSpeedVignette() {
    const vertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        // Direct NDC full-screen quad (spans entire viewport)
        gl_Position = vec4(position.x, position.y, 0.0, 1.0);
      }
    `;

    const fragmentShader = `
      uniform float uSpeedRatio;
      uniform float uTime;
      varying vec2 vUv;

      void main() {
        if (uSpeedRatio <= 0.001) {
          gl_FragColor = vec4(0.0);
          return;
        }

        // Center coordinates: [-0.5, 0.5], aspect-adjusted for 9:16 vertical view
        vec2 centered = vUv - 0.5;
        centered.y *= (16.0 / 9.0);
        float dist = length(centered);

        // Radial tunnel vignette: transparent in center (r < 0.48), darkening at outer perimeter
        float vignette = smoothstep(0.46, 0.98, dist);

        // Dynamic aerodynamic wind fringe ripple at extreme speeds
        float rippleAngle = atan(centered.y, centered.x);
        float ripple = sin(rippleAngle * 14.0 + uTime * 18.0) * 0.06;
        float windFringe = smoothstep(0.58, 1.08, dist + ripple * uSpeedRatio);

        // Subtle cool icy alpine blue-white tint on fringe + soft dark corner vignette
        vec3 darkCorner = vec3(0.03, 0.06, 0.12);
        vec3 icyGlow = vec3(0.82, 0.92, 1.0);
        vec3 color = mix(darkCorner, icyGlow, windFringe * 0.5);

        float alpha = (vignette * 0.42 + windFringe * 0.28) * uSpeedRatio;
        gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.68));
      }
    `;

    this.vignetteUniforms = {
      uSpeedRatio: { value: 0.0 },
      uTime: { value: 0.0 },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.vignetteUniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    const geometry = new THREE.PlaneGeometry(2, 2);
    this.vignetteMesh = new THREE.Mesh(geometry, material);
    this.vignetteMesh.frustumCulled = false;
    this.vignetteMesh.layers.set(0);

    this.streakGroup.add(this.vignetteMesh);
  }

  /**
   * Initializes Web Audio API synthesized alpine wind generator.
   * Completely procedural: zero audio files or assets required.
   * @private
   */
  _initAudio() {
    this.audioCtx = null;
    this.isAudioReady = false;
    this.masterGain = null;
    this.rumbleGain = null;
    this.whistleGain = null;
    this.whistleFilter = null;
    this.rumbleFilter = null;

    // Unlock Web Audio on first user interaction
    const unlockAudio = () => {
      this._startAudioContext();
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };

    window.addEventListener('click', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });
    window.addEventListener('touchstart', unlockAudio, { once: true });
  }

  _startAudioContext() {
    if (this.isAudioReady) return;

    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtxClass) return;

      this.audioCtx = new AudioCtxClass();
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      // Generate 2-second looped pink/white noise buffer
      const bufferSize = this.audioCtx.sampleRate * 2;
      const noiseBuffer = this.audioCtx.createBuffer(2, bufferSize, this.audioCtx.sampleRate);
      for (let channel = 0; channel < 2; channel++) {
        const data = noiseBuffer.getChannelData(channel);
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < bufferSize; i++) {
          const white = Math.random() * 2 - 1;
          // Pink noise filter approximation (Paul Kellet algorithm)
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.96900 * b2 + white * 0.1538520;
          b3 = 0.86650 * b3 + white * 0.3104856;
          b4 = 0.55000 * b4 + white * 0.5329522;
          b5 = -0.7616 * b5 - white * 0.0168980;
          data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.09;
          b6 = white * 0.115926;
        }
      }

      // 1. Noise Source Node (Looping)
      const noiseSource = this.audioCtx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      noiseSource.loop = true;

      // 2. Master Gain
      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.setValueAtTime(0.0, this.audioCtx.currentTime);

      // 3. Low-End Snow & Terrain Rumble Filter Chain
      this.rumbleFilter = this.audioCtx.createBiquadFilter();
      this.rumbleFilter.type = 'lowpass';
      this.rumbleFilter.frequency.setValueAtTime(160, this.audioCtx.currentTime);

      this.rumbleGain = this.audioCtx.createGain();
      this.rumbleGain.gain.setValueAtTime(0.0, this.audioCtx.currentTime);

      // 4. High-End Wind Whistle / Shear Filter Chain
      this.whistleFilter = this.audioCtx.createBiquadFilter();
      this.whistleFilter.type = 'bandpass';
      this.whistleFilter.Q.setValueAtTime(2.2, this.audioCtx.currentTime);
      this.whistleFilter.frequency.setValueAtTime(800, this.audioCtx.currentTime);

      this.whistleGain = this.audioCtx.createGain();
      this.whistleGain.gain.setValueAtTime(0.0, this.audioCtx.currentTime);

      // Connect graph: noiseSource -> rumble -> rumbleGain -> masterGain -> destination
      //                noiseSource -> whistle -> whistleGain -> masterGain -> destination
      noiseSource.connect(this.rumbleFilter);
      this.rumbleFilter.connect(this.rumbleGain);
      this.rumbleGain.connect(this.masterGain);

      noiseSource.connect(this.whistleFilter);
      this.whistleFilter.connect(this.whistleGain);
      this.whistleGain.connect(this.masterGain);

      this.masterGain.connect(this.audioCtx.destination);

      noiseSource.start(0);
      this.isAudioReady = true;
    } catch (err) {
      console.warn('Web Audio initialization warning:', err);
    }
  }

  /**
   * Resumes Web Audio context if suspended.
   */
  start() {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  /**
   * Per-frame update for speed effects.
   * @param {number} dt - Delta time
   * @param {number} speed - Current player speed in m/s
   * @param {THREE.Vector3} [velocity] - Velocity vector
   * @param {boolean} [isGrounded=true] - Ground contact flag
   * @param {number} [elapsedTime=0] - Total elapsed time
   */
  update(dt, speed, velocity, isGrounded = true, elapsedTime = 0) {
    if (!this.enabled) return;

    this.currentSpeed = Math.max(0, Number.isFinite(speed) ? speed : 0);

    // Compute normalized speed ratio [0.0, 1.0]
    const clampedSpeed = Math.min(this.maxSpeedThreshold, Math.max(this.minSpeedThreshold, this.currentSpeed));
    this.speedRatio = this.currentSpeed <= this.minSpeedThreshold
      ? 0.0
      : (clampedSpeed - this.minSpeedThreshold) / (this.maxSpeedThreshold - this.minSpeedThreshold);

    // 1. Update Speed Streaks
    this._updateSpeedStreaks(dt);

    // 2. Update Aerodynamic Vignette
    if (this.vignetteUniforms) {
      this.vignetteUniforms.uSpeedRatio.value = this.speedRatio;
      this.vignetteUniforms.uTime.value = elapsedTime;
    }

    // 3. Update Audio Wind Synth
    this._updateAudio(isGrounded);
  }

  /**
   * Updates 3D line streaks in camera space.
   * @param {number} dt
   * @private
   */
  _updateSpeedStreaks(dt) {
    if (!this._posAttr) return;

    const ratio = this.speedRatio;
    const positions = this._posAttr.array;
    const count = this.streakCount;

    // Fade streaks out when below minimum threshold
    const targetOpacity = ratio <= 0.01 ? 0.0 : Math.min(0.85, ratio * 1.15);
    this.streakMaterial.opacity = THREE.MathUtils.damp(this.streakMaterial.opacity, targetOpacity, 6.0, dt);

    if (this.streakMaterial.opacity <= 0.001) {
      return;
    }

    // Speed at which streaks stream past camera (meters per second along Z)
    const streamSpeed = 16.0 + this.currentSpeed * 1.4;
    // Streak elongation factor
    const lengthMultiplier = 1.0 + ratio * 2.8;

    const aspectY = 16.0 / 9.0; // Aspect ratio height multiplier for 9:16 framing

    for (let i = 0; i < count; i++) {
      let z = this._streakDepths[i];
      z += streamSpeed * this._streakSpeeds[i] * dt;

      // Wrap when passing camera
      if (z > -0.6) {
        z = -7.5 - Math.random() * 2.5;
        this._streakAngles[i] = Math.random() * Math.PI * 2;
        this._streakRadii[i] = 0.72 + Math.random() * 0.75;
      }
      this._streakDepths[i] = z;

      const angle = this._streakAngles[i];
      const r = this._streakRadii[i];
      const streakLen = this._streakLengths[i] * lengthMultiplier;

      // Scale radial coordinates proportionally with distance so frustum coverage is uniform
      const depthScale = Math.abs(z) * 0.42;
      const x1 = Math.cos(angle) * r * depthScale;
      const y1 = Math.sin(angle) * r * depthScale * aspectY;
      const z1 = z;

      // Tail extends further back along Z
      const x2 = x1 * 0.98;
      const y2 = y1 * 0.98;
      const z2 = z - streakLen;

      const baseIdx = i * 6;
      positions[baseIdx] = x1;
      positions[baseIdx + 1] = y1;
      positions[baseIdx + 2] = z1;
      positions[baseIdx + 3] = x2;
      positions[baseIdx + 4] = y2;
      positions[baseIdx + 5] = z2;
    }

    this._posAttr.needsUpdate = true;
  }

  /**
   * Modulates procedural Web Audio wind parameters.
   * @param {boolean} isGrounded
   * @private
   */
  _updateAudio(isGrounded) {
    if (!this.isAudioReady || !this.audioCtx) return;

    try {
      const now = this.audioCtx.currentTime;
      const ratio = this.speedRatio;

      // Master volume: smooth fade with speed
      const targetMaster = ratio <= 0.02 ? 0.0 : THREE.MathUtils.lerp(0.02, 0.36, Math.pow(ratio, 1.2));
      this.masterGain.gain.setTargetAtTime(targetMaster, now, 0.08);

      // Low rumble (snow & board vibration): active on ground, cuts when airborne
      const rumbleTarget = isGrounded ? THREE.MathUtils.lerp(0.05, 0.45, ratio) : 0.04;
      this.rumbleGain.gain.setTargetAtTime(rumbleTarget, now, 0.12);
      const rumbleFreq = THREE.MathUtils.lerp(120, 360, ratio);
      this.rumbleFilter.frequency.setTargetAtTime(rumbleFreq, now, 0.1);

      // High whistle: screaming wind past helmet
      const whistleTarget = THREE.MathUtils.lerp(0.02, 0.55, Math.pow(ratio, 1.4));
      this.whistleGain.gain.setTargetAtTime(whistleTarget, now, 0.08);
      const whistleFreq = THREE.MathUtils.lerp(700, 3100, Math.pow(ratio, 1.25));
      this.whistleFilter.frequency.setTargetAtTime(whistleFreq, now, 0.08);
    } catch {
      // Audio context might be suspended or closed
    }
  }

  dispose() {
    if (this.streakGroup && this.camera) {
      this.camera.remove(this.streakGroup);
    }
    if (this.streakMaterial) this.streakMaterial.dispose();
    if (this.vignetteMesh && this.vignetteMesh.material) this.vignetteMesh.material.dispose();
    if (this.audioCtx) {
      try {
        this.audioCtx.close();
      } catch {}
      this.audioCtx = null;
    }
  }
}
