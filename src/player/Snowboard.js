import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

// Pre-allocated scratch objects for zero runtime heap allocations in 60 FPS loop
const _scratchTargetNormal = new THREE.Vector3();
const _scratchCamForward = new THREE.Vector3();
const _scratchBoardForward = new THREE.Vector3();
const _scratchBoardUp = new THREE.Vector3();
const _scratchBoardRight = new THREE.Vector3();
const _scratchBasisMatrix = new THREE.Matrix4();

/**
 * Snowboard
 * Manages the snowboard model (public/models/board.fbx).
 * Rendered in a dedicated overlay scene with a secondary stacked camera.
 *
 * Guarantees:
 * 1. Automatic Texture Support: Embedded or external textures in FBX are automatically discovered
 *    and applied with sRGB color space and black-diffuse exporter correction.
 * 2. True Blender Scale: Preserves exact Blender author scale and proportions uniformly.
 *    Automatically detects Blender's FBX 100x unit scale factor without squashing or warping.
 * 3. Ground Contact: Placed directly at the terrain elevation beneath the player's feet.
 * 4. Surface Normal Alignment: Up vector (+Y) is locked to the terrain surface normal at player position.
 * 5. Zero-Lag Heading: Forward heading (+Z) tracks player view direction along the slope tangent.
 */
export class Snowboard {
  /**
   * @param {THREE.Scene} scene - Dedicated board scene
   * @param {string} [modelPath='/models/board.fbx'] - Path to board FBX model
   * @param {object} [options={}] - Optional configuration
   * @param {number} [options.scaleMultiplier=1.0] - Uniform scale factor (1.0 = exact 1:1 Blender scale)
   */
  constructor(scene, modelPath = '/models/board.fbx', options = {}) {
    this.scene = scene;
    this.modelPath = modelPath;
    this.scaleMultiplier = options.scaleMultiplier ?? 1.0;

    this.group = new THREE.Group();
    this.group.name = 'Snowboard';

    this.isLoaded = false;
    this.model = null;

    this.currentNormal = new THREE.Vector3(0, 1, 0);
    this._initialized = false;

    if (this.scene) {
      this.scene.add(this.group);
    }
  }

