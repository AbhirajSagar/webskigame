import * as THREE from 'three';

/**
 * CloudSystem
 * High-performance, volumetric alpine cloud particle system using instanced billboards.
 *
 * Visual & Technical Highlights:
 * 1. Single Draw Call: Hundreds of cloud particles batched into a single InstancedBufferGeometry.
 * 2. Multi-Scale Layering:
 *    - Low Alpine Mist (Y ~90-170m): Peak-skimming wisps and mountain col mist.
 *    - Mid Cumulus Banks (Y ~220-370m): Majestic, billowy, volumetric cloud formations.
 *    - High Stratus Canopy (Y ~450-650m): Expansive atmospheric ceiling.
 * 3. Photorealistic Sunlight Illumination:
 *    - Upper lobes illuminated with warm direct sunlight.
 *    - Lower recesses and shaded undersides shaded with cool atmospheric blue-grey.
 *    - Silver Lining (Mie forward scattering): Luminous rim glow when looking toward the sun.
 * 4. Toroidal Infinite Wrapping: Seamlessly wraps around player position beyond the fog horizon.
 * 5. Near-Plane Soft Fade: Prevents hard geometric clipping when flying or skiing through clouds.
 * 6. Atmospheric Fog Integration: Deep distant clouds smoothly blend into the mountain horizon fog.
 */
