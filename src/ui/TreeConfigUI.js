import * as THREE from 'three';
import { DEFAULT_SNOW_CONFIG } from '../terrain/TerrainMaterial.js';

/**
 * SnowMaterialTunerUI (formerly TreeConfigUI)
 * Interactive live tuner allowing instant real-time tweaking of:
 * - Snow Material (Colors, slopes, wind scour, roughness, sastrugi bump, crystal sparkles, SSS, sheen)
 * With one-click JSON copy and instant 60 FPS uniform updates.
 */
export class TreeConfigUI {
  /**
   * @param {TerrainManager} terrainManager
   * @param {THREE.Scene} [scene]
   */
  constructor(terrainManager, scene = null) {
    this.terrainManager = terrainManager;
    this.scene = scene || terrainManager.scene;

    this.activeTab = 'snow'; // 'snow' | 'export'
    this.isOpen = false;

    this._createDOM();
    this._initKeyboardToggle();
  }

  _createDOM() {
    // 1. Floating Toggle Button (Top Right)
    this.toggleBtn = document.createElement('button');
    this.toggleBtn.id = 'visual-tuner-toggle-btn';
    this.toggleBtn.innerHTML = '❄️ Snow Tuner <span style="opacity:0.6;font-size:11px;">[T]</span>';
    this.toggleBtn.style.cssText = `
      position: fixed;
      top: 14px;
      right: 14px;
      z-index: 10001;
      background: rgba(15, 23, 42, 0.90);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.22);
      border-radius: 8px;
      padding: 7px 14px;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
      transition: all 0.2s ease;
      user-select: none;
    `;
    this.toggleBtn.addEventListener('mouseenter', () => {
      this.toggleBtn.style.background = 'rgba(30, 41, 59, 0.95)';
      this.toggleBtn.style.borderColor = 'rgba(56, 189, 248, 0.7)';
    });
    this.toggleBtn.addEventListener('mouseleave', () => {
      this.toggleBtn.style.background = this.isOpen ? 'rgba(2, 132, 199, 0.95)' : 'rgba(15, 23, 42, 0.90)';
      this.toggleBtn.style.borderColor = this.isOpen ? '#38bdf8' : 'rgba(255, 255, 255, 0.22)';
    });
    this.toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    document.body.appendChild(this.toggleBtn);

    // 2. Main Tuning Panel
    this.panel = document.createElement('div');
    this.panel.id = 'visual-tuner-panel';
    this.panel.style.cssText = `
      position: fixed;
      top: 54px;
      right: 14px;
      width: 380px;
      max-height: calc(100vh - 72px);
      background: rgba(15, 23, 42, 0.94);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 12px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      z-index: 10000;
      display: none;
      flex-direction: column;
      overflow: hidden;
      box-sizing: border-box;
      user-select: none;
    `;

    // Isolate pointer & wheel events so interacting with UI doesn't look around or trigger skiing
    ['pointerdown', 'mousedown', 'touchstart', 'wheel', 'contextmenu'].forEach((evt) => {
      this.panel.addEventListener(evt, (e) => e.stopPropagation());
    });

    // Panel Header
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 12px 14px 10px 14px;
      background: rgba(30, 41, 59, 0.7);
      border-bottom: 1px solid rgba(255, 255, 255, 0.12);
      display: flex;
      justify-content: space-between;
      align-items: center;
    `;
    header.innerHTML = `
      <div>
        <div style="font-weight: 700; font-size: 14px; color: #38bdf8; display: flex; align-items: center; gap: 6px;">
          <span>❄️</span> Snow Material Tuner
        </div>
        <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">
          Instant 60fps Real-Time Updates
        </div>
      </div>
      <button id="vt-close-btn" style="
        background: none;
        border: none;
        color: #94a3b8;
        font-size: 16px;
        cursor: pointer;
        padding: 4px;
        line-height: 1;
        transition: color 0.15s;
      ">&times;</button>
    `;
    header.querySelector('#vt-close-btn').addEventListener('click', () => this.hide());
    this.panel.appendChild(header);

    // Tab Navigation Bar
    const nav = document.createElement('div');
    nav.style.cssText = `
      display: flex;
      background: rgba(15, 23, 42, 0.85);
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      padding: 4px 6px;
      gap: 4px;
    `;
    nav.innerHTML = `
      <button class="vt-tab-btn" data-tab="snow" style="flex:1; padding:7px 4px; font-size:12px; font-weight:700; border-radius:6px; border:none; cursor:pointer; background:#0284c7; color:#ffffff;">❄️ Snow Properties</button>
      <button class="vt-tab-btn" data-tab="export" style="flex:1; padding:7px 4px; font-size:12px; font-weight:600; border-radius:6px; border:none; cursor:pointer; background:transparent; color:#94a3b8;">📋 Export JSON</button>
    `;

    this.tabButtons = nav.querySelectorAll('.vt-tab-btn');
    this.tabButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.getAttribute('data-tab');
        this._switchTab(tab);
      });
    });
    this.panel.appendChild(nav);

    // Tab Content Wrapper (Scrollable)
    this.tabContentWrapper = document.createElement('div');
    this.tabContentWrapper.style.cssText = `
      padding: 12px 14px;
      overflow-y: auto;
      overflow-x: hidden;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-height: calc(100vh - 190px);
    `;

    // 1. Tab: Snow
    this.snowTab = document.createElement('div');
    this.snowTab.style.cssText = 'display:flex; flex-direction:column; gap:10px;';
    this._buildSnowTab();
    this.tabContentWrapper.appendChild(this.snowTab);

    // 2. Tab: Export
    this.exportTab = document.createElement('div');
    this.exportTab.style.cssText = 'display:none; flex-direction:column; gap:10px;';
    this._buildExportTab();
    this.tabContentWrapper.appendChild(this.exportTab);

    this.panel.appendChild(this.tabContentWrapper);
    document.body.appendChild(this.panel);

    this._updateSnowControlsFromConfig();
    this._updateActiveJsonPreview();
  }

  _switchTab(tabName) {
    this.activeTab = tabName;
    this.tabButtons.forEach((btn) => {
      const active = btn.getAttribute('data-tab') === tabName;
      btn.style.background = active ? '#0284c7' : 'transparent';
      btn.style.color = active ? '#ffffff' : '#94a3b8';
      btn.style.fontWeight = active ? '700' : '600';
    });

    this.snowTab.style.display = tabName === 'snow' ? 'flex' : 'none';
    this.exportTab.style.display = tabName === 'export' ? 'flex' : 'none';

    this._updateActiveJsonPreview();
  }

  // =========================================================================
  // TAB 1: SNOW MATERIAL
  // =========================================================================
  _buildSnowTab() {
    this.snowControls = {};

    const createColorRow = (id, label) => {
      const curVal = this.terrainManager.getSnowConfig()[id] || '#ffffff';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; justify-content:space-between; align-items:center;';
      row.innerHTML = `
        <span style="font-size:11px; color:#cbd5e1;">${label}</span>
        <div style="display:flex; align-items:center; gap:6px;">
          <input type="color" id="${id}-color" value="${curVal}" style="
            width: 30px;
            height: 22px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            background: transparent;
          ">
          <span id="${id}-hex" style="font-family:monospace; font-size:10px; color:#38bdf8; font-weight:700;">${curVal}</span>
        </div>
      `;
      const input = row.querySelector(`#${id}-color`);
      const hexDisplay = row.querySelector(`#${id}-hex`);

      input.addEventListener('input', (e) => {
        const val = e.target.value;
        hexDisplay.textContent = val;
        this.terrainManager.setSnowProperty(id, val);
        this._updateActiveJsonPreview();
      });

      this.snowControls[id] = { input, hexDisplay, isColor: true };
      return row;
    };

