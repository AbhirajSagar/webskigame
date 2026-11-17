import * as THREE from 'three';

/**
 * GLSL helper functions for RGB <-> HSL conversions and perceptual HSL adjustments.
 * Operates in non-linear sRGB (gamma) space so hue shifts and saturation/lightness curves
 * match standard artist color pickers and human visual perception, before returning to
 * linear space for Three.js PBR lighting calculations.
 */
export const TREE_LEAF_SHADER_GLSL = /* glsl */ `
vec3 leafRgb2Hsl(vec3 c) {
  float maxVal = max(max(c.r, c.g), c.b);
  float minVal = min(min(c.r, c.g), c.b);
  float delta = maxVal - minVal;

  float h = 0.0;
  float s = 0.0;
  float l = (maxVal + minVal) * 0.5;

  if (delta > 1e-5) {
    s = l > 0.5 ? delta / (2.0 - maxVal - minVal) : delta / (maxVal + minVal);

    if (maxVal == c.r) {
      h = (c.g - c.b) / delta + (c.g < c.b ? 6.0 : 0.0);
    } else if (maxVal == c.g) {
      h = (c.b - c.r) / delta + 2.0;
    } else {
      h = (c.r - c.g) / delta + 4.0;
    }
    h /= 6.0;
  }

  return vec3(h, s, l);
}

float leafHue2Rgb(float p, float q, float t) {
  t = fract(t);
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 1.0 / 2.0) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}

vec3 leafHsl2Rgb(vec3 hsl) {
  if (hsl.y <= 1e-5) {
    return vec3(hsl.z);
  }
  float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - (hsl.z * hsl.y);
  float p = 2.0 * hsl.z - q;
  return vec3(
    leafHue2Rgb(p, q, hsl.x + 1.0 / 3.0),
    leafHue2Rgb(p, q, hsl.x),
    leafHue2Rgb(p, q, hsl.x - 1.0 / 3.0)
  );
}

vec3 applyTreeLeafHsl(vec3 linearRgb, float hueShift, float satMultiplier, float lightMultiplier) {
  // Convert linear RGB to sRGB gamma space for perceptually uniform color transforms
  vec3 srgb = pow(max(linearRgb, vec3(0.0)), vec3(1.0 / 2.2));

  vec3 hsl = leafRgb2Hsl(srgb);

  // 1. Hue Shift: wraps smoothly around the color circle [0.0, 1.0]
  hsl.x = fract(hsl.x + hueShift);

  // 2. Saturation Multiplier: 0.0 = desaturated monochrome, 1.0 = normal, >1.0 = boosted vibrance
  hsl.y = clamp(hsl.y * satMultiplier, 0.0, 1.0);

  // 3. Lightness Multiplier: <1.0 = deeper shadow tones, >1.0 = brighter sunlit foliage
  hsl.z = clamp(hsl.z * lightMultiplier, 0.0, 1.0);

  vec3 modifiedSrgb = leafHsl2Rgb(hsl);

  // Return to linear RGB for Three.js PBR lighting & tone mapping pipeline
  return pow(max(modifiedSrgb, vec3(0.0)), vec3(2.2));
}
`;

/**
 * Standard leaf color presets with fine-tuned Hue, Saturation, and Lightness offsets.
 * Can be applied to any tree leaf material using material.applyPreset('name').
 */
export const LEAF_COLOR_PRESETS = {
  // --- Snowy Alpine Mountain Conifers ---
  green: {
    name: 'Subalpine Pine Green',
    hue: -0.01,
    saturation: 0.85,
    lightness: 0.74,
  },
  deepEmerald: {
    name: 'Timberline Black Spruce',
    hue: -0.02,
    saturation: 0.72,
    lightness: 0.60,
  },
  blueSpruce: {
    name: 'Rocky Mountain Blue Spruce',
    hue: 0.16,
    saturation: 0.58,
    lightness: 0.84,
  },
  frostSilver: {
    name: 'Silver Frost Conifer',
    hue: 0.08,
    saturation: 0.38,
    lightness: 0.94,
  },

  // --- Subalpine Winter & Late-Season Foliage ---
  goldenLarch: {
    name: 'Alpine Golden Larch',
    hue: -0.14,
    saturation: 0.82,
    lightness: 0.86,
  },
  autumnOrange: {
    name: 'Winter Russet Bronze Pine',
    hue: -0.18,
    saturation: 0.78,
    lightness: 0.76,
  },
  crimsonMaple: {
    name: 'Winter Alpine Mahogany',
    hue: -0.24,
    saturation: 0.75,
    lightness: 0.70,
  },
  burntSienna: {
    name: 'Frost-Hardened Russet',
    hue: -0.20,
    saturation: 0.74,
    lightness: 0.72,
  },

  // --- High Alpine Crests ---
  springLime: {
    name: 'Mountain Dwarf Pine',
    hue: 0.04,
    saturation: 0.88,
    lightness: 0.82,
  },
  arcticCyan: {
    name: 'Glacial Powder Spruce',
    hue: 0.22,
    saturation: 0.55,
    lightness: 0.88,
  },
};

