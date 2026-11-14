import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

// Pre-allocated scratch objects for zero-allocation 60 FPS update loop
const _scratchNormal = new THREE.Vector3();
const _scratchCamForward = new THREE.Vector3();
const _scratchCharX = new THREE.Vector3();
const _scratchCharY = new THREE.Vector3();
const _scratchCharZ = new THREE.Vector3();
const _scratchBasisMatrix = new THREE.Matrix4();
const _scratchTargetQuat = new THREE.Quaternion();
const _scratchHeadOffset = new THREE.Vector3();

/**
 * CharacterRig
 * Manages the first-person 3D skier character model (character.fbx).
 * Anchors the camera directly at the head/eye position above the jacket collar.
 *
 * Provides:
 * 1. Head-Locked Perspective: The camera sits precisely at the character's head level,
 *    allowing the player to look down and see their jacket, gloves, pants, boots, and skis.
 * 2. Slope Pitch Conformance: Automatically tilts the body and skis to conform to the
 *    underlying terrain gradient, ensuring skis stay flush against the snow.
 * 3. Dynamic Carve Banking: Banks the body and edges the skis into turns based on lateral velocity.
 * 4. Tuck / Crouch Dynamics: Drops stance smoothly when tucking or boosting downhill.
 * 5. Full PBR Lighting & Shadows: Casts authentic character shadows onto snow and ice.
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

    // Head / Eye anchor point in character local coordinates (meters)
    // Model collar is at Y=1.588m; eyes sit naturally at Y=1.70m, Z=0.05m
    this.headOffset = new THREE.Vector3(0, 1.70, 0.05);

    // Dynamic Conformance & Lean State
    this.slopePitch = 0.0;
    this.carveRoll = 0.0;
    this.tuckOffset = 0.0;
    this._initializedQuat = false;

    // Component mesh references for animation and alignment
    this.skiL = null;
    this.skiR = null;
    this.bootsL = null;
    this.bootsR = null;
    this.jacket = null;
    this.glovesL = null;
    this.glovesR = null;

    if (this.scene) {
      this.scene.add(this.root);
    }
  }

  /**
   * Loads the character FBX model, scales from centimeters to meters,
   * aligns skis with boots, and binds PBR materials with shadow casting.
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

          // Locate child meshes
          this.skiL = fbx.getObjectByName('skiL');
          this.skiR = fbx.getObjectByName('skiR');
          this.bootsL = fbx.getObjectByName('bootsL');
          this.bootsR = fbx.getObjectByName('bootsR');
          this.jacket = fbx.getObjectByName('jacket');
          this.glovesL = fbx.getObjectByName('glovesL');
          this.glovesR = fbx.getObjectByName('glovesR');

          // Align skis squarely into the boot bindings in neutral ski stance
          if (this.skiR && this.bootsR) {
            this.skiR.rotation.set(-Math.PI / 2, 0, 0);
            this.skiR.position.set(this.bootsR.position.x, 0, this.bootsR.position.z);
          }
          if (this.skiL && this.bootsL) {
            this.skiL.rotation.set(-Math.PI / 2, 0, 0);
            this.skiL.position.set(this.bootsL.position.x, 0, this.bootsL.position.z);
          }

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
   * Updates the character transform so the camera sits directly at the head position.
   * Directly aligns the character's orientation (up vector) to the terrain surface normal.
   * @param {number} dt - Delta time in seconds
   * @param {PlayerController} player - Active player controller instance
   */
  update(dt, player) {
    if (!this.isLoaded || !this.root) return;

    // 1. Surface normal at the exact point on the terrain where the character is standing
    const rawNorm = player.terrainManager?.getNormalAt(player.position.x, player.position.z) || { x: 0, y: 1, z: 0 };
    _scratchNormal.set(rawNorm.x, rawNorm.y, rawNorm.z);
    if (_scratchNormal.lengthSq() > 0.0001) {
      _scratchNormal.normalize();
    } else {
      _scratchNormal.set(0, 1, 0);
    }

    // 2. Camera horizontal look direction (yaw)
    _scratchCamForward.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));

    // 3. Project look direction onto the terrain tangent plane (perpendicular to surface normal)
    const dot = _scratchCamForward.dot(_scratchNormal);
    _scratchCharZ.copy(_scratchCamForward).addScaledVector(_scratchNormal, -dot);
    if (_scratchCharZ.lengthSq() > 0.0001) {
      _scratchCharZ.normalize();
    } else {
      _scratchCharZ.set(0, 0, 1);
    }

    // 4. Construct orthonormal basis where UP (+Y) aligns with the terrain surface normal:
    // Local +Y: Exact terrain normal
    // Local +Z: Forward tangent along the slope surface
    // Local +X: Cross product (perpendicular across ski stance)
    _scratchCharY.copy(_scratchNormal);
    _scratchCharX.crossVectors(_scratchCharY, _scratchCharZ).normalize();

    _scratchBasisMatrix.makeBasis(_scratchCharX, _scratchCharY, _scratchCharZ);
    _scratchTargetQuat.setFromRotationMatrix(_scratchBasisMatrix);

    // 5. Rotate character to normal: instant initialization on first frame, smooth damping during motion
    if (!this._initializedQuat) {
      this.root.quaternion.copy(_scratchTargetQuat);
      this._initializedQuat = true;
    } else {
      this.root.quaternion.slerp(_scratchTargetQuat, Math.min(1.0, 22.0 * dt));
    }

    // 6. Tuck / Crouch Stance
    const isTucking = player.keys.forward || player.keys.sprint;
    const targetTuck = isTucking ? 0.06 : 0.0;
    this.tuckOffset = THREE.MathUtils.damp(this.tuckOffset, targetTuck, 8.0, dt);

    // 7. Position: Anchor character so camera position exactly coincides with character head
    // worldHead = root.position + quat * (headOffset - tuckOffset)
    // => root.position = cameraPosition - quat * (headOffset - tuckOffset)
    _scratchHeadOffset.copy(this.headOffset);
    _scratchHeadOffset.y -= this.tuckOffset;
    _scratchHeadOffset.z += this.tuckOffset * 0.5; // Slight athletic forward crouch
    _scratchHeadOffset.applyQuaternion(this.root.quaternion);

    const camPos = player.camera.position;
    this.root.position.set(
      camPos.x - _scratchHeadOffset.x,
      camPos.y - _scratchHeadOffset.y,
      camPos.z - _scratchHeadOffset.z
    );

    // 8. Dynamic Ski Edging: Bite steel edges into snow during hard carve turns
    if (this.skiL && this.skiR) {
      const rightDirX = Math.cos(player.yaw);
      const rightDirZ = -Math.sin(player.yaw);
      const lateralSpeed = player.velocity.x * rightDirX + player.velocity.z * rightDirZ;
      const targetRoll = (lateralSpeed / 22.0) * 0.22;
      this.carveRoll = THREE.MathUtils.damp(this.carveRoll, targetRoll, 10.0, dt);

      const edgeAngle = -this.carveRoll * 0.45;
      this.skiL.rotation.z = edgeAngle;
      this.skiR.rotation.z = edgeAngle;
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