  /**
   * Loads board.fbx using FBXLoader.
   * Automatically discovers and binds embedded or external textures.
   * @param {string} [path]
   * @returns {Promise<THREE.Group>}
   */
  load(path = this.modelPath) {
    return new Promise((resolve) => {
      const loader = new FBXLoader();

      // Clean path to extract resource directory without query params
      const cleanPath = path.split('?')[0];
      const lastSlash = cleanPath.lastIndexOf('/');
      const resourcePath = lastSlash !== -1 ? cleanPath.substring(0, lastSlash + 1) : '/models/';
      loader.setResourcePath(resourcePath);

      // Append timestamp query parameter to bust browser disk/memory cache on every reload
      const fetchPath = `${cleanPath}?t=${Date.now()}`;

      loader.load(
        fetchPath,
        (fbx) => {
          this.model = fbx;

          // 1. Detect unit scale from Blender FBX export:
          // Blender's default FBX exporter writes in centimeters (FBX specification standard),
          // assigning mesh nodes a scale of 100. In Three.js (where 1 unit = 1 meter),
          // a scale factor of 0.01 converts 100cm back into exact 1:1 Blender meters.
          // If exported with 'Apply Scalings: FBX All', mesh nodes have scale 1.0.
          let maxMeshScale = 1.0;
          this.model.traverse((child) => {
            if (child.isMesh) {
              maxMeshScale = Math.max(maxMeshScale, child.scale.x, child.scale.y, child.scale.z);
            }
          });
          const unitScale = (maxMeshScale >= 50.0) ? 0.01 : 1.0;

          // 2. Uniform scaling:
          // Scale uniformly across X, Y, and Z so Blender author proportions, thickness,
          // bindings, and geometry are 100% preserved without non-uniform squashing or warping.
          const finalScale = unitScale * this.scaleMultiplier;
          this.model.scale.set(finalScale, finalScale, finalScale);
          this.model.position.set(0, 0, 0);
          this.model.updateMatrixWorld(true);

          // 3. Center model horizontally and position bottom flush with ground (Y = 0)
          const bbox = new THREE.Box3().setFromObject(this.model);
          const center = new THREE.Vector3();
          bbox.getCenter(center);
          this.model.position.set(-center.x, -bbox.min.y, -center.z);
          this.model.updateMatrixWorld(true);

          // Process meshes, materials, and automatic texture mapping
          this.model.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;

              if (child.material) {
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach((m) => {
                  if (!m) return;
                  m.side = THREE.DoubleSide;

                  // Fix common exporter issue: if diffuse texture is present and color is black, restore white tint
                  if (m.map && m.color && m.color.r === 0 && m.color.g === 0 && m.color.b === 0) {
                    m.color.set(0xffffff);
                  }

                  // Automatically configure color spaces for realistic gamma
                  if (m.map) {
                    m.map.colorSpace = THREE.SRGBColorSpace;
                    m.map.needsUpdate = true;
                  }
                  if (m.emissiveMap) {
                    m.emissiveMap.colorSpace = THREE.SRGBColorSpace;
                    m.emissiveMap.needsUpdate = true;
                  }
                  if (m.specularMap) {
                    m.specularMap.needsUpdate = true;
                  }
                  if (m.normalMap) {
                    m.normalMap.needsUpdate = true;
                  }
                  if (m.bumpMap) {
                    m.bumpMap.needsUpdate = true;
                  }

                  m.needsUpdate = true;
                });
              }
            }
          });

          this.group.add(this.model);
          this.isLoaded = true;
          resolve(this.group);
        },
        undefined,
        (err) => {
          console.warn('Snowboard: Failed to load board FBX model:', err);
          resolve(this.group);
        }
      );
    });
  }

  /**
   * Dynamically adjust uniform scale multiplier at runtime.
   * @param {number} multiplier
   */
  setScaleMultiplier(multiplier) {
    if (typeof multiplier !== 'number' || multiplier <= 0) return;
    this.scaleMultiplier = multiplier;
    if (this.model) {
      let maxMeshScale = 1.0;
      this.model.traverse((child) => {
        if (child.isMesh) {
          maxMeshScale = Math.max(maxMeshScale, child.scale.x, child.scale.y, child.scale.z);
        }
      });
      const unitScale = (maxMeshScale >= 50.0) ? 0.01 : 1.0;
      const finalScale = unitScale * this.scaleMultiplier;
      this.model.scale.set(finalScale, finalScale, finalScale);
      this.model.position.set(0, 0, 0);
      this.model.updateMatrixWorld(true);

      const bbox = new THREE.Box3().setFromObject(this.model);
      const center = new THREE.Vector3();
      bbox.getCenter(center);
      this.model.position.set(-center.x, -bbox.min.y, -center.z);
      this.model.updateMatrixWorld(true);
    }
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
    if (!this.group || !this.isLoaded) return;

    // Only render in ski mode (hidden in spectator fly mode)
    this.group.visible = (player.mode === 'ski');
    if (!this.group.visible) return;

    // Ensure group is attached to scene
    if (this.scene && this.group.parent !== this.scene) {
      this.scene.add(this.group);
    }

    // 1. Position: Placed on snow when grounded, or locked at a fixed distance from camera in the air
    const groundH = player.terrainManager?.getHeightAt
      ? player.terrainManager.getHeightAt(player.position.x, player.position.z)
      : (player.position.y - player.eyeHeight);

    // Exact offset from camera to board (eyeHeight - 0.02m clearance)
    // Matches the grounded distance exactly, maintaining a seamless fixed distance in flight
    const boardOffset = player.eyeHeight - 0.02;

    const camPos = player.camera?.position || player.position;
    const boardX = camPos.x;
    const boardZ = camPos.z;
    const boardY = player.isGrounded ? (groundH + 0.02) : (camPos.y - boardOffset);
    this.group.position.set(boardX, boardY, boardZ);

    // 2. Normal Alignment:
    // When grounded on snow: sample terrain normal and align board flush to slope
    // While in the air: disable terrain normal alignment and hold neutral level flight stance
    if (player.isGrounded) {
      const rawNorm = player.terrainManager?.getNormalAt(player.position.x, player.position.z) || { x: 0, y: 1, z: 0 };
      _scratchTargetNormal.set(rawNorm.x, rawNorm.y, rawNorm.z);
      if (_scratchTargetNormal.lengthSq() > 0.0001) {
        _scratchTargetNormal.normalize();
      } else {
        _scratchTargetNormal.set(0, 1, 0);
      }
    } else {
      // In flight: hold level upright stance (0, 1, 0) without tracking terrain bumps/valleys below
      _scratchTargetNormal.set(0, 1, 0);
    }

    if (!this._initialized) {
      this.currentNormal.copy(_scratchTargetNormal);
      this._initialized = true;
    } else {
      // Responsive alignment when grounded (16/s), smooth leveling in flight (8/s)
      const lerpSpeed = player.isGrounded ? 16.0 : 8.0;
      this.currentNormal.lerp(_scratchTargetNormal, Math.min(1.0, lerpSpeed * dt)).normalize();
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
   * Safely disposes snowboard model, geometries, and materials.
   */
  dispose() {
    if (this.scene && this.group) {
      this.scene.remove(this.group);
    }
    if (this.model) {
      this.model.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((m) => {
              if (m?.map) m.map.dispose();
              if (m?.normalMap) m.normalMap.dispose();
              if (m?.specularMap) m.specularMap.dispose();
              if (m?.emissiveMap) m.emissiveMap.dispose();
              if (m?.bumpMap) m.bumpMap.dispose();
              if (m) m.dispose();
            });
          }
        }
      });
      this.model = null;
    }
    this.isLoaded = false;
  }
}
