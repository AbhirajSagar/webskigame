import * as THREE from 'three';

/**
 * TerrainMaterialFactory
 * Creates a PBR terrain material using custom shader injection (onBeforeCompile).
 * Blends base geological rock into high-elevation snow, using the user-provided
 * snow normal map to create tangible physical depth, wind ridges, and snow-drift relief.
 */
export class TerrainMaterialFactory {
  constructor() {
    const textureLoader = new THREE.TextureLoader();
    this.snowNormalMap = textureLoader.load('/textures/snow_normal.jpg');
    this.snowNormalMap.wrapS = THREE.RepeatWrapping;
    this.snowNormalMap.wrapT = THREE.RepeatWrapping;

    this.sharedMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.82,
      metalness: 0.04,
      flatShading: false,
    });

    this.sharedMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uSnowNormalMap = { value: this.snowNormalMap };
      // Normal scale: higher values accentuate crisp shadows and deep drift crevices
      shader.uniforms.uSnowNormalScale = { value: 2.2 };

      // Pass world position and normal from vertex shader
      shader.vertexShader = `
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
        `
      );

      // Inject uniforms and varyings into fragment shader
      shader.fragmentShader = `
        uniform sampler2D uSnowNormalMap;
        uniform float uSnowNormalScale;
        varying vec3 vCustomWorldPos;
        varying vec3 vCustomWorldNorm;
        ${shader.fragmentShader}
      `;

      // 1. Color modulation: Natural stone base in valleys, pure crisp snow on mountains
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `
        #include <color_fragment>
        float snowElevation = smoothstep(24.0, 42.0, vCustomWorldPos.y);
        float snowSlope = smoothstep(0.30, 0.62, vCustomWorldNorm.y);
        float snowFactor = clamp(snowElevation * snowSlope, 0.0, 1.0);

        // Valley and lowland base rock vs alpine snow
        vec3 baseRockColor = vec3(0.48, 0.51, 0.55);
        vec3 snowColor = vec3(0.96, 0.98, 1.0);
        diffuseColor.rgb = mix(baseRockColor, snowColor, snowFactor);
        `
      );

      // 2. Roughness modulation: Snow has soft micro-facet scattering
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `
        #include <roughnessmap_fragment>
        roughnessFactor = mix(0.88, 0.74, snowFactor);
        `
      );

      // 3. Normal mapping: Apply snow normal map to sculpt depth on the snow surface
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `
        #include <normal_fragment_maps>
        if (snowFactor > 0.005) {
          // World tangent frame for planar XZ mapping
          vec3 wn = normalize(vCustomWorldNorm);
          vec3 t = normalize(cross(wn, vec3(0.0, 0.0, 1.0)));
          if (length(t) < 0.1) t = normalize(cross(wn, vec3(1.0, 0.0, 0.0)));
          vec3 b = cross(wn, t);
          mat3 tbn = mat3(t, b, wn);

          // Sample normal map at dual scales:
          // 1. Macro drifts (tiled ~8m)
          // 2. Micro crust ridges (tiled ~2.8m)
          vec2 uvMacro = vCustomWorldPos.xz * 0.125;
          vec2 uvMicro = vCustomWorldPos.xz * 0.355;

          vec3 nMap1 = texture2D(uSnowNormalMap, uvMacro).xyz * 2.0 - 1.0;
          vec3 nMap2 = texture2D(uSnowNormalMap, uvMicro).xyz * 2.0 - 1.0;

          // Scale XY perturbations to accentuate depth
          vec2 combinedPerturbation = (nMap1.xy + nMap2.xy * 0.6) * uSnowNormalScale;
          vec3 tangentSnowN = normalize(vec3(combinedPerturbation, nMap1.z));

          // Transform tangent normal to world space
          vec3 worldSnowN = normalize(tbn * tangentSnowN);

          // Transform to view space for Three.js PBR lighting
          vec3 viewSnowN = normalize((viewMatrix * vec4(worldSnowN, 0.0)).xyz);

          // Blend into surface normal proportional to snow depth
          normal = normalize(mix(normal, viewSnowN, snowFactor));
        }
        `
      );
    };
  }

  getMaterial() {
    return this.sharedMaterial;
  }
}
