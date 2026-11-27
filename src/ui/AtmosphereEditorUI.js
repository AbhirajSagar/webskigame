import {
  DEFAULT_PRESET_ID,
  LIGHTING_PRESETS,
  getAllLightingPresets,
  isCustomLightingPreset,
  saveCustomLightingPreset,
  deleteCustomLightingPreset,
} from '../environment/LightingPresets.js';
import { DEFAULT_SNOW_CONFIG, DEFAULT_LAKE_CONFIG } from '../terrain/TerrainMaterial.js';

const SKYBOX_OPTIONS = [
  { label: 'Alpine Noon (.hdr)', value: '/skybox.hdr' },
  { label: 'Pastel Sunset (.jpg)', value: '/skybox_pastel_sunset.jpg' },
  { label: 'Twilight Sunset (.jpg)', value: '/skybox_sunset.jpg' },
];

function getNested(obj, path) {
  return path.split('.').reduce((acc, part) => (acc != null ? acc[part] : undefined), obj);
}

function setNested(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!cur[key] || typeof cur[key] !== 'object') cur[key] = {};
    cur = cur[key];
  }
  cur[parts[parts.length - 1]] = value;
}

function normalizeHexColor(val, fallback = '#ffffff') {
  if (typeof val !== 'string') return fallback;
  const trimmed = val.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed.toLowerCase()}`;
  return fallback;
}

/**
 * AtmosphereEditorUI
 * Live in-game tuner for lighting, skybox, fog, clouds, and snow shader properties,
 * with full JSON import (Load) and clipboard export (Copy Config).
 */
export class AtmosphereEditorUI {
  /**
   * @param {Object} deps
   * @param {import('../environment/LightingManager.js').LightingManager} deps.lightingManager
   * @param {import('../player/PlayerController.js').PlayerController} [deps.player]
   */
  constructor({ lightingManager, player = null, captureThumbnail = null, onPresetsChange = null }) {
    this.lightingManager = lightingManager;
    this.player = player;
    this.captureThumbnail = captureThumbnail;
    this.onPresetsChange = onPresetsChange;
    this.isOpen = false;
    this._bindings = [];
    this._prevMode = 'ski';

    this._createDOM();
    this._bindGlobalEvents();
    this.syncFromManager();
  }

  _createDOM() {
    this.root = document.createElement('div');
    this.root.id = 'atmosphere-editor-root';

    // Stop canvas/player from stealing clicks or keys inside the tuner
    ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'wheel', 'keydown', 'keyup'].forEach((evt) => {
      this.root.addEventListener(evt, (e) => e.stopPropagation());
    });

    // Floating top-right toggle button
    this.toggleBtn = document.createElement('button');
    this.toggleBtn.type = 'button';
    this.toggleBtn.id = 'atmosphere-toggle-btn';
    this.toggleBtn.title = 'Toggle Atmosphere & Snow Inspector (Hotkey: L)';
    this.toggleBtn.innerHTML = `
      <span>Atmosphere</span>
      <span class="ae-hotkey">L</span>
    `;
    this.toggleBtn.addEventListener('click', () => this.toggle());

    // Main inspector panel
    this.panel = document.createElement('aside');
    this.panel.id = 'atmosphere-editor-panel';
    this.panel.style.display = 'none';

    // Header
    const header = document.createElement('div');
    header.className = 'ae-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'ae-title-wrap';
    titleWrap.innerHTML = `<div class="ae-title">Atmosphere Inspector</div>`;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ae-icon-btn';
    closeBtn.title = 'Close (L)';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => this.setOpen(false));

    header.append(titleWrap, closeBtn);

    // Preset bar + Pause toggle
    const presetBar = document.createElement('div');
    presetBar.className = 'ae-preset-bar';

    this.presetSelect = document.createElement('select');
    this.presetSelect.className = 'ae-select';
    this.presetSelect.setAttribute('aria-label', 'Base Preset');
    this._populatePresetSelect();
    this.presetSelect.addEventListener('change', async () => {
      await this.lightingManager.applyPreset(this.presetSelect.value);
      this.syncFromManager();
    });

    this.newBtn = document.createElement('button');
    this.newBtn.type = 'button';
    this.newBtn.className = 'ae-btn ae-btn-accent';
    this.newBtn.textContent = '+ New';
    this.newBtn.title = 'Create and save a new atmosphere config';
    this.newBtn.addEventListener('click', () => this._toggleSaveDrawer(true));

    this.saveBtn = document.createElement('button');
    this.saveBtn.type = 'button';
    this.saveBtn.className = 'ae-btn ae-btn-ghost';
    this.saveBtn.textContent = 'Save';
    this.saveBtn.title = 'Save updates to this custom config';
    this.saveBtn.style.display = 'none';
    this.saveBtn.addEventListener('click', () => this._updateCurrentCustomPreset());

    this.deleteBtn = document.createElement('button');
    this.deleteBtn.type = 'button';
    this.deleteBtn.className = 'ae-btn ae-btn-danger';
    this.deleteBtn.textContent = 'Del';
    this.deleteBtn.title = 'Delete this custom config';
    this.deleteBtn.style.display = 'none';
    this.deleteBtn.addEventListener('click', () => this._deleteCurrentCustomPreset());

    this.resetBtn = document.createElement('button');
    this.resetBtn.type = 'button';
    this.resetBtn.className = 'ae-btn ae-btn-ghost';
    this.resetBtn.textContent = 'Reset';
    this.resetBtn.title = 'Reset to selected base preset';
    this.resetBtn.addEventListener('click', async () => {
      await this.lightingManager.applyPreset(this.lightingManager.activePresetId);
      this.syncFromManager();
    });

    this.pauseBtn = document.createElement('button');
    this.pauseBtn.type = 'button';
    this.pauseBtn.className = 'ae-btn ae-btn-ghost';
    this.pauseBtn.textContent = 'Pause';
    this.pauseBtn.title = 'Freeze camera movement while tuning';
    this.pauseBtn.addEventListener('click', () => {
      if (!this.player) return;
      this.player.setPaused(!this.player.isPaused);
      this._updatePauseBtn();
    });

    presetBar.append(this.presetSelect, this.newBtn, this.saveBtn, this.deleteBtn, this.resetBtn, this.pauseBtn);

    // Inline Save / Create New Config Drawer
    this.saveDrawer = document.createElement('div');
    this.saveDrawer.className = 'ae-save-drawer';
    this.saveDrawer.style.display = 'none';

    const saveTitle = document.createElement('div');
    saveTitle.className = 'ae-save-title';
    saveTitle.textContent = 'Save New Atmosphere Config';

    this.newNameInput = document.createElement('input');
    this.newNameInput.type = 'text';
    this.newNameInput.className = 'ae-save-input';
    this.newNameInput.placeholder = 'Config name (e.g. Sunset Ridge)';
    this.newNameInput.maxLength = 40;

    const saveMetaRow = document.createElement('div');
    saveMetaRow.className = 'ae-save-meta-row';

    this.newSubInput = document.createElement('input');
    this.newSubInput.type = 'text';
    this.newSubInput.className = 'ae-save-input';
    this.newSubInput.placeholder = 'Short description (optional)';
    this.newSubInput.maxLength = 64;

    this.newAccentInput = document.createElement('input');
    this.newAccentInput.type = 'color';
    this.newAccentInput.className = 'ae-color';
    this.newAccentInput.value = '#38bdf8';
    this.newAccentInput.title = 'Card accent color';

    saveMetaRow.append(this.newSubInput, this.newAccentInput);

    this.saveStatus = document.createElement('div');
    this.saveStatus.className = 'ae-json-status';

    const saveActions = document.createElement('div');
    saveActions.className = 'ae-json-actions';

    const confirmSaveBtn = document.createElement('button');
    confirmSaveBtn.type = 'button';
    confirmSaveBtn.className = 'ae-btn ae-btn-primary';
    confirmSaveBtn.textContent = 'Save Config';
    confirmSaveBtn.addEventListener('click', () => this._saveNewPreset());

    const cancelSaveBtn = document.createElement('button');
    cancelSaveBtn.type = 'button';
    cancelSaveBtn.className = 'ae-btn ae-btn-ghost';
    cancelSaveBtn.textContent = 'Cancel';
    cancelSaveBtn.addEventListener('click', () => this._toggleSaveDrawer(false));

    saveActions.append(confirmSaveBtn, cancelSaveBtn);
    this.saveDrawer.append(saveTitle, this.newNameInput, saveMetaRow, this.saveStatus, saveActions);

    // JSON Copy / Load Action Bar
    const jsonBar = document.createElement('div');
    jsonBar.className = 'ae-json-bar';

    this.copyBtn = document.createElement('button');
    this.copyBtn.type = 'button';
    this.copyBtn.className = 'ae-btn ae-btn-primary';
    this.copyBtn.textContent = 'Copy Config JSON';
    this.copyBtn.addEventListener('click', () => this._copyJson());

    this.loadToggleBtn = document.createElement('button');
    this.loadToggleBtn.type = 'button';
    this.loadToggleBtn.className = 'ae-btn ae-btn-secondary';
    this.loadToggleBtn.textContent = 'Load JSON';
    this.loadToggleBtn.addEventListener('click', () => this._toggleJsonDrawer());

    jsonBar.append(this.copyBtn, this.loadToggleBtn);

    // Collapsible JSON Load Drawer
    this.jsonDrawer = document.createElement('div');
    this.jsonDrawer.className = 'ae-json-drawer';
    this.jsonDrawer.style.display = 'none';

    this.jsonTextarea = document.createElement('textarea');
    this.jsonTextarea.className = 'ae-json-textarea';
    this.jsonTextarea.rows = 7;
    this.jsonTextarea.spellcheck = false;
    this.jsonTextarea.placeholder = 'Paste config JSON here...';

    this.jsonStatus = document.createElement('div');
    this.jsonStatus.className = 'ae-json-status';

    const jsonActions = document.createElement('div');
    jsonActions.className = 'ae-json-actions';

    const applyJsonBtn = document.createElement('button');
    applyJsonBtn.type = 'button';
    applyJsonBtn.className = 'ae-btn ae-btn-primary';
    applyJsonBtn.textContent = 'Apply JSON';
    applyJsonBtn.addEventListener('click', () => this._applyPastedJson());

    const fillJsonBtn = document.createElement('button');
    fillJsonBtn.type = 'button';
    fillJsonBtn.className = 'ae-btn ae-btn-ghost';
    fillJsonBtn.textContent = 'Fill Current';
    fillJsonBtn.addEventListener('click', () => {
      this.jsonTextarea.value = JSON.stringify(this._buildExportObject(), null, 2);
      this.jsonStatus.textContent = '';
      this.jsonStatus.className = 'ae-json-status';
    });

    const closeJsonBtn = document.createElement('button');
    closeJsonBtn.type = 'button';
    closeJsonBtn.className = 'ae-btn ae-btn-ghost';
    closeJsonBtn.textContent = 'Close';
    closeJsonBtn.addEventListener('click', () => {
      this.jsonDrawer.style.display = 'none';
    });

    jsonActions.append(applyJsonBtn, fillJsonBtn, closeJsonBtn);
    this.jsonDrawer.append(this.jsonTextarea, this.jsonStatus, jsonActions);

    // Segmented Category Tabs
    this.tabsBar = document.createElement('div');
    this.tabsBar.className = 'ae-tabs';
    this._tabButtons = {};
    this._tabPanes = {};

    // Scrollable controls container
    this.body = document.createElement('div');
    this.body.className = 'ae-body';

    this._buildSections();

    this.panel.append(header, presetBar, this.saveDrawer, jsonBar, this.jsonDrawer, this.tabsBar, this.body);
    this.root.append(this.toggleBtn, this.panel);
    document.body.appendChild(this.root);
  }

  _createTab(id, label, active = false) {
    const tabBtn = document.createElement('button');
    tabBtn.type = 'button';
    tabBtn.className = `ae-tab-btn${active ? ' is-active' : ''}`;
    tabBtn.textContent = label;
    tabBtn.addEventListener('click', () => this._setActiveTab(id));
    this.tabsBar.appendChild(tabBtn);

    const pane = document.createElement('div');
    pane.className = 'ae-tab-pane';
    pane.style.display = active ? 'flex' : 'none';
    this.body.appendChild(pane);

    this._tabButtons[id] = tabBtn;
    this._tabPanes[id] = pane;
    return pane;
  }

  _setActiveTab(id) {
    for (const key of Object.keys(this._tabPanes)) {
      const isMatch = key === id;
      this._tabPanes[key].style.display = isMatch ? 'flex' : 'none';
      this._tabButtons[key].classList.toggle('is-active', isMatch);
    }
  }

  _createGroup(parentPane, title) {
    const group = document.createElement('div');
    group.className = 'ae-group';

    const heading = document.createElement('div');
    heading.className = 'ae-group-title';
    heading.textContent = title;

    group.appendChild(heading);
    parentPane.appendChild(group);
    return group;
  }

  _buildSections() {
    // Tab 1: Sky & Fog
    const skyPane = this._createTab('sky', 'Sky & Fog', true);
    this._createGroup(skyPane, 'Tone Mapping & Exposure').append(
      this._selectControl('Tone Mapping', 'environment.toneMapping', [
        { label: 'ACES Filmic', value: 'aces' },
        { label: 'AgX', value: 'agx' },
        { label: 'Neutral', value: 'neutral' },
        { label: 'Reinhard', value: 'reinhard' },
      ]),
      this._rangeControl('Exposure', 'environment.toneMappingExposure', 0.1, 3.0, 0.01),
      this._rangeControl('IBL Intensity', 'environment.environmentIntensity', 0.0, 3.0, 0.01),
      this._rangeControl('Sky Brightness', 'environment.backgroundIntensity', 0.0, 3.0, 0.01),
      this._rangeControl('Sky Blur', 'environment.backgroundBlurriness', 0.0, 1.0, 0.01)
    );
    this._createGroup(skyPane, 'Skybox & Gradient').append(
      this._selectControl('Mode', 'skybox.mode', [
        { label: 'Equirectangular', value: 'equirect' },
        { label: 'Procedural Gradient', value: 'gradient' },
        { label: 'Solid Color', value: 'solid' },
      ]),
      this._selectControl('Asset', 'skybox.path', SKYBOX_OPTIONS),
      this._textControl('Custom Path', 'skybox.path'),
      this._colorControl('Zenith Color', 'skybox.zenithColor'),
      this._colorControl('Horizon Color', 'skybox.horizonColor'),
      this._colorControl('Ground Color', 'skybox.groundColor'),
      this._colorControl('Sun Halo', 'skybox.sunGlowColor'),
      this._rangeControl('Halo Intensity', 'skybox.sunGlowIntensity', 0.0, 1.5, 0.02, 0.55),
      this._rangeControl('Halo Size', 'skybox.sunGlowSize', 0.05, 0.75, 0.01, 0.22),
      this._colorControl('Solid Color', 'skybox.solidColor'),
      this._rangeControl('Rotation (deg)', 'skybox.backgroundRotationDeg', -180, 180, 1)
    );
    this._createGroup(skyPane, 'Horizon Fog').append(
      this._toggleControl('Enabled', 'fog.enabled'),
      this._selectControl('Type', 'fog.type', [
        { label: 'Linear', value: 'linear' },
        { label: 'Exponential (Exp2)', value: 'exp2' },
      ]),
      this._colorControl('Color', 'fog.color'),
      this._rangeControl('Near', 'fog.near', 0, 400, 1),
      this._rangeControl('Far', 'fog.far', 30, 1200, 5),
      this._rangeControl('Exp2 Density', 'fog.density', 0.0002, 0.025, 0.0002, 0.0042)
    );

    // Tab 2: Lighting
    const lightPane = this._createTab('lighting', 'Lighting', false);
    this._createGroup(lightPane, 'Directional Sun').append(
      this._toggleControl('Enabled', 'directional.enabled'),
      this._toggleControl('Cast Shadows', 'directional.castShadows'),
      this._colorControl('Color', 'directional.color'),
      this._rangeControl('Intensity', 'directional.intensity', 0.0, 6.0, 0.02),
      this._rangeControl('Azimuth (deg)', 'directional.azimuthDeg', -180, 180, 1),
      this._rangeControl('Elevation (deg)', 'directional.elevationDeg', -15, 90, 0.5)
    );
    this._createGroup(lightPane, 'Ambient Fill').append(
      this._toggleControl('Enabled', 'ambient.enabled'),
      this._colorControl('Color', 'ambient.color'),
      this._rangeControl('Intensity', 'ambient.intensity', 0.0, 4.0, 0.01)
    );
    this._createGroup(lightPane, 'Hemisphere Bounce').append(
      this._toggleControl('Enabled', 'hemisphere.enabled'),
      this._colorControl('Sky Color', 'hemisphere.skyColor'),
      this._colorControl('Ground Color', 'hemisphere.groundColor'),
      this._rangeControl('Intensity', 'hemisphere.intensity', 0.0, 3.0, 0.01)
    );
    this._createGroup(lightPane, 'Sun Lens Flare').append(
      this._toggleControl('Enabled', 'lensFlare.enabled'),
      this._rangeControl('Intensity', 'lensFlare.intensity', 0.0, 1.5, 0.02, 0.55),
      this._colorControl('Tint', 'lensFlare.tintColor')
    );

    // Tab 3: Terrain & Materials
    const terrainPane = this._createTab('terrain', 'Terrain', false);
    this._createGroup(terrainPane, 'Snow Colors & Optics').append(
      this._colorControl('Sunlit Snow', 'snow.sunlitColor'),
      this._colorControl('Shadow Snow', 'snow.shadowColor'),
      this._colorControl('Crevice Snow', 'snow.creviceColor'),
      this._colorControl('Distant Snow', 'snow.distantColor'),
      this._colorControl('SSS Tint', 'snow.sssColor'),
      this._rangeControl('SSS Intensity', 'snow.sssIntensity', 0.0, 2.5, 0.01),
      this._colorControl('Sheen Tint', 'snow.sheenColor'),
      this._rangeControl('Sheen Intensity', 'snow.sheenIntensity', 0.0, 2.5, 0.01)
    );
    this._createGroup(terrainPane, 'Snow Surface & Relief').append(
      this._rangeControl('Normal Scale', 'snow.snowNormalScale', 0.0, 10.0, 0.1, DEFAULT_SNOW_CONFIG.snowNormalScale),
      this._rangeControl('Roughness', 'snow.snowRoughness', 0.05, 1.0, 0.01, DEFAULT_SNOW_CONFIG.snowRoughness),
      this._rangeControl('Slope Min', 'snow.slopeMin', 0.0, 0.95, 0.01, DEFAULT_SNOW_CONFIG.slopeMin),
      this._rangeControl('Slope Max', 'snow.slopeMax', 0.05, 1.0, 0.01, DEFAULT_SNOW_CONFIG.slopeMax),
      this._rangeControl('Peak Scour Start', 'snow.peakScourStart', 50, 300, 1, DEFAULT_SNOW_CONFIG.peakScourStart),
      this._rangeControl('Peak Scour End', 'snow.peakScourEnd', 80, 400, 1, DEFAULT_SNOW_CONFIG.peakScourEnd),
      this._rangeControl('Peak Scour Mix', 'snow.peakScourIntensity', 0.0, 1.0, 0.01, DEFAULT_SNOW_CONFIG.peakScourIntensity)
    );
    this._createGroup(terrainPane, 'Rock Cliffs & Ice Lake').append(
      this._colorControl('Rock Tint', 'rock.tint'),
      this._rangeControl('Rock Roughness', 'rock.roughnessScale', 0.2, 1.5, 0.02, 1.0),
      this._colorControl('Lake Deep', 'lake.lakeDeepColor'),
      this._colorControl('Lake Mid', 'lake.lakeMidColor'),
      this._colorControl('Lake Bright', 'lake.lakeBrightColor'),
      this._colorControl('Lake Frost', 'lake.lakeFrostColor'),
      this._rangeControl('Lake Roughness', 'lake.lakeRoughness', 0.04, 0.9, 0.01, DEFAULT_LAKE_CONFIG.lakeRoughness),
      this._rangeControl('Lake Metalness', 'lake.lakeMetalness', 0.0, 0.8, 0.01, DEFAULT_LAKE_CONFIG.lakeMetalness),
      this._rangeControl('Lake Fresnel', 'lake.lakeFresnel', 0.0, 1.0, 0.01, DEFAULT_LAKE_CONFIG.lakeFresnel),
      this._rangeControl('Lake SSS', 'lake.lakeSSS', 0.0, 1.0, 0.01, DEFAULT_LAKE_CONFIG.lakeSSS),
      this._rangeControl('Lake Ripples', 'lake.lakeNormalRipples', 0.0, 0.15, 0.005, DEFAULT_LAKE_CONFIG.lakeNormalRipples)
    );

    // Tab 4: Weather
    const weatherPane = this._createTab('weather', 'Weather', false);
    this._createGroup(weatherPane, 'Volumetric Clouds').append(
      this._toggleControl('Enabled', 'clouds.enabled'),
      this._rangeControl('Opacity', 'clouds.opacity', 0.1, 1.5, 0.02, 1.0),
      this._rangeControl('Altitude Offset', 'clouds.altitudeOffset', -120, 220, 5, 0),
      this._rangeControl('Wind X', 'clouds.windSpeedX', -25, 25, 0.5, 3.2),
      this._rangeControl('Wind Z', 'clouds.windSpeedZ', -25, 25, 0.5, 1.6),
      this._colorControl('Sun Color', 'clouds.sunColor'),
      this._colorControl('Sky Color', 'clouds.skyColor'),
      this._colorControl('Shadow Color', 'clouds.shadowColor')
    );
    this._createGroup(weatherPane, 'Snowfall Particles').append(
      this._toggleControl('Enabled', 'snowfall.enabled'),
      this._rangeControl('Density', 'snowfall.density', 0.05, 1.0, 0.02, 0.65),
      this._rangeControl('Fall Speed', 'snowfall.speed', 1.0, 20.0, 0.25, 6.5),
      this._rangeControl('Flake Size', 'snowfall.size', 0.08, 0.8, 0.02, 0.28),
      this._rangeControl('Opacity', 'snowfall.opacity', 0.1, 1.0, 0.02, 0.72),
      this._rangeControl('Wind X', 'snowfall.windX', -20.0, 20.0, 0.5, 1.8),
      this._rangeControl('Wind Z', 'snowfall.windZ', -20.0, 20.0, 0.5, 0.9),
      this._colorControl('Color', 'snowfall.color')
    );
  }

  _applyFieldChange(path, value) {
    const patch = {};
    setNested(patch, path, value);
    this.lightingManager.applyCustomConfig(patch);
  }

  _rangeControl(labelText, path, min, max, step, fallback = 0) {
    const row = document.createElement('div');
    row.className = 'ae-row ae-row-range';

    const label = document.createElement('label');
    label.className = 'ae-label';
    label.textContent = labelText;

    const controls = document.createElement('div');
    controls.className = 'ae-range-controls';

    const range = document.createElement('input');
    range.type = 'range';
    range.className = 'ae-range';
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);

    const num = document.createElement('input');
    num.type = 'number';
    num.className = 'ae-num';
    num.step = String(step);

    const onUpdate = (raw) => {
      const val = Number(raw);
      if (!Number.isFinite(val)) return;
      range.value = String(Math.min(max, Math.max(min, val)));
      num.value = String(val);
      this._applyFieldChange(path, val);
    };

    range.addEventListener('input', () => onUpdate(range.value));
    num.addEventListener('input', () => {
      if (num.value === '' || num.value === '-') return;
      onUpdate(num.value);
    });

    controls.append(range, num);
    row.append(label, controls);

    this._bindings.push(() => {
      const raw = getNested(this.lightingManager.state, path);
      const val = Number.isFinite(Number(raw)) ? Number(raw) : fallback;
      range.value = String(Math.min(max, Math.max(min, val)));
      num.value = String(val);
    });

    return row;
  }

  _colorControl(labelText, path) {
    const row = document.createElement('div');
    row.className = 'ae-row';

    const label = document.createElement('label');
    label.className = 'ae-label';
    label.textContent = labelText;

    const controls = document.createElement('div');
    controls.className = 'ae-color-controls';

    const picker = document.createElement('input');
    picker.type = 'color';
    picker.className = 'ae-color';

    const hex = document.createElement('input');
    hex.type = 'text';
    hex.className = 'ae-hex';
    hex.maxLength = 7;

    picker.addEventListener('input', () => {
      hex.value = picker.value.toLowerCase();
      this._applyFieldChange(path, picker.value.toLowerCase());
    });

    hex.addEventListener('input', () => {
      const v = hex.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) {
        picker.value = v.toLowerCase();
        this._applyFieldChange(path, v.toLowerCase());
      }
    });

    hex.addEventListener('blur', () => {
      hex.value = picker.value.toLowerCase();
    });

    controls.append(picker, hex);
    row.append(label, controls);

    this._bindings.push(() => {
      const val = normalizeHexColor(getNested(this.lightingManager.state, path), '#ffffff');
      picker.value = val;
      hex.value = val;
    });

    return row;
  }

  _toggleControl(labelText, path) {
    const row = document.createElement('label');
    row.className = 'ae-row ae-row-toggle';

    const label = document.createElement('span');
    label.className = 'ae-label';
    label.textContent = labelText;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'ae-switch';
    checkbox.addEventListener('change', () => {
      this._applyFieldChange(path, checkbox.checked);
    });

    row.append(label, checkbox);

    this._bindings.push(() => {
      checkbox.checked = Boolean(getNested(this.lightingManager.state, path));
    });

    return row;
  }

  _selectControl(labelText, path, options) {
    const row = document.createElement('div');
    row.className = 'ae-row';

    const label = document.createElement('label');
    label.className = 'ae-label';
    label.textContent = labelText;

    const select = document.createElement('select');
    select.className = 'ae-select ae-select-inline';
    for (const optDef of options) {
      const opt = document.createElement('option');
      opt.value = optDef.value;
      opt.textContent = optDef.label;
      select.appendChild(opt);
    }

    select.addEventListener('change', () => {
      this._applyFieldChange(path, select.value);
      this.syncFromManager();
    });

    row.append(label, select);

    this._bindings.push(() => {
      const val = getNested(this.lightingManager.state, path);
      if (options.some((o) => o.value === val)) {
        select.value = val;
      }
    });

    return row;
  }

  _textControl(labelText, path) {
    const row = document.createElement('div');
    row.className = 'ae-row';

    const label = document.createElement('label');
    label.className = 'ae-label';
    label.textContent = labelText;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ae-text-input';
    input.addEventListener('change', () => {
      const val = input.value.trim();
      if (val) {
        this._applyFieldChange(path, val);
        this.syncFromManager();
      }
    });

    row.append(label, input);

    this._bindings.push(() => {
      const val = getNested(this.lightingManager.state, path);
      input.value = val != null ? String(val) : '';
    });

    return row;
  }

  _buildExportObject() {
    const cfg = this.lightingManager.exportConfig();
    const matSnow = this.lightingManager.terrainManager?.materialFactory?.getSnowConfig?.();
    if (matSnow) {
      cfg.snow = {
        ...cfg.snow,
        slopeMin: matSnow.slopeMin,
        slopeMax: matSnow.slopeMax,
        peakScourStart: matSnow.peakScourStart,
        peakScourEnd: matSnow.peakScourEnd,
        peakScourIntensity: matSnow.peakScourIntensity,
        snowNormalScale: matSnow.snowNormalScale,
        snowRoughness: matSnow.snowRoughness,
      };
    }
    return cfg;
  }

  async _copyJson() {
    const json = JSON.stringify(this._buildExportObject(), null, 2);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json);
      } else {
        throw new Error('Clipboard unavailable');
      }
    } catch {
      this.jsonDrawer.style.display = 'flex';
      this.jsonTextarea.value = json;
      this.jsonTextarea.focus();
      this.jsonTextarea.select();
    }
    const prev = this.copyBtn.textContent;
    this.copyBtn.textContent = 'Copied!';
    this.copyBtn.classList.add('is-copied');
    setTimeout(() => {
      this.copyBtn.textContent = prev;
      this.copyBtn.classList.remove('is-copied');
    }, 1400);
  }

  _toggleJsonDrawer() {
    const show = this.jsonDrawer.style.display === 'none';
    this.jsonDrawer.style.display = show ? 'flex' : 'none';
    if (show) {
      this.jsonTextarea.value = JSON.stringify(this._buildExportObject(), null, 2);
      this.jsonStatus.textContent = '';
      this.jsonStatus.className = 'ae-json-status';
      this.jsonTextarea.focus();
    }
  }

  async _applyPastedJson() {
    try {
      const parsed = JSON.parse(this.jsonTextarea.value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Config must be a JSON object');
      }
      await this.lightingManager.applyCustomConfig(parsed, { immediateRebake: true });
      this.syncFromManager();
      this.jsonStatus.textContent = 'Applied JSON config!';
      this.jsonStatus.className = 'ae-json-status is-ok';
    } catch (err) {
      this.jsonStatus.textContent = `Invalid JSON: ${err.message}`;
      this.jsonStatus.className = 'ae-json-status is-err';
    }
  }

  _updatePauseBtn() {
    if (!this.pauseBtn || !this.player) return;
    const paused = Boolean(this.player.isPaused);
    this.pauseBtn.textContent = paused ? 'Resume' : 'Pause';
    this.pauseBtn.classList.toggle('is-active', paused);
  }

  _bindGlobalEvents() {
    window.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'l' || e.key === 'L') {
        const overlay = document.getElementById('loading-overlay');
        if (overlay && getComputedStyle(overlay).display !== 'none') return;
        this.toggle();
      }
    });
  }

  _populatePresetSelect() {
    if (!this.presetSelect) return;
    this.presetSelect.innerHTML = '';

    const all = getAllLightingPresets();
    const builtInGroup = document.createElement('optgroup');
    builtInGroup.label = 'Built-in';
    const customGroup = document.createElement('optgroup');
    customGroup.label = 'Saved Custom';

    for (const [id, cfg] of Object.entries(all)) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = cfg.label || id;
      if (LIGHTING_PRESETS[id]) {
        builtInGroup.appendChild(opt);
      } else {
        customGroup.appendChild(opt);
      }
    }

    this.presetSelect.appendChild(builtInGroup);
    if (customGroup.children.length > 0) {
      this.presetSelect.appendChild(customGroup);
    }
  }

  _toggleSaveDrawer(forceState = null) {
    const show = forceState !== null ? Boolean(forceState) : this.saveDrawer.style.display === 'none';
    this.saveDrawer.style.display = show ? 'flex' : 'none';
    if (show) {
      this.saveStatus.textContent = '';
      this.saveStatus.className = 'ae-json-status';
      this.newAccentInput.value = normalizeHexColor(
        this.lightingManager.state.fog?.color || this.lightingManager.state.directional?.color,
        '#38bdf8'
      );
      this.newNameInput.focus();
    }
  }

  _safeCaptureThumbnail() {
    if (typeof this.captureThumbnail !== 'function') return '';
    try {
      return this.captureThumbnail() || '';
    } catch {
      return '';
    }
  }

  async _saveNewPreset() {
    const name = this.newNameInput.value.trim();
    if (!name) {
      this.saveStatus.textContent = 'Please enter a config name.';
      this.saveStatus.className = 'ae-json-status is-err';
      this.newNameInput.focus();
      return;
    }

    const config = this._buildExportObject();
    const thumbnail = this._safeCaptureThumbnail();
    const { id } = saveCustomLightingPreset({
      label: name,
      subtitle: this.newSubInput.value.trim(),
      accent: this.newAccentInput.value,
      thumbnail,
      config,
    });

    this.lightingManager.activePresetId = id;
    this._populatePresetSelect();
    this.syncFromManager();
    this.onPresetsChange?.();

    this.newNameInput.value = '';
    this.newSubInput.value = '';
    this.saveStatus.textContent = `Saved "${name}"!`;
    this.saveStatus.className = 'ae-json-status is-ok';
    setTimeout(() => {
      if (this.saveDrawer.style.display !== 'none') {
        this._toggleSaveDrawer(false);
      }
    }, 850);
  }

  _updateCurrentCustomPreset() {
    const activeId = this.lightingManager.activePresetId;
    if (!isCustomLightingPreset(activeId)) return;

    const currentMeta = getAllLightingPresets()[activeId];
    const config = this._buildExportObject();
    const thumbnail = this._safeCaptureThumbnail() || currentMeta?.thumbnail || '';
    saveCustomLightingPreset({
      id: activeId,
      label: currentMeta?.label || activeId,
      subtitle: currentMeta?.subtitle || '',
      accent: currentMeta?.accent || '#38bdf8',
      thumbnail,
      config,
    });
    this.onPresetsChange?.();

    const prev = this.saveBtn.textContent;
    this.saveBtn.textContent = 'Saved!';
    this.saveBtn.classList.add('is-copied');
    setTimeout(() => {
      this.saveBtn.textContent = prev;
      this.saveBtn.classList.remove('is-copied');
    }, 1200);
  }

  async _deleteCurrentCustomPreset() {
    const activeId = this.lightingManager.activePresetId;
    if (!isCustomLightingPreset(activeId)) return;
    deleteCustomLightingPreset(activeId);
    await this.lightingManager.applyPreset(DEFAULT_PRESET_ID);
    this._populatePresetSelect();
    this.syncFromManager();
    this.onPresetsChange?.();
  }

  syncFromManager() {
    this._populatePresetSelect();
    const activeId = this.lightingManager.activePresetId;
    if (this.presetSelect) {
      this.presetSelect.value = activeId;
    }
    const isCustom = isCustomLightingPreset(activeId);
    if (this.saveBtn) this.saveBtn.style.display = isCustom ? 'inline-flex' : 'none';
    if (this.deleteBtn) this.deleteBtn.style.display = isCustom ? 'inline-flex' : 'none';

    for (const updateFn of this._bindings) {
      updateFn();
    }
    this._updatePauseBtn();
  }

  setOpen(open, { startNewConfig = false } = {}) {
    const nextOpen = Boolean(open);
    if (nextOpen === this.isOpen) {
      if (nextOpen && startNewConfig) {
        this._toggleSaveDrawer(true);
      }
      return;
    }

    this.isOpen = nextOpen;
    this.panel.style.display = this.isOpen ? 'flex' : 'none';
    this.toggleBtn.classList.toggle('is-open', this.isOpen);

    if (this.isOpen) {
      if (this.player) {
        this._prevMode = this.player.mode || 'ski';
        this.player.suppressPointerLock = true;
        if (this.player.isPaused) {
          this.player.setPaused(false);
        }
        this.player.setMode('fly');
      }
      this.syncFromManager();
      if (startNewConfig) {
        this._toggleSaveDrawer(true);
      }
      try {
        if (document.pointerLockElement) {
          document.exitPointerLock?.();
        }
      } catch {}
    } else if (this.player) {
      this.player.suppressPointerLock = false;
      this.player.setMode(this._prevMode || 'ski');
    }
  }

  toggle() {
    this.setOpen(!this.isOpen);
  }
}
