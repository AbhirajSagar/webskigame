import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

// Pre-allocated scratch objects for zero-allocation per-frame transform updates
const _scratchNormal = new THREE.Vector3();
const _scratchForward = new THREE.Vector3();
const _scratchTangent = new THREE.Vector3();
const _scratchBinormal = new THREE.Vector3();
const _scratchMatrix = new THREE.Matrix4();

/**
 * SnowboardRig
 * Places public/models/board.fbx directly under the player on the snow terrain.
 * Uses the model and its materials as-is without adding extra details or modifications.
 */
export class SnowboardRig {
  /**
   * @param {THREE.Scene} scene
   * @param {string} [modelPath='/models/board.fbx']
   */
  constructor(scene, modelPath = '/models/board.fbx') {
    this.scene = scene;
    this.modelPath = modelPath;

    this.group = new THREE.Group();
    this.group.name = 'Snowboard';
    this.isLoaded = false;

    // Add directly to the world scene under the player
    if (this.scene) {
      this.scene.add(this.group);
    }
  }

  /**
   * Loads board.fbx using FBXLoader.
   * @returns {Promise<THREE.Group>}
   */
  load() {
    return new Promise((resolve) => {
      const loader = new FBXLoader();
      loader.load(
        this.modelPath,
        (fbx) => {
          // Scale to snowboard dimensions (~1.56m length, ~0.28m width)
          fbx.scale.set(0.0014, 0.0026, 0.0026);

          // Add the model directly to the group without modifying materials
          this.group.add(fbx);
          this.isLoaded = true;
          resolve(this.group);
        },
        undefined,
        (err) => {
          console.warn('Failed to load board.fbx:', err);
          resolve(this.group);
        }
      );
    });
  }

  /**
   * Updates snowboard position and orientation directly under the player.
   * @param {number} dt Delta time in seconds
   * @param {PlayerController} player
   */
  update(dt, player) {
    if (!this.group || !this.isLoaded) return;

    // Hidden in fly spectator mode
    const shouldBeVisible = player.mode === 'ski';
    if (this.group.visible !== shouldBeVisible) {
      this.group.visible = shouldBeVisible;
    }
    if (!shouldBeVisible) return;

    // Ensure the group is in the scene
    if (this.scene && this.group.parent !== this.scene) {
      this.scene.add(this.group);
    }

    // Place directly under the player on the terrain
    const groundH = player.terrainManager?.getHeightAt
      ? player.terrainManager.getHeightAt(player.position.x, player.position.z)
      : (player.position.y - player.eyeHeight);

    const boardY = player.isGrounded ? (groundH + 0.02) : (player.position.y - player.eyeHeight);
    this.group.position.set(player.position.x, boardY, player.position.z);

    // Orient along player heading and terrain slope normal
    // if (player.terrainManager?.getNormalAt) {
    //   const rawNorm = player.terrainManager.getNormalAt(player.position.x, player.position.z);
    //   _scratchNormal.set(rawNorm.x, rawNorm.y, rawNorm.z).normalize();

    //   _scratchForward.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    //   _scratchTangent.copy(_scratchForward).projectOnPlane(_scratchNormal).normalize();
    //   _scratchBinormal.crossVectors(_scratchTangent, _scratchNormal).normalize();

    //   _scratchMatrix.makeBasis(_scratchBinormal, _scratchNormal, _scratchTangent.negate());
    //   this.group.quaternion.setFromRotationMatrix(_scratchMatrix);
    // } else {
      this.group.rotation.set(0, player.yaw, 0);
    // }
  }
}
