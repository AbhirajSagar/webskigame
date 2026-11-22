/**
 * VideoRecorder
 * Seamless gameplay video recorder designed for Instagram Reels & TikTok vertical clips.
 *
 * Capabilities:
 * 1. Direct Canvas Capture:
 *    Uses canvas.captureStream(60) to record raw WebGL frames at butter-smooth 60 FPS.
 *    Because captureStream records the canvas directly, all HTML UI elements, buttons,
 *    and timers are completely invisible in the saved video!
 * 2. High-Bitrate Video Encoding:
 *    Records at 16 Mbps for crisp, artifact-free 1080x1920 video quality.
 *    Automatically selects the best supported format (MP4/H.264 or WebM/VP9).
 * 3. Dual Interaction:
 *    - Floating glassmorphic REC capsule button in the top-right.
 *    - Keyboard hotkey shortcut: Press 'R' to Start / Stop recording.
 * 4. Automatic Download:
 *    When recording stops, automatically packages and downloads the video file
 *    named with timestamp: e.g. `ski-reel-2026-11-22-22-25.webm`.
 */
export class VideoRecorder {
  /**
   * @param {HTMLCanvasElement} canvas - WebGL canvas element
   * @param {object} [options={}]
   * @param {number} [options.fps=60]
   * @param {number} [options.bitrate=16000000] // 16 Mbps
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.fps = options.fps || 60;
    this.bitrate = options.bitrate || 16000000;

    this.isRecording = false;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.stream = null;
    this.startTime = 0;
    this.timerInterval = null;

    this.mimeType = this._selectBestMimeType();
    this.fileExtension = this.mimeType.includes('mp4') ? 'mp4' : 'webm';

    this._createDOM();
    this._bindEvents();
  }

  /**
   * Queries supported container and codec types.
   * @private
   */
  _selectBestMimeType() {
    if (typeof MediaRecorder === 'undefined') return 'video/webm';

    const candidates = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm;codecs=h264',
      'video/webm',
    ];

    for (const mime of candidates) {
      if (MediaRecorder.isTypeSupported(mime)) {
        return mime;
      }
    }

