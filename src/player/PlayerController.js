import * as THREE from 'three';

// Pre-allocated scratch objects for zero runtime heap allocations in 60 FPS physics loop
const _scratchForward = new THREE.Vector3();
const _scratchRight = new THREE.Vector3();
const _scratchForwardXZ = new THREE.Vector3();
const _scratchRightXZ = new THREE.Vector3();
const _scratchGVec = new THREE.Vector3();
const _scratchDownhill = new THREE.Vector3();
const _scratchMoveDir = new THREE.Vector3();
const _scratchEuler = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * PlayerController
 * High-fidelity alpine ski physics controller with grounded momentum,
 * dynamic downhill slope acceleration, ramp/crest takeoffs, and ballistic airtime.
 *
 * Physics Features:
 * 1. Downhill Slope Gravity:
 *    Natural acceleration F = m * g * sin(slope). Descending steep chutes builds authentic speed
 *    (up to 60+ m/s / 200+ km/h), while uphills naturally decelerate.
 * 2. Ballistic Ramp & Crest Takeoffs:
 *    When launching off a ridge, kicker, or convex slope, true 3D velocity is conserved.
 *    Realistic alpine gravity (13.5 m/s²) allows wide, majestic parabolic airtime across valleys.
 * 3. Directional Carving & Edge Grip:
 *    Skis glide freely forward with low snow resistance while lateral carving grip guides turns.
 * 4. Grounded Knee Suspension:
 *    Damped vertical camera tracking absorbs terrain ripples for a silky, grounded glide.
 * 5. Dynamic Speed FOV:
 *    Camera field-of-view expands dynamically as downhill speed increases, enhancing velocity sensation.
 * 6. Fly / Spectator Mode:
 *    Press 'F' at any time to toggle free-flying spectator camera.
 */
export class PlayerController {
  /**
   * @param {THREE.Camera} camera
   * @param {HTMLElement} domElement
   * @param {TerrainManager} terrainManager
   */
  constructor(camera, domElement, terrainManager) {
    this.camera = camera;
    this.domElement = domElement;
    this.terrainManager = terrainManager;

    // Physical state
    this.position = new THREE.Vector3(0, 20, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.eyeHeight = 1.85; // Natural skier stance
    this.cameraY = 20;

    // Modes: 'ski' (downhill physics) | 'fly' (free spectator)
    this.mode = 'ski';

    // Alpine Ski Physics Tuning
    this.gravity = 13.5;         // Realistic alpine gravity (m/s²)
    this.pushAccel = 16.0;       // Active poling / skating push speed on flats
    this.tuckBonus = 1.35;       // Downhill acceleration multiplier when tucking (Shift or W)
    this.brakePower = 32.0;      // Hockey-stop snowplow braking deceleration
    this.snowFriction = 0.045;   // Forward glide rolling resistance
    this.carvingGrip = 7.0;      // Lateral ski edge grip (tracks forward into turns)
    this.jumpForce = 8.8;        // Upward pop off jumps/lips
    this.terminalSpeed = 70.0;   // Max downhill terminal velocity (~250 km/h)
    this.airDrag = 0.025;        // Aerodynamic drag in flight
    this.tuckAirDrag = 0.010;    // Reduced drag when tucking

    // State flags
    this.isGrounded = true;
    this.airTime = 0.0;
    this.speed = 0.0;

    // Fly spectator mode speeds
    this.flySpeed = 45.0;
    this.flySprintSpeed = 120.0;

    // Orientation (aimed down the mountain slope toward the forest vista)
    this.yaw = 1.35;
    this.pitch = -0.05;
    this.isPointerLocked = false;
    this.isDragging = false;
    this.prevMouseX = 0;
    this.prevMouseY = 0;

    // Base camera FOV
    this.baseFov = camera.fov || 65;

    // Input state: Only forward (W) and boost (Shift) are active
    this.keys = {
      forward: false,
      sprint: false,
    };

    // Touch controls state
    this.leftTouchIds = new Set();
    this.rightTouchId = null;
    this.prevRightX = 0;
    this.prevRightY = 0;

    this.onModeChange = null;

    this._initInput();

    // Place initial camera at terrain elevation
    const startHeight = this.terrainManager.getHeightAt(0, 0);
    this.position.set(0, startHeight + this.eyeHeight, 0);
    this.cameraY = this.position.y;
    this.camera.position.copy(this.position);
    this._updateCameraRotation();
  }

  _initInput() {
    window.addEventListener('keydown', (e) => this._onKeyDown(e));
    window.addEventListener('keyup', (e) => this._onKeyUp(e));

    this.domElement.addEventListener('click', () => {
      this.domElement.requestPointerLock?.();
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
   * - Left half of screen: Press and hold = Accelerate (W)
   * - Right half of screen: Touch swipe / drag = Camera view axis rotation (yaw & pitch)
   * - Shift boost: Triggered via on-screen Boost button, 2-finger touch on left, or keyboard Shift
   */
  _initTouchControls() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const onTouchStart = (e) => {
      if (e.cancelable) e.preventDefault();

      const halfWidth = window.innerWidth * 0.5;

      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];

        if (touch.clientX < halfWidth) {
          // Left half: Accelerate / W
          this.leftTouchIds.add(touch.identifier);
        } else {
          // Right half: Camera rotation
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

      const sensitivity = 0.0035;

      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];

        if (touch.identifier === this.rightTouchId) {
          const dx = touch.clientX - this.prevRightX;
          const dy = touch.clientY - this.prevRightY;
          this.prevRightX = touch.clientX;
          this.prevRightY = touch.clientY;

          this.yaw -= dx * sensitivity;
          this.pitch -= dy * sensitivity;

          const maxPitch = Math.PI / 2 - 0.05;
          this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));

          this._updateCameraRotation();
        }
      }
    };

