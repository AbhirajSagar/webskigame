import Stats from 'three/examples/jsm/libs/stats.module.js';

/**
 * Performance Monitor
 * Displays live FPS and JavaScript Heap memory usage (both canvas graphs and exact MB readouts).
 */
export class StatsMonitor {
  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'perf-monitor';
    this.container.style.cssText = `
      position: fixed;
      top: 10px;
      left: 10px;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 6px;
      pointer-events: none;
      user-select: none;
      font-family: 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace;
    `;

    // 1. Classic Stats.js Graphs (FPS + Heap panels)
    this.stats = new Stats();
    this.stats.dom.style.position = 'static';
    this.stats.dom.style.display = 'flex';
    this.stats.dom.style.flexDirection = 'row';
    this.stats.dom.style.gap = '6px';
    this.stats.dom.style.pointerEvents = 'auto';

    // Show both FPS (index 0) and Memory (index 2, if available) side-by-side
    for (let i = 0; i < this.stats.dom.children.length; i++) {
      const child = this.stats.dom.children[i];
      if (i === 0 || i === 2) {
        child.style.display = 'inline-block';
        child.style.position = 'relative';
      } else {
        child.style.display = 'none';
      }
    }

    // Prevent clicking from collapsing the panels
    this.stats.dom.addEventListener(
      'click',
      (e) => {
        e.stopImmediatePropagation();
      },
      true
    );

    this.container.appendChild(this.stats.dom);

    // 2. High-precision Digital Text Readout Pill
    this.pill = document.createElement('div');
    this.pill.style.cssText = `
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 6px;
      padding: 4px 8px;
      color: #e2e8f0;
      font-size: 11px;
      line-height: 1.4;
      display: flex;
      gap: 10px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      width: fit-content;
    `;

    this.fpsText = document.createElement('span');
    this.fpsText.style.color = '#38bdf8';
    this.fpsText.textContent = 'FPS: --';

    this.heapText = document.createElement('span');
    this.heapText.style.color = '#f43f5e';
    this.heapText.textContent = 'Heap: -- MB';

    this.pill.appendChild(this.fpsText);
    this.pill.appendChild(this.heapText);
    this.container.appendChild(this.pill);

    document.body.appendChild(this.container);

    // Telemetry tracking
    this.frameCount = 0;
    this.lastTime = performance.now();
    this.lastPillUpdate = 0;
  }

  begin() {
    this.stats.begin();
  }

  end() {
    this.stats.end();

    this.frameCount++;
    const now = performance.now();

    // Update text pill every 250ms for stable readability
    if (now - this.lastPillUpdate > 250) {
      const elapsed = (now - this.lastTime) / 1000;
      const fps = Math.round(this.frameCount / elapsed);
      this.fpsText.textContent = `FPS: ${fps}`;

      if (window.performance && window.performance.memory) {
        const mem = window.performance.memory;
        const usedMB = (mem.usedJSHeapSize / 1048576).toFixed(1);
        const totalMB = (mem.totalJSHeapSize / 1048576).toFixed(1);
        this.heapText.textContent = `Heap: ${usedMB} MB / ${totalMB} MB`;
      } else {
        this.heapText.textContent = 'Heap: N/A (Chromium only)';
      }

      this.frameCount = 0;
      this.lastTime = now;
      this.lastPillUpdate = now;
    }
  }
}
