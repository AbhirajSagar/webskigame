import { requestPointerLockSafe } from '../utils/pointerLock.js';
import { DEFAULT_PRESET_ID, getAllLightingPresets } from '../environment/LightingPresets.js';

/**
 * Triggers browser fullscreen mode with cross-browser compatibility.
 * Non-blocking fire-and-forget for mobile/tablet/desktop compatibility.
 * @param {HTMLElement} [element=document.documentElement]
 */
export function triggerBrowserFullscreen(element = document.documentElement) {
  try {
    if (element.requestFullscreen) {
      const p = element.requestFullscreen();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else if (element.webkitRequestFullscreen) {
      const p = element.webkitRequestFullscreen();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else if (element.mozRequestFullScreen) {
      const p = element.mozRequestFullScreen();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else if (element.msRequestFullscreen) {
      const p = element.msRequestFullscreen();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  } catch (err) {
    // Non-critical, ignore
  }
}

/**
 * LoadingOverlay
 * Displays loading progress and transitions to the atmosphere preset selector.
 */
export class LoadingOverlay {
  constructor() {
    this.overlay = document.getElementById('loading-overlay');
    this.loadingBarContainer = document.getElementById('loading-bar-container');
    this.loadingBar = document.getElementById('loading-bar');
    this.presetSelector = document.getElementById('preset-selector');
    this.presetButtonsContainer = document.getElementById('preset-buttons');

    this.isReady = false;
    this.isPlaying = false;
    this.selectedPreset = DEFAULT_PRESET_ID;
    this._playCallbacks = [];
    this._createCallbacks = [];
    this._presetButtons = [];

    this.renderPresets();
    this._initCreateButton();
  }

  _initCreateButton() {
    if (!this.presetSelector) return;
    const header = this.presetSelector.querySelector('.preset-header');
    if (!header || document.getElementById('create-preset-btn')) return;

    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.id = 'create-preset-btn';
    createBtn.className = 'preset-create-btn';
    createBtn.textContent = '+ New Atmosphere';
    createBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._launchSelection(DEFAULT_PRESET_ID, { openEditor: true });
    });

    header.appendChild(createBtn);
  }

  _launchSelection(presetId, { openEditor = false } = {}) {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.selectedPreset = presetId;

    if (this.overlay) {
      this.overlay.style.pointerEvents = 'none';
      this.overlay.classList.add('fade-out');
      setTimeout(() => {
        this.overlay.style.display = 'none';
      }, 300);
    }

    try {
      window.focus();
    } catch (err) {}

    for (const cb of this._playCallbacks) {
      try {
        cb(presetId, { openEditor });
      } catch (err) {
        console.error('Error in onPlay callback:', err);
      }
    }

    if (openEditor) {
      for (const cb of this._createCallbacks) {
        try {
          cb();
        } catch (err) {
          console.error('Error in onCreateCustom callback:', err);
        }
      }
    } else {
      triggerBrowserFullscreen();
      const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
      if (!isTouchDevice) {
        const canvas = document.querySelector('#webgl');
        requestPointerLockSafe(canvas);
      }
    }
  }

  renderPresets() {
    if (!this.presetButtonsContainer) return;

    this.presetButtonsContainer.innerHTML = '';
    this._presetButtons = [];
    const entries = Object.entries(getAllLightingPresets());
    this.presetButtonsContainer.dataset.count = String(entries.length);
    if (this.presetSelector) {
      this.presetSelector.dataset.count = String(entries.length);
    }

    entries.forEach(([presetId, cfg], idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preset-card';
      btn.dataset.preset = presetId;

      const media = document.createElement('div');
      media.className = 'preset-media';

      if (cfg.thumbnail) {
        const img = document.createElement('img');
        img.className = 'preset-thumb';
        img.src = cfg.thumbnail;
        img.alt = cfg.label || presetId;
        img.loading = 'eager';
        img.decoding = 'async';
        media.appendChild(img);
      } else {
        const fallback = document.createElement('div');
        fallback.className = 'preset-thumb';
        const c1 = cfg.fog?.color || cfg.skybox?.solidColor || '#52525b';
        const c2 = cfg.snow?.shadowColor || '#18181b';
        const c3 = cfg.snow?.sunlitColor || '#f4f4f5';
        fallback.style.background = `linear-gradient(170deg, ${c1} 0%, ${c3} 52%, ${c2} 100%)`;
        media.appendChild(fallback);
      }

      const sheen = document.createElement('div');
      sheen.className = 'preset-media-overlay';
      media.appendChild(sheen);

      const body = document.createElement('div');
      body.className = 'preset-body';

      const textWrap = document.createElement('div');
      textWrap.className = 'preset-text';

      const label = document.createElement('span');
      label.className = 'preset-label';
      label.textContent = cfg.label || presetId;
      textWrap.appendChild(label);

      if (cfg.subtitle) {
        const sub = document.createElement('span');
        sub.className = 'preset-subtitle';
        sub.textContent = cfg.subtitle;
        textWrap.appendChild(sub);
      }

      const meta = document.createElement('span');
      meta.className = 'preset-meta';
      meta.textContent = cfg.isCustom ? 'Custom' : `0${idx + 1}`;

      body.append(textWrap, meta);
      btn.append(media, body);
      this._presetButtons.push(btn);

      if (idx === 0) {
        this._firstPresetBtn = btn;
      }

      const handleSelect = (e) => {
        if (e) {
          if (typeof e.preventDefault === 'function') e.preventDefault();
          if (typeof e.stopPropagation === 'function') e.stopPropagation();
        }
        this._launchSelection(presetId);
      };

      btn.addEventListener('click', handleSelect);
      btn.addEventListener('touchend', handleSelect, { passive: false });
      btn.addEventListener('pointerup', handleSelect);
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          const next = this._presetButtons[(idx + 1) % this._presetButtons.length];
          next?.focus();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          const prev = this._presetButtons[(idx - 1 + this._presetButtons.length) % this._presetButtons.length];
          prev?.focus();
        }
      });

      this.presetButtonsContainer.appendChild(btn);
    });
  }

  /**
   * Sets the loading bar progress (0 to 100)
   * @param {number} percent
   */
  setProgress(percent) {
    if (this.isReady) return;
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    if (this.loadingBar) {
      this.loadingBar.style.width = `${clamped}%`;
    }
  }

  /**
   * Swaps loading bar for the preset selector once loaded
   */
  setReady() {
    if (this.isReady) return;
    this.isReady = true;

    if (this.loadingBar) {
      this.loadingBar.style.width = '100%';
    }

    if (this.loadingBarContainer) {
      this.loadingBarContainer.style.display = 'none';
    }
    if (this.presetSelector) {
      this.presetSelector.style.display = 'flex';
      this._firstPresetBtn?.focus();
    }
  }

  /**
   * Registers a callback triggered when a preset is launched
   * @param {Function} callback
   */
  onPlay(callback) {
    if (typeof callback === 'function') {
      this._playCallbacks.push(callback);
    }
  }

  /**
   * Registers a callback triggered when Create Custom Atmosphere is clicked
   * @param {Function} callback
   */
  onCreateCustom(callback) {
    if (typeof callback === 'function') {
      this._createCallbacks.push(callback);
    }
  }
}
