import * as THREE from 'three';

// Pre-allocated scratch objects for zero runtime heap allocations in 60 FPS loop
const _scratchTargetNormal = new THREE.Vector3();
const _scratchCamForward = new THREE.Vector3();
const _scratchBoardForward = new THREE.Vector3();
const _scratchBoardUp = new THREE.Vector3();
const _scratchBoardRight = new THREE.Vector3();
const _scratchBasisMatrix = new THREE.Matrix4();

/**
 * Snowboard
 * Procedural snowboard shaped rectangle located at the character's ground position.
 * Always aligned with the terrain surface normal at the contact point.
 *
 * Guarantees:
 * 1. Ground Position: Placed directly at the terrain elevation beneath the player's feet.
 * 2. Surface Normal Alignment: Up vector (+Y) is locked to the terrain surface normal.
 * 3. Forward Yaw Alignment: Forward tangent (+Z) tracks player view heading along the slope.
 * 4. Zero Allocations: All vector/matrix transformations use pre-allocated scratch objects.
 */
export class Snowboard {
  /**
   * @param {THREE.Scene} scene - The main Three.js scene
   */
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'Snowboard';

    this.currentNormal = new THREE.Vector3(0, 1, 0);
    this._initialized = false;

    this._buildMesh();

    if (this.scene) {
      this.scene.add(this.group);
    }
  }

  /**
   * Procedurally generates a snowboard shaped rectangle with rounded corners,
   * kicked-up nose and tail tips, top sheet accent stripe, and binding pads.
   * @private
   */
  _buildMesh() {
    const length = 1.60;
    const width = 0.30;
    const thickness = 0.02;

    // Deck geometry: box with longitudinal & lateral subdivision for smooth tip curvature
    const deckGeom = new THREE.BoxGeometry(width, thickness, length, 8, 1, 36);
    const pos = deckGeom.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);

      const absZ = Math.abs(z);

      // Upturned tips: nose kicks up at +Z, tail kicks up at -Z (4.5cm rise)
      if (absZ > 0.55) {
        const kickNorm = (absZ - 0.55) / (length * 0.5 - 0.55);
        y += Math.pow(kickNorm, 2) * 0.045;
      }

      // Rounded nose and tail contour in X
      if (absZ > 0.62) {
        const taperNorm = (absZ - 0.62) / (length * 0.5 - 0.62);
        const roundFactor = Math.sqrt(Math.max(0, 1 - taperNorm * taperNorm));
        x *= (0.75 + 0.25 * roundFactor);
      }

      pos.setXYZ(i, x, y, z);
    }
    deckGeom.computeVertexNormals();

    // Top deck material: sleek dark matte graphite / carbon with subtle gloss
    const deckMaterial = new THREE.MeshStandardMaterial({
      color: 0x181b20,
      roughness: 0.35,
      metalness: 0.2,
      envMapIntensity: 1.0,
    });

    this.deckMesh = new THREE.Mesh(deckGeom, deckMaterial);
    this.deckMesh.castShadow = true;
    this.deckMesh.receiveShadow = true;
    this.group.add(this.deckMesh);

    // Center accent stripe on top sheet
    const stripeGeom = new THREE.BoxGeometry(0.04, 0.003, 1.20);
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0x00e5ff,
      roughness: 0.3,
      metalness: 0.1,
      emissive: 0x004455,
      emissiveIntensity: 0.3,
    });
    this.stripeMesh = new THREE.Mesh(stripeGeom, stripeMat);
    this.stripeMesh.position.y = thickness * 0.5 + 0.001;
    this.group.add(this.stripeMesh);

    // Bindings / Foot pads
    const padGeom = new THREE.BoxGeometry(0.20, 0.015, 0.12);
    const padMat = new THREE.MeshStandardMaterial({
      color: 0x282c34,
      roughness: 0.75,
      metalness: 0.1,
    });

    // Front binding pad (+Z) - natural duck stance (+12 deg)
    this.frontBinding = new THREE.Mesh(padGeom, padMat);
    this.frontBinding.position.set(0, thickness * 0.5 + 0.008, 0.30);
    this.frontBinding.rotation.y = 12 * (Math.PI / 180);
    this.frontBinding.castShadow = true;
    this.group.add(this.frontBinding);

    // Rear binding pad (-Z) - natural duck stance (-6 deg)
    this.rearBinding = new THREE.Mesh(padGeom, padMat);
    this.rearBinding.position.set(0, thickness * 0.5 + 0.008, -0.30);
    this.rearBinding.rotation.y = -6 * (Math.PI / 180);
    this.rearBinding.castShadow = true;
    this.group.add(this.rearBinding);
  }

  /**
   * Updates snowboard transform:
   * 1. Positions board at the character's ground contact point on snow.
   * 2. Aligns board UP vector (+Y) to the terrain surface normal.
   * 3. Aligns board FORWARD vector (+Z) along player view heading projected onto slope.
   * @param {number} dt - Delta time in seconds
   * @param {PlayerController} player - Active player controller instance
   */
  update(dt, player) {
    if (!this.group) return;

    // Only render in ski mode (hidden in spectator fly mode)
    this.group.visible = (player.mode === 'ski');
    if (!this.group.visible) return;

    // 1. Position: Placed directly at ground elevation beneath player
    const groundH = player.terrainManager?.getHeightAt
      ? player.terrainManager.getHeightAt(player.position.x, player.position.z)
      : (player.position.y - player.eyeHeight);

    // When grounded, place on snow surface with 1.5cm clearance to avoid z-fighting
    // When airborne, track player's feet elevation
    const boardY = player.isGrounded ? (groundH + 0.015) : (player.position.y - player.eyeHeight + 0.015);
    this.group.position.set(player.position.x, boardY, player.position.z);

    // 2. Normal Alignment: Sample terrain normal at player location
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
      // Smooth out micro-polygon noise ripples so board glides flush without jitter
      this.currentNormal.lerp(_scratchTargetNormal, Math.min(1.0, 16.0 * dt)).normalize();
    }

    // 3. Forward Heading: Project camera view heading onto terrain tangent plane
    _scratchCamForward.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    const dot = _scratchCamForward.dot(this.currentNormal);
    _scratchBoardForward.copy(_scratchCamForward).addScaledVector(this.currentNormal, -dot);
    if (_scratchBoardForward.lengthSq() > 0.0001) {
      _scratchBoardForward.normalize();
    } else {
      _scratchBoardForward.set(0, 0, 1);
    }

    // 4. Construct Orthonormal Basis:
    // UP (+Y): Surface normal
    // FORWARD (+Z): Tangent along the slope (nose points forward)
    // RIGHT (+X): Cross product
    _scratchBoardUp.copy(this.currentNormal);
    _scratchBoardRight.crossVectors(_scratchBoardUp, _scratchBoardForward).normalize();

    _scratchBasisMatrix.makeBasis(_scratchBoardRight, _scratchBoardUp, _scratchBoardForward);
    this.group.quaternion.setFromRotationMatrix(_scratchBasisMatrix);
  }

  /**
   * Safely disposes snowboard geometries and materials.
   */
  dispose() {
    if (this.scene && this.group) {
      this.scene.remove(this.group);
    }
    if (this.group) {
      this.group.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((m) => m?.dispose());
          }
        }
      });
      this.group.clear();
      this.group = null;
    }
  }
}