    const onTouchEnd = (e) => {
      if (e.cancelable) e.preventDefault();

      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];

        if (this.leftTouchIds.has(touch.identifier)) {
          this.leftTouchIds.delete(touch.identifier);
        }

        if (touch.identifier === this.rightTouchId) {
          this.rightTouchId = null;
          // If another touch is already on the right half, pick it up
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
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.keys.forward = true;
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
      this.pitch -= e.movementY * sensitivity;
    } else if (this.isDragging) {
      const dx = e.clientX - this.prevMouseX;
      const dy = e.clientY - this.prevMouseY;
      this.prevMouseX = e.clientX;
      this.prevMouseY = e.clientY;

      this.yaw -= dx * sensitivity;
      this.pitch -= dy * sensitivity;
    } else {
      return;
    }

    // Clamp pitch to avoid gimbal flip
    const maxPitch = Math.PI / 2 - 0.05;
    this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));

    this._updateCameraRotation();
  }

  _updateCameraRotation() {
    _scratchEuler.x = this.pitch;
    _scratchEuler.y = this.yaw;
    this.camera.quaternion.setFromEuler(_scratchEuler);
  }

  toggleMode() {
    this.mode = this.mode === 'ski' ? 'fly' : 'ski';
    this.velocity.set(0, 0, 0);
    if (this.onModeChange) {
      this.onModeChange(this.mode);
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

  update(deltaTime) {
    // Skip zero/negative delta time (prevents divide-by-zero on initial clock frame)
    if (!deltaTime || deltaTime <= 0.0001) return;
    const dt = Math.min(deltaTime, 0.066);

    // Guard position & velocity from any numerical anomalies
    if (!Number.isFinite(this.position.x) || !Number.isFinite(this.position.y) || !Number.isFinite(this.position.z)) {
      const resetH = this.terrainManager.getHeightAt(0, 0);
      this.position.set(0, resetH + this.eyeHeight, 0);
      this.cameraY = this.position.y;
    }
    if (!Number.isFinite(this.velocity.x) || !Number.isFinite(this.velocity.y) || !Number.isFinite(this.velocity.z)) {
      this.velocity.set(0, 0, 0);
    }

    // Compute camera heading vectors (0 runtime heap allocations)
    _scratchForward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    _scratchRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion);

    if (this.mode === 'ski') {
      this._updateSkiPhysics(dt, _scratchForward, _scratchRight);
    } else {
      this._updateFlyMode(dt, _scratchForward, _scratchRight);
    }

    // Speed calculation
    this.speed = this.velocity.length();

    // Dynamic Speed FOV: safely expands as velocity climbs
    if (!Number.isFinite(this.camera.fov)) this.camera.fov = this.baseFov;

    if (this.mode === 'ski') {
      const safeSpeed = Number.isFinite(this.speed) ? this.speed : 0;
      const targetFov = this.baseFov + Math.min(12, (safeSpeed / 45.0) * 12);
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 4.0, dt);
      this.camera.updateProjectionMatrix();
    } else if (Math.abs(this.camera.fov - this.baseFov) > 0.01) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, this.baseFov, 6.0, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Grounded alpine skiing physics engine
   * @private
   */
  _updateSkiPhysics(dt, forward, right) {
    _scratchForwardXZ.set(forward.x, 0, forward.z);
    if (_scratchForwardXZ.lengthSq() > 0.0001) _scratchForwardXZ.normalize();
    else _scratchForwardXZ.set(0, 0, -1);

    _scratchRightXZ.set(right.x, 0, right.z);
    if (_scratchRightXZ.lengthSq() > 0.0001) _scratchRightXZ.normalize();
    else _scratchRightXZ.set(1, 0, 0);

    const isBoosting = this.keys.sprint;
    const isAccelerating = this.keys.forward || isBoosting;

    const currentGroundHeight = this.terrainManager.getHeightAt(this.position.x, this.position.z);
    const targetEyeY = currentGroundHeight + this.eyeHeight;
    const normal = this.terrainManager.getNormalAt(this.position.x, this.position.z);

    if (this.isGrounded) {
      this.airTime = 0.0;

      // 1. Downhill Gravity Acceleration (F = m * g * sin(theta))
      _scratchGVec.set(0, -this.gravity, 0);
      _scratchDownhill.copy(_scratchGVec).addScaledVector(normal, -_scratchGVec.dot(normal));

      const downhillBoost = isBoosting ? this.tuckBonus * 1.5 : (this.keys.forward ? this.tuckBonus : 1.0);
      this.velocity.addScaledVector(_scratchDownhill, dt * downhillBoost);

      // 2. Active Push on Flats / Gentle Slopes (W or Left-Side Touch Hold)
      if (this.keys.forward) {
        const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
        if (horizSpeed < this.pushAccel) {
          const pushForce = (this.pushAccel - horizSpeed) * 3.5;
          this.velocity.addScaledVector(_scratchForwardXZ, pushForce * dt);
        }
      }

      // 3. Shift Boost Propulsion
      if (isBoosting) {
        const boostPower = 28.0;
        this.velocity.addScaledVector(_scratchForwardXZ, boostPower * dt);
      }

      // 4. Directional Carving & Edge Grip
      // Decompose horizontal velocity into forward ski direction and lateral drift
      const currentForwardSpeed = this.velocity.x * _scratchForwardXZ.x + this.velocity.z * _scratchForwardXZ.z;
      const currentLateralSpeed = this.velocity.x * _scratchRightXZ.x + this.velocity.z * _scratchRightXZ.z;

      // Detect frozen lake ice surface
      const lakeData = this.terrainManager.heightmap?.getLakeData ? this.terrainManager.heightmap.getLakeData(this.position.x, this.position.z) : null;
      const isOnIce = lakeData && lakeData.isFrozenLake;

      // Apply forward glide friction (reduced on glassy frozen lake ice)
      let frictionRate = isAccelerating ? this.snowFriction * 0.5 : this.snowFriction;
      if (isOnIce) {
        frictionRate *= 0.22; // Ultra-slick emerald ice glide
      }
      const dampedForward = currentForwardSpeed * Math.max(0, 1.0 - frictionRate * dt);

      // Skis carve smoothly into the turn aligned with camera view
      const grip = isOnIce ? this.carvingGrip * 0.65 : this.carvingGrip;
      const dampedLateral = currentLateralSpeed * Math.max(0, 1.0 - grip * dt);

      // Reconstruct horizontal velocity following ski orientation
      this.velocity.x = _scratchForwardXZ.x * dampedForward + _scratchRightXZ.x * dampedLateral;
      this.velocity.z = _scratchForwardXZ.z * dampedForward + _scratchRightXZ.z * dampedLateral;

      // 5. Ground Contact & Slope Following
      const nextX = this.position.x + this.velocity.x * dt;
      const nextZ = this.position.z + this.velocity.z * dt;
      const nextGroundHeight = this.terrainManager.getHeightAt(nextX, nextZ);
      const nextTargetY = nextGroundHeight + this.eyeHeight;

      // Vertical slope velocity tracking (guarded against dt === 0)
      const requiredSlopeVy = dt > 0.0001 ? (nextTargetY - this.position.y) / dt : 0;

      // 6. Slope Crest Takeoff Detection (Natural Airtime)
      // If the terrain falls away faster than gravity or the player carries upward ramp momentum
      if (requiredSlopeVy < this.velocity.y - 1.5 && this.velocity.y > 0.5) {
        // Launch into airtime!
        this.isGrounded = false;
        this.airTime = 0.05;
        this.position.x = nextX;
        this.position.z = nextZ;
        this.position.y += this.velocity.y * dt;
      } else if (requiredSlopeVy < -this.gravity * 0.45 && Math.hypot(this.velocity.x, this.velocity.z) > 18.0) {
        // High-speed crest lip launch
        this.isGrounded = false;
        this.airTime = 0.05;
        this.position.x = nextX;
        this.position.z = nextZ;
        this.position.y += this.velocity.y * dt;
      } else {
        // Firmly grounded on snow
        this.position.x = nextX;
        this.position.z = nextZ;
        this.position.y = nextTargetY;
        this.velocity.y = requiredSlopeVy;
      }
    } else {
      // =========================================================================
      // BALLISTIC AIRTIME (In-flight trajectory over slopes and valleys)
      // =========================================================================
      this.airTime += dt;

      // True alpine gravity
      this.velocity.y -= this.gravity * dt;

      // Aerodynamic air resistance
      const activeAirDrag = isAccelerating ? this.tuckAirDrag : this.airDrag;
      this.velocity.x -= this.velocity.x * activeAirDrag * dt;
      this.velocity.z -= this.velocity.z * activeAirDrag * dt;

      if (isBoosting) {
        // Boost drives forward during flight as well
        this.velocity.addScaledVector(_scratchForwardXZ, 12.0 * dt);
      }

      // Integrate 3D flight position
      this.position.addScaledVector(this.velocity, dt);

      // Ground landing collision detection
      const testGroundY = this.terrainManager.getHeightAt(this.position.x, this.position.z);
      const testTargetY = testGroundY + this.eyeHeight;

      if (this.position.y <= testTargetY) {
        // Touchdown on snow!
        this.position.y = testTargetY;
        this.isGrounded = true;

        // Smooth landing momentum conservation:
        // Project incoming 3D flight velocity onto the landing slope normal
        const landNormal = this.terrainManager.getNormalAt(this.position.x, this.position.z);
        const normalSpeed = this.velocity.dot(landNormal);

        if (normalSpeed < 0) {
          // Remove penetration velocity into ground while keeping tangential speed down the slope!
          this.velocity.addScaledVector(landNormal, -normalSpeed);
        }

        // Slight landing compression dampener
        this.cameraY = testTargetY - 0.25;
      }
    }

    // Clamp terminal downhill speed
    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (horizSpeed > this.terminalSpeed && horizSpeed > 0.001) {
      const factor = this.terminalSpeed / horizSpeed;
      this.velocity.x *= factor;
      this.velocity.z *= factor;
    }

    // Knee suspension damping: smooths micro-terrain bumps without jitter
    if (!Number.isFinite(this.cameraY)) this.cameraY = this.position.y;
    this.cameraY = THREE.MathUtils.damp(this.cameraY, this.position.y, 18.0, dt);
    this.camera.position.set(this.position.x, this.cameraY, this.position.z);
  }

  /**
   * Free-flying spectator camera mode
   * @private
   */
  _updateFlyMode(dt, forward, right) {
    _scratchMoveDir.set(0, 0, 0);

    if (this.keys.forward) _scratchMoveDir.add(forward);

    if (_scratchMoveDir.lengthSq() > 0.0001) {
      _scratchMoveDir.normalize();
      const speed = this.keys.sprint ? this.flySprintSpeed : this.flySpeed;
      this.velocity.copy(_scratchMoveDir.multiplyScalar(speed));
      this.position.addScaledVector(this.velocity, dt);
    } else {
      this.velocity.set(0, 0, 0);
    }

    this.cameraY = this.position.y;
    this.camera.position.copy(this.position);
  }
}
