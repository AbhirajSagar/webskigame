import { DEFAULT_SNOW_CONFIG } from '../terrain/TerrainMaterial.js';

/**
 * Default baseline lighting & atmosphere preset (preserves original snow/fog/IBL defaults).
 */
export const DEFAULT_LIGHTING_CONFIG = {
  label: 'Default',
  subtitle: 'Original twilight skybox',
  badge: 'CLASSIC',
  accent: '#94a3b8',
  thumbnail: '/thumbnails/default.png',
  skybox: {
    mode: 'equirect',
    path: '/skybox_sunset.jpg',
    solidColor: '#c6cdd5',
    backgroundRotationDeg: 0,
  },
  environment: {
    toneMappingExposure: 1.0,
    environmentIntensity: 1.0,
    backgroundIntensity: 1.0,
    backgroundBlurriness: 0.0,
  },
  ambient: {
    enabled: false,
    color: '#d0e2f7',
    intensity: 0.4,
  },
  hemisphere: {
    enabled: false,
    skyColor: '#7b8ec8',
    groundColor: '#d49aa8',
    intensity: 0.8,
  },
  directional: {
    enabled: false,
    color: '#ffbfa8',
    intensity: 1.6,
    azimuthDeg: 155,
    elevationDeg: 16,
    castShadows: true,
  },
  clouds: {
    enabled: false,
    sunColor: '#ffffff',
    skyColor: '#f7faff',
    shadowColor: '#dfe6ef',
  },
  fog: {
    enabled: true,
    color: '#c6cdd5',
    near: 90,
    far: 335,
  },
  snow: {
    sunlitColor: DEFAULT_SNOW_CONFIG.sunlitColor,
    shadowColor: DEFAULT_SNOW_CONFIG.shadowColor,
    creviceColor: DEFAULT_SNOW_CONFIG.creviceColor,
    sssColor: DEFAULT_SNOW_CONFIG.sssColor,
    sssIntensity: DEFAULT_SNOW_CONFIG.sssIntensity,
    sheenColor: DEFAULT_SNOW_CONFIG.sheenColor,
    sheenIntensity: DEFAULT_SNOW_CONFIG.sheenIntensity,
    distantColor: '#dce5ed',
  },
};

/**
 * User-tuned Pastel Sunset preset.
 */
export const PASTEL_SUNSET_LIGHTING_CONFIG = {
  label: 'Pastel Sunset',
  subtitle: 'Cotton-candy dusk glow',
  badge: 'SUNSET',
  accent: '#f472b6',
  thumbnail: '/thumbnails/pastelSunset.png',
  skybox: {
    mode: 'equirect',
    path: '/skybox_pastel_sunset.jpg',
    solidColor: '#c6cdd5',
    backgroundRotationDeg: 0,
  },
  environment: {
    toneMappingExposure: 1.68,
    environmentIntensity: 0,
    backgroundIntensity: 1,
    backgroundBlurriness: 0,
  },
  ambient: {
    enabled: true,
    color: '#fddddd',
    intensity: 3,
  },
  hemisphere: {
    enabled: false,
    skyColor: '#a1add4',
    groundColor: '#d49aa8',
    intensity: 0.7,
  },
  directional: {
    enabled: true,
    color: '#ff990a',
    intensity: 1.05,
    azimuthDeg: 50,
    elevationDeg: 48,
    castShadows: false,
  },
  clouds: {
    enabled: false,
    sunColor: '#ffc2cf',
    skyColor: '#f5b0c8',
    shadowColor: '#9e88b5',
  },
  fog: {
    enabled: true,
    color: '#fec4b9',
    near: 90,
    far: 335,
  },
  snow: {
    sunlitColor: '#ffe0fb',
    shadowColor: '#a8a8a8',
    creviceColor: '#192230',
    sssColor: '#c78a8a',
    sssIntensity: 0.2,
    sheenColor: '#ffffff',
    sheenIntensity: 0.3,
    distantColor: '#dce5ed',
  },
};

