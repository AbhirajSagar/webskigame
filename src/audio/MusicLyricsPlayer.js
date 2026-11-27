import { parseLrc, findActiveLyric } from './LrcParser.js';

const SIDE_MODES = ['left', 'center', 'right'];

/**
 * MusicLyricsPlayer
 * Plays a selected local audio file once the player lands in-game and renders
 * backdrop-free synchronized .lrc lyrics randomly across left, center, and right
 * safe regions over the canvas with zero in-game music controls.
 */
export class MusicLyricsPlayer {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.loop = false;
    this.audio.volume = 0.78;

    this._objectUrl = null;
    this.songName = '';
    this.lyrics = [];
    this.pendingStart = false;
    this.hasStarted = false;

    this._lastRenderedIdx = -2;
    this._lastRenderedText = '';
    this._lastSide = null;

    this._createDOM();
  }

  _createDOM() {
    this.lyricsEl = document.createElement('div');
    this.lyricsEl.id = 'lyrics-overlay';
    this.lyricsEl.className = 'lyrics-floating-text';
    this.lyricsEl.style.display = 'none';
    document.body.appendChild(this.lyricsEl);
  }

  /**
   * Loads a project-defined track ({ audioUrl, lrcUrl?, lrc?, title? }) without starting playback yet.
   * @param {{ id?: string, title?: string, audioUrl: string, lrcUrl?: string, lrc?: string }} track
   * @returns {Promise<void>}
   */
  async loadTrack(track) {
    if (!track || !track.audioUrl) return;
    if (this._objectUrl) {
      URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = null;
    }

    this.songName = track.title || track.id || track.audioUrl;
    this.audio.src = track.audioUrl;
    this.audio.currentTime = 0;
    this.pendingStart = false;
    this.hasStarted = false;
    this.lyrics = [];
    this._lastRenderedIdx = -2;
    this._lastRenderedText = '';

    if (typeof track.lrc === 'string' && track.lrc.trim()) {
      this.loadLrcText(track.lrc);
    } else if (track.lrcUrl) {
      try {
        const res = await fetch(track.lrcUrl);
        if (res.ok) {
          const text = await res.text();
          this.loadLrcText(text);
        }
      } catch (err) {
        console.warn('Failed to load .lrc file:', track.lrcUrl, err);
      }
    }
  }

  /**
   * Loads a local audio File object (e.g. .wav) without starting playback yet.
   * @param {File} file
   */
  loadAudioFile(file) {
    if (!file) return;
    if (this._objectUrl) {
      URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = null;
    }

    this._objectUrl = URL.createObjectURL(file);
    this.songName = file.name || 'Selected Audio';
    this.audio.src = this._objectUrl;
    this.audio.currentTime = 0;
    this.pendingStart = false;
    this.hasStarted = false;
  }

  /**
   * Parses raw .lrc text content.
   * @param {string} rawText
   * @returns {number} Number of parsed timed entries
   */
  loadLrcText(rawText) {
    const parsed = parseLrc(typeof rawText === 'string' ? rawText : '');
    this.lyrics = parsed.lines;
    this._lastRenderedIdx = -2;
    this._lastRenderedText = '';
    return this.lyrics.length;
  }

  hasAudio() {
    return Boolean(this.songName && this.audio.src);
  }

  hasLyrics() {
    return this.lyrics.length > 0;
  }

  /**
   * Unlocks the HTMLAudioElement during the user's click gesture and arms playback
   * to begin when the player touches down on the snow.
   */
  armForLanding() {
    if (!this.hasAudio()) return;
    this.pendingStart = true;
    this.hasStarted = false;
    try {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio.muted = true;
      const p = this.audio.play();
      if (p && typeof p.then === 'function') {
        p.then(() => {
          if (!this.hasStarted) {
            this.audio.pause();
            this.audio.currentTime = 0;
          }
        }).catch(() => {});
      }
    } catch {
      this.audio.muted = false;
    }
  }

  /**
   * Starts armed audio playback at the exact moment of ground landing.
   */
  startOnLanding() {
    if (!this.pendingStart || this.hasStarted || !this.hasAudio()) return;
    this.pendingStart = false;
    this.hasStarted = true;
    this.audio.muted = false;
    try {
      this.audio.currentTime = 0;
    } catch {}
    const p = this.audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {});
    }
  }

  clearAll() {
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    if (this._objectUrl) {
      URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = null;
    }
    this.songName = '';
    this.lyrics = [];
    this.pendingStart = false;
    this.hasStarted = false;
    this._lastRenderedIdx = -2;
    this._lastRenderedText = '';
    this.lyricsEl.style.display = 'none';
  }

  _positionRandomly() {
    const candidates = SIDE_MODES.filter((s) => s !== this._lastSide);
    const side = candidates[Math.floor(Math.random() * candidates.length)] || 'center';
    this._lastSide = side;

    // Reset positional styles before applying new slot
    this.lyricsEl.style.left = '';
    this.lyricsEl.style.right = '';
    this.lyricsEl.style.top = '';
    this.lyricsEl.style.bottom = '';
    this.lyricsEl.style.transform = '';
    this.lyricsEl.dataset.side = side;

    if (side === 'left') {
      const topPct = 22 + Math.random() * 44; // 22% - 66%
      const leftPct = 5 + Math.random() * 7;  // 5% - 12%
      this.lyricsEl.style.left = `${leftPct.toFixed(1)}%`;
      this.lyricsEl.style.top = `${topPct.toFixed(1)}%`;
      this.lyricsEl.style.textAlign = 'left';
    } else if (side === 'right') {
      const topPct = 22 + Math.random() * 44;
      const rightPct = 5 + Math.random() * 7;
      this.lyricsEl.style.right = `${rightPct.toFixed(1)}%`;
      this.lyricsEl.style.top = `${topPct.toFixed(1)}%`;
      this.lyricsEl.style.textAlign = 'right';
    } else {
      const useUpper = Math.random() < 0.45;
      const topPct = useUpper ? (14 + Math.random() * 14) : (64 + Math.random() * 14);
      this.lyricsEl.style.left = '50%';
      this.lyricsEl.style.top = `${topPct.toFixed(1)}%`;
      this.lyricsEl.style.transform = 'translateX(-50%)';
      this.lyricsEl.style.textAlign = 'center';
    }
  }

  /**
   * Synchronizes floating lyrics with current playback time after landing.
   */
  update() {
    if (!this.hasStarted || !this.hasAudio() || !this.hasLyrics()) {
      if (this.lyricsEl.style.display !== 'none') {
        this.lyricsEl.style.display = 'none';
      }
      return;
    }

    if (this.audio.ended) {
      this.lyricsEl.style.display = 'none';
      return;
    }

    const cur = this.audio.currentTime || 0;
    const { index, current } = findActiveLyric(this.lyrics, cur);
    const activeText = current?.text || '';

    if (!activeText) {
      if (this.lyricsEl.style.display !== 'none') {
        this.lyricsEl.style.display = 'none';
      }
      this._lastRenderedIdx = index;
      this._lastRenderedText = '';
      return;
    }

    this.lyricsEl.style.display = 'block';

    if (index !== this._lastRenderedIdx || activeText !== this._lastRenderedText) {
      this._lastRenderedIdx = index;
      this._lastRenderedText = activeText;
      this._positionRandomly();
      this.lyricsEl.textContent = activeText;
      this.lyricsEl.classList.remove('is-entering');
      void this.lyricsEl.offsetWidth;
      this.lyricsEl.classList.add('is-entering');
    }
  }

  dispose() {
    this.clearAll();
    this.lyricsEl?.remove();
  }
}
