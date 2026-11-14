import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

// Pre-allocated scratch vectors and matrices for zero runtime heap allocations in 60 FPS loop
const _scratchUp = new THREE.Vector3();
const _scratchForward = new THREE.Vector3();
const _scratchRight = new THREE.Vector3();
const _scratchTargetNormal = new THREE.Vector3();
const _scratchBasisMatrix = new THREE.Matrix4();
const _scratchSprayPos = new THREE.Vector3();
const _scratchSprayVel = new THREE.Vector3();

// Snow spray particle capacity
const MAX_SPRAY_PARTICLES = 120;

// Transparent 1x1 PNG data URI used to safely intercept missing external author textures
const DUMMY_PNG_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';

/**
 * CharacterModel
 * High-fidelity Third-Person (TPS) rider and snowboard rig.
 * Combines Skateboarding.fbx, Skateboost.fbx, Falling.fbx, and board.fbx into a unified world-space rig.
 *
 * Animation States:
 * 1. Cruise ('cruise', from Skateboarding.fbx):
 *    Natural alpine snowboard carving and cruising stance when gliding down slopes.
 * 2. Accelerate / Boost ('boost', from Skateboost.fbx):
 *    Triggered when the player presses or holds 'W' / 'ArrowUp' / Sprint / Touch-hold,
 *    showing the rider actively kicking and pumping to accelerate down the mountain.
 * 3. Falling / Airborne ('fall', from Falling.fbx):
 *    Triggered when the player is airborne off crests, lips, kickers, or cliffs,
 *    showing the rider flailing in free-fall through the alpine air before touchdown.
 *
 * Rig Features:
 * - Root-motion normalization: strips linear forward drift so all clips play 100% in-place.
 * - Dynamic roll banking into turns (up to ±20°).
 * - Hockey-stop snowplow braking slide when holding 'S'.
 * - GPU-instanced dynamic snow spray particles.
 * - Real-time soft shadows cast onto the snow.
 */
export class CharacterModel {
  /**
   * @param {THREE.Scene} scene - Primary world scene
   * @param {TerrainManager} terrainManager
   * @param {object} [options={}]
   */
  constructor(scene, terrainManager, options = {}) {
    this.scene = scene;
    this.terrainManager = terrainManager;

    // Root world-space rig containing character, snowboard, and particle emitter
    this.group = new THREE.Group();
    this.group.name = 'RiderRig';

    // Model and animation references
    this.character = null;
    this.board = null;
    this.mixer = null;
    this.actions = {};
    this.currentAction = null;
    this.currentState = 'cruise'; // 'cruise' | 'boost' | 'fall'
    this.action = null; // Legacy alias for callers referencing .action
    this.isLoaded = false;

    // First-Person (FPS) camera & head tracking
    this.headBone = null;
    this.headTopBone = null;
    this.isFirstPerson = true;

    // Dynamic animation and stance state
    this.currentNormal = new THREE.Vector3(0, 1, 0);
    this.currentBankAngle = 0.0;
    this.currentBrakeAngle = 0.0;
    this._initialized = false;
    this.scaleMultiplier = options.scaleMultiplier ?? 1.0;
    this.fallHeightThreshold = options.fallHeightThreshold ?? 3.0; // Height in meters above ground to trigger falling animation

    // Snow spray particle system
    this.sprayMesh = null;
    this._sprayPositions = new Float32Array(MAX_SPRAY_PARTICLES * 3);
    this._sprayVelocities = new Float32Array(MAX_SPRAY_PARTICLES * 3);
    this._sprayLifetimes = new Float32Array(MAX_SPRAY_PARTICLES);
    this._sprayMaxLifetimes = new Float32Array(MAX_SPRAY_PARTICLES);
    this._sprayDummy = new THREE.Object3D();

    this._initSpraySystem();

    if (this.scene) {
      this.scene.add(this.group);
    }
  }