export const ALPINE_DAY_LIGHTING_CONFIG = {
  label: 'Alpine Noon',
  subtitle: 'Crisp sun, cobalt shadows & clouds',
  badge: 'CLEAR DAY',
  accent: '#38bdf8',
  thumbnail: '/thumbnails/alpineDay.png',
  skybox: {
    mode: 'equirect',
    path: '/skybox.hdr',
    solidColor: '#c4ddf2',
    backgroundRotationDeg: 180,
  },
  environment: {
    toneMappingExposure: 0.94,
    environmentIntensity: 0.35,
    backgroundIntensity: 0.85,
    backgroundBlurriness: 0.0,
  },
  ambient: {
    enabled: true,
    color: '#b8d8ff',
    intensity: 0.15,
  },
  hemisphere: {
    enabled: true,
    skyColor: '#6fb3ff',
    groundColor: '#7f9bb8',
    intensity: 0.38,
  },
  directional: {
    enabled: true,
    color: '#fff6e5',
    intensity: 1.85,
    azimuthDeg: -125,
    elevationDeg: 40,
    castShadows: true,
  },
  clouds: {
    enabled: true,
    sunColor: '#ffffff',
    skyColor: '#eef5fc',
    shadowColor: '#b4c6dc',
  },
  fog: {
    enabled: true,
    color: '#c4ddf2',
    near: 110,
    far: 360,
  },
  snow: {
    sunlitColor: '#f4f8ff',
    shadowColor: '#2e59a2',
    creviceColor: '#16243b',
    sssColor: '#ffdba8',
    sssIntensity: 0.55,
    sheenColor: '#ffffff',
    sheenIntensity: 0.35,
    distantColor: '#d9e6f2',
  },
};

export const GOLDEN_HOUR_LIGHTING_CONFIG = {
  label: 'Golden Hour',
  subtitle: 'Amber low sun, clouds & long shadows',
  badge: 'GOLDEN',
  accent: '#fb923c',
  thumbnail: '/thumbnails/goldenHour.png',
  skybox: {
    mode: 'equirect',
    path: '/skybox_golden_hour.hdr',
    solidColor: '#d99e8e',
    backgroundRotationDeg: 180,
  },
  environment: {
    toneMappingExposure: 0.96,
    environmentIntensity: 0.25,
    backgroundIntensity: 0.82,
    backgroundBlurriness: 0.0,
  },
  ambient: {
    enabled: true,
    color: '#536299',
    intensity: 0.22,
  },
  hemisphere: {
    enabled: true,
    skyColor: '#6b7bb5',
    groundColor: '#966b6b',
    intensity: 0.42,
  },
  directional: {
    enabled: true,
    color: '#ff983b',
    intensity: 2.35,
    azimuthDeg: -129,
    elevationDeg: 14,
    castShadows: true,
  },
  clouds: {
    enabled: true,
    sunColor: '#ffad66',
    skyColor: '#e89088',
    shadowColor: '#665b8c',
  },
  fog: {
    enabled: true,
    color: '#d99e8e',
    near: 85,
    far: 340,
  },
  snow: {
    sunlitColor: '#ffe2c4',
    shadowColor: '#465082',
    creviceColor: '#222440',
    sssColor: '#ff8c42',
    sssIntensity: 0.85,
    sheenColor: '#ffd0a6',
    sheenIntensity: 0.45,
    distantColor: '#dfb6a8',
  },
};

export const CRIMSON_DUSK_LIGHTING_CONFIG = {
  label: 'Crimson Dusk',
  subtitle: 'Ember horizon & glowing dusk clouds',
  badge: 'EMBER',
  accent: '#fb7185',
  thumbnail: '/thumbnails/crimsonDusk.png',
  skybox: {
    mode: 'equirect',
    path: '/skybox_crimson_dusk.hdr',
    solidColor: '#b36b82',
    backgroundRotationDeg: 180,
  },
  environment: {
    toneMappingExposure: 0.92,
    environmentIntensity: 0.16,
    backgroundIntensity: 0.72,
    backgroundBlurriness: 0.0,
  },
  ambient: {
    enabled: true,
    color: '#4a3b70',
    intensity: 0.26,
  },
  hemisphere: {
    enabled: true,
    skyColor: '#7b568f',
    groundColor: '#6b415a',
    intensity: 0.38,
  },
  directional: {
    enabled: true,
    color: '#ff5e6c',
    intensity: 1.95,
    azimuthDeg: -128,
    elevationDeg: 11,
    castShadows: true,
  },
  clouds: {
    enabled: true,
    sunColor: '#ff707a',
    skyColor: '#cc6088',
    shadowColor: '#483868',
  },
  fog: {
    enabled: true,
    color: '#b36b82',
    near: 75,
    far: 320,
  },
  snow: {
    sunlitColor: '#ffc2cc',
    shadowColor: '#43396b',
    creviceColor: '#1f1938',
    sssColor: '#ff4d6d',
    sssIntensity: 0.75,
    sheenColor: '#ff9eb5',
    sheenIntensity: 0.42,
    distantColor: '#be7f96',
  },
};

