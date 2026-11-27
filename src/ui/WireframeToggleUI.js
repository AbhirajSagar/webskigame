import * as THREE from 'three';
import { TreeGenerator } from '../terrain/TreeGenerator.js';

/**
 * WireframeToggleUI
 * Glassmorphic HUD button to toggle between wireframe and solid rendering.
 *
 * Capabilities:
 * 1. Global Scene & Material Wireframe:
 *    Toggles wireframe across terrain chunks, conifer trees, tree impostors,
 *    clouds, leaf particles, snowboard, and character meshes.
 * 2. Streaming Chunk Guarantee:
 *    Updates shared terrain and tree materials so any newly streamed chunks or
 *    impostor LOD transitions automatically respect the active wireframe state.
 * 3. Dual Interaction:
 *    - Clickable UI button in the top-right HUD with glowing active state.
 *    - Keyboard shortcut: Press 'Z' at any time (even during active mouse-locked ski runs).
 */
export class WireframeToggleUI {
  /**
   * @param {object} options
   * @param {THREE.Scene} [options.scene]
   * @param {object} [options.player]
   * @param {object} [options.terrainManager]
   * @param {object} [options.cloudSystem]
   */
  constructor(options = {}) {
    this.scene = options.scene || window.__GAME?.scene;
    this.player = options.player || window.__GAME?.player;
    this.terrainManager = options.terrainManager || window.__GAME?.terrainManager;
    this.cloudSystem = options.cloudSystem || window.__GAME?.cloudSystem;

    this.isWireframe = false;
    this.callbacks = [];

    this._createDOM();
    this._bindEvents();
  }

