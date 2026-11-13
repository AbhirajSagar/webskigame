import * as THREE from 'three';

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

    // Orientation (aimed toward the mountain vista)
    this.yaw = -1.9;
    this.pitch = 0.05;
    this.isPointerLocked = false;
    this.isDragging = false;
    this.prevMouseX = 0;
    this.prevMouseY = 0;

    // Base camera FOV
    this.baseFov = camera.fov || 65;

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
  }

  _onKeyDown(e) {
    switch (e.code) {
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
        if (this.mode === 'ski' && this.isGrounded) {
          // Add jump pop impulse off the slope
          const normal = this.terrainManager.getNormalAt(this.position.x, this.position.z);
          this.velocity.y += this.jumpForce * Math.max(0.6, normal.y);
          this.velocity.x += normal.x * (this.jumpForce * 0.4);
          this.velocity.z += normal.z * (this.jumpForce * 0.4);
          this.isGrounded = false;
          this.airTime = 0.05;
        } else if (this.mode === 'fly') {
          this.keys.up = true;
        }
        break;
      case 'KeyE':
        this.keys.up = true;
        break;
      case 'KeyC':
      case 'KeyQ':
        this.keys.down = true;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.keys.sprint = true;
        break;
      case 'KeyF':
        this.toggleMode();
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
      case 'KeyE':
        this.keys.up = false;
        break;
      case 'KeyC':
      case 'KeyQ':
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
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    euler.x = this.pitch;
    euler.y = this.yaw;
    this.camera.quaternion.setFromEuler(euler);
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

    // Compute camera heading vectors
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);

    if (this.mode === 'ski') {
      this._updateSkiPhysics(dt, forward, right);
    } else {
      this._updateFlyMode(dt, forward, right);
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
    const forwardXZ = new THREE.Vector3(forward.x, 0, forward.z);
    if (forwardXZ.lengthSq() > 0.0001) forwardXZ.normalize();
    else forwardXZ.set(0, 0, -1);

    const rightXZ = new THREE.Vector3(right.x, 0, right.z);
    if (rightXZ.lengthSq() > 0.0001) rightXZ.normalize();
    else rightXZ.set(1, 0, 0);

    const isTucking = this.keys.forward || this.keys.sprint;
    const isBraking = this.keys.backward;

    const currentGroundHeight = this.terrainManager.getHeightAt(this.position.x, this.position.z);
    const targetEyeY = currentGroundHeight + this.eyeHeight;
    const normal = this.terrainManager.getNormalAt(this.position.x, this.position.z);

    if (this.isGrounded) {
      this.airTime = 0.0;

      // 1. Downhill Gravity Acceleration (F = m * g * sin(theta))
      const gVec = new THREE.Vector3(0, -this.gravity, 0);
      const downhill = gVec.clone().addScaledVector(normal, -gVec.dot(normal));

      const downhillBoost = isTucking ? this.tuckBonus : 1.0;
      this.velocity.addScaledVector(downhill, dt * downhillBoost);

      // 2. Active Push on Flats / Gentle Slopes
      if (this.keys.forward) {
        const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
        if (horizSpeed < this.pushAccel) {
          const pushForce = (this.pushAccel - horizSpeed) * 3.5;
          this.velocity.addScaledVector(forwardXZ, pushForce * dt);
        }
      }

      // 3. Hockey-Stop / Snowplow Braking
      if (isBraking) {
        const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
        if (horizSpeed > 0.1) {
          const brakeAmount = Math.min(horizSpeed, this.brakePower * dt);
          this.velocity.x -= (this.velocity.x / horizSpeed) * brakeAmount;
          this.velocity.z -= (this.velocity.z / horizSpeed) * brakeAmount;
        }
      }

      // 4. Directional Carving & Edge Grip
      // Decompose horizontal velocity into forward ski direction and lateral drift
      const currentForwardSpeed = this.velocity.x * forwardXZ.x + this.velocity.z * forwardXZ.z;
      const currentLateralSpeed = this.velocity.x * rightXZ.x + this.velocity.z * rightXZ.z;

      // When carving with A/D, apply deliberate lateral steering
      if (this.keys.left) {
        this.velocity.addScaledVector(rightXZ, -18.0 * dt);
      }
      if (this.keys.right) {
        this.velocity.addScaledVector(rightXZ, 18.0 * dt);
      }

      // Apply forward glide friction
      const frictionRate = isTucking ? this.snowFriction * 0.5 : this.snowFriction;
      const dampedForward = currentForwardSpeed * Math.max(0, 1.0 - frictionRate * dt);

      // Skis carve into the snow: high lateral resistance prevents ice-skating drift
      const dampedLateral = currentLateralSpeed * Math.max(0, 1.0 - this.carvingGrip * dt);

      // Reconstruct horizontal velocity following ski orientation
      this.velocity.x = forwardXZ.x * dampedForward + rightXZ.x * dampedLateral;
      this.velocity.z = forwardXZ.z * dampedForward + rightXZ.z * dampedLateral;

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
      const activeAirDrag = isTucking ? this.tuckAirDrag : this.airDrag;
      this.velocity.x -= this.velocity.x * activeAirDrag * dt;
      this.velocity.z -= this.velocity.z * activeAirDrag * dt;

      // Aerodynamic steering during airtime (subtle yaw tilt control)
      if (this.keys.left) this.velocity.addScaledVector(rightXZ, -8.0 * dt);
      if (this.keys.right) this.velocity.addScaledVector(rightXZ, 8.0 * dt);

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
    let moveDir = new THREE.Vector3();

    if (this.keys.forward) moveDir.add(forward);
    if (this.keys.backward) moveDir.sub(forward);
    if (this.keys.right) moveDir.add(right);
    if (this.keys.left) moveDir.sub(right);
    if (this.keys.up) moveDir.y += 1.0;
    if (this.keys.down) moveDir.y -= 1.0;

    if (moveDir.lengthSq() > 0.0001) {
      moveDir.normalize();
      const speed = this.keys.sprint ? this.flySprintSpeed : this.flySpeed;
      this.velocity.copy(moveDir.multiplyScalar(speed));
      this.position.addScaledVector(this.velocity, dt);
    } else {
      this.velocity.set(0, 0, 0);
    }

    this.cameraY = this.position.y;
    this.camera.position.copy(this.position);
  }
}