export const MISTY_DAWN_LIGHTING_CONFIG = {
  label: 'Misty Dawn',
  subtitle: 'Soft morning haze & drifting clouds',
  badge: 'DAWN',
  accent: '#fdba74',
  thumbnail: '/thumbnails/mistyDawn.png',
  skybox: {
    mode: 'equirect',
    path: '/skybox_misty_dawn.hdr',
    solidColor: '#c7cfd9',
    backgroundRotationDeg: 180,
  },
  environment: {
    toneMappingExposure: 0.94,
    environmentIntensity: 0.28,
    backgroundIntensity: 0.85,
    backgroundBlurriness: 0.0,
  },
  ambient: {
    enabled: true,
    color: '#8aa0bf',
    intensity: 0.30,
  },
  hemisphere: {
    enabled: true,
    skyColor: '#a8bdd6',
    groundColor: '#969aa8',
    intensity: 0.45,
  },
  directional: {
    enabled: true,
    color: '#ffe0ba',
    intensity: 1.35,
    azimuthDeg: -135,
    elevationDeg: 24,
    castShadows: true,
  },
  clouds: {
    enabled: true,
    sunColor: '#fff0dc',
    skyColor: '#d9dde8',
    shadowColor: '#8d9bb0',
  },
  fog: {
    enabled: true,
    color: '#c7cfd9',
    near: 58,
    far: 265,
  },
  snow: {
    sunlitColor: '#fff3e6',
    shadowColor: '#5d6f8c',
    creviceColor: '#2b364a',
    sssColor: '#ffd1a3',
    sssIntensity: 0.50,
    sheenColor: '#ffffff',
    sheenIntensity: 0.32,
    distantColor: '#cfd7e0',
  },
};

export const ARCTIC_WHITEOUT_LIGHTING_CONFIG = {
  label: 'Arctic Whiteout',
  subtitle: 'Overcast storm clouds & dense fog',
  badge: 'STORM',
  accent: '#cbd5e1',
  thumbnail: '/thumbnails/arcticWhiteout.png',
  skybox: {
    mode: 'equirect',
    path: '/skybox_overcast.hdr',
    solidColor: '#aebdca',
    backgroundRotationDeg: 0,
  },
  environment: {
    toneMappingExposure: 0.88,
    environmentIntensity: 0.25,
    backgroundIntensity: 0.82,
    backgroundBlurriness: 0.06,
  },
  ambient: {
    enabled: true,
    color: '#70849c',
    intensity: 0.24,
  },
  hemisphere: {
    enabled: true,
    skyColor: '#9ab0c7',
    groundColor: '#4f6178',
    intensity: 0.52,
  },
  directional: {
    enabled: true,
    color: '#cfe0f2',
    intensity: 0.55,
    azimuthDeg: -120,
    elevationDeg: 34,
    castShadows: false,
  },
  clouds: {
    enabled: true,
    sunColor: '#cfdce8',
    skyColor: '#b3c3d4',
    shadowColor: '#728499',
  },
  fog: {
    enabled: true,
    color: '#aebdca',
    near: 28,
    far: 185,
  },
  snow: {
    sunlitColor: '#dbe6f0',
    shadowColor: '#4e627a',
    creviceColor: '#2a384a',
    sssColor: '#8aa6c4',
    sssIntensity: 0.15,
    sheenColor: '#cfe0f0',
    sheenIntensity: 0.20,
    distantColor: '#b4c3d1',
  },
};

