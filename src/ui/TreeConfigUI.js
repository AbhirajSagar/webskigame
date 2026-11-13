import { DEFAULT_TREE_CONFIGS } from '../terrain/TreeGenerator.js';

/**
 * TreeConfigUI
 * Interactive live UI panel allowing real-time adjustment of min/max scale and
 * 3-axis rotation bounds for every tree variant in the pack.
 * Includes a "Copy Config JSON" button to easily copy the generated values.
 */
export class TreeConfigUI {
  /**
   * @param {TerrainManager} terrainManager
   */
  constructor(terrainManager) {
    this.terrainManager = terrainManager;
    this.treeGenerator = terrainManager.treeGenerator;

    this.treeKeys = ['long_1', 'long_2', 'small_1', 'small_2', 'dead_1', 'dead_2'];
    this.treeLabels = {
      long_1: 'long_1 (Tall Conifer 1)',
      long_2: 'long_2 (Tall Conifer 2)',
      small_1: 'small_1 (Medium Pine 1)',
      small_2: 'small_2 (Bushy Pine 2)',
      dead_1: 'dead_1 (Dried Snag 1)',
      dead_2: 'dead_2 (Dried Snag 2)',
    };

    this.activeKey = 'long_1';
    this.isOpen = false;
    this.rebuildTimeout = null;

    this._createDOM();
    this._initKeyboardToggle();
  }

