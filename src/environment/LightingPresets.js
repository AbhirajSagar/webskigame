const CUSTOM_PRESETS_STORAGE_KEY = 'webski_custom_atmospheres_v1';

export const GOLDEN_HOUR_LIGHTING_CONFIG = {
  label: 'Golden Hour',
  subtitle: 'Warm amber glow & pastel dusk',
  badge: 'GOLDEN',
  accent: '#fbbf24',
  thumbnail: '/thumbnails/goldenHour.jpg',
  skybox: {
    zenithColor: '#1d4ed8',
    horizonColor: '#fde68a',
    groundColor: '#334155',
    sunGlowColor: '#fffbeb',
    sunGlowIntensity: 0.58,
    sunGlowSize: 0.22,
    mode: 'equirect',
    path: '/skybox_pastel_sunset.jpg',
    solidColor: '#f5b8c2',
    backgroundRotationDeg: 0,
  },
  environment: {
    toneMapping: 'aces',
    toneMappingExposure: 1.1,
    environmentIntensity: 1.61,
    backgroundIntensity: 1.09,
    backgroundBlurriness: 0,
  },
  ambient: {
    enabled: true,
    color: '#6f501b',
    intensity: 2.4,
  },
  hemisphere: {
    enabled: false,
    skyColor: '#f5a6ca',
    groundColor: '#52497a',
    intensity: 0.44,
  },
  directional: {
    enabled: true,
    color: '#cf994f',
    intensity: 1.38,
    azimuthDeg: 61,
    elevationDeg: 69.5,
    castShadows: true,
  },
  clouds: {
    opacity: 0.68,
    altitudeOffset: -75,
    windSpeedX: 3.2,
    windSpeedZ: 1.6,
    enabled: true,
    sunColor: '#ffe5eb',
    skyColor: '#fe7cbb',
    shadowColor: '#ff9f1a',
  },
  fog: {
    type: 'linear',
    density: 0.0042,
    enabled: true,
    color: '#f5ab9e',
    near: 80,
    far: 235,
  },
  snow: {
    sunlitColor: '#ffdbf0',
    shadowColor: '#524e88',
    creviceColor: '#231f42',
    sssColor: '#ff8da6',
    sssIntensity: 0.82,
    sheenColor: '#ffd4eb',
    sheenIntensity: 0.36,
    distantColor: '#f0b8c4',
    snowNormalScale: 6.1,
    snowRoughness: 0.75,
    slopeMin: 0.52,
    slopeMax: 0.74,
    peakScourStart: 150,
    peakScourEnd: 210,
    peakScourIntensity: 0.36,
  },
  lensFlare: {
    enabled: false,
    intensity: 0.55,
    tintColor: '#ffffff',
  },
  snowfall: {
    enabled: true,
    density: 0.31,
    speed: 4.5,
    size: 0.48,
    opacity: 0.8,
    windX: 1.8,
    windZ: 0.9,
    color: '#ffffff',
  },
  rock: {
    tint: '#ffffff',
    roughnessScale: 1,
  },
  lake: {
    lakeDeepColor: '#005872',
    lakeMidColor: '#0e7e8b',
    lakeBrightColor: '#12a4c5',
    lakeFrostColor: '#80eec5',
    lakeRoughness: 0.24,
    lakeMetalness: 0.06,
    lakeFresnel: 0.22,
    lakeSSS: 0.22,
    lakeNormalRipples: 0.025,
  },
};

