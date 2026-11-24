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
      padding: 3px 8px;
      background: rgba(15, 23, 42, 0.55);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 5px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.2;
      color: #22c55e;
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
