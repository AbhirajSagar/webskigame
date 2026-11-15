/**
 * FpsCounter
 * Lightweight FPS and real-time airborne height telemetry monitor.
 * Displays FPS and real-time / peak airborne height in the top-left HUD.
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
      background: rgba(15, 23, 42, 0.80);
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

    this.divider = document.createElement('span');
    this.divider.style.opacity = '0.35';
    this.divider.textContent = '|';

    this.airValue = document.createElement('span');
    this.airValue.style.color = '#38bdf8';
    this.airValue.textContent = 'Air: 0.00m';

    this.peakValue = document.createElement('span');
    this.peakValue.style.color = '#c084fc';
    this.peakValue.style.fontSize = '11px';
    this.peakValue.style.fontWeight = '500';
    this.peakValue.textContent = '(Peak: 0.00m)';

    this.dom.appendChild(this.fpsValue);
    this.dom.appendChild(this.divider);
    this.dom.appendChild(this.airValue);
    this.dom.appendChild(this.peakValue);
    document.body.appendChild(this.dom);

    this.frames = 0;
    this.prevTime = performance.now();
    this.currentJumpPeak = 0;
    this.maxRecordedPeak = 0;
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

    const alt = Math.max(0, altitude);

    if (isAirborne) {
      if (alt > this.currentJumpPeak) {
        this.currentJumpPeak = alt;
      }
      if (alt > this.maxRecordedPeak) {
        this.maxRecordedPeak = alt;
      }
    } else {
      this.currentJumpPeak = 0;
    }

    // Frequent updates (every 80ms) ensure responsive airborne height readout during fast jumps
    if (elapsed >= 80) {
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

      this.airValue.textContent = `Air: ${alt.toFixed(2)}m`;
      if (isAirborne && alt > 0.05) {
        this.airValue.style.color = '#38bdf8';
      } else {
        this.airValue.style.color = '#94a3b8';
      }

      const displayPeak = isAirborne ? this.currentJumpPeak : this.maxRecordedPeak;
      this.peakValue.textContent = `(Peak: ${displayPeak.toFixed(2)}m)`;
    }
  }
}