  /**
   * Initializes lightweight snow spray instanced particle system.
   * @private
   */
  _initSpraySystem() {
    const geo = new THREE.SphereGeometry(0.06, 4, 3);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.sprayMesh = new THREE.InstancedMesh(geo, mat, MAX_SPRAY_PARTICLES);
    this.sprayMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sprayMesh.frustumCulled = false;

    for (let i = 0; i < MAX_SPRAY_PARTICLES; i++) {
      this._sprayDummy.position.set(0, -9999, 0);
      this._sprayDummy.scale.set(0, 0, 0);
      this._sprayDummy.updateMatrix();
      this.sprayMesh.setMatrixAt(i, this._sprayDummy.matrix);
    }
    this.sprayMesh.instanceMatrix.needsUpdate = true;

    if (this.scene) {
      this.scene.add(this.sprayMesh);
    }
  }

  /**
   * Helper: removes forward linear root-motion drift from mixamorigHips.position
   * to convert forward-travelling Mixamo clips into seamless in-place animations.
   * @param {THREE.AnimationClip} clip
   * @private
   */
  _fixRootMotion(clip) {
    if (!clip || !clip.tracks) return;
    const posTrack = clip.tracks.find((t) => t.name.includes('position'));
    if (!posTrack || posTrack.values.length < 3) return;

    const zStart = posTrack.values[2];
    const zEnd = posTrack.values[posTrack.values.length - 1];
    const zTotalDelta = zEnd - zStart;

    // Only apply if there is substantial forward drift (over 10cm)
    if (Math.abs(zTotalDelta) > 10.0) {
      for (let i = 0; i < posTrack.times.length; i++) {
        const progress = posTrack.times[i] / clip.duration;
        posTrack.values[i * 3 + 2] -= progress * zTotalDelta;
      }
    }
  }

