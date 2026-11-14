import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

// Pre-allocated scratch objects for zero-allocation 60 FPS update loop
const _scratchEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _scratchQuat = new THREE.Quaternion();
const _scratchHeadOffset = new THREE.Vector3();
const _scratchForwardXZ = new THREE.Vector3();

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
   * Conforms body and skis to terrain slope, lean into carve turns, and tuck dynamics.
   * @param {number} dt - Delta time in seconds
   * @param {PlayerController} player - Active player controller instance
   */
  update(dt, player) {
    if (!this.isLoaded || !this.root) return;

    // 1. Compute terrain slope pitch along player's look direction
    const lookDirX = -Math.sin(player.yaw);
    const lookDirZ = -Math.cos(player.yaw);

    let targetSlopePitch = 0.0;
    if (player.isGrounded && player.terrainManager) {
      // Sample terrain elevation at front of skis (+0.8m ahead) and back (-0.8m behind)
      const tipX = player.position.x + lookDirX * 0.8;
      const tipZ = player.position.z + lookDirZ * 0.8;
      const tailX = player.position.x - lookDirX * 0.8;
      const tailZ = player.position.z - lookDirZ * 0.8;

      const tipY = player.terrainManager.getHeightAt(tipX, tipZ);
      const tailY = player.terrainManager.getHeightAt(tailX, tailZ);

      // Pitch angle conforms skis flush against downhill mountain slope
      targetSlopePitch = Math.atan2(tipY - tailY, 1.6);
    } else {
      // Airborne ballistic flight trajectory alignment
      const horizSpeed = Math.hypot(player.velocity.x, player.velocity.z);
      if (horizSpeed > 1.0) {
        targetSlopePitch = Math.atan2(player.velocity.y, horizSpeed) * 0.55;
      }
    }

    this.slopePitch = THREE.MathUtils.damp(this.slopePitch, targetSlopePitch, 14.0, dt);

    // 2. Dynamic Carving Bank / Roll
    const rightDirX = Math.cos(player.yaw);
    const rightDirZ = -Math.sin(player.yaw);
    const lateralSpeed = player.velocity.x * rightDirX + player.velocity.z * rightDirZ;
    const targetRoll = (lateralSpeed / 22.0) * 0.22; // Lean into carving turn up to ~12 deg
    this.carveRoll = THREE.MathUtils.damp(this.carveRoll, targetRoll, 10.0, dt);

    // 3. Tuck / Crouch Stance
    const isTucking = player.keys.forward || player.keys.sprint;
    const targetTuck = isTucking ? 0.06 : 0.0;
    this.tuckOffset = THREE.MathUtils.damp(this.tuckOffset, targetTuck, 8.0, dt);

    // 4. Orientation: Character faces forward along camera yaw (+PI offset for FBX coordinate frame)
    _scratchEuler.set(this.slopePitch, player.yaw + Math.PI, this.carveRoll, 'YXZ');
    _scratchQuat.setFromEuler(_scratchEuler);
    this.root.quaternion.copy(_scratchQuat);

    // 5. Position: Anchor character so camera position exactly coincides with character head
    // worldHead = root.position + quat * (headOffset - tuckOffset)
    // => root.position = cameraPosition - quat * (headOffset - tuckOffset)
    _scratchHeadOffset.copy(this.headOffset);
    _scratchHeadOffset.y -= this.tuckOffset;
    _scratchHeadOffset.z += this.tuckOffset * 0.5; // Slight athletic forward crouch
    _scratchHeadOffset.applyQuaternion(_scratchQuat);

    const camPos = player.camera.position;
    this.root.position.set(
      camPos.x - _scratchHeadOffset.x,
      camPos.y - _scratchHeadOffset.y,
      camPos.z - _scratchHeadOffset.z
    );

    // 6. Dynamic Ski Edging: Bite steel edges into snow during hard carve turns
    if (this.skiL && this.skiR) {
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
