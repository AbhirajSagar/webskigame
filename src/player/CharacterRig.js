import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

// Pre-allocated scratch objects for zero-allocation 60 FPS update loop
const _scratchTargetNormal = new THREE.Vector3();
const _scratchCamForward = new THREE.Vector3();
const _scratchCharX = new THREE.Vector3();
const _scratchCharY = new THREE.Vector3();
const _scratchCharZ = new THREE.Vector3();
const _scratchBasisMatrix = new THREE.Matrix4();

/**
 * CharacterRig
 * Manages the first-person 3D skier character model (character.fbx).
 *
 * Solves:
 * 1. Zero-Wobble Ground Anchoring: Root is anchored directly to the player's ground position (X, Z),
 *    eliminating the 1.7m lever-arm pendulum swing that caused the model to wobble around.
 * 2. Surface Normal Alignment: The character's UP vector (+Y) is locked to the terrain surface normal
 *    at the exact point on the terrain where the character is standing.
 * 3. Instant Yaw Lock: Horizontal turning tracks player camera view instantaneously without rubber-banding.
 * 4. Micro-Damped Terrain Normal: Smooths out high-frequency polygon noise ripples so skis glide flush
 *    against the mountain contours without jitter.
 * 5. PBR Lighting & Shadows: Full standard materials with authentic shadow casting on snow.
 */
export class CharacterRig {
  /**
   * @param {THREE.Scene} scene - The main Three.js scene
   */
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'FirstPersonCharacterRig';

    this.isLoaded = false;
    this.model = null;

    // Smoothed surface normal for stable, non-wobbling terrain alignment
    this.currentNormal = new THREE.Vector3(0, 1, 0);
    this._initialized = false;

    // Dynamic tuck offset
    this.tuckOffset = 0.0;

    if (this.scene) {
      this.scene.add(this.root);
    }
  }

  /**
   * Loads the modified character FBX model, scales from centimeters to meters,
   * centers horizontal stance, and binds PBR materials with shadow casting.
   * @param {string} [path='/models/character.fbx']
   * @returns {Promise<THREE.Group|null>}
   */
  load(path = '/models/character.fbx') {
    return new Promise((resolve) => {
      const loader = new FBXLoader();
      loader.load(
        path,
        (fbx) => {
          this.model = fbx;

          // Convert FBX authoring units (centimeters) to world meters
          this.model.scale.set(0.01, 0.01, 0.01);

          // Center character model in local horizontal space so collar/neck is centered at (0, 0)
          this.model.position.set(0, 0, -0.12);

          // Configure PBR materials and shadow rendering
          fbx.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;

              const mats = Array.isArray(child.material) ? child.material : [child.material];
              const pbrMats = mats.map((m) => {
                if (!m) return m;
                const matName = (m.name || '').toLowerCase();
                const isMetal = matName.includes('metal') || matName.includes('silver');
                const isSki = matName.includes('ski');
                const hasValidMap = m.map && (m.map.image || m.map.isCanvasTexture || m.map.isDataTexture);

                return new THREE.MeshStandardMaterial({
                  name: m.name,
                  color: m.color || new THREE.Color(0xcccccc),
                  map: hasValidMap ? m.map : null,
                  roughness: isMetal ? 0.35 : (isSki ? 0.45 : 0.72),
                  metalness: isMetal ? 0.85 : 0.08,
                  envMapIntensity: 1.0,
                });
              });

              child.material = Array.isArray(child.material) ? pbrMats : pbrMats[0];
            }
          });

          this.root.add(this.model);
          this.isLoaded = true;
          resolve(this.model);
        },
        undefined,
        (err) => {
          console.warn('CharacterRig: Failed to load character model:', err);
          resolve(null);
        }
      );
    });
  }

  /**
   * Updates character transform: locks UP vector to terrain surface normal,
   * tracks view direction without lag, and anchors to ground contact point.
   * @param {number} dt - Delta time in seconds
   * @param {PlayerController} player - Active player controller instance
   */
  update(dt, player) {
    if (!this.isLoaded || !this.root) return;

    // 1. Sample surface normal at the exact point on the terrain where the character is standing
    const rawNorm = player.terrainManager?.getNormalAt(player.position.x, player.position.z) || { x: 0, y: 1, z: 0 };
    _scratchTargetNormal.set(rawNorm.x, rawNorm.y, rawNorm.z);
    if (_scratchTargetNormal.lengthSq() > 0.0001) {
      _scratchTargetNormal.normalize();
    } else {
      _scratchTargetNormal.set(0, 1, 0);
    }

    if (!this._initialized) {
      this.currentNormal.copy(_scratchTargetNormal);
      this._initialized = true;
    } else {
      // Damps out high-frequency polygon noise ripples so normal transition is silky smooth
      this.currentNormal.lerp(_scratchTargetNormal, Math.min(1.0, 16.0 * dt)).normalize();
    }

    // 2. Camera horizontal look direction (yaw) - tracks view instantly with ZERO lag
    _scratchCamForward.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));

    // 3. Project look direction onto the terrain tangent plane (perpendicular to surface normal)
    const dot = _scratchCamForward.dot(this.currentNormal);
    _scratchCharZ.copy(_scratchCamForward).addScaledVector(this.currentNormal, -dot);
    if (_scratchCharZ.lengthSq() > 0.0001) {
      _scratchCharZ.normalize();
    } else {
      _scratchCharZ.set(0, 0, 1);
    }

    // 4. Construct orthonormal basis:
    // Local +Y: Exact terrain surface normal (character stands perpendicular to slope)
    // Local +Z: Forward tangent along the slope surface (skis direction)
    // Local +X: Lateral vector (cross product)
    _scratchCharY.copy(this.currentNormal);
    _scratchCharX.crossVectors(_scratchCharY, _scratchCharZ).normalize();

    _scratchBasisMatrix.makeBasis(_scratchCharX, _scratchCharY, _scratchCharZ);
    this.root.quaternion.setFromRotationMatrix(_scratchBasisMatrix);

    // 5. Position: Anchor character base directly at player's standing location on snow
    // Eliminates any 1.7m lever-arm swinging or wobbling
    const feetY = (Number.isFinite(player.cameraY) ? player.cameraY : player.position.y) - player.eyeHeight;
    this.root.position.set(player.position.x, feetY, player.position.z);

    // 6. Athletic tuck / crouch stance
    if (this.model) {
      const isTucking = player.keys.forward || player.keys.sprint;
      const targetTuck = isTucking ? 0.06 : 0.0;
      this.tuckOffset = THREE.MathUtils.damp(this.tuckOffset, targetTuck, 8.0, dt);
      this.model.position.y = -this.tuckOffset;
      this.model.position.z = -0.12 + this.tuckOffset * 0.4; // Slight forward lean when tucking
    }
  }

  /**
   * Safely disposes character model, geometries, and materials.
   */
  dispose() {
    if (this.scene && this.root) {
      this.scene.remove(this.root);
    }
    if (this.model) {
      this.model.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m) => {
            if (m?.map) m.map.dispose();
            if (m) m.dispose();
          });
        }
      });
      this.model = null;
    }
    this.isLoaded = false;
  }
}