export class CloudSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {Object} [options]
   */
  constructor(scene, options = {}) {
    this.scene = scene;

    this.clusterCount = options.clusterCount || 32;
    this.particlesPerCluster = options.particlesPerCluster || 12;
    this.totalParticles = this.clusterCount * this.particlesPerCluster; // ~384 particles

    this.wrapRadius = options.wrapRadius || 1350.0; // 2700m active domain (exceeds fog range)
    this.windSpeed = options.windSpeed || new THREE.Vector3(3.6, 0.0, 1.8); // Gentle alpine wind (m/s)

    this.texturePath = options.texturePath || '/textures/cloud.png';

    // Sunlight & Atmosphere Colors (tuned to match scene lighting & skybox)
    this.sunDirection = options.sunDirection || new THREE.Vector3(130, 190, 90).normalize();
    this.sunColor = options.sunColor || new THREE.Color(0xfff8ee);
    this.skyColor = options.skyColor || new THREE.Color(0xd2e4f6);
    this.shadowColor = options.shadowColor || new THREE.Color(0x8da3b8);
    this.fogColor = options.fogColor || new THREE.Color(0xc6cdd5);
    this.fogNear = options.fogNear || 200.0;
    this.fogFar = options.fogFar || 850.0;

    this.mesh = null;
    this.material = null;
    this.geometry = null;

    this._dummy = new THREE.Object3D();
    this._playerPos = new THREE.Vector3();

    this._init();
  }

  /**
   * Initializes texture, geometry, instanced attributes and shader material.
   * @private
   */
  _init() {
    const textureLoader = new THREE.TextureLoader();
    this.cloudTexture = textureLoader.load(this.texturePath);
    this.cloudTexture.colorSpace = THREE.SRGBColorSpace;
    this.cloudTexture.generateMipmaps = true;
    this.cloudTexture.minFilter = THREE.LinearMipmapLinearFilter;
    this.cloudTexture.magFilter = THREE.LinearFilter;
    this.cloudTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.cloudTexture.wrapT = THREE.ClampToEdgeWrapping;

    this._initMaterial();
    this._initGeometry();

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    // Explicitly assign to Layer 0 (Secondary / worldCamera only; excluded from CharacterCamera)
    this.mesh.layers.set(0);
    this.mesh.layers.disable(1);

    // renderOrder 50: renders after opaque terrain and trees (renderOrder 0)
    // Combined with depthWrite: false, enables flawless order-independent transparency
    this.mesh.renderOrder = 50;
    this.mesh.frustumCulled = false; // Always visible across the vast world sky

    this.scene.add(this.mesh);
  }

  /**
   * Custom GLSL shader with view-space billboarding, forward Mie scattering,
   * toroidal wrapping, and near-plane fade.
   * @private
   */
  _initMaterial() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uCloudTexture: { value: this.cloudTexture },
        uTime: { value: 0.0 },
        uWind: { value: this.windSpeed },
        uPlayerPos: { value: this._playerPos },
        uWrapRadius: { value: this.wrapRadius },
        uSunDirection: { value: this.sunDirection },
        uSunColor: { value: this.sunColor },
        uSkyColor: { value: this.skyColor },
        uShadowColor: { value: this.shadowColor },
        uFogColor: { value: this.fogColor },
        uFogNear: { value: this.fogNear },
        uFogFar: { value: this.fogFar },
      },
      vertexShader: `
        attribute vec3 aPosition;
        attribute vec2 aScale;
        attribute float aRotation;
        attribute float aOpacity;
        attribute float aLayer;
        attribute float aPhase;
        attribute float aSunFactor;

        varying vec2 vUv;
        varying float vOpacity;
        varying float vSunFactor;
        varying float vLayer;
        varying vec3 vWorldPos;
        varying float vDistToCamera;

        uniform float uTime;
        uniform vec3 uWind;
        uniform vec3 uPlayerPos;
        uniform float uWrapRadius;

        void main() {
          vUv = uv;
          vOpacity = aOpacity;
          vSunFactor = aSunFactor;
          vLayer = aLayer;

          // 1. Wind drift with layer-differentiated velocity
          // Low mist drifts slower (~55%), high stratus drifts faster (~125%)
          float layerSpeed = (aLayer < 0.5) ? 0.55 : ((aLayer < 1.5) ? 1.0 : 1.25);
          vec3 pos = aPosition + uWind * (uTime * layerSpeed);

          // Subtle organic vertical oscillation (billowing breathing)
          float billow = sin(uTime * 0.35 + aPhase) * 2.2 + cos(uTime * 0.18 + aPhase * 1.5) * 1.5;
          pos.y += billow;

          // 2. Toroidal wrap around player position (seamless infinite horizon)
          float domain = uWrapRadius * 2.0;
          pos.x = mod(pos.x - uPlayerPos.x + uWrapRadius, domain) - uWrapRadius + uPlayerPos.x;
          pos.z = mod(pos.z - uPlayerPos.z + uWrapRadius, domain) - uWrapRadius + uPlayerPos.z;

          vWorldPos = pos;

          // 3. View-space camera-facing billboard expansion
          vec4 viewCenter = modelViewMatrix * vec4(pos, 1.0);
          vDistToCamera = -viewCenter.z;

          // Gentle rotational billow breathing
          float rotAngle = aRotation + sin(uTime * 0.08 + aPhase) * 0.12;
          float cosR = cos(rotAngle);
          float sinR = sin(rotAngle);

          vec2 scaledOffset = position.xy * aScale;
          vec2 rotatedOffset = vec2(
            cosR * scaledOffset.x - sinR * scaledOffset.y,
            sinR * scaledOffset.x + cosR * scaledOffset.y
          );

          vec4 viewPos = viewCenter + vec4(rotatedOffset, 0.0, 0.0);
          gl_Position = projectionMatrix * viewPos;
        }
      `,
      fragmentShader: `
        uniform sampler2D uCloudTexture;
        uniform vec3 uSunDirection;
        uniform vec3 uSunColor;
        uniform vec3 uSkyColor;
        uniform vec3 uShadowColor;
        uniform vec3 uFogColor;
        uniform float uFogNear;
        uniform float uFogFar;

        varying vec2 vUv;
        varying float vOpacity;
        varying float vSunFactor;
        varying float vLayer;
        varying vec3 vWorldPos;
        varying float vDistToCamera;

        void main() {
          vec4 tex = texture2D(uCloudTexture, vUv);
          if (tex.a < 0.005) discard;

          // 1. Dual-Tone Volumetric Sunlight Illumination
          // Upper portions of the billboard catch warm sunlight, lower portions receive cool sky ambient
          float vertGrad = smoothstep(0.15, 0.88, vUv.y);
          vec3 ambientTone = mix(uShadowColor, uSkyColor, vertGrad * 0.55);
          vec3 litTone = mix(ambientTone, uSunColor, vertGrad * (0.65 + 0.35 * vSunFactor));

          // 2. Mie Forward Scattering (Luminous silver lining when looking toward the sun)
          vec3 viewDir = normalize(vWorldPos - cameraPosition);
          float sunDot = dot(uSunDirection, viewDir);
          float forwardScatter = pow(max(0.0, sunDot), 5.0) * 0.65;
          // Silver lining is most prominent on wispy translucent fringes (lower alpha)
          float edgeGlow = (1.0 - smoothstep(0.35, 0.85, tex.a)) * forwardScatter;
          vec3 silverLining = vec3(1.15, 1.08, 0.95) * edgeGlow;

          // 3. Composite lit cloud fragment
          vec3 finalColor = litTone * tex.rgb + silverLining;

          // 4. Near-Plane Soft Fade (eliminates harsh camera clipping when player flies through cloud)
          float nearFade = smoothstep(18.0, 65.0, vDistToCamera);

          // 5. Atmospheric Fog Blend (melts distant clouds into horizon mountain mist)
          float fogFactor = smoothstep(uFogNear, uFogFar, vDistToCamera);
          finalColor = mix(finalColor, uFogColor, fogFactor * 0.82);

          float alpha = tex.a * vOpacity * nearFade * (1.0 - fogFactor * 0.45);

          gl_FragColor = vec4(finalColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false, // Prevents Z-sorting artifacts with overlapping translucent puffs
      depthTest: true,   // Correctly occluded behind mountains and terrain peaks
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
  }

  /**
   * Generates organic cloud clusters with layered altitude distribution.
   * @private
   */
  _initGeometry() {
    const basePlane = new THREE.PlaneGeometry(1, 1);
    this.geometry = new THREE.InstancedBufferGeometry();

    this.geometry.setAttribute('position', basePlane.attributes.position);
    this.geometry.setAttribute('uv', basePlane.attributes.uv);
    this.geometry.setIndex(basePlane.index);

    const N = this.totalParticles;

    const positions = new Float32Array(N * 3);
    const scales = new Float32Array(N * 2);
    const rotations = new Float32Array(N);
    const opacities = new Float32Array(N);
    const layers = new Float32Array(N);
    const phases = new Float32Array(N);
    const sunFactors = new Float32Array(N);

    let pIdx = 0;

    // Pseudorandom deterministic seed generator
    let seed = 4289;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    const wrapR = this.wrapRadius;

    for (let c = 0; c < this.clusterCount; c++) {
      // Determine cluster layer:
      // Layer 0: Low alpine mist (30% of clusters)
      // Layer 1: Mid cumulus banks (50% of clusters)
      // Layer 2: High stratus ceiling (20% of clusters)
      let layerType = 1;
      let clusterBaseY = 280.0;
      let clusterRadiusXZ = 160.0;
      let clusterRadiusY = 35.0;
      let minScale = 160.0;
      let maxScale = 270.0;
      let baseOpacity = 0.55;

      const layerRoll = rnd();
      if (layerRoll < 0.30) {
        // Low Alpine Mist & Mountain Pass Shrouds
        layerType = 0;
        clusterBaseY = 110.0 + rnd() * 65.0; // Y ~110-175m (skimming mountain peaks)
        clusterRadiusXZ = 190.0;
        clusterRadiusY = 22.0;
        minScale = 95.0;
        maxScale = 175.0;
        baseOpacity = 0.38;
      } else if (layerRoll < 0.80) {
        // Mid Majestic Cumulus Formations
        layerType = 1;
        clusterBaseY = 230.0 + rnd() * 120.0; // Y ~230-350m
        clusterRadiusXZ = 170.0;
        clusterRadiusY = 40.0;
        minScale = 170.0;
        maxScale = 290.0;
        baseOpacity = 0.62;
      } else {
        // High Atmospheric Stratus Canopy
        layerType = 2;
        clusterBaseY = 460.0 + rnd() * 140.0; // Y ~460-600m
        clusterRadiusXZ = 260.0;
        clusterRadiusY = 30.0;
        minScale = 290.0;
        maxScale = 460.0;
        baseOpacity = 0.48;
      }

      // Distribute cluster centers across the wrap domain
      const angle = rnd() * Math.PI * 2.0;
      const dist = Math.sqrt(rnd()) * (wrapR * 0.95);
      const clusterX = Math.cos(angle) * dist;
      const clusterZ = Math.sin(angle) * dist;

      // Populate cluster with overlapping sub-puffs
      for (let p = 0; p < this.particlesPerCluster; p++) {
        const i = pIdx++;

        // Gaussian-like organic spread around cluster center
        const offsetAngle = rnd() * Math.PI * 2.0;
        const offsetDist = Math.pow(rnd(), 1.5) * clusterRadiusXZ;
        const offsetY = (rnd() - 0.5) * 2.0 * clusterRadiusY;

        positions[i * 3 + 0] = clusterX + Math.cos(offsetAngle) * offsetDist;
        positions[i * 3 + 1] = clusterBaseY + offsetY;
        positions[i * 3 + 2] = clusterZ + Math.sin(offsetAngle) * offsetDist;

        // Scale: Cloud texture aspect ratio is ~1.54:1 (width > height)
        const baseScale = minScale + rnd() * (maxScale - minScale);
        const aspect = 1.35 + rnd() * 0.35; // Natural variation in puff elongation
        // Randomly flip width (50% chance) for instantaneous 2x visual silhouette variety
        const flipX = rnd() > 0.5 ? 1.0 : -1.0;
        scales[i * 2 + 0] = baseScale * aspect * flipX;
        scales[i * 2 + 1] = baseScale;

        // Random subtle rotation angle (-35 deg to +35 deg for natural cumulus orientation)
        rotations[i] = (rnd() - 0.5) * 0.65;

        // Opacity variation: core particles are denser, edge particles are wispy
        const distFromCenter = offsetDist / clusterRadiusXZ;
        const densityFade = 1.0 - distFromCenter * 0.45;
        opacities[i] = Math.max(0.18, Math.min(0.85, baseOpacity * densityFade * (0.85 + rnd() * 0.30)));

        layers[i] = layerType;
        phases[i] = rnd() * Math.PI * 2.0;
        sunFactors[i] = 0.70 + rnd() * 0.60;
      }
    }

    this.geometry.setAttribute('aPosition', new THREE.InstancedBufferAttribute(positions, 3));
    this.geometry.setAttribute('aScale', new THREE.InstancedBufferAttribute(scales, 2));
    this.geometry.setAttribute('aRotation', new THREE.InstancedBufferAttribute(rotations, 1));
    this.geometry.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(opacities, 1));
    this.geometry.setAttribute('aLayer', new THREE.InstancedBufferAttribute(layers, 1));
    this.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    this.geometry.setAttribute('aSunFactor', new THREE.InstancedBufferAttribute(sunFactors, 1));
  }

  /**
   * Per-frame update loop.
   * Updates time uniform for wind drift and billow pulsing, and player position for toroidal wrapping.
   * @param {number} elapsedTime - Total elapsed simulation time in seconds
   * @param {THREE.Vector3} playerPosition - Current active skier position
   */
  update(elapsedTime, playerPosition) {
    if (!this.material) return;

    this.material.uniforms.uTime.value = elapsedTime;

    if (playerPosition) {
      this._playerPos.copy(playerPosition);
      this.material.uniforms.uPlayerPos.value.copy(playerPosition);
    }
  }

  /**
   * Updates sun direction uniform dynamically when time of day changes.
   * @param {THREE.Vector3} sunDir
   */
  setSunDirection(sunDir) {
    if (this.material && sunDir) {
      this.material.uniforms.uSunDirection.value.copy(sunDir).normalize();
    }
  }

  /**
   * Disposes GPU buffers and textures when scene unloads.
   */
  dispose() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
    }
    if (this.geometry) {
      this.geometry.dispose();
    }
    if (this.material) {
      this.material.dispose();
    }
    if (this.cloudTexture) {
      this.cloudTexture.dispose();
    }
  }
}