/**
 * Normalizes hue input (accepts either fractions in [-1, 1] or degrees in [-180, 360]).
 * @param {number} val
 * @returns {number}
 */
export function normalizeHue(val) {
  if (typeof val !== 'number' || isNaN(val)) return 0.0;
  if (Math.abs(val) > 1.0) {
    val = (val / 360.0) % 1.0;
  }
  return ((val % 1.0) + 1.0) % 1.0;
}

/**
 * Injects the Tree Leaf HSL Shader into an existing Three.js material (MeshStandardMaterial or MeshBasicMaterial).
 *
 * @param {THREE.Material} material - The target material to enhance
 * @param {Object} [options={}]
 * @param {number} [options.hue=0.0] - Hue shift in [0, 1] or degrees [0, 360]
 * @param {number} [options.saturation=1.0] - Saturation multiplier (0.0 = mono, 1.0 = normal, >1.0 = vivid)
 * @param {number} [options.lightness=1.0] - Lightness multiplier (<1.0 = darker, >1.0 = brighter)
 * @param {THREE.Vector3|number[]} [options.instanceVariation] - Subtle per-tree random HSL jitter [hue, sat, light]
 * @returns {THREE.Material}
 */
export function applyTreeLeafShader(material, options = {}) {
  if (!material) return material;

  const initialHue = options.hue !== undefined ? normalizeHue(options.hue) : 0.0;
  const initialSat = options.saturation !== undefined ? Math.max(0.0, options.saturation) : 1.0;
  const initialLight = options.lightness !== undefined ? Math.max(0.0, options.lightness) : 1.0;

  let varVec = new THREE.Vector3(0.0, 0.0, 0.0);
  if (options.instanceVariation instanceof THREE.Vector3) {
    varVec.copy(options.instanceVariation);
  } else if (Array.isArray(options.instanceVariation)) {
    varVec.set(
      options.instanceVariation[0] || 0.0,
      options.instanceVariation[1] || 0.0,
      options.instanceVariation[2] || 0.0
    );
  }

  // Uniform container attached to userData for direct runtime manipulation
  const uniforms = {
    uHue: { value: initialHue },
    uSaturation: { value: initialSat },
    uLightness: { value: initialLight },
    uInstanceHslVariation: { value: varVec },
    uSeed: { value: options.seed !== undefined ? Number(options.seed) : 1337.0 },
  };

  material.userData.leafUniforms = uniforms;

  // Custom program cache key ensures Three.js caches the shader program cleanly
  material.customProgramCacheKey = () => 'TreeLeafHslShader';

  const prevOnBeforeCompile = material.onBeforeCompile;

  material.onBeforeCompile = (shader, renderer) => {
    if (typeof prevOnBeforeCompile === 'function') {
      prevOnBeforeCompile(shader, renderer);
    }

    // Connect material uniforms to shader instance
    shader.uniforms.uHue = uniforms.uHue;
    shader.uniforms.uSaturation = uniforms.uSaturation;
    shader.uniforms.uLightness = uniforms.uLightness;
    shader.uniforms.uInstanceHslVariation = uniforms.uInstanceHslVariation;
    shader.uniforms.uSeed = uniforms.uSeed;

    // 1. Vertex Shader Header & Instance Variation
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      /* glsl */ `
      #include <common>
      uniform float uHue;
      uniform float uSaturation;
      uniform float uLightness;
      uniform vec3 uInstanceHslVariation;
      uniform float uSeed;
      varying vec3 vLeafHsl;
      `
    );

    // Compute final HSL per vertex/instance
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      /* glsl */ `
      #include <begin_vertex>
      #ifdef USE_INSTANCING
        // Deterministic pseudo-random jitter derived from tree instance world coordinates and seed
        float instHash = fract(sin(dot(instanceMatrix[3].xyz, vec3(12.9898, 78.233, 45.164)) + uSeed * 0.13371) * 43758.5453);
        vLeafHsl = vec3(
          uHue + (instHash - 0.5) * uInstanceHslVariation.x,
          uSaturation * (1.0 + (fract(instHash * 17.13) - 0.5) * uInstanceHslVariation.y),
          uLightness * (1.0 + (fract(instHash * 31.41) - 0.5) * uInstanceHslVariation.z)
        );
      #else
        vLeafHsl = vec3(uHue, uSaturation, uLightness);
      #endif
      `
    );

    // 2. Fragment Shader Header & Color Functions
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      /* glsl */ `
      #include <common>
      uniform float uHue;
      uniform float uSaturation;
      uniform float uLightness;
      varying vec3 vLeafHsl;

      ${TREE_LEAF_SHADER_GLSL}
      `
    );

    // 3. Fragment Shader Color Transformation: Modifies texture diffuse color in HSL space
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      /* glsl */ `
      #include <map_fragment>
      #if defined( USE_MAP )
        diffuseColor.rgb = applyTreeLeafHsl(diffuseColor.rgb, vLeafHsl.x, vLeafHsl.y, vLeafHsl.z);
      #else
        diffuseColor.rgb = applyTreeLeafHsl(diffuseColor.rgb, vLeafHsl.x, vLeafHsl.y, vLeafHsl.z);
      #endif
      `
    );
  };

  // Provide convenient property accessors directly on the material instance
  Object.defineProperties(material, {
    hue: {
      get() {
        return uniforms.uHue.value;
      },
      set(val) {
        uniforms.uHue.value = normalizeHue(val);
      },
      configurable: true,
    },
    saturation: {
      get() {
        return uniforms.uSaturation.value;
      },
      set(val) {
        uniforms.uSaturation.value = Math.max(0.0, val);
      },
      configurable: true,
    },
    lightness: {
      get() {
        return uniforms.uLightness.value;
      },
      set(val) {
        uniforms.uLightness.value = Math.max(0.0, val);
      },
      configurable: true,
    },
    seed: {
      get() {
        return uniforms.uSeed.value;
      },
      set(val) {
        uniforms.uSeed.value = Number(val) || 0;
      },
      configurable: true,
    },
  });

  material.setHsl = function (h, s, l) {
    if (h !== undefined) this.hue = h;
    if (s !== undefined) this.saturation = s;
    if (l !== undefined) this.lightness = l;
    return this;
  };

  material.applyPreset = function (presetName) {
    const p = LEAF_COLOR_PRESETS[presetName];
    if (p) {
      this.setHsl(p.hue, p.saturation, p.lightness);
    }
    return this;
  };

  material.setInstanceVariation = function (hJitter = 0.0, sJitter = 0.0, lJitter = 0.0) {
    uniforms.uInstanceHslVariation.value.set(hJitter, sJitter, lJitter);
    return this;
  };

  material.needsUpdate = true;
  return material;
}

