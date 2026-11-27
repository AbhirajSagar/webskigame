import * as THREE from 'three';

/**
 * CloudSystem
 * High-performance, volumetric alpine cloud particle system using position-anchored world billboards.
 *
 * Visual & Technical Highlights:
 * 1. Seamless Smooth Fade-In/Out (100% Zero Pop-In):
 *    - Toroidal Domain Perimeter Fade: Particles smoothly dissolve to 0.0 opacity between 60% and 92% of the wrap radius.
 *      When wrapping on the opposite horizon, particles are 100% invisible (alpha 0.0) and fade in smoothly as they approach.
 *    - Distance Horizon Fade: Clouds smoothly melt into the horizon fog and sky without any sudden clipping.
 *    - Smooth Intro Fade: Softly fades all clouds in on startup.
 * 2. Multi-Texture Silhouette Variation (3 Distinct Cloud Types):
 *    - Texture 1 (/textures/cloud.png): Wide multi-lobed alpine cumulus.
 *    - Texture 2 (/textures/cloud2.png): Isolated towering fluffy cumulus dome (from user upload).
 *    - Texture 3 (/textures/cloud3.png): Volumetric ethereal billowy cloud volume.
 *    - Dynamically mixed across 36 clusters for rich, organic sky variety.
 * 3. Position-Anchored World Billboarding (No Camera-Turn Swivel):
 *    - Faces camera's 3D position in world space with vertical axis locked to World Up.
 *    - Turning, panning, or tilting the camera produces ZERO quad rotation in world space.
 * 4. High Optical Density & Reduced Transparency:
 *    - Substantial opacity (0.55-0.92) with boosted alpha response curve ensures clouds are solid, crisp, and fluffy.
 * 5. Pure White & Soft Light-Gray Shading (Zero Dark Clouds):
 *    - Texture luminance is remapped so clouds are bright fluffy white with at most a delicate light-gray tint.
 * 6. Multi-Particle 3D Volume Clusters:
 *    - 36 clusters each containing 24 overlapping billboard particles distributed in 3D ellipsoids (864 particles in 1 draw call).
 */