  /**
   * Creates the glassmorphic toggle button in the top-right corner.
   * @private
   */
  _createDOM() {
    this.button = document.createElement('button');
    this.button.id = 'wireframe-toggle-btn';
    this.button.type = 'button';
    this.button.title = 'Toggle Wireframe / Solid Rendering (Hotkey: Z)';

    // Modern glassmorphism HUD styling matching FpsCounter
    this.button.style.cssText = `
      position: fixed;
      top: 14px;
      right: 14px;
      z-index: 99999;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 14px;
      background: rgba(15, 23, 42, 0.82);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
      font-family: 'Dosis', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      font-weight: 700;
      color: #e2e8f0;
      letter-spacing: 0.02em;
      cursor: pointer;
      user-select: none;
      pointer-events: auto;
      touch-action: manipulation;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      outline: none;
    `;

    // SVG Wireframe Mesh Icon
    this.iconSvg = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
        <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
        <polyline points="2 17 12 22 22 17"></polyline>
        <polyline points="2 12 12 17 22 12"></polyline>
      </svg>
    `;

    this._updateButtonUI();

    // Hover & Active micro-interactions
    this.button.addEventListener('mouseenter', () => {
      if (!this.isWireframe) {
        this.button.style.background = 'rgba(30, 41, 59, 0.90)';
        this.button.style.borderColor = 'rgba(255, 255, 255, 0.32)';
      }
      this.button.style.transform = 'translateY(-1px)';
    });

    this.button.addEventListener('mouseleave', () => {
      if (!this.isWireframe) {
        this.button.style.background = 'rgba(15, 23, 42, 0.82)';
        this.button.style.borderColor = 'rgba(255, 255, 255, 0.18)';
      }
      this.button.style.transform = 'translateY(0)';
    });

    this.button.addEventListener('mousedown', () => {
      this.button.style.transform = 'translateY(1px) scale(0.98)';
    });

    this.button.addEventListener('mouseup', () => {
      this.button.style.transform = 'translateY(-1px)';
    });

    document.body.appendChild(this.button);
  }

  /**
   * Binds click and keyboard 'Z' shortcut handlers.
   * @private
   */
  _bindEvents() {
    // Click toggle
    this.button.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.toggle();
    });

    // Hotkey toggle: 'Z' or 'z'
    window.addEventListener('keydown', (e) => {
      // Ignore if user is currently typing in an input field
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

      if (e.key === 'z' || e.key === 'Z') {
        this.toggle();
      }
    });
  }

  /**
   * Updates button DOM text, colors, and active glow.
   * @private
   */
  _updateButtonUI() {
    if (this.isWireframe) {
      this.button.innerHTML = `
        ${this.iconSvg}
        <span>Wireframe</span>
        <span style="display:inline-block; font-size:10px; padding:1px 5px; border-radius:4px; background:rgba(56, 189, 248, 0.22); color:#38bdf8; border:1px solid rgba(56, 189, 248, 0.45); font-weight:800;">ON</span>
        <span style="font-size:11px; opacity:0.65; margin-left:1px;">[Z]</span>
      `;
      this.button.style.color = '#38bdf8';
      this.button.style.borderColor = 'rgba(56, 189, 248, 0.70)';
      this.button.style.boxShadow = '0 0 16px rgba(56, 189, 248, 0.35), 0 4px 16px rgba(0, 0, 0, 0.40)';
      this.button.style.background = 'rgba(15, 23, 42, 0.92)';
    } else {
      this.button.innerHTML = `
        ${this.iconSvg}
        <span>Wireframe</span>
        <span style="display:inline-block; font-size:10px; padding:1px 5px; border-radius:4px; background:rgba(148, 163, 184, 0.16); color:#94a3b8; border:1px solid rgba(255, 255, 255, 0.12); font-weight:700;">OFF</span>
        <span style="font-size:11px; opacity:0.55; margin-left:1px;">[Z]</span>
      `;
      this.button.style.color = '#e2e8f0';
      this.button.style.borderColor = 'rgba(255, 255, 255, 0.18)';
      this.button.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.35)';
      this.button.style.background = 'rgba(15, 23, 42, 0.82)';
    }
  }

  /**
   * Toggles between wireframe and solid rendering.
   * @returns {boolean} New wireframe state
   */
  toggle() {
    this.setWireframe(!this.isWireframe);
    return this.isWireframe;
  }

  /**
   * Explicitly sets wireframe mode across all game entities and materials.
   * @param {boolean} isWireframe
   */
  setWireframe(isWireframe) {
    this.isWireframe = !!isWireframe;

    const visitedMaterials = new Set();
    const applyToMaterial = (mat) => {
      if (!mat || visitedMaterials.has(mat)) return;
      visitedMaterials.add(mat);

      if (Array.isArray(mat)) {
        mat.forEach(applyToMaterial);
        return;
      }

      if ('wireframe' in mat) {
        mat.wireframe = this.isWireframe;
        mat.needsUpdate = true;
      }
    };

    // 1. Traverse all meshes in the main scene (Terrain, Trees, Foliage, Scenery)
    const targetScene = this.scene || window.__GAME?.scene;
    if (targetScene) {
      targetScene.traverse((obj) => {
        if (obj.isMesh && obj.material) {
          applyToMaterial(obj.material);
        }
      });
    }

    // 2. Traverse character and snowboard meshes
    const targetPlayer = this.player || window.__GAME?.player;
    if (targetPlayer?.character?.group) {
      targetPlayer.character.group.traverse((obj) => {
        if (obj.isMesh && obj.material) {
          applyToMaterial(obj.material);
        }
      });
    }

    // 3. Shared Terrain Material Factory (guarantees streaming chunks respect active state)
    const targetTerrain = this.terrainManager || window.__GAME?.terrainManager;
    if (targetTerrain?.materialFactory) {
      const mf = targetTerrain.materialFactory;
      if (mf.sharedMaterial) applyToMaterial(mf.sharedMaterial);
      if (mf.sharedDistantMaterial) applyToMaterial(mf.sharedDistantMaterial);
    }

    // 4. Tree Generator Shared Materials & Cache
    if (TreeGenerator._materialCache) {
      Object.values(TreeGenerator._materialCache).forEach(applyToMaterial);
    }
    if (targetTerrain?.treeGenerator?.models) {
      targetTerrain.treeGenerator.models.forEach((m) => {
        if (m.materials) applyToMaterial(m.materials);
        if (m.impostor?.material) applyToMaterial(m.impostor.material);
      });
    }

    // 5. Cloud System Material
    const targetClouds = this.cloudSystem || window.__GAME?.cloudSystem;
    if (targetClouds?.material) {
      applyToMaterial(targetClouds.material);
    }

    // 6. Update UI button appearance
    this._updateButtonUI();

    // 7. Invoke any registered state change listeners
    for (const cb of this.callbacks) {
      try {
        cb(this.isWireframe);
      } catch (err) {
        console.warn('WireframeToggleUI listener error:', err);
      }
    }
  }

  /**
   * Registers a listener callback invoked when wireframe state changes.
   * @param {function(boolean)} callback
   */
  onChange(callback) {
    if (typeof callback === 'function') {
      this.callbacks.push(callback);
    }
  }

  /**
   * Cleans up DOM elements and listeners.
   */
  dispose() {
    if (this.button && this.button.parentNode) {
      this.button.parentNode.removeChild(this.button);
    }
    this.callbacks = [];
  }
}