/**
 * TreeLeafMaterial
 * High-performance PBR material for tree foliage with real-time Hue, Saturation, and Lightness adjustment.
 * Modifies the assigned diffuse texture color directly on the GPU without altering alpha or normal maps.
 */
export class TreeLeafMaterial extends THREE.MeshStandardMaterial {
  /**
   * @param {Object} [parameters={}]
   * @param {number} [parameters.hue=0.0] - Hue shift (0.0 to 1.0 or degrees)
   * @param {number} [parameters.saturation=1.0] - Saturation multiplier
   * @param {number} [parameters.lightness=1.0] - Lightness multiplier
   * @param {THREE.Vector3|number[]} [parameters.instanceVariation] - Subtle per-instance HSL jitter
   * @param {string} [parameters.preset] - Optional preset name from LEAF_COLOR_PRESETS
   */
  constructor(parameters = {}) {
    const {
      hue,
      saturation,
      lightness,
      instanceVariation,
      preset,
      seed,
      ...standardParams
    } = parameters;

    const params = {
      color: 0xffffff,
      roughness: 1.0,
      metalness: 0.0,
      side: THREE.DoubleSide,
      transparent: true,
      alphaTest: 0.40,
      depthWrite: true,
      ...standardParams,
    };

    super(params);

    let h = hue !== undefined ? hue : 0.0;
    let s = saturation !== undefined ? saturation : 1.0;
    let l = lightness !== undefined ? lightness : 1.0;

    if (preset && LEAF_COLOR_PRESETS[preset]) {
      const p = LEAF_COLOR_PRESETS[preset];
      h = p.hue;
      s = p.saturation;
      l = p.lightness;
    }

    applyTreeLeafShader(this, {
      hue: h,
      saturation: s,
      lightness: l,
      instanceVariation,
      seed,
    });
  }

  /**
   * Clones this material while preserving leaf HSL uniforms and settings.
   * @returns {TreeLeafMaterial}
   */
  clone() {
    const cloned = super.clone();
    applyTreeLeafShader(cloned, {
      hue: this.hue,
      saturation: this.saturation,
      lightness: this.lightness,
      instanceVariation: this.userData.leafUniforms?.uInstanceHslVariation?.value,
      seed: this.seed,
    });
    return cloned;
  }
}

/**
 * Factory helper for creating a new TreeLeafMaterial with custom HSL adjustments.
 * @param {Object} [options={}]
 * @returns {TreeLeafMaterial}
 */
export function createTreeLeafMaterial(options = {}) {
  return new TreeLeafMaterial(options);
}
