/**
 * TreeSelectorUI / EnvironmentSelectorUI
 * Floating status overlay displaying environment and model status.
 */
export class TreeSelectorUI {
  constructor(terrainManager, initialSelection = null) {
    this.terrainManager = terrainManager;
    this.currentSelection = initialSelection;

    this.container = document.createElement('div');
    this.container.id = 'environment-selector-ui';
    this.container.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      z-index: 10000;
      background: rgba(15, 23, 42, 0.88);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 10px;
      padding: 12px 16px;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      user-select: none;
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 260px;
      max-width: 320px;
    `;

    ['click', 'mousedown', 'mouseup', 'keydown', 'keyup', 'pointerdown'].forEach((evt) => {
      this.container.addEventListener(evt, (e) => e.stopPropagation());
    });

    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    `;
    header.innerHTML = `
      <div style="font-weight: 700; font-size: 13px; color: #f8fafc; display: flex; align-items: center; gap: 6px;">
        <span>🏔️</span> Environment Models
      </div>
      <span id="env-status" style="font-size: 10px; font-weight: 600; background: rgba(56, 189, 248, 0.2); color: #38bdf8; padding: 2px 7px; border-radius: 4px; font-family: monospace;">Ready</span>
    `;
    this.container.appendChild(header);

    const desc = document.createElement('div');
    desc.id = 'env-desc';
    desc.style.cssText = 'font-size: 11px; color: #94a3b8; line-height: 1.4;';
    desc.innerHTML = 'All models cleared. Drop your new <b>.glb</b>, <b>.gltf</b>, or <b>.fbx</b> models into <code>public/models/</code> to populate the world.';
    this.container.appendChild(desc);

    const footer = document.createElement('div');
    footer.style.cssText = 'font-size: 10px; color: #64748b; margin-top: 4px; border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 6px;';
    footer.innerHTML = 'Press <b>F</b> to toggle Fly/Walk | <b>WASD</b> to move | Click to look';
    this.container.appendChild(footer);

    document.body.appendChild(this.container);
  }
}