export const NORDIC_BLUE_HOUR_LIGHTING_CONFIG = {
  label: 'Blue Hour',
  subtitle: 'Tranquil Nordic violet-cobalt twilight',
  badge: 'TWILIGHT',
  accent: '#818cf8',
  thumbnail: '/thumbnails/nordicBlueHour.png',
  skybox: {
    mode: 'equirect',
    path: '/skybox_blue_hour.hdr',
    solidColor: '#5c6396',
    backgroundRotationDeg: 180,
  },
  environment: {
    toneMappingExposure: 0.88,
    environmentIntensity: 0.14,
    backgroundIntensity: 0.72,
    backgroundBlurriness: 0.0,
  },
  ambient: {
    enabled: true,
    color: '#3e4c8a',
    intensity: 0.32,
  },
  hemisphere: {
    enabled: true,
    skyColor: '#586cb8',
    groundColor: '#403661',
    intensity: 0.42,
  },
  directional: {
    enabled: true,
    color: '#d49cff',
    intensity: 0.85,
    azimuthDeg: -125,
    elevationDeg: 14,
    castShadows: true,
  },
  clouds: {
    enabled: false,
    sunColor: '#c9a6ff',
    skyColor: '#7078b5',
    shadowColor: '#2d3360',
  },
  fog: {
    enabled: true,
    color: '#5c6396',
    near: 70,
    far: 310,
  },
  snow: {
    sunlitColor: '#c4c8f2',
    shadowColor: '#2e396e',
    creviceColor: '#141938',
    sssColor: '#a685ff',
    sssIntensity: 0.35,
    sheenColor: '#d6d9ff',
    sheenIntensity: 0.38,
    distantColor: '#6770a3',
  },
};

export const MIDNIGHT_MOON_LIGHTING_CONFIG = {
  label: 'Midnight Moon',
  subtitle: 'Starry sky & silver moonlight',
  badge: 'NIGHT',
  accent: '#60a5fa',
  thumbnail: '/thumbnails/midnightMoon.png',
  skybox: {
    mode: 'equirect',
    path: '/skybox_moonlight.hdr',
    solidColor: '#14203b',
    backgroundRotationDeg: 180,
  },
  environment: {
    toneMappingExposure: 0.88,
    environmentIntensity: 0.015,
    backgroundIntensity: 0.95,
    backgroundBlurriness: 0.0,
  },
  ambient: {
    enabled: true,
    color: '#1a2b52',
    intensity: 0.42,
  },
  hemisphere: {
    enabled: true,
    skyColor: '#29447a',
    groundColor: '#0d152b',
    intensity: 0.38,
  },
  directional: {
    enabled: true,
    color: '#9bc2ff',
    intensity: 0.95,
    azimuthDeg: -126,
    elevationDeg: 18,
    castShadows: true,
  },
  clouds: {
    enabled: false,
    sunColor: '#8fb4e8',
    skyColor: '#364d7d',
    shadowColor: '#152242',
  },
  fog: {
    enabled: true,
    color: '#14203b',
    near: 55,
    far: 285,
  },
  snow: {
    sunlitColor: '#8fb3e8',
    shadowColor: '#1b2b52',
    creviceColor: '#0a1024',
    sssColor: '#4d88ff',
    sssIntensity: 0.28,
    sheenColor: '#a8ccff',
    sheenIntensity: 0.38,
    distantColor: '#2a3f6e',
  },
};

export const LIGHTING_PRESETS = {
  default: DEFAULT_LIGHTING_CONFIG,
  pastelSunset: PASTEL_SUNSET_LIGHTING_CONFIG,
  alpineDay: ALPINE_DAY_LIGHTING_CONFIG,
  goldenHour: GOLDEN_HOUR_LIGHTING_CONFIG,
  crimsonDusk: CRIMSON_DUSK_LIGHTING_CONFIG,
  mistyDawn: MISTY_DAWN_LIGHTING_CONFIG,
  arcticWhiteout: ARCTIC_WHITEOUT_LIGHTING_CONFIG,
  nordicBlueHour: NORDIC_BLUE_HOUR_LIGHTING_CONFIG,
  midnightMoon: MIDNIGHT_MOON_LIGHTING_CONFIG,
};

export function cloneLightingPreset(presetId = 'default') {
  const source = LIGHTING_PRESETS[presetId] || DEFAULT_LIGHTING_CONFIG;
  const { label: _label, subtitle: _subtitle, badge: _badge, accent: _accent, thumbnail: _thumbnail, ...config } = source;
  return JSON.parse(JSON.stringify(config));
}