  _createDOM() {
    // 1. Floating Toggle Button (Top Right)
    this.toggleBtn = document.createElement('button');
    this.toggleBtn.id = 'tree-config-toggle-btn';
    this.toggleBtn.innerHTML = '🌲 Tree Config <span style="opacity:0.6;font-size:11px;">[T]</span>';
    this.toggleBtn.style.cssText = `
      position: fixed;
      top: 14px;
      right: 14px;
      z-index: 10001;
      background: rgba(15, 23, 42, 0.88);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.22);
      border-radius: 8px;
      padding: 7px 13px;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      transition: all 0.2s ease;
      user-select: none;
    `;
    this.toggleBtn.addEventListener('mouseenter', () => {
      this.toggleBtn.style.background = 'rgba(30, 41, 59, 0.95)';
      this.toggleBtn.style.borderColor = 'rgba(56, 189, 248, 0.6)';
    });
    this.toggleBtn.addEventListener('mouseleave', () => {
      this.toggleBtn.style.background = 'rgba(15, 23, 42, 0.88)';
      this.toggleBtn.style.borderColor = 'rgba(255, 255, 255, 0.22)';
    });
    this.toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    document.body.appendChild(this.toggleBtn);

    // 2. Main Config Panel Container
    this.panel = document.createElement('div');
    this.panel.id = 'tree-config-panel';
    this.panel.style.cssText = `
      position: fixed;
      top: 54px;
      right: 14px;
      z-index: 10002;
      width: 360px;
      max-height: calc(100vh - 74px);
      background: rgba(15, 23, 42, 0.94);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 12px;
      padding: 16px 18px;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.65);
      user-select: none;
      display: none;
      flex-direction: column;
      gap: 12px;
      overflow-y: auto;
    `;

    // Stop propagation so clicking in panel doesn't trigger ski / camera pointer lock
    ['mousedown', 'mouseup', 'click', 'pointerdown', 'mousemove', 'keydown', 'keyup', 'wheel'].forEach(evt => {
      this.panel.addEventListener(evt, (e) => e.stopPropagation());
    });

    // Panel Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:10px;';
    header.innerHTML = `
      <div>
        <div style="font-weight:700; font-size:14px; color:#f8fafc; display:flex; align-items:center; gap:6px;">
          <span>🌲</span> Tree Transform Config
        </div>
        <div style="font-size:11px; color:#94a3b8; margin-top:2px;">Adjust min/max scale & rotation live</div>
      </div>
      <button id="tree-config-close" style="background:none; border:none; color:#94a3b8; font-size:18px; cursor:pointer; padding:2px 6px; line-height:1;">✕</button>
    `;
    header.querySelector('#tree-config-close').addEventListener('click', () => this.hide());
    this.panel.appendChild(header);

    // Tree Variant Tab Selector
    const tabContainer = document.createElement('div');
    tabContainer.style.cssText = 'display:flex; flex-direction:column; gap:6px;';
    tabContainer.innerHTML = `
      <label style="font-size:11px; font-weight:600; color:#cbd5e1; text-transform:uppercase; letter-spacing:0.5px;">Select Tree Variant:</label>
      <select id="tree-variant-select" style="
        background: rgba(30, 41, 59, 0.9);
        color: #f8fafc;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 6px;
        padding: 6px 10px;
        font-size: 13px;
        cursor: pointer;
        outline: none;
      ">
        ${this.treeKeys.map(k => `<option value="${k}">${this.treeLabels[k]}</option>`).join('')}
      </select>
    `;
    this.selectEl = tabContainer.querySelector('#tree-variant-select');
    this.selectEl.addEventListener('change', (e) => {
      this.activeKey = e.target.value;
      this._updateControlsFromConfig();
    });
    this.panel.appendChild(tabContainer);

    // Sliders Container
    this.slidersContainer = document.createElement('div');
    this.slidersContainer.style.cssText = 'display:flex; flex-direction:column; gap:12px;';
    this.panel.appendChild(this.slidersContainer);

    this._createSliderGroups();

    // Action Buttons
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex; flex-direction:column; gap:8px; margin-top:6px; border-top:1px solid rgba(255,255,255,0.1); padding-top:12px;';
    actions.innerHTML = `
      <button id="copy-json-btn" style="
        background: #0284c7;
        color: #ffffff;
        border: none;
        border-radius: 6px;
        padding: 9px 12px;
        font-weight: 700;
        font-size: 13px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: background 0.2s;
        box-shadow: 0 2px 8px rgba(2, 132, 199, 0.4);
      ">
        📋 Copy Config as JSON
      </button>

      <div style="display:flex; gap:8px;">
        <button id="apply-all-btn" style="
          flex: 1;
          background: rgba(51, 65, 85, 0.8);
          color: #e2e8f0;
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 6px;
          padding: 6px 8px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
        ">Apply to All Trees</button>

        <button id="reset-defaults-btn" style="
          flex: 1;
          background: rgba(51, 65, 85, 0.8);
          color: #e2e8f0;
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 6px;
          padding: 6px 8px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
        ">Reset Defaults</button>
      </div>

      <details id="json-preview-details" style="font-size:11px; color:#94a3b8; margin-top:4px;">
        <summary style="cursor:pointer; font-weight:600; color:#38bdf8;">View JSON Payload</summary>
        <textarea id="json-preview-text" readonly style="
          width: 100%;
          height: 120px;
          margin-top: 6px;
          background: #090d16;
          color: #38bdf8;
          font-family: monospace;
          font-size: 10px;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 4px;
          padding: 6px;
          box-sizing: border-box;
          resize: vertical;
        "></textarea>
      </details>
    `;

    // Copy JSON Button click handler
    this.copyBtn = actions.querySelector('#copy-json-btn');
    this.jsonPreview = actions.querySelector('#json-preview-text');

    this.copyBtn.addEventListener('click', () => this._copyJsonToClipboard());

    actions.querySelector('#apply-all-btn').addEventListener('click', () => {
      const current = this.treeGenerator.getTreeConfig(this.activeKey);
      for (const k of this.treeKeys) {
        this.treeGenerator.setTreeConfig(k, { ...current });
      }
      this._triggerRebuild();
      this._updateJsonPreview();
    });

    actions.querySelector('#reset-defaults-btn').addEventListener('click', () => {
      this.treeGenerator.setAllTreeConfigs(DEFAULT_TREE_CONFIGS);
      this._updateControlsFromConfig();
      this._triggerRebuild();
      this._updateJsonPreview();
    });

    this.panel.appendChild(actions);
    document.body.appendChild(this.panel);

    this._updateControlsFromConfig();
  }

