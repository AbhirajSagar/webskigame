import { requestPointerLockSafe } from '../utils/pointerLock.js';
import { LIGHTING_PRESETS } from '../environment/LightingPresets.js';

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
 * Simple loading bar overlay that transitions to a Play button when loaded,
 * and enters browser fullscreen upon clicking Play.
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
    this.selectedPreset = 'default';
    this._playCallbacks = [];

    this._initEvents();
  }

  _initEvents() {
    if (!this.presetButtonsContainer) return;

    this.presetButtonsContainer.innerHTML = '';
    const entries = Object.entries(LIGHTING_PRESETS);

    entries.forEach(([presetId, cfg], idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preset-card';
      btn.dataset.preset = presetId;
      btn.style.setProperty('--accent', cfg.accent || '#38bdf8');

      const media = document.createElement('div');
      media.className = 'preset-media';

      const img = document.createElement('img');
      img.className = 'preset-thumb';
      img.src = cfg.thumbnail || `/thumbnails/${presetId}.png`;
      img.alt = cfg.label || presetId;
      img.loading = 'eager';
      img.decoding = 'async';

      const sheen = document.createElement('div');
      sheen.className = 'preset-media-overlay';

      const badge = document.createElement('span');
      badge.className = 'preset-badge';
      badge.textContent = cfg.badge || 'PRESET';

      media.append(img, sheen, badge);

      if (cfg.clouds?.enabled) {
        const cloudTag = document.createElement('span');
        cloudTag.className = 'preset-cloud-tag';
        cloudTag.textContent = 'CLOUDS';
        media.appendChild(cloudTag);
      }

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

      const cta = document.createElement('span');
      cta.className = 'preset-cta';
      cta.textContent = 'DROP IN';

      body.append(textWrap, cta);
      btn.append(media, body);
      if (idx === 0) {
        this._firstPresetBtn = btn;
      }

      const handleSelect = (e) => {
        if (e) {
          if (typeof e.preventDefault === 'function') e.preventDefault();
          if (typeof e.stopPropagation === 'function') e.stopPropagation();
        }

        if (this.isPlaying) return;
        this.isPlaying = true;
        this.selectedPreset = presetId;

        if (this.overlay) {
          this.overlay.style.pointerEvents = 'none';
          this.overlay.classList.add('fade-out');
          setTimeout(() => {
            this.overlay.style.display = 'none';
          }, 350);
        }

        try {
          window.focus();
        } catch (err) {}

        for (const cb of this._playCallbacks) {
          try {
            cb(presetId);
          } catch (err) {
            console.error('Error in onPlay callback:', err);
          }
        }

        triggerBrowserFullscreen();

        const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        if (!isTouchDevice) {
          const canvas = document.querySelector('#webgl');
          requestPointerLockSafe(canvas);
        }
      };

      btn.addEventListener('click', handleSelect);
      btn.addEventListener('touchend', handleSelect, { passive: false });
      btn.addEventListener('pointerup', handleSelect);

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
   * Registers a callback triggered when Play button is clicked
   * @param {Function} callback
   */
  onPlay(callback) {
    if (typeof callback === 'function') {
      this._playCallbacks.push(callback);
    }
  }
}
