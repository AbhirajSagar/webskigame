/**
 * FpsCounter
 * Ultra-lightweight, zero-allocation FPS, frame time, and speed telemetry monitor.
 * Displays clean alpine HUD badge in the top-left corner.
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
      gap: 8px;
      padding: 6px 14px;
      background: rgba(15, 23, 42, 0.75);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "SF Mono", Consolas, monospace;
      font-size: 12px;
      font-weight: 600;
      color: #f8fafc;
      letter-spacing: 0.02em;
    `;

    this.fpsValue = document.createElement('span');
    this.fpsValue.style.color = '#22c55e';
    this.fpsValue.textContent = '-- FPS';

    this.divider1 = document.createElement('span');
    this.divider1.style.opacity = '0.35';
    this.divider1.textContent = '|';

    this.msValue = document.createElement('span');
    this.msValue.style.color = '#94a3b8';
    this.msValue.style.fontSize = '11px';
    this.msValue.style.fontWeight = '500';
    this.msValue.textContent = '-- ms';

    this.divider2 = document.createElement('span');
    this.divider2.style.opacity = '0.35';
    this.divider2.textContent = '|';

    this.speedValue = document.createElement('span');
    this.speedValue.style.color = '#38bdf8';
    this.speedValue.style.fontSize = '12px';
    this.speedValue.style.fontWeight = '600';
    this.speedValue.textContent = '0 km/h';

    this.dom.appendChild(this.fpsValue);
    this.dom.appendChild(this.divider1);
    this.dom.appendChild(this.msValue);
    this.dom.appendChild(this.divider2);
    this.dom.appendChild(this.speedValue);
    document.body.appendChild(this.dom);

    this.frames = 0;
    this.prevTime = performance.now();
  }

  /**
   * @param {number} [speedKmh] - Current player velocity in km/h
   * @param {boolean} [isAirborne] - Whether player is currently in flight
   * @param {string} [mode] - Active player mode ('ski' | 'fly')
   */
  update(speedKmh = 0, isAirborne = false, mode = 'ski') {
    this.frames++;
    const now = performance.now();
    const elapsed = now - this.prevTime;

    // Batched update every 120ms prevents DOM thrashing while maintaining responsive speed readout
    if (elapsed >= 120) {
      const fps = Math.round((this.frames * 1000) / elapsed);
      const ms = (elapsed / this.frames).toFixed(1);
      this.frames = 0;
      this.prevTime = now;

      this.fpsValue.textContent = `${fps} FPS`;
      this.msValue.textContent = `${ms} ms`;

      if (fps >= 55) {
        this.fpsValue.style.color = '#22c55e';
      } else if (fps >= 30) {
        this.fpsValue.style.color = '#f59e0b';
      } else {
        this.fpsValue.style.color = '#ef4444';
      }

      if (mode === 'fly') {
        this.speedValue.textContent = `FLY ${speedKmh} km/h`;
        this.speedValue.style.color = '#38bdf8';
      } else if (isAirborne) {
        this.speedValue.textContent = `AIR ${speedKmh} km/h`;
        this.speedValue.style.color = '#a855f7'; // Purple badge for airtime
      } else {
        this.speedValue.textContent = `${speedKmh} km/h`;
        if (speedKmh >= 90) {
          this.speedValue.style.color = '#f43f5e'; // High speed red/rose
        } else if (speedKmh >= 50) {
          this.speedValue.style.color = '#fbbf24'; // Fast amber
        } else {
          this.speedValue.style.color = '#38bdf8'; // Cruising cyan
        }
      }
    }
  }
}
