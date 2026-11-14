import * as THREE from 'three';
import { CharacterModel } from './CharacterModel.js';

// Pre-allocated scratch objects for zero runtime heap allocations in 60 FPS physics loop
const _scratchForward = new THREE.Vector3();
const _scratchRight = new THREE.Vector3();
const _scratchForwardXZ = new THREE.Vector3();
const _scratchRightXZ = new THREE.Vector3();
const _scratchGVec = new THREE.Vector3();
const _scratchDownhill = new THREE.Vector3();
const _scratchMoveDir = new THREE.Vector3();
const _scratchCamDesired = new THREE.Vector3();
const _scratchCamEuler = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * PlayerController
 * High-fidelity First-Person (FPS) alpine snowboard and ski physics controller.
 * Features realistic downhill momentum, directional carving edge-grip,
 * dynamic FPS eye-line camera positioned directly at the character's head with carving bank roll and landing trauma shake,
 * ballistic airtime, and seamless integration with the animated Skateboarding.fbx 3D character rig.
 *
 * Physics & Camera Highlights:
 * 1. First-Person Eye-Line Camera:
 *    Camera is positioned at character eye level (+0.12m from head bone, +0.22m forward along heading),
 *    with carving bank roll and landing trauma shake. Looking down lets the player see their snowboard and boots.
 * 2. Downhill Slope Gravity & Carving:
 *    Natural acceleration F = m * g * sin(slope). Descending steep chutes builds authentic speed
 *    (up to 60+ m/s / 200+ km/h), while uphills naturally decelerate.
 * 3. Responsive Keyboard & Mouse Steering:
 *    A/D and Arrow keys actively carve left/right, leaning the rider and board into turns (roll banking).
 *    Mouse rotation smoothly guides heading.
 * 4. Ballistic Airtime & Jump Pop:
 *    Conserves 3D momentum when launching off lips, kickers, or crests with alpine gravity (13.5 m/s²).
 * 5. Dynamic Speed FOV FX:
 *    Camera FOV widens dynamically with speed, height, and airtime.
 * 6. Free Spectator Fly Mode:
 *    Press 'F' at any time to toggle 6-DOF free spectator camera.
 */
export class PlayerController {
  /**
   * @param {THREE.Camera} camera
   * @param {HTMLElement} domElement
   * @param {TerrainManager} terrainManager
   * @param {THREE.Scene} [scene=null]
   */
  constructor(camera, domElement, terrainManager, scene = null) {
    this.camera = camera;
    this.domElement = domElement;
    this.terrainManager = terrainManager;
    this.scene = scene || this.terrainManager?.scene;

    // Physical state (ground contact point on snow: x, y, z)
    this.position = new THREE.Vector3(0, 20, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);

    // Modes: 'ski' (downhill FPS physics) | 'fly' (free spectator)
    this.mode = 'ski';

    // Alpine Ski Physics Tuning
    this.gravity = 13.5;         // Realistic alpine gravity (m/s²)
    this.pushAccel = 16.0;       // Active poling / skating push speed on flats
    this.tuckBonus = 1.35;       // Downhill acceleration multiplier when tucking (Shift or W)
    this.brakePower = 34.0;      // Hockey-stop snowplow braking deceleration
    this.snowFriction = 0.045;   // Forward glide rolling resistance
    this.carvingGrip = 7.5;      // Lateral ski edge grip (tracks forward into turns)
    this.jumpForce = 8.8;        // Upward pop off jumps/lips
    this.terminalSpeed = 70.0;   // Max downhill terminal velocity (~250 km/h)
    this.airDrag = 0.025;        // Aerodynamic drag in flight
    this.tuckAirDrag = 0.010;    // Reduced drag when tucking

    // State flags
    this.isGrounded = true;
    this.airTime = 0.0;
    this.altitude = 0.0;
    this.speed = 0.0;
    this.isPlaying = false; // Waits at summit starting gate until user clicks Play

    // Fly spectator mode speeds
    this.flySpeed = 45.0;
    this.flySprintSpeed = 120.0;

    // First-Person (FPS) Camera Configuration
    this.yaw = 1.35;             // Heading aimed down mountain slope
    this.pitch = 0.08;           // Natural forward eye-line looking down mountain
    this.minPitch = -0.95;       // ~ -55° looking up at alpine peaks / sky
    this.maxPitch = 1.25;        // ~ +72° looking down at snowboard / boots
    this.camera.near = 0.25;     // Clean near clipping to prevent skull/collar interior clipping
    this.camera.updateProjectionMatrix();
    this.focusHeight = 1.15;     // Eye-line reference height
    this.focusY = 20 + this.focusHeight;

    this.isPointerLocked = false;
    this.isDragging = false;
    this.prevMouseX = 0;
    this.prevMouseY = 0;

    // Dynamic Camera FOV parameters (bounded between minFov and maxFov)
    this.baseFov = camera.fov || 65;
    this.minFov = 60;
    this.maxFov = 90;

    // Camera shake state (light, subtle grounded tremor on landing)
    this.trauma = 0.0;
    this.shakeTime = 0.0;

    // Tree trunk collision parameters
    this.treeCollisionRadius = 0.35;
    this._nearbyTrunks = [];

    // Input state
    this.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      up: false,
      down: false,
      sprint: false,
    };