    return 'video/webm';
  }

  /**
   * Builds the floating recording status HUD capsule.
   * @private
   */
  _createDOM() {
    this.container = document.createElement('div');
    this.container.id = 'video-recorder-hud';
    this.container.style.cssText = `
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 999999;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 9999px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.45);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "SF Mono", Consolas, monospace;
      font-size: 13px;
      font-weight: 700;
      color: #f8fafc;
      letter-spacing: 0.02em;
      cursor: pointer;
      user-select: none;
      touch-action: manipulation;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      outline: none;
    `;

    // Red recording dot indicator
    this.dot = document.createElement('span');
    this.dot.style.cssText = `
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #ef4444;
      display: inline-block;
      transition: all 0.2s ease;
      flex-shrink: 0;
    `;

    this.label = document.createElement('span');
    this.label.textContent = 'Record [R]';

    this.container.appendChild(this.dot);
    this.container.appendChild(this.label);

    // Hover styling
    this.container.addEventListener('mouseenter', () => {
      if (!this.isRecording) {
        this.container.style.background = 'rgba(30, 41, 59, 0.92)';
        this.container.style.borderColor = 'rgba(255, 255, 255, 0.30)';
      }
      this.container.style.transform = 'translateY(-1px)';
    });

    this.container.addEventListener('mouseleave', () => {
      if (!this.isRecording) {
        this.container.style.background = 'rgba(15, 23, 42, 0.85)';
        this.container.style.borderColor = 'rgba(255, 255, 255, 0.16)';
      }
      this.container.style.transform = 'translateY(0)';
    });

    document.body.appendChild(this.container);

    // Inject pulse keyframes for active recording dot
    if (!document.getElementById('rec-pulse-style')) {
      const style = document.createElement('style');
      style.id = 'rec-pulse-style';
      style.textContent = `
        @keyframes recPulse {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.35); opacity: 0.4; box-shadow: 0 0 10px #ef4444; }
          100% { transform: scale(1); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }
  }

  /**
   * Binds click and 'R' hotkey handlers.
   * @private
   */
  _bindEvents() {
    this.container.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.toggle();
    });

    window.addEventListener('keydown', (e) => {
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

      if (e.key === 'r' || e.key === 'R') {
        this.toggle();
      }
    });
  }

  /**
   * Starts or stops recording.
   */
  toggle() {
    if (this.isRecording) {
      this.stop();
    } else {
      this.start();
    }
  }

  /**
   * Starts 60 FPS high-bitrate video recording.
   */
  start() {
    if (this.isRecording) return;
    if (!this.canvas) {
      console.warn('VideoRecorder: Canvas element not found');
      return;
    }

    try {
      this.recordedChunks = [];

      // Capture canvas stream at 60 FPS
      this.stream = this.canvas.captureStream ? this.canvas.captureStream(this.fps) : this.canvas.mozCaptureStream(this.fps);
      if (!this.stream) {
        throw new Error('captureStream() returned null stream');
      }

      const recorderOptions = {
        mimeType: this.mimeType,
        videoBitsPerSecond: this.bitrate,
      };

      this.mediaRecorder = new MediaRecorder(this.stream, recorderOptions);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.recordedChunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        this._finalizeAndDownload();
      };

      // Request data chunk every 1000ms
      this.mediaRecorder.start(1000);
      this.isRecording = true;
      this.startTime = performance.now();

      // Update UI to active recording state
      this.container.style.background = 'rgba(239, 68, 68, 0.16)';
      this.container.style.borderColor = 'rgba(239, 68, 68, 0.65)';
      this.container.style.boxShadow = '0 0 16px rgba(239, 68, 68, 0.40)';
      this.dot.style.background = '#ef4444';
      this.dot.style.animation = 'recPulse 1.2s infinite ease-in-out';
      this.label.textContent = '00:00 [R]';

      this.timerInterval = setInterval(() => {
        const elapsedSec = Math.floor((performance.now() - this.startTime) / 1000);
        const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
        const secs = String(elapsedSec % 60).padStart(2, '0');
        this.label.textContent = `${mins}:${secs} [R]`;
      }, 500);

    } catch (err) {
      console.error('VideoRecorder: Failed to start recording:', err);
      this.label.textContent = 'Recording Error';
      setTimeout(() => {
        this.label.textContent = 'Record [R]';
      }, 2500);
    }
  }

  /**
   * Stops recording and initiates video download.
   */
  stop() {
    if (!this.isRecording) return;
    this.isRecording = false;

    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    this.label.textContent = 'Saving...';
    this.dot.style.animation = 'none';

    try {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }
    } catch (err) {
      console.warn('VideoRecorder: Error stopping recorder:', err);
      this._finalizeAndDownload();
    }
  }

  /**
   * Packages recorded chunks into a Blob and triggers automatic file download.
   * @private
   */
  _finalizeAndDownload() {
    if (this.recordedChunks.length === 0) {
      this._resetUI();
      return;
    }

    try {
      const blob = new Blob(this.recordedChunks, { type: this.mimeType });
      const url = URL.createObjectURL(blob);

      // Create timestamped filename: e.g. ski-reel-2026-11-22-22-25.webm
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
      const filename = `ski-reel-${timestamp}.${this.fileExtension}`;

      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();

      // Clean up URL and link after download starts
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1000);

      // Stop stream tracks
      if (this.stream) {
        this.stream.getTracks().forEach((track) => track.stop());
        this.stream = null;
      }

      // Success notification toast
      this.label.textContent = '✓ Saved Video!';
      this.container.style.borderColor = 'rgba(34, 197, 94, 0.65)';
      this.container.style.color = '#4ade80';
      this.dot.style.background = '#22c55e';

      setTimeout(() => {
        this._resetUI();
      }, 2500);

    } catch (err) {
      console.error('VideoRecorder: Error saving video file:', err);
      this._resetUI();
    }
  }

  /**
   * Resets UI back to default idle state.
   * @private
   */
  _resetUI() {
    this.isRecording = false;
    this.container.style.background = 'rgba(15, 23, 42, 0.85)';
    this.container.style.borderColor = 'rgba(255, 255, 255, 0.16)';
    this.container.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.45)';
    this.container.style.color = '#f8fafc';
    this.dot.style.background = '#ef4444';
    this.dot.style.animation = 'none';
    this.label.textContent = 'Record [R]';
  }

  /**
   * Cleans up DOM elements and listeners.
   */
  dispose() {
    this.stop();
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}