  _createSliderGroups() {
    this.controls = {};

    const createSlider = (id, label, min, max, step, unit = '') => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; flex-direction:column; gap:3px;';
      row.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#cbd5e1;">
          <span>${label}</span>
          <span id="${id}-val" style="font-family:monospace; font-weight:700; color:#38bdf8;">0.00</span>
        </div>
        <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" style="
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
        valDisplay.textContent = unit === '°' ? `${Math.round(val)}°` : val.toFixed(2);
        this._onSliderChange(id, val);
      });

      this.controls[id] = { input, valDisplay, unit };
      return row;
    };

    // 1. Scale Group
    const scaleBox = document.createElement('div');
    scaleBox.style.cssText = 'background:rgba(30,41,59,0.5); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:10px; display:flex; flex-direction:column; gap:8px;';
    scaleBox.innerHTML = '<div style="font-size:11px; font-weight:700; color:#f1f5f9; display:flex; align-items:center; gap:4px;">📏 Scale / Size Bounds</div>';
    scaleBox.appendChild(createSlider('minScale', 'Min Scale', 0.1, 3.0, 0.05));
    scaleBox.appendChild(createSlider('maxScale', 'Max Scale', 0.1, 3.0, 0.05));
    this.slidersContainer.appendChild(scaleBox);

    // 2. Y-Axis Rotation Group (Yaw)
    const rotYBox = document.createElement('div');
    rotYBox.style.cssText = 'background:rgba(30,41,59,0.5); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:10px; display:flex; flex-direction:column; gap:8px;';
    rotYBox.innerHTML = '<div style="font-size:11px; font-weight:700; color:#f1f5f9; display:flex; align-items:center; gap:4px;">🔄 Y-Axis Rotation (Yaw)</div>';
    rotYBox.appendChild(createSlider('minRotY', 'Min Y Rotation', 0, 360, 5, '°'));
    rotYBox.appendChild(createSlider('maxRotY', 'Max Y Rotation', 0, 360, 5, '°'));
    this.slidersContainer.appendChild(rotYBox);

    // 3. X & Z Axis Tilt Group (Pitch & Roll)
    const tiltBox = document.createElement('div');
    tiltBox.style.cssText = 'background:rgba(30,41,59,0.5); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:10px; display:flex; flex-direction:column; gap:8px;';
    tiltBox.innerHTML = '<div style="font-size:11px; font-weight:700; color:#f1f5f9; display:flex; align-items:center; gap:4px;">📐 Tilt Angles (X & Z Axis)</div>';
    tiltBox.appendChild(createSlider('minRotX', 'Min Tilt X', -45, 45, 1, '°'));
    tiltBox.appendChild(createSlider('maxRotX', 'Max Tilt X', -45, 45, 1, '°'));
    tiltBox.appendChild(createSlider('minRotZ', 'Min Tilt Z', -45, 45, 1, '°'));
    tiltBox.appendChild(createSlider('maxRotZ', 'Max Tilt Z', -45, 45, 1, '°'));
    this.slidersContainer.appendChild(tiltBox);
  }

  _updateControlsFromConfig() {
    const cfg = this.treeGenerator.getTreeConfig(this.activeKey);
    for (const [id, ctrl] of Object.entries(this.controls)) {
      if (cfg[id] !== undefined) {
        ctrl.input.value = cfg[id];
        ctrl.valDisplay.textContent = ctrl.unit === '°' ? `${Math.round(cfg[id])}°` : cfg[id].toFixed(2);
      }
    }
    this._updateJsonPreview();
  }

  _onSliderChange(id, val) {
    const update = { [id]: val };
    this.treeGenerator.setTreeConfig(this.activeKey, update);
    this._triggerRebuild();
    this._updateJsonPreview();
  }

  _triggerRebuild() {
    clearTimeout(this.rebuildTimeout);
    this.rebuildTimeout = setTimeout(() => {
      this.terrainManager.rebuildAllTrees();
    }, 40);
  }

  _updateJsonPreview() {
    if (this.jsonPreview) {
      this.jsonPreview.value = JSON.stringify(this.treeGenerator.getAllTreeConfigs(), null, 2);
    }
  }

  async _copyJsonToClipboard() {
    const jsonStr = JSON.stringify(this.treeGenerator.getAllTreeConfigs(), null, 2);
    try {
      await navigator.clipboard.writeText(jsonStr);
      this.copyBtn.style.background = '#16a34a';
      this.copyBtn.innerHTML = '✓ Copied JSON to Clipboard!';
      setTimeout(() => {
        this.copyBtn.style.background = '#0284c7';
        this.copyBtn.innerHTML = '📋 Copy Config as JSON';
      }, 2500);
    } catch (err) {
      // Fallback
      if (this.jsonPreview) {
        this.jsonPreview.focus();
        this.jsonPreview.select();
        document.execCommand('copy');
        this.copyBtn.style.background = '#16a34a';
        this.copyBtn.innerHTML = '✓ Copied from Textbox!';
        setTimeout(() => {
          this.copyBtn.style.background = '#0284c7';
          this.copyBtn.innerHTML = '📋 Copy Config as JSON';
        }, 2500);
      }
    }
  }

  _initKeyboardToggle() {
    window.addEventListener('keydown', (e) => {
      // Toggle panel with 'T' key when not typing in an input
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
    this.toggleBtn.style.background = 'rgba(2, 132, 199, 0.9)';
    this.toggleBtn.style.borderColor = '#38bdf8';
    this._updateControlsFromConfig();
  }

  hide() {
    this.isOpen = false;
    this.panel.style.display = 'none';
    this.toggleBtn.style.background = 'rgba(15, 23, 42, 0.88)';
    this.toggleBtn.style.borderColor = 'rgba(255, 255, 255, 0.22)';
  }
}
