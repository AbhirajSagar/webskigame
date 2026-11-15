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
    this.playBtn = document.getElementById('play-btn');

    this.isReady = false;
    this.isPlaying = false;
    this._playCallbacks = [];

    this._initEvents();
  }

  _initEvents() {
    if (!this.playBtn) return;

    const handlePlay = (e) => {
      if (e) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
      }

      if (this.isPlaying) return;
      this.isPlaying = true;

      // 1. Immediately hide loading overlay and disable its pointer events so touches pass directly to game
      if (this.overlay) {
        this.overlay.style.pointerEvents = 'none';
        this.overlay.classList.add('fade-out');
        setTimeout(() => {
          this.overlay.style.display = 'none';
        }, 350);
      }

      // Ensure window has focus so keyboard events (W / ArrowUp) register immediately
      try {
        window.focus();
      } catch (err) {}

      // 2. Fire registered start callbacks immediately (starts game & launches player)
      for (const cb of this._playCallbacks) {
        try {
          cb();
        } catch (err) {
          console.error('Error in onPlay callback:', err);
        }
      }

      // 3. Attempt browser fullscreen non-blockingly (fire-and-forget)
      triggerBrowserFullscreen();

      // 4. Request pointer lock only on non-touch desktop devices with a mouse
      const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
      if (!isTouchDevice) {
        const canvas = document.querySelector('#webgl');
        try {
          const lockPromise = canvas?.requestPointerLock?.();
          if (lockPromise && typeof lockPromise.catch === 'function') {
            lockPromise.catch(() => {});
          }
        } catch (err) {}
      }
    };

    // Listen to click, touchend, and pointerup to guarantee immediate firing on all mobile devices
    this.playBtn.addEventListener('click', handlePlay);
    this.playBtn.addEventListener('touchend', handlePlay, { passive: false });
    this.playBtn.addEventListener('pointerup', handlePlay);
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
   * Swaps loading bar for the Play button once loaded
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
    if (this.playBtn) {
      this.playBtn.style.display = 'block';
      this.playBtn.focus();
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
