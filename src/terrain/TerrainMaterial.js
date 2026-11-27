import * as THREE from 'three';

/**
 * Default Snow Material Config
 * Completely customizable and exportable as JSON.
 */
export const DEFAULT_SNOW_CONFIG = {
  // Chromatic Snow Palette (pure radiant alpine snow with crisp cool-blue shadows)
  sunlitColor: '#f4f7fb',
  shadowColor: '#244b91',
  creviceColor: '#192230',

  // Slope & Wind Scour
  slopeMin: 0.42,
  slopeMax: 0.76,
  peakScourStart: 155,
  peakScourEnd: 210,
  peakScourIntensity: 0.36,

  // Surface & Roughness (Strong 3D sastrugi & powder relief)
  snowNormalScale: 4.2,
  snowRoughness: 0.75,

  // SSS & Glancing Sheen (Volumetric powder light scattering)
  sssIntensity: 0.65,
  sssColor: '#f9c687',
  sheenIntensity: 0.35,
  sheenColor: '#ffffff',
};

/**
 * Default Frozen Lake Material Config
 * Hardcoded PBR glacial ice parameters.
 */
export const DEFAULT_LAKE_CONFIG = {
  // Glacial Cyan Lake Colors
  lakeDeepColor: '#005872',
  lakeMidColor: '#0e7e8b',
  lakeBrightColor: '#12a4c5',
  lakeFrostColor: '#80eec5',
  lakeCrackColor: '#a6ffff',

  // Surface & Lighting Optics (non-metallic glacial ice with soft satin reflection)
  lakeRoughness: 0.24,
  lakeMetalness: 0.06,
  lakeSpecular: 0.14,
  lakeGlintPower: 420,
  lakeFresnel: 0.22,
  lakeFresnelPower: 3.0,
  lakeSSS: 0.22,

  // Kept for config compatibility
  lakeCrackScale: 0.65,
  lakeCrackIntensity: 0.0,
  lakeCrackWidth: 0.020,
  lakeNoiseScale: 0.048,
  lakeNoiseThreshold: 0.36,
  lakeNormalRipples: 0.025,
};

/**
 * TerrainMaterialFactory
 * Ultra-high-performance PBR alpine terrain shader with dynamic snow illumination and anti-tiled rock.
 *
 * Performance Optimizations:
 * 1. Snow-First Early Exit:
 *    Computes the organic snow-rock boundary first. On pure snow surfaces (~85% of terrain pixels),
 *    all 24+ heavy triplanar rock texture fetches are completely skipped!
 * 2. Gated Triplanar Plane Execution:
 *    On rock cliffs, planes with blending weight <= 0.03 are skipped, eliminating wasted texture bandwidth.
 * 3. Dual-Frequency Quasi-Periodic Sampling:
 *    Streamlined anti-tiling (macro + detuned angle) eliminating redundant micro-passes.
 * 4. Fast-Gated Crystal Sparkles:
 *    Voronoi micro-crystal glints are only calculated for fragments illuminated by direct sunlight
 *    and within 48 meters, skipping shadows, hollows, and distant slopes.
 * 5. Multi-Scale Wind Sastrugi & Powder Drift Normals:
 *    Tangible 3D alpine snow contours with subtle animated drift.
 */