    const createSnowSlider = (id, label, min, max, step, unit = '') => {
      const curVal = this.terrainManager.getSnowConfig()[id] ?? 0;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; flex-direction:column; gap:3px;';
      row.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#cbd5e1;">
          <span>${label}</span>
          <span id="${id}-val" style="font-family:monospace; font-weight:700; color:#38bdf8;">${curVal.toFixed(2)}${unit}</span>
        </div>
        <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${curVal}" style="
          width: 100%;
          accent-color: #38bdf8;
          cursor: pointer;
          height: 5px;
        ">
      `;
      const input = row.querySelector(`#${id}`);
      const valDisplay = row.querySelector(`#${id}-val`);

      input.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        valDisplay.textContent = `${unit === 'm' ? Math.round(val) : val.toFixed(2)}${unit}`;
        this.terrainManager.setSnowProperty(id, val);
        this._updateActiveJsonPreview();
      });

      this.snowControls[id] = { input, valDisplay, unit, isColor: false };
      return row;
    };

    // 1. Chromatic Snow Palette Box
    const paletteBox = document.createElement('div');
    paletteBox.style.cssText = 'background:rgba(30,41,59,0.5); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:10px; display:flex; flex-direction:column; gap:8px;';
    paletteBox.innerHTML = '<div style="font-size:11px; font-weight:700; color:#f1f5f9;">☀️ Chromatic Snow Colors</div>';
    paletteBox.appendChild(createColorRow('sunlitColor', 'Sunlit Alpine White'));
    paletteBox.appendChild(createColorRow('shadowColor', 'Shadow Ambient Sky Blue'));
    paletteBox.appendChild(createColorRow('creviceColor', 'Deep Crevice Drift Tone'));
    this.snowTab.appendChild(paletteBox);

    // 2. Slope Coverage & Wind Scouring
    const slopeBox = document.createElement('div');
    slopeBox.style.cssText = 'background:rgba(30,41,59,0.5); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:10px; display:flex; flex-direction:column; gap:8px;';
    slopeBox.innerHTML = '<div style="font-size:11px; font-weight:700; color:#f1f5f9;">🏔️ Slope Coverage & Wind Scour</div>';
    slopeBox.appendChild(createSnowSlider('slopeMin', 'Slope Transition Start', 0.1, 0.9, 0.02));
    slopeBox.appendChild(createSnowSlider('slopeMax', 'Slope Rock Cutoff', 0.2, 1.0, 0.02));
    slopeBox.appendChild(createSnowSlider('peakScourStart', 'Peak Scour Altitude Start', 30, 160, 2, 'm'));
    slopeBox.appendChild(createSnowSlider('peakScourEnd', 'Peak Scour Altitude End', 60, 220, 2, 'm'));
    slopeBox.appendChild(createSnowSlider('peakScourIntensity', 'Summit Rock Scour Amount', 0.0, 1.0, 0.02));
    this.snowTab.appendChild(slopeBox);

    // 3. Surface Texture & Illumination
    const textureBox = document.createElement('div');
    textureBox.style.cssText = 'background:rgba(30,41,59,0.5); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:10px; display:flex; flex-direction:column; gap:8px;';
    textureBox.innerHTML = '<div style="font-size:11px; font-weight:700; color:#f1f5f9;">❄️ Texture & Micro-Glints</div>';
    textureBox.appendChild(createSnowSlider('snowNormalScale', 'Wind Sastrugi Bumpiness', 0.0, 5.0, 0.1));
    textureBox.appendChild(createSnowSlider('snowRoughness', 'Base Snow Roughness', 0.1, 1.0, 0.02));
    textureBox.appendChild(createSnowSlider('sparkleScale', 'Crystal Sparkle Density', 0.5, 8.0, 0.1));
    textureBox.appendChild(createSnowSlider('sparkleIntensity', 'Sparkle Flash Brightness', 0.0, 5.0, 0.1));
    textureBox.appendChild(createSnowSlider('sparkleDistance', 'Sparkle Distance Fade', 10, 120, 2, 'm'));
    this.snowTab.appendChild(textureBox);

    // 4. Subsurface Scattering (SSS) & Glancing Sheen
    const sssBox = document.createElement('div');
    sssBox.style.cssText = 'background:rgba(30,41,59,0.5); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:10px; display:flex; flex-direction:column; gap:8px;';
    sssBox.innerHTML = '<div style="font-size:11px; font-weight:700; color:#f1f5f9;">✨ Subsurface Glow & Sheen</div>';
    sssBox.appendChild(createSnowSlider('sssIntensity', 'Translucent SSS Forward Glow', 0.0, 1.0, 0.02));
    sssBox.appendChild(createColorRow('sssColor', 'SSS Warm Tint Color'));
    sssBox.appendChild(createSnowSlider('sheenIntensity', 'Glancing Horizon Sheen', 0.0, 1.0, 0.02));
    sssBox.appendChild(createColorRow('sheenColor', 'Glancing Sheen Tint Color'));
    this.snowTab.appendChild(sssBox);

    // Snow Action Buttons
    const snowActions = document.createElement('div');
    snowActions.style.cssText = 'display:flex; flex-direction:column; gap:6px; margin-top:4px;';
    snowActions.innerHTML = `
      <button id="copy-snow-btn" style="
        background: #0284c7;
        color: #ffffff;
        border: none;
        border-radius: 6px;
        padding: 9px 12px;
        font-weight: 700;
        font-size: 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: background 0.2s;
        box-shadow: 0 4px 12px rgba(2, 132, 199, 0.35);
      ">📋 Copy Snow Config as JSON</button>

      <button id="reset-snow-btn" style="
        background: rgba(51, 65, 85, 0.8);
        color: #e2e8f0;
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 6px;
        padding: 6px 8px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
      ">Reset Snow to Defaults</button>
    `;

    this.copySnowBtn = snowActions.querySelector('#copy-snow-btn');
    this.copySnowBtn.addEventListener('click', () => {
      this._copyTextToClipboard(
        JSON.stringify(this.terrainManager.getSnowConfig(), null, 2),
        this.copySnowBtn,
        '📋 Copy Snow Config as JSON'
      );
    });

    snowActions.querySelector('#reset-snow-btn').addEventListener('click', () => {
      this.terrainManager.resetSnowConfig();
      this._updateSnowControlsFromConfig();
      this._updateActiveJsonPreview();
    });

    this.snowTab.appendChild(snowActions);
  }

  _updateSnowControlsFromConfig() {
    const cfg = this.terrainManager.getSnowConfig();
    for (const [id, ctrl] of Object.entries(this.snowControls)) {
      if (cfg[id] !== undefined) {
        if (ctrl.isColor) {
          ctrl.input.value = cfg[id];
          ctrl.hexDisplay.textContent = cfg[id];
        } else {
          ctrl.input.value = cfg[id];
          const val = cfg[id];
          ctrl.valDisplay.textContent = `${ctrl.unit === 'm' ? Math.round(val) : val.toFixed(2)}${ctrl.unit}`;
        }
      }
    }
  }

  // =========================================================================
  // TAB 2: EXPORT ALL
  // =========================================================================
  _buildExportTab() {
    const box = document.createElement('div');
    box.style.cssText = 'display:flex; flex-direction:column; gap:8px;';
    box.innerHTML = `
      <div style="font-size:12px; font-weight:700; color:#38bdf8;">📦 Export Snow Material Configuration</div>
      <div style="font-size:11px; color:#94a3b8; line-height:1.4;">
        Copy the active Snow Material parameters for hardcoding into the game engine.
      </div>

      <button id="copy-all-unified-btn" style="
        background: #059669;
        color: #ffffff;
        border: none;
        border-radius: 6px;
        padding: 10px 12px;
        font-weight: 700;
        font-size: 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        box-shadow: 0 4px 12px rgba(5, 150, 105, 0.4);
      ">📋 Copy Snow Config as JSON</button>

      <div style="margin-top:8px;">
        <div style="font-size:11px; font-weight:600; color:#cbd5e1; margin-bottom:4px;">Live JSON Payload Preview:</div>
        <textarea id="unified-json-preview" readonly style="
          width: 100%;
          height: 220px;
          background: #090d16;
          color: #38bdf8;
          font-family: monospace;
          font-size: 10px;
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 6px;
          padding: 8px;
          box-sizing: border-box;
          resize: vertical;
        "></textarea>
      </div>
    `;

    this.copyAllUnifiedBtn = box.querySelector('#copy-all-unified-btn');
    this.unifiedJsonPreview = box.querySelector('#unified-json-preview');

    this.copyAllUnifiedBtn.addEventListener('click', () => {
      this._copyTextToClipboard(
        JSON.stringify(this.terrainManager.getSnowConfig(), null, 2),
        this.copyAllUnifiedBtn,
        '📋 Copy Snow Config as JSON'
      );
    });

    this.exportTab.appendChild(box);
  }

  _updateActiveJsonPreview() {
    if (!this.unifiedJsonPreview) return;
    this.unifiedJsonPreview.value = JSON.stringify(this.terrainManager.getSnowConfig(), null, 2);
  }

  async _copyTextToClipboard(text, btnElement, originalText) {
    try {
      await navigator.clipboard.writeText(text);
      if (btnElement) {
        const origBg = btnElement.style.background;
        btnElement.style.background = '#16a34a';
        btnElement.textContent = '✓ Copied JSON!';
        setTimeout(() => {
          btnElement.style.background = origBg;
          btnElement.textContent = originalText;
        }, 2200);
      }
    } catch (err) {
      // Reliable fallback
      if (this.unifiedJsonPreview) {
        this.unifiedJsonPreview.value = text;
        this.unifiedJsonPreview.focus();
        this.unifiedJsonPreview.select();
        document.execCommand('copy');
        if (btnElement) {
          const origBg = btnElement.style.background;
          btnElement.style.background = '#16a34a';
          btnElement.textContent = '✓ Copied from Box!';
          setTimeout(() => {
            btnElement.style.background = origBg;
            btnElement.textContent = originalText;
          }, 2200);
        }
      }
    }
  }

  _initKeyboardToggle() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyT' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        this.toggle();
      }
    });
  }

  toggle() {
    if (this.isOpen) {
      this.hide();
    } else {
      this.show();
    }
  }

  show() {
    this.isOpen = true;
    this.panel.style.display = 'flex';
    this.toggleBtn.style.background = 'rgba(2, 132, 199, 0.95)';
    this.toggleBtn.style.borderColor = '#38bdf8';
    this._updateSnowControlsFromConfig();
    this._updateActiveJsonPreview();
  }

  hide() {
    this.isOpen = false;
    this.panel.style.display = 'none';
    this.toggleBtn.style.background = 'rgba(15, 23, 42, 0.90)';
    this.toggleBtn.style.borderColor = 'rgba(255, 255, 255, 0.22)';
  }
}
