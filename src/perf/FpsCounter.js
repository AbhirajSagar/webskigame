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
      top: 10px;
      left: 10px;
      z-index: 99999;
      pointer-events: none;
      user-select: none;
      padding: 4px 8px;
      background: rgba(18, 20, 23, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      font-family: 'Dosis', -apple-system, BlinkMacSystemFont, sans-serif;
      font-variant-numeric: tabular-nums;
      font-size: 12px;
      font-weight: 700;
      line-height: 1.2;
      color: #e4e4e7;
      letter-spacing: 0.02em;
    `;
    this.dom.textContent = '-- FPS';

    document.body.appendChild(this.dom);

    this.frames = 0;
    this.prevTime = performance.now();
  }

  update() {
    this.frames++;
    const now = performance.now();
    const elapsed = now - this.prevTime;

    if (elapsed >= 200) {
      const fps = Math.round((this.frames * 1000) / elapsed);
      this.frames = 0;
      this.prevTime = now;

      this.dom.textContent = `${fps} FPS`;

      if (fps >= 55) {
        this.dom.style.color = '#22c55e';
      } else if (fps >= 30) {
        this.dom.style.color = '#f59e0b';
      } else {
        this.dom.style.color = '#ef4444';
      }
    }
  }
}
