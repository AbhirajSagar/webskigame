import { requestPointerLockSafe } from '../utils/pointerLock.js';
import { DEFAULT_PRESET_ID, getAllLightingPresets } from '../environment/LightingPresets.js';
import { MUSIC_TRACKS } from '../audio/MusicTracks.js';

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
 * Displays loading progress, atmosphere preset selection, and a post-selection
 * music prompt dialog listing tracks defined in src/audio/MusicTracks.js.
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
    this._pendingPresetId = DEFAULT_PRESET_ID;
    this._pendingOpenEditor = false;
    this._selectedTrackId = null;
    this._tracksProvider = () => MUSIC_TRACKS;

    this._playCallbacks = [];
    this._createCallbacks = [];
    this._presetButtons = [];
    this._musicPlayer = null;

    this.renderPresets();
    this._initCreateButton();
    this._initMusicDialog();
  }

  attachMusicPlayer(musicPlayer) {
    this._musicPlayer = musicPlayer || null;
  }

  /**
   * Optional override for available track list (useful for testing or dynamic injection).
   * @param {() => Array} provider
   */
  setTracksProvider(provider) {
    if (typeof provider === 'function') {
      this._tracksProvider = provider;
      this._renderTrackList();
    }
  }

  _getAvailableTracks() {
    const list = this._tracksProvider?.();
    return Array.isArray(list) ? list : [];
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
      this._openMusicDialog(DEFAULT_PRESET_ID, { openEditor: true });
    });

    header.appendChild(createBtn);
  }

  _initMusicDialog() {
    if (!this.overlay || document.getElementById('music-prompt-dialog')) return;

    this.musicDialog = document.createElement('div');
    this.musicDialog.id = 'music-prompt-dialog';
    this.musicDialog.style.display = 'none';

    const header = document.createElement('div');
    header.className = 'mpd-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'mpd-title-wrap';
    this._dialogPresetLabel = document.createElement('span');
    this._dialogPresetLabel.className = 'mpd-eyebrow';
    const title = document.createElement('h2');
    title.className = 'mpd-title';
    title.textContent = 'Play with music?';
    titleWrap.append(this._dialogPresetLabel, title);

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'ae-icon-btn';
    backBtn.title = 'Back to atmospheres';
    backBtn.textContent = '×';
    backBtn.addEventListener('click', () => this._closeMusicDialog());

    header.append(titleWrap, backBtn);

    // Choice row: Yes / No
    this._choiceRow = document.createElement('div');
    this._choiceRow.className = 'mpd-choice-row';

    const noBtn = document.createElement('button');
    noBtn.type = 'button';
    noBtn.id = 'music-prompt-no';
    noBtn.className = 'mpd-btn mpd-btn-secondary';
    noBtn.textContent = 'No, play without music';
    noBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this._musicPlayer) {
        this._musicPlayer.clearAll();
      }
      this._launchSelection(this._pendingPresetId, {
        openEditor: this._pendingOpenEditor,
        withMusic: false,
      });
    });

    const yesBtn = document.createElement('button');
    yesBtn.type = 'button';
    yesBtn.id = 'music-prompt-yes';
    yesBtn.className = 'mpd-btn mpd-btn-primary';
    yesBtn.textContent = 'Yes, choose a track';
    yesBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._showTrackPicker(true);
    });

    this._choiceRow.append(yesBtn, noBtn);

    // Track picker list shown when user says Yes
    this._fieldsWrap = document.createElement('div');
    this._fieldsWrap.id = 'music-prompt-fields';
    this._fieldsWrap.className = 'mpd-fields';
    this._fieldsWrap.style.display = 'none';

    const listLabel = document.createElement('div');
    listLabel.className = 'mpd-field-label';
    listLabel.textContent = 'Available tracks';

    this._trackListEl = document.createElement('div');
    this._trackListEl.id = 'music-prompt-track-list';
    this._trackListEl.className = 'mpd-track-list';

    this._dialogStatus = document.createElement('div');
    this._dialogStatus.className = 'mpd-status';

    const actionsRow = document.createElement('div');
    actionsRow.className = 'mpd-actions';

    this._startBtn = document.createElement('button');
    this._startBtn.type = 'button';
    this._startBtn.id = 'music-prompt-start';
    this._startBtn.className = 'mpd-btn mpd-btn-primary';
    this._startBtn.textContent = 'Drop In';
    this._startBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const tracks = this._getAvailableTracks();
      const selected = tracks.find((t, idx) => (t.id || String(idx)) === this._selectedTrackId);
      if (!selected) {
        this._dialogStatus.textContent = 'Select a track above or go Back to play without music.';
        this._dialogStatus.className = 'mpd-status is-err';
        return;
      }

      if (this._musicPlayer) {
        const loadPromise = this._musicPlayer.loadTrack(selected);
        // Arm synchronously inside click gesture right after audio.src is assigned
        this._musicPlayer.armForLanding();
        await loadPromise;
      }

      this._launchSelection(this._pendingPresetId, {
        openEditor: this._pendingOpenEditor,
        withMusic: true,
      });
    });

    const backStepBtn = document.createElement('button');
    backStepBtn.type = 'button';
    backStepBtn.className = 'mpd-btn mpd-btn-secondary';
    backStepBtn.textContent = 'Back';
    backStepBtn.addEventListener('click', () => this._showTrackPicker(false));

    actionsRow.append(this._startBtn, backStepBtn);
    this._fieldsWrap.append(listLabel, this._trackListEl, this._dialogStatus, actionsRow);

    this.musicDialog.append(header, this._choiceRow, this._fieldsWrap);
    this.overlay.appendChild(this.musicDialog);
    this._renderTrackList();
  }

  _renderTrackList() {
    if (!this._trackListEl) return;
    this._trackListEl.innerHTML = '';

    const tracks = this._getAvailableTracks();
    if (tracks.length === 0) {
      this._selectedTrackId = null;
      const empty = document.createElement('div');
      empty.className = 'mpd-empty-tracks';
      empty.innerHTML = 'No tracks configured yet. Add audio + <code>.lrc</code> files in <code>public/music/</code> and register them in <code>src/audio/MusicTracks.js</code>.';
      this._trackListEl.appendChild(empty);
      if (this._startBtn) this._startBtn.disabled = true;
      return;
    }

    if (this._startBtn) this._startBtn.disabled = false;
    if (!tracks.some((t, idx) => (t.id || String(idx)) === this._selectedTrackId)) {
      this._selectedTrackId = tracks[0].id || '0';
    }

    tracks.forEach((track, idx) => {
      const trackId = track.id || String(idx);
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'mpd-track-item';
      item.dataset.trackId = trackId;
      item.classList.toggle('is-selected', trackId === this._selectedTrackId);

      const meta = document.createElement('div');
      meta.className = 'mpd-track-meta';

      const name = document.createElement('span');
      name.className = 'mpd-track-title';
      name.textContent = track.title || trackId;
      meta.appendChild(name);

      if (track.artist) {
        const artist = document.createElement('span');
        artist.className = 'mpd-track-artist';
        artist.textContent = track.artist;
        meta.appendChild(artist);
      }

      const tag = document.createElement('span');
      tag.className = 'mpd-track-tag';
      tag.textContent = (track.lrc || track.lrcUrl) ? 'LRC' : 'AUDIO';

      item.append(meta, tag);
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._selectedTrackId = trackId;
        this._trackListEl.querySelectorAll('.mpd-track-item').forEach((el) => {
          el.classList.toggle('is-selected', el.dataset.trackId === trackId);
        });
        this._dialogStatus.textContent = '';
        this._dialogStatus.className = 'mpd-status';
      });

      this._trackListEl.appendChild(item);
    });
  }

  _showTrackPicker(show) {
    this._choiceRow.style.display = show ? 'none' : 'flex';
    this._fieldsWrap.style.display = show ? 'flex' : 'none';
    if (show) {
      this._renderTrackList();
      this._dialogStatus.textContent = '';
      this._dialogStatus.className = 'mpd-status';
    }
  }

  _openMusicDialog(presetId, { openEditor = false } = {}) {
    if (this.isPlaying) return;
    this._pendingPresetId = presetId;
    this._pendingOpenEditor = openEditor;

    const cfg = getAllLightingPresets()[presetId];
    if (this._dialogPresetLabel) {
      this._dialogPresetLabel.textContent = cfg?.label || presetId;
    }

    this._showTrackPicker(false);
    if (this.presetSelector) this.presetSelector.style.display = 'none';
    if (this.musicDialog) this.musicDialog.style.display = 'flex';
  }

  _closeMusicDialog() {
    if (this.musicDialog) this.musicDialog.style.display = 'none';
    if (this.presetSelector) this.presetSelector.style.display = 'flex';
  }

  _launchSelection(presetId, { openEditor = false, withMusic = false } = {}) {
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
        cb(presetId, { openEditor, withMusic });
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
        this._openMusicDialog(presetId);
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
   * Registers a callback triggered when Play starts
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
