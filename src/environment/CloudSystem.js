import * as THREE from 'three';

/**
 * CloudSystem
 * High-performance, true volumetric alpine cloud particle system using fixed 3D world-space particles.
 *
 * Visual & Technical Highlights:
 * 1. True 3D Volumetric Formations:
 *    - Particles do NOT rotate to face the camera. They are fixed in 3D world space.
 *    - Each cloud is a dense volume composed of multiple intersecting 3D particles oriented across
 *      horizontal, vertical, and diagonal planes, forming full, billowy 3D cloud masses with natural parallax.
 * 2. High Particle Density (~1,500 particles in 1 draw call):
 *    - 40 organic cloud clusters each consisting of 36 layered 3D particles.
 *    - Core particles overlap to form a solid, opaque white center, while fringe particles create soft wisps.
 * 3. Pure White & Soft Light-Gray Shading (Zero Dark Clouds):
 *    - Texture luminance is remapped so the cloud is bright fluffy white with at most a delicate light-gray tint.
 *    - Gentle sunlit highlights and atmospheric sky ambient without any dark/stormy patches.
 * 4. Toroidal Infinite Wrapping: Seamlessly wraps around player position beyond the fog horizon.
 * 5. Near-Plane Soft Fade: Dissolves softly when flying or skiing through clouds (no geometric clipping).
 * 6. Atmospheric Fog Integration: Melts distant clouds into the mountain horizon fog.
 */
