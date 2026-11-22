/**
 * FpsCounter
 * Lightweight FPS counter monitor.
 * Displays real-time frames-per-second in the top-left HUD.
 */
export class FpsCounter {
  constructor() {
    this.dom = document.createElement('div');
    this.dom.id = 'fps-counter';
    this.dom.style.cssText = `
      position: fixed;
      top: 14px;
      left: 14px;
      z-index: 99999;
      pointer-events: none;
      user-select: none;
      display: flex;
      align-items: center;
      padding: 6px 14px;
      background: rgba(15, 23, 42, 0.80);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "SF Mono", Consolas, monospace;
      font-size: 13px;
      font-weight: 700;
      color: #f8fafc;
      letter-spacing: 0.02em;
    `;

    this.fpsValue = document.createElement('span');
    this.fpsValue.style.color = '#22c55e';
    this.fpsValue.textContent = '-- FPS';

    this.dom.appendChild(this.fpsValue);
    document.body.appendChild(this.dom);

    this.frames = 0;
    this.prevTime = performance.now();
  }

  /**
   * @param {number} [speedKmh]
   * @param {boolean} [isAirborne]
   * @param {string} [mode]
   * @param {number} [altitude]
   */
  update(speedKmh = 0, isAirborne = false, mode = 'ski', altitude = 0) {
    this.frames++;
    const now = performance.now();
    const elapsed = now - this.prevTime;

    if (elapsed >= 100) {
      const fps = Math.round((this.frames * 1000) / elapsed);
      this.frames = 0;
      this.prevTime = now;

      this.fpsValue.textContent = `${fps} FPS`;

      if (fps >= 55) {
        this.fpsValue.style.color = '#22c55e';
      } else if (fps >= 30) {
        this.fpsValue.style.color = '#f59e0b';
      } else {
        this.fpsValue.style.color = '#ef4444';
      }
    }
  }
}