export class CloudSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {Object} [options]
   */
  constructor(scene, options = {}) {
    this.scene = scene;

    this.clusterCount = options.clusterCount || 64;
    this.particlesPerCluster = options.particlesPerCluster || 32;
    this.totalParticles = this.clusterCount * this.particlesPerCluster; // 2048 particles

    this.wrapRadius = options.wrapRadius || 1350.0; // 2700m active domain
    this.windSpeed = options.windSpeed || new THREE.Vector3(3.2, 0.0, 1.6); // Gentle alpine wind (m/s)

    this.texturePath1 = options.texturePath1 || '/textures/cloud.png';
    this.texturePath2 = options.texturePath2 || '/textures/cloud2.png';
    this.texturePath3 = options.texturePath3 || '/textures/cloud3.png';

    // Pure White & Light-Gray Shading (strictly avoiding orange/dark tints)
    this.sunDirection = options.sunDirection || new THREE.Vector3(130, 190, 90).normalize();
    this.sunColor = options.sunColor || new THREE.Color(1.06, 1.06, 1.05); // Crisp bright white sunlight
    this.skyColor = options.skyColor || new THREE.Color(0.97, 0.98, 1.00); // Fresh alpine sky ambient
    this.shadowColor = options.shadowColor || new THREE.Color(0.89, 0.92, 0.95); // Light silver-white (clean & bright)
    this.fogColor = options.fogColor || new THREE.Color(0xc6cdd5);
    this.fogNear = options.fogNear || 260.0;
    this.fogFar = options.fogFar || 1050.0;

    this.mesh = null;
    this.material = null;
    this.geometry = null;

    this._dummy = new THREE.Object3D();
    this._playerPos = new THREE.Vector3();

    this._init();
  }

  /**
   * Initializes textures, geometry, instanced attributes and shader material.
   * @private
   */
  _init() {
    const textureLoader = new THREE.TextureLoader();

    // Texture 1: Wide multi-lobed fluffy cumulus
    this.cloudTexture1 = textureLoader.load(this.texturePath1);
    this.cloudTexture1.colorSpace = THREE.SRGBColorSpace;
    this.cloudTexture1.generateMipmaps = true;
    this.cloudTexture1.minFilter = THREE.LinearMipmapLinearFilter;
    this.cloudTexture1.magFilter = THREE.LinearFilter;
    this.cloudTexture1.wrapS = THREE.ClampToEdgeWrapping;
    this.cloudTexture1.wrapT = THREE.ClampToEdgeWrapping;

    // Texture 2: Isolated fluffy towering cumulus dome
    this.cloudTexture2 = textureLoader.load(this.texturePath2);
    this.cloudTexture2.colorSpace = THREE.SRGBColorSpace;
    this.cloudTexture2.generateMipmaps = true;
    this.cloudTexture2.minFilter = THREE.LinearMipmapLinearFilter;
    this.cloudTexture2.magFilter = THREE.LinearFilter;
    this.cloudTexture2.wrapS = THREE.ClampToEdgeWrapping;
    this.cloudTexture2.wrapT = THREE.ClampToEdgeWrapping;

    // Texture 3: Volumetric billowy cloud volume
    this.cloudTexture3 = textureLoader.load(this.texturePath3);
    this.cloudTexture3.colorSpace = THREE.SRGBColorSpace;
    this.cloudTexture3.generateMipmaps = true;
    this.cloudTexture3.minFilter = THREE.LinearMipmapLinearFilter;
    this.cloudTexture3.magFilter = THREE.LinearFilter;
    this.cloudTexture3.wrapS = THREE.ClampToEdgeWrapping;
    this.cloudTexture3.wrapT = THREE.ClampToEdgeWrapping;

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
   * Custom GLSL shader with position-anchored world billboarding,
   * smooth toroidal perimeter fade-in/out, multi-texture blending, and pure white tone remapping.
   * @private
   */
  _initMaterial() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uCloudTexture1: { value: this.cloudTexture1 },
        uCloudTexture2: { value: this.cloudTexture2 },
        uCloudTexture3: { value: this.cloudTexture3 },
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
        attribute float aTextureType;

        varying vec2 vUv;
        varying float vOpacity;
        varying float vSunFactor;
        varying float vTextureType;
        varying vec3 vWorldPos;
        varying float vTotalFade;

        uniform float uTime;
        uniform vec3 uWind;
        uniform vec3 uPlayerPos;
        uniform float uWrapRadius;

        void main() {
          vUv = uv;
          vOpacity = aOpacity;
          vSunFactor = aSunFactor;
          vTextureType = aTextureType;

          // 1. Wind drift with layer-differentiated velocity
          float layerSpeed = (aLayer < 0.5) ? 0.55 : ((aLayer < 1.5) ? 1.0 : 1.25);
          vec3 pos = aPosition + uWind * (uTime * layerSpeed);

          // Subtle organic vertical oscillation (billowing breathing)
          float billow = sin(uTime * 0.32 + aPhase) * 2.2 + cos(uTime * 0.16 + aPhase * 1.4) * 1.5;
          pos.y += billow;

          // 2. Toroidal wrap around player position in world space
          float domain = uWrapRadius * 2.0;
          pos.x = mod(pos.x - uPlayerPos.x + uWrapRadius, domain) - uWrapRadius + uPlayerPos.x;
          pos.z = mod(pos.z - uPlayerPos.z + uWrapRadius, domain) - uWrapRadius + uPlayerPos.z;

          // 3. Smooth Toroidal Domain & Horizon Fade-In / Fade-Out (decoupled from ground fog jumps)
          float distFromPlayerXZ = length(pos.xz - uPlayerPos.xz);
          float domainFade = 1.0 - smoothstep(uWrapRadius * 0.55, uWrapRadius * 0.90, distFromPlayerXZ);

          vec3 toCamera = cameraPosition - pos;
          float distToCam = length(toCamera);

          float horizonFade = 1.0 - smoothstep(uWrapRadius * 0.72, uWrapRadius * 1.10, distToCam);
          float introFade = smoothstep(0.0, 1.5, uTime);
          float totalFade = domainFade * horizonFade * introFade;
          vTotalFade = totalFade;

          // Early cull invisible wrapped/far quads or quads completely behind the camera
          vec3 viewCenter = (viewMatrix * vec4(pos, 1.0)).xyz;
          float maxRadius = max(abs(aScale.x), abs(aScale.y)) * 0.80;
          if (totalFade <= 0.003 || viewCenter.z > maxRadius) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            vWorldPos = pos;
            return;
          }

          // 4. Position-Anchored World Billboard (Eliminates camera-turn swivel)
          vec3 norm = (distToCam > 0.001) ? (toCamera / distToCam) : vec3(0.0, 0.0, 1.0);

          // World Up vector locked to true vertical
          vec3 worldUp = vec3(0.0, 1.0, 0.0);

          // Reconstruct orthogonal World Right and World Up basis vectors
          vec3 rawRight = cross(worldUp, norm);
          float rightLen = length(rawRight);
          vec3 right = (rightLen > 0.001) ? (rawRight / rightLen) : vec3(1.0, 0.0, 0.0);
          vec3 up = cross(norm, right);

          // Gentle static puff rotation angle
          float cosR = cos(aRotation);
          float sinR = sin(aRotation);

          vec2 scaledOffset = position.xy * aScale;
          vec3 quadOffset = right * (cosR * scaledOffset.x - sinR * scaledOffset.y) +
                            up * (sinR * scaledOffset.x + cosR * scaledOffset.y);

          vec3 worldPos = pos + quadOffset;
          vWorldPos = worldPos;

          // Standard transformation into view and clip space:
          gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uCloudTexture1;
        uniform sampler2D uCloudTexture2;
        uniform sampler2D uCloudTexture3;
        uniform float uTime;
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
        varying float vTextureType;
        varying vec3 vWorldPos;
        varying float vTotalFade;

        void main() {
          if (vTotalFade <= 0.003) discard;

          // Select texture based on per-particle variation
          vec4 tex;
          if (vTextureType < 0.6) {
            tex = texture2D(uCloudTexture1, vUv);
          } else if (vTextureType < 1.6) {
            tex = texture2D(uCloudTexture2, vUv);
          } else {
            tex = texture2D(uCloudTexture3, vUv);
          }

          if (tex.a < 0.015) discard;

          // 1. Pure White Tone Remapping (Zero Dark Clouds)
          float texLum = tex.r;
          float cloudWhiteness = mix(0.90, 1.0, smoothstep(0.35, 0.88, texLum));

          // 2. High-Key Atmospheric Lighting
          float vertGrad = smoothstep(0.10, 0.88, vUv.y);
          vec3 ambientTone = mix(uShadowColor, uSkyColor, vertGrad * 0.45);
          vec3 litTone = mix(ambientTone, uSunColor, vertGrad * 0.40 + 0.60 * vSunFactor);

          // 3. Subtle Forward Scattering (uSunDirection is pre-normalized on CPU)
          vec3 viewDir = normalize(vWorldPos - cameraPosition);
          float sunDot = max(0.0, dot(uSunDirection, viewDir));
          float s2 = sunDot * sunDot;
          float forwardScatter = (s2 * s2 * sunDot) * 0.35 * (1.0 - smoothstep(0.35, 0.85, tex.a));
          vec3 silverLining = vec3(1.08, 1.05, 1.00) * forwardScatter;

          vec3 finalColor = litTone * cloudWhiteness + silverLining;

          // 4. Atmospheric Fog Color Blend (melts distant clouds into horizon mountain fog)
          float fragDistToCam = length(cameraPosition - vWorldPos);
          float nearFade = smoothstep(18.0, 65.0, fragDistToCam);
          float fogFactor = smoothstep(uFogNear, uFogFar, fragDistToCam);
          finalColor = mix(finalColor, uFogColor, fogFactor * 0.55);

          // Boosted alpha curve without pow()
          float boostedAlpha = mix(tex.a, sqrt(tex.a), 0.36);
          float alpha = boostedAlpha * vOpacity * vTotalFade * nearFade;

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
   * Generates organic cloud clusters with layered altitude distribution and 3-texture variation.
   * Clusters contain overlapping position-anchored particles with high opacity
   * forming dense, volumetric, prominently visible cloud masses.
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
    const textureTypes = new Float32Array(N);

    let pIdx = 0;

    // Pseudorandom deterministic seed generator
    let seed = 5821;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    const wrapR = this.wrapRadius;

    for (let c = 0; c < this.clusterCount; c++) {
      let layerType = 1;
      let clusterBaseY = 270.0;
      let clusterRadiusXZ = 160.0;
      let clusterRadiusY = 50.0;
      let minScale = 150.0;
      let maxScale = 270.0;
      let baseOpacity = 0.76; // High optical density so clouds are prominently visible

      const layerRoll = rnd();
      if (layerRoll < 0.28) {
        // Low Alpine Mist & Mountain Col Shrouds (Y ~105-175m)
        layerType = 0;
        clusterBaseY = 105.0 + rnd() * 70.0;
        clusterRadiusXZ = 170.0;
        clusterRadiusY = 30.0;
        minScale = 95.0;
        maxScale = 175.0;
        baseOpacity = 0.62;
      } else if (layerRoll < 0.78) {
        // Mid Majestic Cumulus Formations (Y ~220-370m)
        layerType = 1;
        clusterBaseY = 220.0 + rnd() * 140.0;
        clusterRadiusXZ = 160.0;
        clusterRadiusY = 55.0;
        minScale = 160.0;
        maxScale = 290.0;
        baseOpacity = 0.78;
      } else {
        // High Atmospheric Cloud Ceiling (Y ~460-630m)
        layerType = 2;
        clusterBaseY = 460.0 + rnd() * 160.0;
        clusterRadiusXZ = 240.0;
        clusterRadiusY = 40.0;
        minScale = 250.0;
        maxScale = 420.0;
        baseOpacity = 0.70;
      }

      // Distribute cluster centers across the wrap domain
      const angle = rnd() * Math.PI * 2.0;
      const dist = Math.sqrt(rnd()) * (wrapR * 0.95);
      const clusterX = Math.cos(angle) * dist;
      const clusterZ = Math.sin(angle) * dist;

      // Primary texture theme for this cluster:
      // ~38% Texture 2 (Isolated fluffy cumulus dome)
      // ~38% Texture 1 (Wide alpine cumulus)
      // ~24% Texture 3 (Ethereal billowy volume)
      const themeRoll = rnd();
      const clusterTextureTheme = (themeRoll < 0.38) ? 1.0 : ((themeRoll < 0.76) ? 0.0 : 2.0);

      // Populate cluster with overlapping position-anchored billboard particles
      for (let p = 0; p < this.particlesPerCluster; p++) {
        const i = pIdx++;

        // 3D spread around cluster center
        const offsetAngle = rnd() * Math.PI * 2.0;
        const offsetDist = Math.pow(rnd(), 1.3) * clusterRadiusXZ;
        const offsetY = (rnd() - 0.5) * 2.0 * clusterRadiusY;

        positions[i * 3 + 0] = clusterX + Math.cos(offsetAngle) * offsetDist;
        positions[i * 3 + 1] = clusterBaseY + offsetY;
        positions[i * 3 + 2] = clusterZ + Math.sin(offsetAngle) * offsetDist;

        // Texture assignment: predominantly cluster theme, with organic sub-puff variety
        const texType = (rnd() > 0.25) ? clusterTextureTheme : Math.floor(rnd() * 3.0);
        textureTypes[i] = texType;

        // Scale: Textures 1 & 2 have ~1.54:1 aspect ratio; Texture 3 is ~1:1
        const baseScale = minScale + rnd() * (maxScale - minScale);
        const aspect = (texType === 2.0) ? (1.0 + rnd() * 0.25) : (1.35 + rnd() * 0.35);
        // 50% chance of horizontal flip for 2x visual variety
        const flipX = rnd() > 0.5 ? 1.0 : -1.0;
        scales[i * 2 + 0] = baseScale * aspect * flipX;
        scales[i * 2 + 1] = baseScale;

        // Subtle billboard rotation angle (-20 deg to +20 deg for natural puff orientation)
        rotations[i] = (rnd() - 0.5) * 0.40;

        // Dense opacity: core particles reach 0.80-0.92, outer wisps reach 0.48-0.65
        const distNorm = offsetDist / clusterRadiusXZ;
        const coreFactor = Math.max(0.55, 1.0 - distNorm * 0.45);
        opacities[i] = Math.max(0.45, Math.min(0.92, baseOpacity * coreFactor * (0.90 + rnd() * 0.25)));

        layers[i] = layerType;
        phases[i] = rnd() * Math.PI * 2.0;
        sunFactors[i] = 0.80 + rnd() * 0.45;
      }
    }

    this.geometry.setAttribute('aPosition', new THREE.InstancedBufferAttribute(positions, 3));
    this.geometry.setAttribute('aScale', new THREE.InstancedBufferAttribute(scales, 2));
    this.geometry.setAttribute('aRotation', new THREE.InstancedBufferAttribute(rotations, 1));
    this.geometry.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(opacities, 1));
    this.geometry.setAttribute('aLayer', new THREE.InstancedBufferAttribute(layers, 1));
    this.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    this.geometry.setAttribute('aSunFactor', new THREE.InstancedBufferAttribute(sunFactors, 1));
    this.geometry.setAttribute('aTextureType', new THREE.InstancedBufferAttribute(textureTypes, 1));
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
    if (this.cloudTexture1) {
      this.cloudTexture1.dispose();
    }
    if (this.cloudTexture2) {
      this.cloudTexture2.dispose();
    }
    if (this.cloudTexture3) {
      this.cloudTexture3.dispose();
    }
  }
}
