/**
 * Triggers browser fullscreen mode with cross-browser compatibility.
 * Must be invoked within a user gesture (e.g., click event).
 * @param {HTMLElement} [element=document.documentElement]
 * @returns {Promise<void>}
 */
export async function triggerBrowserFullscreen(element = document.documentElement) {
  try {
    if (element.requestFullscreen) {
      await element.requestFullscreen();
    } else if (element.webkitRequestFullscreen) {
      await element.webkitRequestFullscreen();
    } else if (element.mozRequestFullScreen) {
      await element.mozRequestFullScreen();
    } else if (element.msRequestFullscreen) {
      await element.msRequestFullscreen();
    }
  } catch (err) {
    console.warn('Fullscreen request was blocked or not permitted:', err?.message || err);
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
    if (this.playBtn) {
      this.playBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (this.isPlaying) return;
        this.isPlaying = true;

        // 1. Enter browser fullscreen
        await triggerBrowserFullscreen();

        // 2. Request canvas pointer lock if available
        const canvas = document.querySelector('#webgl');
        try {
          const lockPromise = canvas?.requestPointerLock?.();
          if (lockPromise && typeof lockPromise.catch === 'function') {
            lockPromise.catch(() => {});
          }
        } catch (err) {}

        // 3. Fire registered start callbacks
        for (const cb of this._playCallbacks) {
          try {
            cb();
          } catch (err) {
            console.error('Error in onPlay callback:', err);
          }
        }

        // 4. Hide loading overlay
        if (this.overlay) {
          this.overlay.classList.add('fade-out');
          setTimeout(() => {
            this.overlay.style.display = 'none';
          }, 400);
        }
      });
    }
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