export const ALPINE_DAY_LIGHTING_CONFIG = {
  label: 'Alpine Noon',
  subtitle: 'Crisp sun, cobalt shadows & clouds',
  badge: 'BLUEBIRD',
  accent: '#38bdf8',
  thumbnail: '/thumbnails/alpineDay.jpg',
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
    near: 75,
    far: 230,
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

export const LIGHTING_PRESETS = {
  alpineDay: ALPINE_DAY_LIGHTING_CONFIG,
  goldenHour: GOLDEN_HOUR_LIGHTING_CONFIG,
};

export const DEFAULT_PRESET_ID = 'alpineDay';

function readCustomPresetsStorage() {
  try {
    const raw = window.localStorage?.getItem(CUSTOM_PRESETS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeCustomPresetsStorage(presetsObj) {
  try {
    window.localStorage?.setItem(CUSTOM_PRESETS_STORAGE_KEY, JSON.stringify(presetsObj));
  } catch (err) {
    console.warn('Failed to persist custom presets:', err);
  }
}

export function getCustomLightingPresets() {
  return readCustomPresetsStorage();
}

export function getAllLightingPresets() {
  return {
    ...LIGHTING_PRESETS,
    ...readCustomPresetsStorage(),
  };
}

export function isCustomLightingPreset(presetId) {
  if (!presetId || LIGHTING_PRESETS[presetId]) return false;
  const custom = readCustomPresetsStorage();
  return Boolean(custom[presetId]);
}

export function getLightingPreset(presetId) {
  const all = getAllLightingPresets();
  return all[presetId] || null;
}

export function slugifyPresetId(name) {
  const base = String(name || 'custom')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'custom';
  return `custom_${base}`;
}

export function saveCustomLightingPreset({ id = null, label, subtitle = '', accent = '#38bdf8', thumbnail = '', config }) {
  const custom = readCustomPresetsStorage();
  const cleanLabel = String(label || 'Custom Atmosphere').trim() || 'Custom Atmosphere';

  let resolvedId = id && !LIGHTING_PRESETS[id] ? id : slugifyPresetId(cleanLabel);
  if (!id && custom[resolvedId]) {
    let suffix = 2;
    while (custom[`${resolvedId}_${suffix}`]) suffix++;
    resolvedId = `${resolvedId}_${suffix}`;
  }

  const cleanConfig = JSON.parse(JSON.stringify(config || cloneLightingPreset(DEFAULT_PRESET_ID)));
  custom[resolvedId] = {
    label: cleanLabel,
    subtitle: String(subtitle || '').trim() || 'Custom atmosphere preset',
    badge: 'CUSTOM',
    accent: accent || '#38bdf8',
    thumbnail: thumbnail || custom[resolvedId]?.thumbnail || '',
    isCustom: true,
    ...cleanConfig,
  };

  writeCustomPresetsStorage(custom);
  return { id: resolvedId, preset: custom[resolvedId] };
}

export function deleteCustomLightingPreset(presetId) {
  if (!presetId || LIGHTING_PRESETS[presetId]) return false;
  const custom = readCustomPresetsStorage();
  if (!custom[presetId]) return false;
  delete custom[presetId];
  writeCustomPresetsStorage(custom);
  return true;
}

const DEFAULT_EXTRAS = {
  skybox: {
    zenithColor: '#1d4ed8',
    horizonColor: '#fde68a',
    groundColor: '#334155',
    sunGlowColor: '#fffbeb',
    sunGlowIntensity: 0.55,
    sunGlowSize: 0.22,
  },
  environment: {
    toneMapping: 'aces',
  },
  clouds: {
    opacity: 1.0,
    altitudeOffset: 0,
    windSpeedX: 3.2,
    windSpeedZ: 1.6,
  },
  fog: {
    type: 'linear',
    density: 0.0042,
  },
  lensFlare: {
    enabled: false,
    intensity: 0.55,
    tintColor: '#ffffff',
  },
  snowfall: {
    enabled: false,
    density: 0.65,
    speed: 6.5,
    size: 0.28,
    opacity: 0.72,
    windX: 1.8,
    windZ: 0.9,
    color: '#ffffff',
  },
  rock: {
    tint: '#ffffff',
    roughnessScale: 1.0,
  },
  lake: {
    lakeDeepColor: '#005872',
    lakeMidColor: '#0e7e8b',
    lakeBrightColor: '#12a4c5',
    lakeFrostColor: '#80eec5',
    lakeRoughness: 0.24,
    lakeMetalness: 0.06,
    lakeFresnel: 0.22,
    lakeSSS: 0.22,
    lakeNormalRipples: 0.025,
  },
};

export function cloneLightingPreset(presetId = DEFAULT_PRESET_ID) {
  const all = getAllLightingPresets();
  const source = all[presetId] || all[DEFAULT_PRESET_ID] || ALPINE_DAY_LIGHTING_CONFIG;
  const {
    label: _label,
    subtitle: _subtitle,
    badge: _badge,
    accent: _accent,
    thumbnail: _thumbnail,
    isCustom: _isCustom,
    ...rawConfig
  } = source;
  const config = JSON.parse(JSON.stringify(rawConfig));
  for (const [section, defaults] of Object.entries(DEFAULT_EXTRAS)) {
    config[section] = { ...defaults, ...(config[section] || {}) };
  }
  return config;
}