export class TerrainMaterialFactory {
  constructor() {
    const textureLoader = new THREE.TextureLoader();

    // 1. Rock PBR Texture Suite from public/textures (Rock058 1K)
    this.rockColorMap = textureLoader.load('/textures/Rock058_1K-JPG_Color.jpg');
    this.rockColorMap.wrapS = THREE.RepeatWrapping;
    this.rockColorMap.wrapT = THREE.RepeatWrapping;
    this.rockColorMap.colorSpace = THREE.SRGBColorSpace;

    this.rockNormalMap = textureLoader.load('/textures/Rock058_1K-JPG_NormalGL.jpg');
    this.rockNormalMap.wrapS = THREE.RepeatWrapping;
    this.rockNormalMap.wrapT = THREE.RepeatWrapping;

    this.rockRoughnessMap = textureLoader.load('/textures/Rock058_1K-JPG_Roughness.jpg');
    this.rockRoughnessMap.wrapS = THREE.RepeatWrapping;
    this.rockRoughnessMap.wrapT = THREE.RepeatWrapping;

    this.rockAOMap = textureLoader.load('/textures/Rock058_1K-JPG_AmbientOcclusion.jpg');
    this.rockAOMap.wrapS = THREE.RepeatWrapping;
    this.rockAOMap.wrapT = THREE.RepeatWrapping;

    // 2. Snow Normal Map
    this.snowNormalMap = textureLoader.load('/textures/snow_normal.jpg');
    this.snowNormalMap.wrapS = THREE.RepeatWrapping;
    this.snowNormalMap.wrapT = THREE.RepeatWrapping;

    this.snowConfig = { ...DEFAULT_SNOW_CONFIG };
    this.lakeConfig = { ...DEFAULT_LAKE_CONFIG };

    // Dynamic Shader Uniforms
    this.uniforms = {
      uRockColorMap: { value: this.rockColorMap },
      uRockNormalMap: { value: this.rockNormalMap },
      uRockRoughnessMap: { value: this.rockRoughnessMap },
      uRockAOMap: { value: this.rockAOMap },
      uSnowNormalMap: { value: this.snowNormalMap },
      uSnowNormalScale: { value: this.snowConfig.snowNormalScale },
      uTime: { value: 0.0 },
      uCameraPosition: { value: new THREE.Vector3() },
      uSunDirection: { value: new THREE.Vector3(130, 190, 90).normalize() },

      // Snow Dynamic Uniforms (Real-time tweakable)
      uSunlitSnowColor: { value: new THREE.Color(this.snowConfig.sunlitColor) },
      uShadowSnowColor: { value: new THREE.Color(this.snowConfig.shadowColor) },
      uCreviceSnowColor: { value: new THREE.Color(this.snowConfig.creviceColor) },
      uSnowSlopeMin: { value: this.snowConfig.slopeMin },
      uSnowSlopeMax: { value: this.snowConfig.slopeMax },
      uPeakScourStart: { value: this.snowConfig.peakScourStart },
      uPeakScourEnd: { value: this.snowConfig.peakScourEnd },
      uPeakScourIntensity: { value: this.snowConfig.peakScourIntensity },
      uSnowRoughness: { value: this.snowConfig.snowRoughness },
      uSSSIntensity: { value: this.snowConfig.sssIntensity },
      uSSSColor: { value: new THREE.Color(this.snowConfig.sssColor) },
      uSheenIntensity: { value: this.snowConfig.sheenIntensity },
      uSheenColor: { value: new THREE.Color(this.snowConfig.sheenColor) },
      uRockTint: { value: new THREE.Color('#ffffff') },
      uRockRoughnessScale: { value: 1.0 },

      // Emerald Lake Ice Uniforms (Live tweakable via LakeMaterialUI)
      uLakeDeepColor: { value: new THREE.Color(this.lakeConfig.lakeDeepColor) },
      uLakeMidColor: { value: new THREE.Color(this.lakeConfig.lakeMidColor) },
      uLakeBrightColor: { value: new THREE.Color(this.lakeConfig.lakeBrightColor) },
      uLakeFrostColor: { value: new THREE.Color(this.lakeConfig.lakeFrostColor) },
      uLakeCrackColor: { value: new THREE.Color(this.lakeConfig.lakeCrackColor) },
      uLakeRoughness: { value: this.lakeConfig.lakeRoughness },
      uLakeMetalness: { value: this.lakeConfig.lakeMetalness },
      uLakeSpecular: { value: this.lakeConfig.lakeSpecular },
      uLakeGlintPower: { value: this.lakeConfig.lakeGlintPower },
      uLakeFresnel: { value: this.lakeConfig.lakeFresnel },
      uLakeFresnelPower: { value: this.lakeConfig.lakeFresnelPower },
      uLakeSSS: { value: this.lakeConfig.lakeSSS },
      uLakeCrackScale: { value: this.lakeConfig.lakeCrackScale },
      uLakeCrackIntensity: { value: this.lakeConfig.lakeCrackIntensity },
      uLakeCrackWidth: { value: this.lakeConfig.lakeCrackWidth },
      uLakeNoiseScale: { value: this.lakeConfig.lakeNoiseScale },
      uLakeNoiseThreshold: { value: this.lakeConfig.lakeNoiseThreshold },
      uLakeNormalRipples: { value: this.lakeConfig.lakeNormalRipples },
    };

    this.sharedMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.80,
      metalness: 0.04,
      envMapIntensity: 0.72,
      flatShading: false,
      side: THREE.DoubleSide,
    });

    this.sharedMaterial.onBeforeCompile = (shader) => {
      // Connect custom uniforms to shader instance
      shader.uniforms.uRockColorMap = this.uniforms.uRockColorMap;
      shader.uniforms.uRockNormalMap = this.uniforms.uRockNormalMap;
      shader.uniforms.uRockRoughnessMap = this.uniforms.uRockRoughnessMap;
      shader.uniforms.uRockAOMap = this.uniforms.uRockAOMap;
      shader.uniforms.uSnowNormalMap = this.uniforms.uSnowNormalMap;
      shader.uniforms.uSnowNormalScale = this.uniforms.uSnowNormalScale;
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.uniforms.uCameraPosition = this.uniforms.uCameraPosition;
      shader.uniforms.uSunDirection = this.uniforms.uSunDirection;

      shader.uniforms.uSunlitSnowColor = this.uniforms.uSunlitSnowColor;
      shader.uniforms.uShadowSnowColor = this.uniforms.uShadowSnowColor;
      shader.uniforms.uCreviceSnowColor = this.uniforms.uCreviceSnowColor;
      shader.uniforms.uSnowSlopeMin = this.uniforms.uSnowSlopeMin;
      shader.uniforms.uSnowSlopeMax = this.uniforms.uSnowSlopeMax;
      shader.uniforms.uPeakScourStart = this.uniforms.uPeakScourStart;
      shader.uniforms.uPeakScourEnd = this.uniforms.uPeakScourEnd;
      shader.uniforms.uPeakScourIntensity = this.uniforms.uPeakScourIntensity;
      shader.uniforms.uSnowRoughness = this.uniforms.uSnowRoughness;
      shader.uniforms.uSSSIntensity = this.uniforms.uSSSIntensity;
      shader.uniforms.uSSSColor = this.uniforms.uSSSColor;
      shader.uniforms.uSheenIntensity = this.uniforms.uSheenIntensity;
      shader.uniforms.uSheenColor = this.uniforms.uSheenColor;
      shader.uniforms.uRockTint = this.uniforms.uRockTint;
      shader.uniforms.uRockRoughnessScale = this.uniforms.uRockRoughnessScale;

      shader.uniforms.uLakeDeepColor = this.uniforms.uLakeDeepColor;
      shader.uniforms.uLakeMidColor = this.uniforms.uLakeMidColor;
      shader.uniforms.uLakeBrightColor = this.uniforms.uLakeBrightColor;
      shader.uniforms.uLakeFrostColor = this.uniforms.uLakeFrostColor;
      shader.uniforms.uLakeCrackColor = this.uniforms.uLakeCrackColor;
      shader.uniforms.uLakeRoughness = this.uniforms.uLakeRoughness;
      shader.uniforms.uLakeMetalness = this.uniforms.uLakeMetalness;
      shader.uniforms.uLakeSpecular = this.uniforms.uLakeSpecular;
      shader.uniforms.uLakeGlintPower = this.uniforms.uLakeGlintPower;
      shader.uniforms.uLakeFresnel = this.uniforms.uLakeFresnel;
      shader.uniforms.uLakeFresnelPower = this.uniforms.uLakeFresnelPower;
      shader.uniforms.uLakeSSS = this.uniforms.uLakeSSS;
      shader.uniforms.uLakeCrackScale = this.uniforms.uLakeCrackScale;
      shader.uniforms.uLakeCrackIntensity = this.uniforms.uLakeCrackIntensity;
      shader.uniforms.uLakeCrackWidth = this.uniforms.uLakeCrackWidth;
      shader.uniforms.uLakeNoiseScale = this.uniforms.uLakeNoiseScale;
      shader.uniforms.uLakeNoiseThreshold = this.uniforms.uLakeNoiseThreshold;
      shader.uniforms.uLakeNormalRipples = this.uniforms.uLakeNormalRipples;

      // Pass world position, normal, and lake attributes from vertex shader
      shader.vertexShader = `
        attribute vec2 aLakeData;
        varying vec2 vLakeData;
        varying vec3 vCustomWorldPos;
        varying vec3 vCustomWorldNorm;
        ${shader.vertexShader}
      `;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `
        #include <worldpos_vertex>
        vCustomWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vCustomWorldNorm = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        vLakeData = aLakeData;
        `
      );

      // Inject uniforms, helper functions, and varyings into fragment shader
      shader.fragmentShader = `
        uniform sampler2D uRockColorMap;
        uniform sampler2D uRockNormalMap;
        uniform sampler2D uRockRoughnessMap;
        uniform sampler2D uRockAOMap;
        uniform sampler2D uSnowNormalMap;
        uniform float uSnowNormalScale;
        uniform float uTime;
        uniform vec3 uCameraPosition;
        uniform vec3 uSunDirection;

        // Snow Dynamic Uniforms
        uniform vec3 uSunlitSnowColor;
        uniform vec3 uShadowSnowColor;
        uniform vec3 uCreviceSnowColor;
        uniform float uSnowSlopeMin;
        uniform float uSnowSlopeMax;
        uniform float uPeakScourStart;
        uniform float uPeakScourEnd;
        uniform float uPeakScourIntensity;
        uniform float uSnowRoughness;
        uniform float uSSSIntensity;
        uniform vec3 uSSSColor;
        uniform float uSheenIntensity;
        uniform vec3 uSheenColor;
        uniform vec3 uRockTint;
        uniform float uRockRoughnessScale;

        // Emerald Lake Ice Uniforms (Live tweakable via LakeMaterialUI)
        uniform vec3 uLakeDeepColor;
        uniform vec3 uLakeMidColor;
        uniform vec3 uLakeBrightColor;
        uniform vec3 uLakeFrostColor;
        uniform vec3 uLakeCrackColor;
        uniform float uLakeRoughness;
        uniform float uLakeMetalness;
        uniform float uLakeSpecular;
        uniform float uLakeGlintPower;
        uniform float uLakeFresnel;
        uniform float uLakeFresnelPower;
        uniform float uLakeSSS;
        uniform float uLakeCrackScale;
        uniform float uLakeCrackIntensity;
        uniform float uLakeCrackWidth;
        uniform float uLakeNoiseScale;
        uniform float uLakeNoiseThreshold;
        uniform float uLakeNormalRipples;

        varying vec2 vLakeData;
        varying vec3 vCustomWorldPos;
        varying vec3 vCustomWorldNorm;

        // Fragment-scope shared variables across chunks
        float g_snowFactor;
        vec3 g_worldSnowN;
        float g_powderCrust;
        vec3 g_blending;
        float g_roughX, g_roughY, g_roughZ;
        vec3 g_nX, g_nY, g_nZ;
        float g_lakeFactor;
        float g_lakeDepth;
        float g_distToCam;
        vec3 g_lakeIceColor;

        // 2D Rotation Helper
        vec2 rotateUV(vec2 uv, float angle) {
          float s = sin(angle);
          float c = cos(angle);
          return mat2(c, -s, s, c) * uv;
        }

        // Fast domain warp
        vec2 warpDomain(vec2 p) {
          return vec2(
            sin(p.y * 0.038 + p.x * 0.022),
            cos(p.x * 0.032 - p.y * 0.026)
          ) * 1.5;
        }

        // Optimized Dual-Frequency Anti-Tiled Rock Sampling (single-pass past 125m)
        void sampleRockPlane(
          vec2 coord,
          float distToCam,
          out vec3 outColor,
          out float outRough,
          out float outAO,
          out vec3 outNormal
        ) {
          vec2 wCoord = coord + warpDomain(coord);

          // Layer 1: Macro frequency (~26m repeat)
          vec2 uv1 = wCoord * 0.038;
          vec3 c1 = texture2D(uRockColorMap, uv1).rgb;
          float r1 = texture2D(uRockRoughnessMap, uv1).r;
          float ao1 = texture2D(uRockAOMap, uv1).r;
          vec3 n1 = texture2D(uRockNormalMap, uv1).xyz * 2.0 - 1.0;

          if (distToCam > 125.0) {
            outColor = c1;
            outRough = r1;
            outAO = ao1;
            outNormal = normalize(n1);
            return;
          }

          // Layer 2: Detuned frequency (~16m repeat, non-harmonic 1.63x ratio, rotated by 37 deg)
          vec2 uv2 = rotateUV(wCoord * 0.062, 0.6458) + vec2(17.3, 41.7);

          vec3 c2 = texture2D(uRockColorMap, uv2).rgb;
          float blendMask = clamp(0.5 + 0.5 * sin(coord.x * 0.042 + coord.y * 0.035), 0.0, 1.0);
          float w2 = (0.35 + 0.30 * blendMask) * (1.0 - smoothstep(95.0, 125.0, distToCam));
          outColor = mix(c1, c2, w2);

          float r2 = texture2D(uRockRoughnessMap, uv2).r;
          outRough = mix(r1, r2, w2);

          float ao2 = texture2D(uRockAOMap, uv2).r;
          outAO = min(ao1, ao2);

          vec3 n2 = texture2D(uRockNormalMap, uv2).xyz * 2.0 - 1.0;
          n2.xy = rotateUV(n2.xy, -0.6458);
          outNormal = normalize(vec3(n1.xy + n2.xy * (0.60 * (1.0 - smoothstep(95.0, 125.0, distToCam))), n1.z));
        }

        ${shader.fragmentShader}
      `;

      // 1. Color modulation with Snow-First Early Exit
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `
        #include <color_fragment>

        float lakeFactor = vLakeData.x;
        float lakeDepth = vLakeData.y;
        g_lakeFactor = lakeFactor;
        g_lakeDepth = lakeDepth;
        float distToCam = length(uCameraPosition - vCustomWorldPos);
        g_distToCam = distToCam;

        // =========================================================================
        // 1. FAST ORGANIC SNOW-ROCK BOUNDARY (Skipped on solid lake ice)
        // =========================================================================
        float snowFactor = 0.0;
        vec3 terrainColor = vec3(0.0);
        vec3 aNormAbs = abs(vCustomWorldNorm);
        vec3 aNorm2 = aNormAbs * aNormAbs;
        vec3 blending = aNorm2 * aNorm2;
        blending = max(blending, vec3(0.0001));
        blending /= (blending.x + blending.y + blending.z);
        g_blending = blending;

        if (lakeFactor < 0.42) {
          vec2 flowUV1 = vCustomWorldPos.xz * 0.022;
          float flow1 = texture2D(uSnowNormalMap, flowUV1).r;
          float flow2 = (distToCam < 160.0)
            ? texture2D(uSnowNormalMap, vCustomWorldPos.xz * 0.055 + vec2(17.3, 31.9)).g
            : flow1;

          // Organic continuous wind-drift perturbation (smooth across screen pixels)
          float organicDrift = (flow1 * 0.60 + flow2 * 0.40 - 0.5) * 0.26;

          float effectiveSlope = vCustomWorldNorm.y + organicDrift;
          float slopeSnow = smoothstep(uSnowSlopeMin, uSnowSlopeMax, effectiveSlope);

          // Alpine mountain peak wind scouring
          float peakScour = smoothstep(uPeakScourStart, uPeakScourEnd, vCustomWorldPos.y) * uPeakScourIntensity;

          snowFactor = clamp(slopeSnow - peakScour, 0.0, 1.0);
          g_snowFactor = snowFactor;

          // =========================================================================
          // 2a. MULTI-SCALE SNOW PERTURBATION & CAVITY AO (Gated by snow presence)
          // =========================================================================
          vec3 worldSnowN = normalize(vCustomWorldNorm);
          vec3 tangentSnowN = vec3(0.0, 0.0, 1.0);
          g_powderCrust = 0.5;

          if (snowFactor > 0.01) {
            vec3 wn = worldSnowN;
            vec3 t = normalize(cross(wn, vec3(0.0, 0.0, 1.0)));
            if (length(t) < 0.1) t = normalize(cross(wn, vec3(1.0, 0.0, 0.0)));
            vec3 b = cross(wn, t);
            mat3 tbn = mat3(t, b, wn);

            // Layer 1: Macro wind sastrugi ridges (broad alpine snow drifts, ~20m-35m)
            vec2 sastrugiDir = vec2(0.848, 0.530);
            vec2 sastrugiCoord = vec2(
              dot(vCustomWorldPos.xz, sastrugiDir) * 0.038,
              dot(vCustomWorldPos.xz, vec2(-sastrugiDir.y, sastrugiDir.x)) * 0.015
            );
            vec3 sMap1 = texture2D(uSnowNormalMap, sastrugiCoord).xyz * 2.0 - 1.0;

            // Layer 2: Meso wind ripples & tracks (~4m-6m, distance-gated past 220m)
            vec2 rippleXY = vec2(0.0);
            float rippleWeight = 1.0 - smoothstep(160.0, 220.0, distToCam);
            if (rippleWeight > 0.001) {
              vec2 rippleCoord = rotateUV(vCustomWorldPos.xz * 0.22, 1.18) + vec2(19.2, 43.7);
              vec3 sMap2 = texture2D(uSnowNormalMap, rippleCoord).xyz * 2.0 - 1.0;
              rippleXY = rotateUV(sMap2.xy, -1.18) * (0.35 * rippleWeight);
            }

            // Layer 3: Micro powder granules (~0.9m-1.2m, distance-gated past 140m where sub-pixel)
            vec2 microXY = vec2(0.0);
            float microWeight = 1.0 - smoothstep(95.0, 140.0, distToCam);
            if (microWeight > 0.001) {
              vec2 microCoord = rotateUV(vCustomWorldPos.xz * 0.95, 2.35) + vec2(47.1, 13.8);
              vec3 sMap3 = texture2D(uSnowNormalMap, microCoord).xyz * 2.0 - 1.0;
              microXY = rotateUV(sMap3.xy, -2.35) * (0.32 * microWeight);
            }

            // Layer 4: Ultra-fine crystalline crust (under player's boots, skipped beyond 38m)
            vec2 fineXY = vec2(0.0);
            float nearWeight = clamp(1.0 - distToCam / 38.0, 0.0, 1.0);
            if (nearWeight > 0.001) {
              vec2 fineCoord = rotateUV(vCustomWorldPos.xz * 2.8, 0.45) + vec2(83.5, 31.2);
              vec3 sMap4 = texture2D(uSnowNormalMap, fineCoord).xyz * 2.0 - 1.0;
              fineXY = rotateUV(sMap4.xy, -0.45) * (0.28 * nearWeight);
            }

            vec2 snowPerturb = (
              sMap1.xy * 0.45 +
              rippleXY +
              microXY +
              fineXY
            ) * uSnowNormalScale;

            tangentSnowN = normalize(vec3(snowPerturb, 1.0));
            worldSnowN = normalize(tbn * tangentSnowN);
            g_powderCrust = clamp((rippleXY.x + microXY.y) * 0.5 + 0.5, 0.0, 1.0);
          }
          g_worldSnowN = worldSnowN;

          vec3 litRockColor = vec3(0.3);

          // =========================================================================
          // 2b. GATED ROCK SAMPLING (Early-exit when snow covers this pixel!)
          // =========================================================================
          if (snowFactor < 0.98) {
            vec3 colX = vec3(0.32), colY = vec3(0.32), colZ = vec3(0.32);
            float roughX = 0.85, roughY = 0.85, roughZ = 0.85;
            float aoX = 1.0, aoY = 1.0, aoZ = 1.0;
            vec3 nX = vec3(0.0, 0.0, 1.0), nY = vec3(0.0, 0.0, 1.0), nZ = vec3(0.0, 0.0, 1.0);

            if (blending.x > 0.03) sampleRockPlane(vCustomWorldPos.zy, distToCam, colX, roughX, aoX, nX);
            if (blending.y > 0.03) sampleRockPlane(vCustomWorldPos.xz, distToCam, colY, roughY, aoY, nY);
            if (blending.z > 0.03) sampleRockPlane(vCustomWorldPos.xy, distToCam, colZ, roughZ, aoZ, nZ);

            g_roughX = roughX; g_roughY = roughY; g_roughZ = roughZ;
            g_nX = nX; g_nY = nY; g_nZ = nZ;

            vec3 rockAlbedo = colX * blending.x + colY * blending.y + colZ * blending.z;
            float rockAO = aoX * blending.x + aoY * blending.y + aoZ * blending.z;

            // Macro Geological Strata & Tone Modulation
            float strata = sin(vCustomWorldPos.y * 0.075 + sin(vCustomWorldPos.x * 0.02) * 1.5) * 0.07;
            float macroWave = sin(vCustomWorldPos.x * 0.012 + vCustomWorldPos.z * 0.009) * cos(vCustomWorldPos.y * 0.014);
            vec3 macroTint = mix(vec3(0.93, 0.96, 1.04), vec3(1.06, 1.01, 0.94), macroWave * 0.5 + 0.5);
            rockAlbedo = rockAlbedo * macroTint * (1.0 + strata);

            litRockColor = rockAlbedo * mix(0.55, 1.0, rockAO) * uRockTint;
          } else {
            g_roughX = 0.82; g_roughY = 0.82; g_roughZ = 0.82;
            g_nX = vec3(0.0, 0.0, 1.0); g_nY = vec3(0.0, 0.0, 1.0); g_nZ = vec3(0.0, 0.0, 1.0);
          }

          // =========================================================================
          // 3. DYNAMIC CHROMATIC SNOW SHADING (Atmospheric Sunlit vs Shadow Color)
          // =========================================================================
          vec3 dynamicSnowAlbedo = litRockColor;
          if (snowFactor > 0.01) {
            float microSun = clamp(dot(worldSnowN, uSunDirection) * 1.5, 0.0, 1.0);
            float cavityAO = clamp(tangentSnowN.z * 0.65 + 0.35, 0.0, 1.0);
            vec3 ambientSnowColor = mix(uShadowSnowColor, uCreviceSnowColor, (1.0 - cavityAO) * 0.60);
            dynamicSnowAlbedo = mix(ambientSnowColor, uSunlitSnowColor, microSun * 0.85 + 0.15);
            dynamicSnowAlbedo *= mix(0.75, 1.0, cavityAO);
          }

          terrainColor = mix(litRockColor, dynamicSnowAlbedo, snowFactor);
        } else {
          g_snowFactor = 0.0;
          g_worldSnowN = vec3(0.0, 1.0, 0.0);
          g_powderCrust = 0.5;
          g_roughX = 0.82; g_roughY = 0.82; g_roughZ = 0.82;
          g_nX = vec3(0.0, 0.0, 1.0); g_nY = vec3(0.0, 0.0, 1.0); g_nZ = vec3(0.0, 0.0, 1.0);
        }

        // =========================================================================
        // 4. FROZEN LAKE GLACIAL ICE (Pure color gradient, zero net crack overlay)
        // =========================================================================

        vec3 lakeIceColor = vec3(0.0);
        if (lakeFactor > 0.001) {
          // Depth color gradient from bright shoreline teal to deep glacial blue-cyan center
          vec3 baseIce = mix(uLakeBrightColor, uLakeMidColor, smoothstep(0.15, 0.60, lakeDepth));
          baseIce = mix(baseIce, uLakeDeepColor, smoothstep(0.55, 0.95, lakeDepth));

          // Shoreline frost rim
          lakeIceColor = mix(uLakeFrostColor, baseIce, smoothstep(0.08, 0.40, lakeFactor));
        }
        g_lakeIceColor = lakeIceColor;

        float iceBlend = smoothstep(0.08, 0.40, lakeFactor);
        diffuseColor.rgb = mix(terrainColor, lakeIceColor, iceBlend);
        `
      );

      // 2. Roughness modulation (Glassy mirror reflection on frozen emerald lake ice)
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `
        #include <roughnessmap_fragment>

        float rockRoughness = clamp(
          (g_roughX * g_blending.x + g_roughY * g_blending.y + g_roughZ * g_blending.z) * uRockRoughnessScale,
          0.05,
          1.0
        );
        float snowSlope = 1.0 - clamp(vCustomWorldNorm.y, 0.0, 1.0);
        float snowRoughness = mix(uSnowRoughness, uSnowRoughness * 0.70, g_powderCrust * 0.4 + snowSlope * 0.6);
        float terrainRoughness = mix(rockRoughness * 0.90 + 0.10, snowRoughness, g_snowFactor);

        // Live tweakable roughness (mirror reflection to frosty matte)
        float iceRoughBlend = smoothstep(0.10, 0.45, g_lakeFactor);
        roughnessFactor = mix(terrainRoughness, uLakeRoughness, iceRoughBlend);
        `
      );

      // 3. Metalness modulation (Boost specular reflection intensity on emerald ice)
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <metalnessmap_fragment>',
        `
        #include <metalnessmap_fragment>

        float iceMetalBlend = smoothstep(0.12, 0.48, g_lakeFactor);
        metalnessFactor = mix(metalnessFactor, uLakeMetalness, iceMetalBlend);
        `
      );

      // 4. Normal mapping with early-gated rock reconstruction and horizontal lake ice
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `
        #include <normal_fragment_maps>

        vec3 viewSnowN = normalize((viewMatrix * vec4(g_worldSnowN, 0.0)).xyz);

        if (g_snowFactor < 0.98) {
          vec3 tPlaneX = vec3(0.0, 0.0, 1.0);
          vec3 bPlaneX = vec3(0.0, 1.0, 0.0);
          vec3 nPlaneX = vec3(sign(vCustomWorldNorm.x), 0.0, 0.0);
          vec3 worldNormX = normalize(g_nX.x * tPlaneX + g_nX.y * bPlaneX + g_nX.z * nPlaneX);

          vec3 tPlaneY = vec3(1.0, 0.0, 0.0);
          vec3 bPlaneY = vec3(0.0, 0.0, 1.0);
          vec3 nPlaneY = vec3(0.0, sign(vCustomWorldNorm.y), 0.0);
          vec3 worldNormY = normalize(g_nY.x * tPlaneY + g_nY.y * bPlaneY + g_nY.z * nPlaneY);

          vec3 tPlaneZ = vec3(1.0, 0.0, 0.0);
          vec3 bPlaneZ = vec3(0.0, 1.0, 0.0);
          vec3 nPlaneZ = vec3(0.0, 0.0, sign(vCustomWorldNorm.z));
          vec3 worldNormZ = normalize(g_nZ.x * tPlaneZ + g_nZ.y * bPlaneZ + g_nZ.z * nPlaneZ);

          vec3 worldRockN = normalize(worldNormX * g_blending.x + worldNormY * g_blending.y + worldNormZ * g_blending.z);
          vec3 viewRockN = normalize((viewMatrix * vec4(worldRockN, 0.0)).xyz);

          normal = normalize(mix(viewRockN, viewSnowN, g_snowFactor));
        } else {
          normal = viewSnowN;
        }

        // On lake ice: smooth horizontal ice normal with subtle frozen ripple
        if (g_lakeFactor > 0.05) {
          float ripX = sin(vCustomWorldPos.x * 2.1 + vCustomWorldPos.z * 1.5);
          float ripZ = cos(vCustomWorldPos.x * 1.6 - vCustomWorldPos.z * 2.3);
          vec2 icePerturb = vec2(ripX, ripZ) * uLakeNormalRipples;
          vec3 worldIceN = normalize(vec3(icePerturb.x, 1.0, icePerturb.y));
          vec3 viewIceN = normalize((viewMatrix * vec4(worldIceN, 0.0)).xyz);
          float iceNormBlend = smoothstep(0.12, 0.50, g_lakeFactor);
          normal = normalize(mix(normal, viewIceN, iceNormBlend));
        }
        `
      );

      // 5. Dynamic illumination: Ice Crystal Glints, Emerald Glancing Sheen & Sun Glare
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `
        if (g_snowFactor > 0.01 && g_lakeFactor < 0.42) {
          vec3 V = normalize(uCameraPosition - vCustomWorldPos);
          vec3 L = normalize(uSunDirection);
          float sunLit = clamp(dot(g_worldSnowN, L) * 1.8, 0.0, 1.0);

          float oneMinusNdotV = 1.0 - clamp(dot(g_worldSnowN, V), 0.0, 1.0);
          float om2 = oneMinusNdotV * oneMinusNdotV;
          float vDotNegL = clamp(dot(V, -L), 0.0, 1.0);
          float forwardTrans = (vDotNegL * vDotNegL * vDotNegL) * om2;
          vec3 sssGlow = uSSSColor * forwardTrans * uSSSIntensity * sunLit;

          float fresnel = om2 * om2;
          vec3 sheenGlow = uSheenColor * fresnel * (uSheenIntensity * (sunLit * 0.7 + 0.3));

          outgoingLight += (sssGlow + sheenGlow) * g_snowFactor;
        }

        // Frozen Emerald Lake: Sharp Sun Glint, Luminous Fresnel Sheen & Subsurface Green Glow
        if (g_lakeFactor > 0.05) {
          vec3 V = normalize(uCameraPosition - vCustomWorldPos);
          vec3 L = normalize(uSunDirection);
          vec3 H = normalize(L + V);
          vec3 worldUp = vec3(0.0, 1.0, 0.0);

          // Direct sun specular glint on mirror ice
          float NdotH = max(0.0, dot(worldUp, H));
          float iceSpecular = pow(NdotH, uLakeGlintPower) * uLakeSpecular;
          vec3 sunSpecGlint = vec3(1.0, 0.98, 0.92) * iceSpecular;

          // Grazing angle Fresnel sheen (luminous emerald glow at glancing angles)
          float NdotV = max(0.0, dot(worldUp, V));
          float fresnel = pow(1.0 - NdotV, uLakeFresnelPower);
          vec3 emeraldSheen = mix(uLakeBrightColor, vec3(0.4, 1.0, 0.8), 0.4) * fresnel * uLakeFresnel;

          // Subsurface crystalline emerald glow
          float sssIce = pow(clamp(dot(V, -L), 0.0, 1.0), 3.0) * (uLakeSSS * g_lakeDepth);
          vec3 iceSSS = uLakeBrightColor * sssIce;

          float iceEffectBlend = smoothstep(0.12, 0.55, g_lakeFactor);
          outgoingLight += (sunSpecGlint + emeraldSheen + iceSSS) * iceEffectBlend;
        }

        #include <opaque_fragment>
        `
      );
    };
  }

  /**
   * Set a specific snow property in real-time without recompiling shaders.
   * @param {string} key
   * @param {*} value
   */
  setSnowProperty(key, value) {
    this.snowConfig[key] = value;
    switch (key) {
      case 'sunlitColor':
        this.uniforms.uSunlitSnowColor.value.set(value);
        break;
      case 'shadowColor':
        this.uniforms.uShadowSnowColor.value.set(value);
        break;
      case 'creviceColor':
        this.uniforms.uCreviceSnowColor.value.set(value);
        break;
      case 'slopeMin':
        this.uniforms.uSnowSlopeMin.value = value;
        break;
      case 'slopeMax':
        this.uniforms.uSnowSlopeMax.value = value;
        break;
      case 'peakScourStart':
        this.uniforms.uPeakScourStart.value = value;
        break;
      case 'peakScourEnd':
        this.uniforms.uPeakScourEnd.value = value;
        break;
      case 'peakScourIntensity':
        this.uniforms.uPeakScourIntensity.value = value;
        break;
      case 'snowNormalScale':
        this.uniforms.uSnowNormalScale.value = value;
        break;
      case 'snowRoughness':
        this.uniforms.uSnowRoughness.value = value;
        break;
      case 'sssIntensity':
        this.uniforms.uSSSIntensity.value = value;
        break;
      case 'sssColor':
        this.uniforms.uSSSColor.value.set(value);
        break;
      case 'sheenIntensity':
        this.uniforms.uSheenIntensity.value = value;
        break;
      case 'sheenColor':
        this.uniforms.uSheenColor.value.set(value);
        break;
      case 'lakeDeepColor':
      case 'lakeMidColor':
      case 'lakeBrightColor':
      case 'lakeFrostColor':
        this.setLakeProperty(key, value);
        break;
    }
  }

  /**
   * Set a specific frozen lake property in real-time without recompiling shaders.
   * @param {string} key
   * @param {*} value
   */
  setLakeProperty(key, value) {
    if (this.lakeConfig[key] !== undefined) {
      this.lakeConfig[key] = value;
    }

    const uniformMap = {
      lakeDeepColor: { uniform: this.uniforms.uLakeDeepColor, isColor: true },
      lakeMidColor: { uniform: this.uniforms.uLakeMidColor, isColor: true },
      lakeBrightColor: { uniform: this.uniforms.uLakeBrightColor, isColor: true },
      lakeFrostColor: { uniform: this.uniforms.uLakeFrostColor, isColor: true },
      lakeCrackColor: { uniform: this.uniforms.uLakeCrackColor, isColor: true },
      lakeRoughness: { uniform: this.uniforms.uLakeRoughness, isColor: false },
      lakeMetalness: { uniform: this.uniforms.uLakeMetalness, isColor: false },
      lakeSpecular: { uniform: this.uniforms.uLakeSpecular, isColor: false },
      lakeGlintPower: { uniform: this.uniforms.uLakeGlintPower, isColor: false },
      lakeFresnel: { uniform: this.uniforms.uLakeFresnel, isColor: false },
      lakeFresnelPower: { uniform: this.uniforms.uLakeFresnelPower, isColor: false },
      lakeSSS: { uniform: this.uniforms.uLakeSSS, isColor: false },
      lakeCrackScale: { uniform: this.uniforms.uLakeCrackScale, isColor: false },
      lakeCrackIntensity: { uniform: this.uniforms.uLakeCrackIntensity, isColor: false },
      lakeCrackWidth: { uniform: this.uniforms.uLakeCrackWidth, isColor: false },
      lakeNoiseScale: { uniform: this.uniforms.uLakeNoiseScale, isColor: false },
      lakeNoiseThreshold: { uniform: this.uniforms.uLakeNoiseThreshold, isColor: false },
      lakeNormalRipples: { uniform: this.uniforms.uLakeNormalRipples, isColor: false },
    };

    const entry = uniformMap[key];
    if (entry && entry.uniform) {
      if (entry.isColor) {
        entry.uniform.value.set(value);
      } else {
        entry.uniform.value = Number(value);
      }
    }
  }

  /**
   * Update full or partial frozen lake material config.
   * @param {Partial<typeof DEFAULT_LAKE_CONFIG>} newConfig
   */
  setLakeConfig(newConfig) {
    for (const [k, v] of Object.entries(newConfig)) {
      this.setLakeProperty(k, v);
    }
  }

  /**
   * Get current active frozen lake material config.
   * @returns {typeof DEFAULT_LAKE_CONFIG}
   */
  getLakeConfig() {
    return { ...this.lakeConfig };
  }

  /**
   * Reset frozen lake material to pristine default parameters.
   */
  resetLakeConfig() {
    this.setLakeConfig(DEFAULT_LAKE_CONFIG);
  }

  /**
   * Update full or partial snow material config.
   * @param {Partial<typeof DEFAULT_SNOW_CONFIG>} newConfig
   */
  setSnowConfig(newConfig) {
    for (const [k, v] of Object.entries(newConfig)) {
      this.setSnowProperty(k, v);
    }
  }

  /**
   * Get current active snow config.
   * @returns {typeof DEFAULT_SNOW_CONFIG}
   */
  getSnowConfig() {
    return { ...this.snowConfig };
  }

  /**
   * Reset snow material to pristine default parameters.
   */
  resetSnowConfig() {
    this.setSnowConfig(DEFAULT_SNOW_CONFIG);
  }

  /**
   * Update rock cliff tint and roughness scale in real time.
   * @param {{ tint?: string, roughnessScale?: number }} rockConfig
   */
  setRockConfig(rockConfig = {}) {
    if (rockConfig.tint) {
      this.uniforms.uRockTint.value.set(rockConfig.tint);
    }
    if (rockConfig.roughnessScale !== undefined) {
      this.uniforms.uRockRoughnessScale.value = Number(rockConfig.roughnessScale);
    }
  }

  /**
   * Per-frame dynamic uniform updates
   * @param {number} time - Elapsed time in seconds
   * @param {THREE.Vector3} cameraPosition - Current camera position
   */
  update(time, cameraPosition) {
    if (this.uniforms.uTime) {
      this.uniforms.uTime.value = time;
    }
    if (this.uniforms.uCameraPosition && cameraPosition) {
      this.uniforms.uCameraPosition.value.copy(cameraPosition);
    }
  }

  getMaterial() {
    return this.sharedMaterial;
  }

  /**
   * Ultra-lightweight material for distant terrain chunks (> 90m).
   * Bypasses heavy triplanar sampling, domain warping, and Voronoi glints.
   * Delivers a 10x fragment shader speedup with zero texture fetches.
   */
  getDistantMaterial() {
    if (!this.sharedDistantMaterial) {
      this.sharedDistantMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0xdce5ed),
        roughness: 0.90,
        metalness: 0.02,
        flatShading: false,
      });
    }
    return this.sharedDistantMaterial;
  }
}