export class CloudSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {Object} [options]
   */
  constructor(scene, options = {}) {
    this.scene = scene;

    this.clusterCount = options.clusterCount || 40;
    this.particlesPerCluster = options.particlesPerCluster || 36;
    this.totalParticles = this.clusterCount * this.particlesPerCluster; // 1,440 particles

    this.wrapRadius = options.wrapRadius || 1350.0; // 2700m active domain
    this.windSpeed = options.windSpeed || new THREE.Vector3(3.2, 0.0, 1.6); // Gentle alpine wind (m/s)

    this.texturePath = options.texturePath || '/textures/cloud.png';

    // Pure White & Light-Gray Shading (strictly avoiding dark clouds)
    this.sunDirection = options.sunDirection || new THREE.Vector3(130, 190, 90).normalize();
    this.sunColor = options.sunColor || new THREE.Color(1.06, 1.05, 1.03); // Radiant warm white sunlight
    this.skyColor = options.skyColor || new THREE.Color(0.96, 0.98, 1.00); // Fresh alpine sky ambient
    this.shadowColor = options.shadowColor || new THREE.Color(0.88, 0.91, 0.94); // Light silver-gray (clean & bright)
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
    this.mesh.renderOrder = 50;
    this.mesh.frustumCulled = false; // Always visible across the vast sky

    this.scene.add(this.mesh);
  }

  /**
   * Custom GLSL shader with 3D world-space orientation (non-billboard),
   * true volumetric parallax, pure white tone remapping, and near-plane fade.
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
        attribute vec3 aRotation;
        attribute float aOpacity;
        attribute float aLayer;
        attribute float aPhase;
        attribute float aSunFactor;

        varying vec2 vUv;
        varying float vOpacity;
        varying float vSunFactor;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying float vDistToCamera;

        uniform float uTime;
        uniform vec3 uWind;
        uniform vec3 uPlayerPos;
        uniform float uWrapRadius;

        // 3D Euler rotation (Pitch, Yaw, Roll) in World Space
        vec3 rotateEuler(vec3 p, vec3 rot) {
          // 1. Rotate around X (pitch)
          float cx = cos(rot.x);
          float sx = sin(rot.x);
          vec3 p1 = vec3(p.x, cx * p.y - sx * p.z, sx * p.y + cx * p.z);

          // 2. Rotate around Y (yaw)
          float cy = cos(rot.y);
          float sy = sin(rot.y);
          vec3 p2 = vec3(cy * p1.x + sy * p1.z, p1.y, -sy * p1.x + cy * p1.z);

          // 3. Rotate around Z (roll)
          float cz = cos(rot.z);
          float sz = sin(rot.z);
          return vec3(cz * p2.x - sz * p2.y, sz * p2.x + cz * p2.y, p2.z);
        }

        void main() {
          vUv = uv;
          vOpacity = aOpacity;
          vSunFactor = aSunFactor;

          // 1. Wind drift with layer-differentiated velocity
          float layerSpeed = (aLayer < 0.5) ? 0.55 : ((aLayer < 1.5) ? 1.0 : 1.25);
          vec3 pos = aPosition + uWind * (uTime * layerSpeed);

          // Subtle organic vertical oscillation (billowing breathing)
          float billow = sin(uTime * 0.32 + aPhase) * 2.0 + cos(uTime * 0.16 + aPhase * 1.4) * 1.2;
          pos.y += billow;

          // 2. Toroidal wrap around player position in world space
          float domain = uWrapRadius * 2.0;
          pos.x = mod(pos.x - uPlayerPos.x + uWrapRadius, domain) - uWrapRadius + uPlayerPos.x;
          pos.z = mod(pos.z - uPlayerPos.z + uWrapRadius, domain) - uWrapRadius + uPlayerPos.z;

          // 3. Fixed 3D World-Space Orientation (NO CAMERA BILLBOARDING)
          // The quad stays firmly anchored in 3D world space. As the camera moves/rotates,
          // the cloud exhibits true 3D volumetric parallax!
          vec3 localPos = vec3(position.x * aScale.x, position.y * aScale.y, 0.0);
          vec3 rotatedOffset = rotateEuler(localPos, aRotation);

          vec3 worldPos = pos + rotatedOffset;
          vWorldPos = worldPos;
          vDistToCamera = length(worldPos - cameraPosition);

          // Compute world normal for realistic light scattering
          vec3 worldNorm = rotateEuler(vec3(0.0, 0.0, 1.0), aRotation);
          vec3 toCam = normalize(cameraPosition - worldPos);
          if (dot(worldNorm, toCam) < 0.0) {
            worldNorm = -worldNorm;
          }
          vWorldNormal = worldNorm;

          // Standard 3D transformation: World -> View -> Clip
          gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
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
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying float vDistToCamera;

        void main() {
          vec4 tex = texture2D(uCloudTexture, vUv);
          if (tex.a < 0.005) discard;

          // 1. Pure White Tone Remapping (Zero Dark Clouds)
          // The source texture has dark gray areas (~0.50). We remap the luminance so that
          // the cloud is predominantly crisp, fluffy white (1.0), with at most a soft,
          // delicate light-gray tint (0.87-0.92) in deeper crevices.
          float texLum = tex.r;
          float cloudWhiteness = mix(0.87, 1.0, smoothstep(0.40, 0.90, texLum));

          // 2. High-Key Atmospheric Lighting
          // Top-facing surfaces receive radiant sunlight; lower surfaces receive soft sky ambient.
          // Minimum brightness is kept high so clouds always look bright and heavenly.
          float vertGrad = smoothstep(-0.25, 0.90, vWorldNormal.y);
          vec3 ambientTone = mix(uShadowColor, uSkyColor, vertGrad * 0.55);
          vec3 litTone = mix(ambientTone, uSunColor, vertGrad * 0.45 + 0.55 * vSunFactor);

          // 3. Subtle Forward Scattering (Luminous silver lining when looking toward the sun)
          vec3 viewDir = normalize(vWorldPos - cameraPosition);
          float sunDot = dot(normalize(uSunDirection), viewDir);
          float forwardScatter = pow(max(0.0, sunDot), 5.0) * 0.35 * (1.0 - smoothstep(0.25, 0.80, tex.a));
          vec3 silverLining = vec3(1.06, 1.04, 1.00) * forwardScatter;

          vec3 finalColor = litTone * cloudWhiteness + silverLining;

          // 4. Near-Plane Soft Fade (smoothly dissolves when player flies/skis through clouds)
          float nearFade = smoothstep(12.0, 48.0, vDistToCamera);

          // 5. Atmospheric Fog Blend (melts distant clouds seamlessly into horizon mountain fog)
          float fogFactor = smoothstep(uFogNear, uFogFar, vDistToCamera);
          finalColor = mix(finalColor, uFogColor, fogFactor * 0.75);

          float alpha = tex.a * vOpacity * nearFade * (1.0 - fogFactor * 0.40);

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
   * Each cluster contains 36 particles with complementary 3D orientations (horizontal,
   * vertical, and diagonal) forming a cohesive 3D volume.
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
    const rotations = new Float32Array(N * 3);
    const opacities = new Float32Array(N);
    const layers = new Float32Array(N);
    const phases = new Float32Array(N);
    const sunFactors = new Float32Array(N);

    let pIdx = 0;

    // Pseudorandom deterministic seed generator
    let seed = 7391;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    const wrapR = this.wrapRadius;

    for (let c = 0; c < this.clusterCount; c++) {
      let layerType = 1;
      let clusterBaseY = 280.0;
      let clusterRadiusXZ = 160.0;
      let clusterRadiusY = 55.0;
      let minScale = 140.0;
      let maxScale = 240.0;
      let baseOpacity = 0.28;

      const layerRoll = rnd();
      if (layerRoll < 0.30) {
        // Low Alpine Mist & Mountain Col Shrouds (Y ~100-170m)
        layerType = 0;
        clusterBaseY = 105.0 + rnd() * 65.0;
        clusterRadiusXZ = 180.0;
        clusterRadiusY = 32.0;
        minScale = 90.0;
        maxScale = 160.0;
        baseOpacity = 0.22;
      } else if (layerRoll < 0.80) {
        // Mid Majestic Cumulus Formations (Y ~220-360m)
        layerType = 1;
        clusterBaseY = 225.0 + rnd() * 135.0;
        clusterRadiusXZ = 160.0;
        clusterRadiusY = 60.0;
        minScale = 150.0;
        maxScale = 260.0;
        baseOpacity = 0.30;
      } else {
        // High Atmospheric Cloud Ceiling (Y ~460-620m)
        layerType = 2;
        clusterBaseY = 460.0 + rnd() * 150.0;
        clusterRadiusXZ = 240.0;
        clusterRadiusY = 45.0;
        minScale = 240.0;
        maxScale = 380.0;
        baseOpacity = 0.24;
      }

      // Distribute cluster centers across the wrap domain
      const angle = rnd() * Math.PI * 2.0;
      const dist = Math.sqrt(rnd()) * (wrapR * 0.95);
      const clusterX = Math.cos(angle) * dist;
      const clusterZ = Math.sin(angle) * dist;

      // Populate cluster with 36 overlapping 3D particles across multiple orientation groups
      for (let p = 0; p < this.particlesPerCluster; p++) {
        const i = pIdx++;

        // 3D Gaussian-like spread around cluster center
        const offsetAngle = rnd() * Math.PI * 2.0;
        const offsetDist = Math.pow(rnd(), 1.4) * clusterRadiusXZ;
        const offsetY = (rnd() - 0.5) * 2.0 * clusterRadiusY;

        positions[i * 3 + 0] = clusterX + Math.cos(offsetAngle) * offsetDist;
        positions[i * 3 + 1] = clusterBaseY + offsetY;
        positions[i * 3 + 2] = clusterZ + Math.sin(offsetAngle) * offsetDist;

        // 3D Orientation Groups:
        // Group A (p % 3 == 0): Horizontal / low-tilt shelves (cumulus flat bases and top shelves)
        // Group B (p % 3 == 1): Vertical billow lobes (facing varied 360-deg azimuth directions)
        // Group C (p % 3 == 2): Diagonal billow transitions (45-deg angled slabs tying volume together)
        let rotX = 0;
        let rotY = rnd() * Math.PI * 2.0;
        let rotZ = (rnd() - 0.5) * 0.5;

        if (p % 3 === 0) {
          // Horizontal / low-tilt layer
          rotX = Math.PI * 0.5 + (rnd() - 0.5) * 0.35;
        } else if (p % 3 === 1) {
          // Vertical billow lobe
          rotX = (rnd() - 0.5) * 0.40;
          rotY = (p / this.particlesPerCluster) * Math.PI * 2.0 + (rnd() - 0.5) * 0.35;
        } else {
          // Diagonal transition
          rotX = (Math.PI * 0.25) * (rnd() > 0.5 ? 1.0 : -1.0) + (rnd() - 0.5) * 0.30;
        }

        rotations[i * 3 + 0] = rotX;
        rotations[i * 3 + 1] = rotY;
        rotations[i * 3 + 2] = rotZ;

        // Scale: Cloud texture aspect ratio is ~1.54:1 (width > height)
        const baseScale = minScale + rnd() * (maxScale - minScale);
        const aspect = 1.30 + rnd() * 0.40;
        // 50% chance of horizontal flip for 2x visual variety
        const flipX = rnd() > 0.5 ? 1.0 : -1.0;
        scales[i * 2 + 0] = baseScale * aspect * flipX;
        scales[i * 2 + 1] = baseScale;

        // Opacity variation: core particles overlap to form solid white, edges are wispy
        const distNorm = Math.sqrt((offsetDist / clusterRadiusXZ) ** 2 + (offsetY / clusterRadiusY) ** 2);
        const coreFalloff = Math.max(0.25, 1.0 - distNorm * 0.55);
        opacities[i] = Math.max(0.12, Math.min(0.48, baseOpacity * coreFalloff * (0.85 + rnd() * 0.30)));

        layers[i] = layerType;
        phases[i] = rnd() * Math.PI * 2.0;
        sunFactors[i] = 0.75 + rnd() * 0.50;
      }
    }

    this.geometry.setAttribute('aPosition', new THREE.InstancedBufferAttribute(positions, 3));
    this.geometry.setAttribute('aScale', new THREE.InstancedBufferAttribute(scales, 2));
    this.geometry.setAttribute('aRotation', new THREE.InstancedBufferAttribute(rotations, 3));
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