  /**
   * Loads Skateboarding.fbx, Skateboost.fbx, Falling.fbx, and board.fbx in parallel.
   * Pre-processes animation clips, binds materials, and initializes animation mixer.
   * @returns {Promise<THREE.Group>}
   */
  async load() {
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      if (url.includes('E:') || url.includes('skiing-lady')) {
        return DUMMY_PNG_DATA;
      }
      return url;
    });

    const loader = new FBXLoader(manager);
    const timestamp = Date.now();
    const charUrl = `/models/Skateboarding.fbx?t=${timestamp}`;
    const boardUrl = `/models/board.fbx?t=${timestamp}`;
    const fallUrl = `/models/Falling.fbx?t=${timestamp}`;
    const boostUrl = `/models/Skateboost.fbx?t=${timestamp}`;

    loader.setResourcePath('/models/');

    const loadCharPromise = new Promise((resolve) => {
      loader.load(charUrl, (fbx) => resolve(fbx), undefined, (err) => {
        console.warn('CharacterModel: Failed to load Skateboarding.fbx:', err);
        resolve(null);
      });
    });

    const loadBoardPromise = new Promise((resolve) => {
      loader.load(boardUrl, (fbx) => resolve(fbx), undefined, (err) => {
        console.warn('CharacterModel: Failed to load board.fbx:', err);
        resolve(null);
      });
    });

    const loadFallPromise = new Promise((resolve) => {
      loader.load(fallUrl, (fbx) => resolve(fbx), undefined, (err) => {
        console.warn('CharacterModel: Failed to load Falling.fbx:', err);
        resolve(null);
      });
    });

    const loadBoostPromise = new Promise((resolve) => {
      loader.load(boostUrl, (fbx) => resolve(fbx), undefined, (err) => {
        console.warn('CharacterModel: Failed to load Skateboost.fbx:', err);
        resolve(null);
      });
    });

    const [charFbx, boardFbx, fallFbx, boostFbx] = await Promise.all([
      loadCharPromise,
      loadBoardPromise,
      loadFallPromise,
      loadBoostPromise,
    ]);

    // 1. Setup Character Rig & Materials
    if (charFbx) {
      this.character = charFbx;
      this.character.name = 'SkaterCharacter';

      let maxMeshScale = 1.0;
      this.character.traverse((child) => {
        if (child.isMesh) {
          maxMeshScale = Math.max(maxMeshScale, child.scale.x, child.scale.y, child.scale.z);
        }
      });
      const unitScale = maxMeshScale >= 50.0 ? 0.01 : 1.0;
      const finalScale = unitScale * this.scaleMultiplier;
      this.character.scale.set(finalScale, finalScale, finalScale);
      this.character.position.set(0, -0.12, 0);

      this.character.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;

          if (child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((m) => {
              if (!m) return;
              m.side = THREE.DoubleSide;

              ['map', 'normalMap', 'specularMap', 'bumpMap', 'emissiveMap'].forEach((slot) => {
                if (m[slot]) {
                  if (!m[slot].image || (m[slot].image.width && m[slot].image.width <= 1)) {
                    m[slot].dispose();
                    m[slot] = null;
                  } else {
                    m[slot].colorSpace = THREE.SRGBColorSpace;
                  }
                }
              });

              if (m.name === 'jacket') {
                m.color.set(0x2563eb); // Electric alpine blue ski jacket
                m.shininess = 20;
              }
              if (m.name === 'pants') {
                m.color.set(0x1e242b); // Dark slate snowboard pants
                m.shininess = 15;
              }
              if (m.name === 'fabric_woolen_black') {
                m.color.set(0x18181c); // Knit black beanie / facemask
                m.shininess = 5;
              }
              if (m.name === 'glass_pink') {
                m.color.set(0xff3388); // Iridescent pink alpine goggles
                m.shininess = 140;
                m.transparent = true;
                m.opacity = 0.85;
              }
              if (m.name === 'coated_white') {
                m.color.set(0xf8fafc); // Crisp white helmet shell & boots
                m.shininess = 60;
              }

              m.needsUpdate = true;
            });
          }
        }
      });

      // 2. Setup Animation Mixer & Actions
      this.mixer = new THREE.AnimationMixer(this.character);

      // (a) Cruise Clip (Skateboarding.fbx)
      if (this.character.animations && this.character.animations.length > 0) {
        const cruiseClip = this.character.animations[0];
        cruiseClip.name = 'Cruise';
        this._fixRootMotion(cruiseClip);
        this.actions.cruise = this.mixer.clipAction(cruiseClip);
      }

      // (b) Boost Clip (Skateboost.fbx)
      if (boostFbx && boostFbx.animations && boostFbx.animations.length > 0) {
        const boostClip = boostFbx.animations[0];
        boostClip.name = 'Skateboost';
        this._fixRootMotion(boostClip);
        this.actions.boost = this.mixer.clipAction(boostClip);
      }

      // (c) Falling Clip (Falling.fbx)
      if (fallFbx && fallFbx.animations && fallFbx.animations.length > 0) {
        const fallClip = fallFbx.animations[0];
        fallClip.name = 'Falling';
        this.actions.fall = this.mixer.clipAction(fallClip);
      }

      // Initialize all actions with LoopRepeat and start in Cruise state
      for (const [key, act] of Object.entries(this.actions)) {
        if (act) {
          act.setLoop(THREE.LoopRepeat);
          act.play();
          act.setEffectiveWeight(key === 'cruise' ? 1.0 : 0.0);
        }
      }

      this.currentAction = this.actions.cruise;
      this.currentState = 'cruise';
      this.action = this.currentAction;

      // Locate head bones for First-Person (FPS) camera tracking
      this.headBone = this.character.getObjectByName('mixamorigHead') || null;
      this.headTopBone = this.character.getObjectByName('mixamorigHeadTop_End') || null;
      if (this.headBone && this.isFirstPerson) {
        this.headBone.scale.set(0.0001, 0.0001, 0.0001);
      }

      this.group.add(this.character);
    }

    // 3. Setup Snowboard Mesh
    if (boardFbx) {
      this.board = boardFbx;
      this.board.name = 'SnowboardMesh';

      let boardMaxScale = 1.0;
      this.board.traverse((child) => {
        if (child.isMesh) {
          boardMaxScale = Math.max(boardMaxScale, child.scale.x, child.scale.y, child.scale.z);
        }
      });
      const boardUnitScale = boardMaxScale >= 50.0 ? 0.01 : 1.0;
      const finalBoardScale = boardUnitScale * this.scaleMultiplier;
      this.board.scale.set(finalBoardScale, finalBoardScale, finalBoardScale);

      this.board.updateMatrixWorld(true);
      const bbox = new THREE.Box3().setFromObject(this.board);
      const center = new THREE.Vector3();
      bbox.getCenter(center);
      this.board.position.set(-center.x, -bbox.min.y, -center.z);

      this.board.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;

          if (child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((m) => {
              if (!m) return;
              m.side = THREE.DoubleSide;

              ['map', 'normalMap', 'specularMap', 'bumpMap', 'emissiveMap'].forEach((slot) => {
                if (m[slot]) {
                  if (!m[slot].image || (m[slot].image.width && m[slot].image.width <= 1)) {
                    m[slot].dispose();
                    m[slot] = null;
                  } else {
                    m[slot].colorSpace = THREE.SRGBColorSpace;
                  }
                }
              });

              if (m.name === 'Material.001') {
                m.color.set(0x1a1a24);
                m.shininess = 65;
              }
              if (m.name === 'white') {
                m.color.set(0x0f172a); // Midnight alpine snowboard deck
                m.shininess = 90;
              }

              m.needsUpdate = true;
            });
          }
        }
      });

      this.group.add(this.board);
    }

    this.isLoaded = true;
    return this.group;
  }

  /**
   * Smoothly cross-fades between animation states with specified duration.
   * @param {'cruise'|'boost'|'fall'} name
   * @param {number} [duration=0.25]
   */
  fadeToAction(name, duration = 0.25) {
    const nextAction = this.actions[name];
    if (!nextAction || nextAction === this.currentAction) return;

    const prevAction = this.currentAction;
    this.currentAction = nextAction;
    this.action = nextAction;

    if (prevAction) {
      prevAction.fadeOut(duration);
    }

    nextAction
      .reset()
      .setEffectiveTimeScale(1.0)
      .setEffectiveWeight(1.0)
      .fadeIn(duration)
      .play();
  }

  /**
   * Sets visibility of rider rig (e.g. hidden during Free Spectator fly mode).
   * @param {boolean} visible
   */
  setVisible(visible) {
    if (this.group) {
      this.group.visible = visible;
    }
    if (this.sprayMesh) {
      this.sprayMesh.visible = visible;
    }
  }

  /**
   * Dynamically adjusts uniform scale multiplier at runtime.
   * @param {number} multiplier
   */
  setScaleMultiplier(multiplier) {
    if (typeof multiplier !== 'number' || multiplier <= 0) return;
    this.scaleMultiplier = multiplier;
    if (this.character) {
      const s = 0.01 * this.scaleMultiplier;
      this.character.scale.set(s, s, s);
      this.character.position.set(0, -0.12 * this.scaleMultiplier, 0);
    }
    if (this.board) {
      const s = 0.01 * this.scaleMultiplier;
      this.board.scale.set(s, s, s);
      this.board.updateMatrixWorld(true);
      const bbox = new THREE.Box3().setFromObject(this.board);
      const center = new THREE.Vector3();
      bbox.getCenter(center);
      this.board.position.set(-center.x, -bbox.min.y, -center.z);
    }
  }

  /**
   * Retrieves world-space head position for First-Person (FPS) camera.
   * @param {THREE.Vector3} target
   * @returns {THREE.Vector3}
   */
  getHeadPosition(target) {
    if (this.headBone && this.character) {
      this.headBone.getWorldPosition(target);
      // Offset from neck/jaw to eye level inside helmet/goggles
      target.addScaledVector(this.currentNormal, 0.12);
      return target;
    }
    target.copy(this.group.position);
    target.addScaledVector(this.currentNormal, 1.35);
    return target;
  }

  /**
   * Toggles First-Person mode:
   * Collapses head/helmet bone scale to prevent near-plane clipping while keeping
   * torso, arms, legs, and snowboard visible when looking down.
   * @param {boolean} isFps
   */
  setFirstPersonMode(isFps) {
    this.isFirstPerson = !!isFps;
    if (this.headBone) {
      if (this.isFirstPerson) {
        this.headBone.scale.set(0.0001, 0.0001, 0.0001);
      } else {
        this.headBone.scale.set(1.0, 1.0, 1.0);
      }
      this.group.updateMatrixWorld(true);
    }
  }

  /**
   * Updates rider rig position, orientation, animation transitions, and snow spray particles.
   * @param {number} dt - Delta time in seconds
   * @param {PlayerController} player - Active player controller instance
   */
  update(dt, player) {
    if (!this.group || !this.isLoaded) return;

    // Visible only in ski mode (hidden during free spectator fly mode)
    const isSkiMode = player.mode === 'ski';
    this.setVisible(isSkiMode);
    if (!isSkiMode) {
      this._clearSpray();
      return;
    }

    // Ensure group is attached to world scene
    if (this.scene && this.group.parent !== this.scene) {
      this.scene.add(this.group);
    }

    // 1. Rig Position: Locked to player's contact point
    this.group.position.copy(player.position);

    // 2. Normal Alignment:
    // When grounded: align UP vector to terrain surface normal
    // When airborne: smoothly level out to world UP (0, 1, 0)
    if (player.isGrounded) {
      const rawNorm = this.terrainManager?.getNormalAt(player.position.x, player.position.z) || { x: 0, y: 1, z: 0 };
      _scratchTargetNormal.set(rawNorm.x, rawNorm.y, rawNorm.z);
      if (_scratchTargetNormal.lengthSq() > 0.0001) {
        _scratchTargetNormal.normalize();
      } else {
        _scratchTargetNormal.set(0, 1, 0);
      }
    } else {
      _scratchTargetNormal.set(0, 1, 0);
    }

    if (!this._initialized) {
      this.currentNormal.copy(_scratchTargetNormal);
      this._initialized = true;
    } else {
      const lerpRate = player.isGrounded ? 18.0 : 8.0;
      this.currentNormal.lerp(_scratchTargetNormal, Math.min(1.0, lerpRate * dt)).normalize();
    }

    // 3. Forward Heading:
    const headingYaw = player.yaw;
    _scratchForward.set(-Math.sin(headingYaw), 0, -Math.cos(headingYaw));

    const dotNorm = _scratchForward.dot(this.currentNormal);
    _scratchForward.addScaledVector(this.currentNormal, -dotNorm);
    if (_scratchForward.lengthSq() > 0.0001) {
      _scratchForward.normalize();
    } else {
      _scratchForward.set(0, 0, 1);
    }

    _scratchUp.copy(this.currentNormal);
    _scratchRight.crossVectors(_scratchUp, _scratchForward).normalize();

    // 4. Carving Banking / Roll:
    let targetBank = 0.0;
    if (player.keys.left) {
      targetBank -= 0.35; // Bank left (-20°)
    }
    if (player.keys.right) {
      targetBank += 0.35; // Bank right (+20°)
    }

    this.currentBankAngle = THREE.MathUtils.damp(this.currentBankAngle, targetBank, 12.0, dt);

    if (Math.abs(this.currentBankAngle) > 0.001) {
      _scratchUp.applyAxisAngle(_scratchForward, this.currentBankAngle);
      _scratchRight.applyAxisAngle(_scratchForward, this.currentBankAngle);
    }

    const altitude = player.getAltitude ? player.getAltitude() : (player.altitude || 0);

    // 5. Dynamic Snowplow / Hockey-Stop Braking:
    let targetBrake = 0.0;
    if (player.keys.backward && player.speed > 2.0 && (player.isGrounded || altitude < 1.0)) {
      targetBrake = 0.78; // ~45 degrees sideways slide
    }
    this.currentBrakeAngle = THREE.MathUtils.damp(this.currentBrakeAngle, targetBrake, 14.0, dt);

    if (Math.abs(this.currentBrakeAngle) > 0.001) {
      _scratchForward.applyAxisAngle(_scratchUp, this.currentBrakeAngle);
      _scratchRight.applyAxisAngle(_scratchUp, this.currentBrakeAngle);
    }

    // 6. Apply Orthonormal Rotation Basis Matrix
    _scratchBasisMatrix.makeBasis(_scratchRight, _scratchUp, _scratchForward);
    this.group.quaternion.setFromRotationMatrix(_scratchBasisMatrix);

    // 7. Animation State Machine & Blending:
    // - Falling: triggered only when airborne AND height above ground exceeds threshold (big cliff drops / massive air)
    //   Once triggered, persists until touchdown to avoid premature stance snaps mid-plummet.
    // - Boost: when grounded or hopping small bumps and pressing W / Up / Sprint
    // - Cruise: default grounded or small-jump carving stance
    const isAirborne = player.isAirborne();

    let targetState = 'cruise';
    if (isAirborne && (altitude >= this.fallHeightThreshold || (this.currentState === 'fall' && !player.isGrounded))) {
      targetState = 'fall';
    } else if (player.keys.forward || player.keys.sprint) {
      targetState = 'boost';
    } else {
      targetState = 'cruise';
    }

    if (targetState !== this.currentState) {
      const fadeDuration = targetState === 'fall' ? 0.2 : (targetState === 'boost' ? 0.18 : (this.currentState === 'fall' ? 0.2 : 0.22));
      this.fadeToAction(targetState, fadeDuration);
      this.currentState = targetState;
    }

    // 8. Dynamic Animation Playback Speed:
    if (this.mixer) {
      if (this.currentAction) {
        let targetTimeScale = 1.0;

        if (this.currentState === 'cruise') {
          if (!player.isPlaying) {
            targetTimeScale = 0.2; // Idle balance at starting summit
          } else {
            const speedFactor = Math.min(1.0, player.speed / 40.0);
            targetTimeScale = THREE.MathUtils.lerp(0.7, 1.65, speedFactor);
          }
        } else if (this.currentState === 'boost') {
          // Fast, energetic accelerating kick rhythm scaling with velocity
          const boostFactor = Math.min(1.0, player.speed / 30.0);
          targetTimeScale = THREE.MathUtils.lerp(1.85, 2.95, boostFactor);
          if (player.keys.sprint) targetTimeScale += 0.45;
        } else if (this.currentState === 'fall') {
          // Vertical downward velocity determines falling animation playback speed:
          // The faster the rider falls vertically, the faster and more frantically the animation plays.
          const downwardVy = player.velocity ? Math.max(0, -player.velocity.y) : 0;
          const fallRatio = Math.min(1.0, downwardVy / 30.0);
          targetTimeScale = THREE.MathUtils.lerp(0.8, 3.0, fallRatio);
        }

        this.currentAction.timeScale = targetTimeScale;
      }

      this.mixer.update(dt);
    }

    // 9. Snow Spray Particle Update
    this._updateSpray(dt, player);

    // 10. First-Person Mode Bone Scale & Matrix Sync
    if (this.headBone) {
      if (this.isFirstPerson) {
        this.headBone.scale.set(0.0001, 0.0001, 0.0001);
      } else if (this.headBone.scale.x < 0.5) {
        this.headBone.scale.set(1.0, 1.0, 1.0);
      }
    }
    this.group.updateMatrixWorld(true);
  }

  /**
   * Spawns and simulates snow spray particles behind the board tail.
   * @private
   */
  _updateSpray(dt, player) {
    if (!this.sprayMesh) return;

    const isGrounded = player.isGrounded;
    const speed = player.speed || 0;
    const isCarving = player.keys.left || player.keys.right;
    const isBraking = player.keys.backward && speed > 3.0;
    const isBoosting = this.currentState === 'boost';

    if (isGrounded && speed > 2.0 && player.isPlaying) {
      const spawnCount = isBraking ? 4 : (isCarving ? 3 : (isBoosting ? 3 : (speed > 15 ? 2 : 1)));

      _scratchSprayPos.set(0, 0.05, -0.85).applyMatrix4(this.group.matrixWorld);

      for (let s = 0; s < spawnCount; s++) {
        const spreadX = (Math.random() - 0.5) * (isBraking ? 1.6 : 0.6);
        const spreadY = 0.8 + Math.random() * (isBraking ? 2.5 : (isBoosting ? 1.6 : 1.2));
        const spreadZ = -0.4 - Math.random() * (speed * 0.08);

        _scratchSprayVel.set(spreadX, spreadY, spreadZ).applyQuaternion(this.group.quaternion);

        this._spawnParticle(
          _scratchSprayPos.x + (Math.random() - 0.5) * 0.2,
          _scratchSprayPos.y,
          _scratchSprayPos.z + (Math.random() - 0.5) * 0.2,
          _scratchSprayVel.x,
          _scratchSprayVel.y,
          _scratchSprayVel.z,
          0.35 + Math.random() * 0.25
        );
      }
    }

    let needsUpdate = false;

    for (let i = 0; i < MAX_SPRAY_PARTICLES; i++) {
      if (this._sprayLifetimes[i] > 0) {
        this._sprayLifetimes[i] -= dt;

        const idx = i * 3;
        this._sprayPositions[idx] += this._sprayVelocities[idx] * dt;
        this._sprayPositions[idx + 1] += this._sprayVelocities[idx + 1] * dt;
        this._sprayPositions[idx + 2] += this._sprayVelocities[idx + 2] * dt;

        this._sprayVelocities[idx + 1] -= 9.8 * dt;

        const lifeRatio = Math.max(0, this._sprayLifetimes[i] / this._sprayMaxLifetimes[i]);
        const scale = (1.0 - lifeRatio) * 1.8 * Math.sin(lifeRatio * Math.PI) * 0.8 + 0.1;

        this._sprayDummy.position.set(
          this._sprayPositions[idx],
          this._sprayPositions[idx + 1],
          this._sprayPositions[idx + 2]
        );
        this._sprayDummy.scale.set(scale, scale, scale);
        this._sprayDummy.updateMatrix();
        this.sprayMesh.setMatrixAt(i, this._sprayDummy.matrix);
        needsUpdate = true;
      } else {
        this._sprayDummy.position.set(0, -9999, 0);
        this._sprayDummy.scale.set(0, 0, 0);
        this._sprayDummy.updateMatrix();
        this.sprayMesh.setMatrixAt(i, this._sprayDummy.matrix);
      }
    }

    if (needsUpdate) {
      this.sprayMesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Spawns a single snow spray particle in the pool.
   * @private
   */
  _spawnParticle(x, y, z, vx, vy, vz, lifetime) {
    for (let i = 0; i < MAX_SPRAY_PARTICLES; i++) {
      if (this._sprayLifetimes[i] <= 0) {
        const idx = i * 3;
        this._sprayPositions[idx] = x;
        this._sprayPositions[idx + 1] = y;
        this._sprayPositions[idx + 2] = z;
        this._sprayVelocities[idx] = vx;
        this._sprayVelocities[idx + 1] = vy;
        this._sprayVelocities[idx + 2] = vz;
        this._sprayLifetimes[i] = lifetime;
        this._sprayMaxLifetimes[i] = lifetime;
        break;
      }
    }
  }

  /**
   * Clears all active spray particles.
   * @private
   */
  _clearSpray() {
    if (!this.sprayMesh) return;
    for (let i = 0; i < MAX_SPRAY_PARTICLES; i++) {
      this._sprayLifetimes[i] = 0;
      this._sprayDummy.position.set(0, -9999, 0);
      this._sprayDummy.scale.set(0, 0, 0);
      this._sprayDummy.updateMatrix();
      this.sprayMesh.setMatrixAt(i, this._sprayDummy.matrix);
    }
    this.sprayMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Safely disposes rider rig, models, animations, and particle buffers.
   */
  dispose() {
    this._clearSpray();

    if (this.scene) {
      if (this.group) this.scene.remove(this.group);
      if (this.sprayMesh) this.scene.remove(this.sprayMesh);
    }

    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.character);
      this.mixer = null;
    }

    const disposeNode = (node) => {
      if (!node) return;
      node.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((m) => {
              if (m?.map) m.map.dispose();
              if (m?.normalMap) m.normalMap.dispose();
              if (m) m.dispose();
            });
          }
        }
      });
    };

    disposeNode(this.character);
    disposeNode(this.board);

    if (this.sprayMesh) {
      if (this.sprayMesh.geometry) this.sprayMesh.geometry.dispose();
      if (this.sprayMesh.material) this.sprayMesh.material.dispose();
      this.sprayMesh = null;
    }

    this.character = null;
    this.board = null;
    this.actions = {};
    this.currentAction = null;
    this.isLoaded = false;
  }
}