    // Touch controls state
    this.leftTouchIds = new Set();
    this.rightTouchId = null;
    this.leftTouchStartX = 0;
    this.leftTouchCurrentX = 0;
    this.prevRightX = 0;
    this.prevRightY = 0;

    this.onModeChange = null;

    // Character & Snowboard Rig (Skateboarding.fbx + board.fbx in world scene)
    this.character = new CharacterModel(this.scene, this.terrainManager);
    // Backward compatibility alias for any existing reference
    this.snowboard = this.character;

    this._initInput();

    // Place initial rider at terrain elevation
    const startHeight = this.terrainManager.getHeightAt(0, 0);
    this.position.set(0, startHeight, 0);
    this.focusY = this.position.y + this.focusHeight;

    // Position camera initially
    this._updateCamera(0.016, true);
  }

  _initInput() {
    window.addEventListener('keydown', (e) => this._onKeyDown(e));
    window.addEventListener('keyup', (e) => this._onKeyUp(e));

    this.domElement.addEventListener('click', () => {
      const p = this.domElement.requestPointerLock?.();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {});
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.isPointerLocked = document.pointerLockElement === this.domElement;
    });

    this.domElement.addEventListener('mousedown', (e) => {
      if (e.button === 0 && !this.isPointerLocked) {
        this.isDragging = true;
        this.prevMouseX = e.clientX;
        this.prevMouseY = e.clientY;
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    window.addEventListener('mousemove', (e) => this._onMouseMove(e));

    // Touch controls for mobile / tablet devices
    this._initTouchControls();
  }

  /**
   * Touch controls:
   * - Left half of screen: Press and hold = Accelerate; drag left/right = Carve
   * - Right half of screen: Touch swipe / drag = Camera view axis rotation (yaw & pitch)
   */
  _initTouchControls() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const onTouchStart = (e) => {
      if (e.cancelable) e.preventDefault();
      const halfWidth = window.innerWidth * 0.5;

      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];

        if (touch.clientX < halfWidth) {
          this.leftTouchIds.add(touch.identifier);
          this.leftTouchStartX = touch.clientX;
          this.leftTouchCurrentX = touch.clientX;
        } else {
          if (this.rightTouchId === null) {
            this.rightTouchId = touch.identifier;
            this.prevRightX = touch.clientX;
            this.prevRightY = touch.clientY;
          }
        }
      }

      this._updateTouchState();
    };

    const onTouchMove = (e) => {
      if (e.cancelable) e.preventDefault();
      const sensitivity = 0.0032;

      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];

        if (this.leftTouchIds.has(touch.identifier)) {
          this.leftTouchCurrentX = touch.clientX;
          const dragX = this.leftTouchCurrentX - this.leftTouchStartX;
          // Virtual stick steering: drag left = carve left, drag right = carve right
          this.keys.left = dragX < -25;
          this.keys.right = dragX > 25;
        }

        if (touch.identifier === this.rightTouchId) {
          const dx = touch.clientX - this.prevRightX;
          const dy = touch.clientY - this.prevRightY;
          this.prevRightX = touch.clientX;
          this.prevRightY = touch.clientY;

          this.yaw -= dx * sensitivity;
          this.pitch += dy * sensitivity;
          this.pitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.pitch));
        }
      }
    };

    const onTouchEnd = (e) => {
      if (e.cancelable) e.preventDefault();

      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];

        if (this.leftTouchIds.has(touch.identifier)) {
          this.leftTouchIds.delete(touch.identifier);
          if (this.leftTouchIds.size === 0) {
            this.keys.left = false;
            this.keys.right = false;
          }
        }

        if (touch.identifier === this.rightTouchId) {
          this.rightTouchId = null;
          for (let j = 0; j < e.touches.length; j++) {
            const t = e.touches[j];
            if (t.clientX >= window.innerWidth * 0.5 && !this.leftTouchIds.has(t.identifier)) {
              this.rightTouchId = t.identifier;
              this.prevRightX = t.clientX;
              this.prevRightY = t.clientY;
              break;
            }
          }
        }
      }

      this._updateTouchState();
    };

    this.domElement.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: false });
    window.addEventListener('touchcancel', onTouchEnd, { passive: false });
  }

  _updateTouchState() {
    const leftCount = this.leftTouchIds.size;
    this.keys.forward = leftCount > 0;
    this.keys.sprint = leftCount >= 2;
  }

  _onKeyDown(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
      return;
    }

    switch (e.code) {
      case 'KeyF':
        this.toggleMode();
        break;
      case 'KeyW':
      case 'ArrowUp':
        this.keys.forward = true;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.keys.backward = true;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.keys.left = true;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.keys.right = true;
        break;
      case 'Space':
        this.keys.up = true;
        break;
      case 'KeyC':
      case 'ControlLeft':
      case 'ControlRight':
        this.keys.down = true;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.keys.sprint = true;
        break;
    }
  }

  _onKeyUp(e) {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.keys.forward = false;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.keys.backward = false;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.keys.left = false;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.keys.right = false;
        break;
      case 'Space':
        this.keys.up = false;
        break;
      case 'KeyC':
      case 'ControlLeft':
      case 'ControlRight':
        this.keys.down = false;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.keys.sprint = false;
        break;
    }
  }

  _onMouseMove(e) {
    const sensitivity = 0.0022;

    if (this.isPointerLocked) {
      this.yaw -= e.movementX * sensitivity;
      this.pitch += e.movementY * sensitivity;
    } else if (this.isDragging) {
      const dx = e.clientX - this.prevMouseX;
      const dy = e.clientY - this.prevMouseY;
      this.prevMouseX = e.clientX;
      this.prevMouseY = e.clientY;

      this.yaw -= dx * sensitivity;
      this.pitch += dy * sensitivity;
    } else {
      return;
    }

    // Clamp pitch: max looking down and up in FPS
    this.pitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.pitch));
  }

  setPitchLimits(minPitchDeg, maxPitchDeg) {
    this.minPitch = minPitchDeg * (Math.PI / 180);
    this.maxPitch = maxPitchDeg * (Math.PI / 180);
    this.pitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.pitch));
  }

  getPitchLimitsDeg() {
    return {
      minPitchDeg: Math.round(this.minPitch * (180 / Math.PI)),
      maxPitchDeg: Math.round(this.maxPitch * (180 / Math.PI)),
    };
  }

  getPitchDeg() {
    return Math.round(this.pitch * (180 / Math.PI) * 10) / 10;
  }

  /**
   * Always 'fps' in dedicated First-Person mode.
   * @returns {'fps'}
   */
  get perspective() {
    return 'fps';
  }

  togglePerspective() {
    return 'fps';
  }

  setPerspective(mode) {
    // Dedicated First-Person (FPS) mode
  }

  toggleMode() {
    this.mode = this.mode === 'ski' ? 'fly' : 'ski';
    this.velocity.set(0, 0, 0);

    if (this.mode === 'ski') {
      const groundH = this.terrainManager.getHeightAt(this.position.x, this.position.z);
      if (this.position.y < groundH) {
        this.position.y = groundH;
        this.isGrounded = true;
      } else {
        this.isGrounded = false;
      }
      this.focusY = this.position.y + this.focusHeight;
      this._updateCamera(0.016, true);
    }

    if (this.onModeChange) {
      this.onModeChange(this.mode);
    }
    if (this.character) {
      this.character.setVisible(this.mode === 'ski');
    }
  }

  getSpeedKmh() {
    return Math.round(this.speed * 3.6);
  }

  getSpeedMs() {
    return this.speed;
  }

  isAirborne() {
    return !this.isGrounded && this.mode === 'ski';
  }

  /**
   * Returns current altitude in meters above the underlying snow terrain.
   * @returns {number}
   */
  getAltitude() {
    if (!this.terrainManager?.getHeightAt) return this.altitude || 0;
    const groundH = this.terrainManager.getHeightAt(this.position.x, this.position.z);
    this.altitude = Math.max(0, this.position.y - groundH);
    return this.altitude;
  }

  start() {
    this.isPlaying = true;
  }

  update(deltaTime) {
    if (!deltaTime || deltaTime <= 0.0001) return;
    const dt = Math.min(deltaTime, 0.066);

    // Guard position & velocity from any numerical anomalies
    if (!Number.isFinite(this.position.x) || !Number.isFinite(this.position.y) || !Number.isFinite(this.position.z)) {
      const resetH = this.terrainManager.getHeightAt(0, 0);
      this.position.set(0, resetH, 0);
      this.focusY = this.position.y + this.focusHeight;
    }
    if (!Number.isFinite(this.velocity.x) || !Number.isFinite(this.velocity.y) || !Number.isFinite(this.velocity.z)) {
      this.velocity.set(0, 0, 0);
    }

    // Keep skier poised at summit starting gate until user clicks Play
    if (!this.isPlaying && this.mode === 'ski') {
      this.velocity.set(0, 0, 0);
      const groundH = this.terrainManager.getHeightAt(this.position.x, this.position.z);
      this.position.y = groundH;
      this.focusY = this.position.y + this.focusHeight;
      if (this.character) {
        this.character.update(dt, this);
      }
      this._updateCamera(dt, false);
      return;
    }

    // Active Camera Direction Vectors
    _scratchForward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    _scratchRight.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();

    if (this.mode === 'ski') {
      this._updateSkiPhysics(dt, _scratchForward, _scratchRight);
      if (this.character) {
        this.character.update(dt, this);
      }
      this._updateCamera(dt, false);
    } else {
      this._updateFlyMode(dt);
      if (this.character) {
        this.character.update(dt, this);
      }
    }

    this.speed = this.velocity.length();

    // Dynamic Speed FOV: expands smoothly with downhill velocity and altitude
    if (!Number.isFinite(this.camera.fov)) this.camera.fov = this.baseFov;

    const safeSpeed = Number.isFinite(this.speed) ? this.speed : 0;
    const groundH = this.terrainManager?.getHeightAt
      ? this.terrainManager.getHeightAt(this.position.x, this.position.z)
      : this.position.y;
    const altitude = Math.max(0, this.position.y - groundH);
    this.altitude = altitude;
    const speedRatio = Math.min(1.0, safeSpeed / 45.0);
    const speedBonus = speedRatio * 16.0;
    const altRatio = Math.min(1.0, altitude / 35.0);
    const altBonus = Math.sqrt(altRatio) * 12.0;

    const targetFov = Math.min(this.maxFov, Math.max(this.minFov, this.baseFov + speedBonus + altBonus));
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 3.8, dt);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Updates First-Person (FPS) Camera locked directly at character's head position.
   * Features dynamic head tracking, carving banking lean, and landing trauma shake.
   * @param {number} dt - Delta time
   * @param {boolean} [snap=false]
   * @private
   */
  _updateCamera(dt, snap = false) {
    // 1. Position camera directly at character's eye position
    if (this.character && this.character.isLoaded) {
      this.character.getHeadPosition(_scratchCamDesired);
    } else {
      _scratchCamDesired.copy(this.position);
      _scratchCamDesired.y += this.focusHeight + 0.25;
    }

    // Offset camera forward along player heading out of the skull to eye/visor line (0.22m forward)
    _scratchForwardXZ.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    _scratchCamDesired.addScaledVector(_scratchForwardXZ, 0.22);

    // 2. Landing Trauma Camera Shake
    if (this.trauma > 0.001) {
      this.trauma = Math.max(0, this.trauma - dt * 3.5);
      this.shakeTime += dt;
      const shake = this.trauma * this.trauma;
      const t = this.shakeTime * 38.0;
      _scratchCamDesired.x += (Math.sin(t * 1.7) + Math.cos(t * 3.1) * 0.5) * 0.04 * shake;
      _scratchCamDesired.y += (Math.cos(t * 1.5) + Math.sin(t * 2.9) * 0.5) * 0.04 * shake;
    }

    this.camera.position.copy(_scratchCamDesired);

    // 3. Camera Rotation
    // Yaw: turns left/right with steering/mouse
    // Pitch: tilts down/up (negative pitch tilts up, positive pitch tilts down)
    // Bank roll: lean into carving turns
    const bankRoll = this.character ? -this.character.currentBankAngle * 0.45 : 0;
    _scratchCamEuler.set(-this.pitch, this.yaw, bankRoll, 'YXZ');
    this.camera.quaternion.setFromEuler(_scratchCamEuler);
  }

  /**
   * Alias for _updateCamera in First-Person mode.
   * @private
   */
  _updateFpsCamera(dt, snap = false) {
    this._updateCamera(dt, snap);
  }

  /**
   * Grounded alpine skiing and snowboarding physics engine
   * @private
   */
  _updateSkiPhysics(dt, forward, right) {
    _scratchForwardXZ.set(forward.x, 0, forward.z).normalize();
    _scratchRightXZ.set(right.x, 0, right.z).normalize();

    const isBoosting = this.keys.sprint;
    const isAccelerating = this.keys.forward || isBoosting;

    // Active Keyboard Carving Steering (A & D or Arrow keys)
    const turnRate = 2.2; // rad/s
    if (this.keys.left) {
      this.yaw += turnRate * dt;
      this.velocity.addScaledVector(_scratchRightXZ, -18.0 * dt);
    }
    if (this.keys.right) {
      this.yaw -= turnRate * dt;
      this.velocity.addScaledVector(_scratchRightXZ, 18.0 * dt);
    }

    // Recompute heading vectors after potential yaw adjustment
    _scratchForwardXZ.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    _scratchRightXZ.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();

    const currentGroundHeight = this.terrainManager.getHeightAt(this.position.x, this.position.z);
    const normal = this.terrainManager.getNormalAt(this.position.x, this.position.z);

    const prevX = this.position.x;
    const prevZ = this.position.z;

    if (this.isGrounded) {
      this.airTime = 0.0;

      // 1. Downhill Gravity Acceleration (F = m * g * sin(theta))
      _scratchGVec.set(0, -this.gravity, 0);
      _scratchDownhill.copy(_scratchGVec).addScaledVector(normal, -_scratchGVec.dot(normal));

      const downhillBoost = isBoosting ? this.tuckBonus * 1.5 : (this.keys.forward ? this.tuckBonus : 1.0);
      this.velocity.addScaledVector(_scratchDownhill, dt * downhillBoost);

      // 2. Active Push on Flats / Gentle Slopes (W or Left Touch)
      if (this.keys.forward) {
        const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
        if (horizSpeed < this.pushAccel) {
          const pushForce = (this.pushAccel - horizSpeed) * 3.5;
          this.velocity.addScaledVector(_scratchForwardXZ, pushForce * dt);
        }
      }

      // Active snowplow / hockey-stop braking (S or ArrowDown)
      if (this.keys.backward) {
        const brakeDecel = this.brakePower * dt;
        const currentSpeed = Math.hypot(this.velocity.x, this.velocity.z);
        if (currentSpeed > 0.001) {
          const newSpeed = Math.max(0, currentSpeed - brakeDecel);
          const ratio = newSpeed / currentSpeed;
          this.velocity.x *= ratio;
          this.velocity.z *= ratio;
        }
      }

      // 3. Shift Boost Propulsion
      if (isBoosting) {
        const boostPower = 28.0;
        this.velocity.addScaledVector(_scratchForwardXZ, boostPower * dt);
      }

      // 4. Directional Carving & Edge Grip
      const currentForwardSpeed = this.velocity.x * _scratchForwardXZ.x + this.velocity.z * _scratchForwardXZ.z;
      const currentLateralSpeed = this.velocity.x * _scratchRightXZ.x + this.velocity.z * _scratchRightXZ.z;

      // Detect frozen lake ice surface
      const lakeData = this.terrainManager.heightmap?.getLakeData ? this.terrainManager.heightmap.getLakeData(this.position.x, this.position.z) : null;
      const isOnIce = lakeData && lakeData.isFrozenLake;

      let frictionRate = isAccelerating ? this.snowFriction * 0.5 : this.snowFriction;
      if (isOnIce) {
        frictionRate *= 0.22;
      }
      const dampedForward = currentForwardSpeed * Math.max(0, 1.0 - frictionRate * dt);
      const grip = isOnIce ? this.carvingGrip * 0.65 : this.carvingGrip;
      const dampedLateral = currentLateralSpeed * Math.max(0, 1.0 - grip * dt);

      this.velocity.x = _scratchForwardXZ.x * dampedForward + _scratchRightXZ.x * dampedLateral;
      this.velocity.z = _scratchForwardXZ.z * dampedForward + _scratchRightXZ.z * dampedLateral;

      // Active jump pop (Spacebar) off lips or flat snow
      if (this.keys.up) {
        this.velocity.y = Math.max(this.velocity.y + this.jumpForce, this.jumpForce);
        this.isGrounded = false;
        this.airTime = 0.05;
        this.position.y += 0.12;
        this.keys.up = false;
      }

      // 5. Ground Contact & Slope Following
      const nextX = this.position.x + this.velocity.x * dt;
      const nextZ = this.position.z + this.velocity.z * dt;
      const nextGroundHeight = this.terrainManager.getHeightAt(nextX, nextZ);

      const requiredSlopeVy = dt > 0.0001 ? (nextGroundHeight - this.position.y) / dt : 0;

      // 6. Slope Crest Takeoff Detection (Natural Airtime)
      if (requiredSlopeVy < this.velocity.y - 1.5 && this.velocity.y > 0.5) {
        this.isGrounded = false;
        this.airTime = 0.05;
        this.position.x = nextX;
        this.position.z = nextZ;
        this.position.y += this.velocity.y * dt;
      } else if (requiredSlopeVy < -this.gravity * 0.45 && Math.hypot(this.velocity.x, this.velocity.z) > 18.0) {
        this.isGrounded = false;
        this.airTime = 0.05;
        this.position.x = nextX;
        this.position.z = nextZ;
        this.position.y += this.velocity.y * dt;
      } else {
        this.position.x = nextX;
        this.position.z = nextZ;
        this.position.y = nextGroundHeight;
        this.velocity.y = requiredSlopeVy;
      }
    } else {
      // Ballistic airtime trajectory
      this.airTime += dt;
      this.velocity.y -= this.gravity * dt;

      const activeAirDrag = isAccelerating ? this.tuckAirDrag : this.airDrag;
      this.velocity.x -= this.velocity.x * activeAirDrag * dt;
      this.velocity.z -= this.velocity.z * activeAirDrag * dt;

      if (isBoosting) {
        this.velocity.addScaledVector(_scratchForwardXZ, 12.0 * dt);
      }

      this.position.addScaledVector(this.velocity, dt);

      // Ground landing collision detection
      const testGroundY = this.terrainManager.getHeightAt(this.position.x, this.position.z);
      if (this.position.y <= testGroundY) {
        const landAirTime = this.airTime;
        this.position.y = testGroundY;
        this.isGrounded = true;
        this.airTime = 0.0;

        const landNormal = this.terrainManager.getNormalAt(this.position.x, this.position.z);
        const normalSpeed = this.velocity.dot(landNormal);
        if (normalSpeed < 0) {
          this.velocity.addScaledVector(landNormal, -normalSpeed);
        }

        if (landAirTime >= 0.15) {
          this.trauma = Math.min(0.35, (landAirTime - 0.1) * 0.25);
        }
      }
    }

    // 7. Tree Trunk Collisions
    this._resolveTrunkCollisions(prevX, prevZ);

    // Terminal velocity clamping
    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (horizSpeed > this.terminalSpeed && horizSpeed > 0.001) {
      const factor = this.terminalSpeed / horizSpeed;
      this.velocity.x *= factor;
      this.velocity.z *= factor;
    }
  }

  /**
   * Resolves physical collision against solid tree trunks.
   * @param {number} prevX
   * @param {number} prevZ
   * @private
   */
  _resolveTrunkCollisions(prevX, prevZ) {
    if (!this.terrainManager || !this.terrainManager.getNearbyTrunkColliders) return;

    const nearbyTrunks = this.terrainManager.getNearbyTrunkColliders(
      this.position.x,
      this.position.z,
      4.0,
      this._nearbyTrunks
    );

    if (!nearbyTrunks || nearbyTrunks.length === 0) return;

    const playerRadius = this.treeCollisionRadius || 0.35;
    const playerFeetY = this.position.y;
    const playerHeadY = this.position.y + 1.8;

    for (let pass = 0; pass < 2; pass++) {
      let hadCollision = false;

      for (let i = 0; i < nearbyTrunks.length; i++) {
        const t = nearbyTrunks[i];

        const trunkBottom = t.y - 0.5;
        const trunkTop = t.y + t.height;
        if (playerFeetY > trunkTop || playerHeadY < trunkBottom) {
          continue;
        }

        const segX = this.position.x - prevX;
        const segZ = this.position.z - prevZ;
        const segLenSq = segX * segX + segZ * segZ;
        let tParam = 0;
        if (segLenSq > 1e-6) {
          tParam = ((t.x - prevX) * segX + (t.z - prevZ) * segZ) / segLenSq;
          tParam = Math.max(0, Math.min(1, tParam));
        }
        const closeX = prevX + tParam * segX;
        const closeZ = prevZ + tParam * segZ;

        const dx = closeX - t.x;
        const dz = closeZ - t.z;
        const distSq = dx * dx + dz * dz;
        const minDistance = t.radius + playerRadius;

        if (distSq < minDistance * minDistance) {
          hadCollision = true;
          let dist = Math.sqrt(distSq);
          let nx = 0;
          let nz = 0;

          if (dist > 1e-4) {
            nx = dx / dist;
            nz = dz / dist;
          } else {
            const spd = Math.hypot(this.velocity.x, this.velocity.z);
            if (spd > 0.01) {
              nx = -this.velocity.x / spd;
              nz = -this.velocity.z / spd;
            } else {
              nx = 1;
              nz = 0;
            }
          }

          this.position.x = t.x + nx * minDistance;
          this.position.z = t.z + nz * minDistance;

          const vn = this.velocity.x * nx + this.velocity.z * nz;
          if (vn < 0) {
            const vtX = this.velocity.x - vn * nx;
            const vtZ = this.velocity.z - vn * nz;

            const bounce = 0.25;
            const friction = 0.65;

            this.velocity.x = vtX * friction - nx * vn * bounce;
            this.velocity.z = vtZ * friction - nz * vn * bounce;

            if (Math.abs(vn) > 4.0) {
              this.trauma = Math.min(0.4, this.trauma + Math.min(0.25, Math.abs(vn) * 0.015));
            }
          }
        }
      }

      if (!hadCollision) break;
    }

    if (this.isGrounded) {
      this.position.y = this.terrainManager.getHeightAt(this.position.x, this.position.z);
    }
  }

  /**
   * Free-flying spectator camera mode
   * @private
   */
  _updateFlyMode(dt) {
    _scratchMoveDir.set(0, 0, 0);

    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const rgt = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);

    if (this.keys.forward) _scratchMoveDir.add(fwd);
    if (this.keys.backward) _scratchMoveDir.sub(fwd);
    if (this.keys.right) _scratchMoveDir.add(rgt);
    if (this.keys.left) _scratchMoveDir.sub(rgt);
    if (this.keys.up) _scratchMoveDir.y += 1;
    if (this.keys.down) _scratchMoveDir.y -= 1;

    if (_scratchMoveDir.lengthSq() > 0.0001) {
      _scratchMoveDir.normalize();
      const speed = this.keys.sprint ? this.flySprintSpeed : this.flySpeed;
      this.velocity.copy(_scratchMoveDir.multiplyScalar(speed));
      this.camera.position.addScaledVector(this.velocity, dt);
      this.position.copy(this.camera.position);
    } else {
      this.velocity.set(0, 0, 0);
    }

    // Set rotation directly from pitch/yaw in fly mode
    _scratchCamEuler.set(-this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(_scratchCamEuler);
  }

  dispose() {
    if (this.character) {
      this.character.dispose();
      this.character = null;
      this.snowboard = null;
    }
  }
}
