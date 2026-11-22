import * as THREE from 'three';
import { CharacterModel } from './CharacterModel.js';
import { LeafParticleSystem } from './LeafParticleSystem.js';

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
const _scratchLocalOffset = new THREE.Vector3();

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
   * @param {THREE.Camera} camera - 2nd camera (worldCamera, renders terrain, trees, skybox)
   * @param {HTMLElement} domElement
   * @param {TerrainManager} terrainManager
   * @param {THREE.Scene} [scene=null]
   * @param {THREE.Camera} [characterCamera=null] - 1st camera (character & snowboard overlay camera)
   */
  constructor(camera, domElement, terrainManager, scene = null, characterCamera = null) {
    this.camera = camera;
    this.characterCamera = characterCamera;
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

    // Height Cap Tuning (removed artificial 115m cap so jumps and flight are uncapped)
    this.maxAirborneHeight = Infinity;
    this.maxWorldHeight = Infinity; // Maximum world elevation ceiling (optional)

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
    this.pitch = 0.14;           // Natural forward eye-line slightly down toward slope & board (optimal 9:16 framing)
    this.minPitch = -0.95;       // ~ -55° looking up at alpine peaks / sky
    this.maxPitch = 1.25;        // ~ +72° looking down at snowboard / boots
    this.camera.near = 0.08;     // Clean near clipping to prevent skull/collar interior clipping
    this.camera.updateProjectionMatrix();
    this.focusHeight = 1.15;     // Eye-line reference height
    this.focusY = 20 + this.focusHeight;

    this.isPointerLocked = false;
    this.isDragging = false;
    this.prevMouseX = 0;
    this.prevMouseY = 0;

    // Dynamic Camera FOV parameters tuned for 9:16 vertical Instagram Reels
    this.baseFov = camera.fov || 100;
    this.minFov = 94;
    this.maxFov = 118;

    // Camera shake state (light, subtle grounded tremor on landing)
    this.trauma = 0.0;
    this.shakeTime = 0.0;

    // Tree trunk collision parameters (compact capsule for snowboarder)
    this.treeCollisionRadius = 0.22;
    this._nearbyTrunks = [];

    // Input state: strictly forward acceleration (W / ArrowUp)
    this.keys = {
      forward: false,
    };
    this.keyboardForward = false;
    this.touchForward = false;
    this.steerBank = 0.0;

    // Camera input sensitivity
    this.mouseSensitivity = 0.0022;
    this.touchSensitivity = 0.0075; // Increased touch sensitivity for responsive mobile camera steering

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

    // High-speed tree leaf particles (deterministic multi-texture pine needles)
    const seed = this.terrainManager?.seed ?? this.terrainManager?.treeGenerator?.seed ?? 1337;
    this.leafParticles = new LeafParticleSystem(this.scene, seed);

    // Stabilized head tracking offset (relative to player ground position)
    this._smoothedHeadOffset = new THREE.Vector3(0, this.focusHeight + 0.25, 0);
    this._headOffsetInitialized = false;

    this._initInput();

    // Place initial rider at terrain elevation
    const startHeight = this.terrainManager.getHeightAt(0, 0);
    this.position.set(0, startHeight, 0);
    this.focusY = this.position.y + this.focusHeight;

    // Automatically align initial heading downhill along the starting slope
    if (this.terrainManager?.heightmap?.getNormal) {
      const startNorm = this.terrainManager.heightmap.getNormal(0, 0);
      if (Math.hypot(startNorm.x, startNorm.z) > 0.05) {
        this.yaw = Math.atan2(-startNorm.x, -startNorm.z);
      }
    }

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
   * Touch controls for mobile / tablet devices:
   * - Left half of screen: Press and hold = Tuck / Accelerate (W equivalent)
   * - Right half of screen: Drag = Steer heading and pitch (Mouse equivalent)
   * - Single-finger drag anywhere: Smoothly guides gaze / steering
   * - Any touch when stopped: Automatically launches forward along gaze heading
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
        } else {
          if (this.rightTouchId === null) {
            this.rightTouchId = touch.identifier;
            this.prevRightX = touch.clientX;
            this.prevRightY = touch.clientY;
          }
        }
      }

      // If user touches with one finger on the left side, also allow steering with that finger if no right touch exists
      if (this.rightTouchId === null && e.touches.length === 1) {
        const singleTouch = e.touches[0];
        this.rightTouchId = singleTouch.identifier;
        this.prevRightX = singleTouch.clientX;
        this.prevRightY = singleTouch.clientY;
      }

      this._updateTouchState();
    };

    const onTouchMove = (e) => {
      if (e.cancelable) e.preventDefault();
      const sensitivity = this.touchSensitivity;

      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];

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
        }

        if (touch.identifier === this.rightTouchId) {
          this.rightTouchId = null;
          for (let j = 0; j < e.touches.length; j++) {
            const t = e.touches[j];
            if (!this.leftTouchIds.has(t.identifier)) {
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

    // Listen on window to ensure 100% touch capture across the whole screen on mobile browsers
    window.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: false });
    window.addEventListener('touchcancel', onTouchEnd, { passive: false });
  }

  _updateTouchState() {
    this.touchForward = this.leftTouchIds.size > 0;
    this.keys.forward = this.keyboardForward || this.touchForward;
  }

  _onKeyDown(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
      return;
    }

    if (e.code === 'KeyW' || e.code === 'ArrowUp' || e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') {
      this.keyboardForward = true;
      this.keys.forward = true;
    }
  }

  _onKeyUp(e) {
    if (e.code === 'KeyW' || e.code === 'ArrowUp' || e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') {
      this.keyboardForward = false;
      this.keys.forward = this.touchForward;
    }
  }

  _onMouseMove(e) {
    const sensitivity = this.mouseSensitivity;

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

  setTouchSensitivity(val) {
    if (typeof val === 'number' && val > 0) {
      this.touchSensitivity = val;
    }
  }

  getTouchSensitivity() {
    return this.touchSensitivity;
  }

  setMouseSensitivity(val) {
    if (typeof val === 'number' && val > 0) {
      this.mouseSensitivity = val;
    }
  }

  getMouseSensitivity() {
    return this.mouseSensitivity;
  }

  /**
   * Sets the height cap preventing the player from going up more than that.
   * @param {number} val - Height cap value in meters
   * @param {'air'|'world'} [type='air'] - 'air' bounds jump/air altitude above terrain; 'world' bounds absolute Y elevation
   */
  setHeightCap(val, type = 'air') {
    if (typeof val === 'number' && val > 0) {
      if (type === 'world') {
        this.maxWorldHeight = val;
      } else {
        this.maxAirborneHeight = val;
      }
    }
  }

  /**
   * Returns current height cap parameters.
   * @returns {{ maxAirborneHeight: number, maxWorldHeight: number }}
   */
  getHeightCap() {
    return {
      maxAirborneHeight: this.maxAirborneHeight,
      maxWorldHeight: this.maxWorldHeight,
    };
  }

  setMaxAirborneHeight(val) {
    if (typeof val === 'number' && val > 0) {
      this.maxAirborneHeight = val;
    }
  }

  getMaxAirborneHeight() {
    return this.maxAirborneHeight;
  }

  setMaxWorldHeight(val) {
    if (typeof val === 'number') {
      this.maxWorldHeight = val;
    }
  }

  getMaxWorldHeight() {
    return this.maxWorldHeight;
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

  /**
   * Sets the 1st camera dedicated to rendering character and snowboard on top.
   * @param {THREE.Camera} characterCamera
   */
  setCharacterCamera(characterCamera) {
    this.characterCamera = characterCamera;
    if (this.characterCamera) {
      this.characterCamera.position.copy(this.camera.position);
      this.characterCamera.quaternion.copy(this.camera.quaternion);
      this.characterCamera.fov = this.camera.fov;
      this.characterCamera.updateProjectionMatrix();
    }
  }

  toggleMode() {
    this.mode = 'ski';
    return this.mode;
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
    // Launch skier downhill along heading with authentic starting momentum (9 m/s = ~32 km/h)
    _scratchForwardXZ.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    if (_scratchForwardXZ.lengthSq() < 0.001) {
      _scratchForwardXZ.set(0, 0, -1);
    }
    const launchSpeed = 9.0;
    this.velocity.x = _scratchForwardXZ.x * launchSpeed;
    this.velocity.z = _scratchForwardXZ.z * launchSpeed;
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

    if (this.leafParticles) {
      _scratchForwardXZ.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
      _scratchRightXZ.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
      this.leafParticles.update(
        dt,
        this.position,
        this.velocity,
        this.camera.position,
        _scratchForwardXZ,
        _scratchRightXZ
      );
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

    if (this.characterCamera && this.characterCamera.fov !== this.camera.fov) {
      this.characterCamera.fov = this.camera.fov;
      this.characterCamera.updateProjectionMatrix();
    }
  }

  /**
   * Updates First-Person (FPS) Camera locked directly at character's head position.
   * Features dynamic head tracking, neck flexion when looking down at the snowboard,
   * zero-velocity-lag stabilization, and a rock-solid level horizon.
   * @param {number} dt - Delta time
   * @param {boolean} [snap=false]
   * @private
   */
  _updateCamera(dt, snap = false) {
    // 1. Position camera directly at character's head / eye position
    if (this.character && this.character.isLoaded) {
      this.character.getHeadPosition(_scratchCamDesired);
    } else {
      _scratchCamDesired.copy(this.position);
      _scratchCamDesired.y += this.focusHeight + 0.25;
    }

    // Dynamic neck flexion arc:
    // When looking down, natural neck articulation tilts the head forward,
    // subtly arcing the eyes forward (+0.09m) and down (-0.02m) as pitch increases.
    // When looking level or up, the exact neutral eye position (+0.22m forward) is maintained.
    const downPitch = Math.max(0, this.pitch);
    const pitchRatio = Math.min(1.0, downPitch / this.maxPitch);
    const forwardOffset = 0.22 + 0.09 * pitchRatio;
    const verticalOffset = -0.02 * pitchRatio;

    _scratchForwardXZ.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    _scratchCamDesired.addScaledVector(_scratchForwardXZ, forwardOffset);
    _scratchCamDesired.y += verticalOffset;

    // Camera shake impact trauma on tree collisions and hard landings
    if (this.trauma > 0.001) {
      this.trauma = Math.max(0, this.trauma - dt * 3.5);
      this.shakeTime += dt;
      const shake = this.trauma * this.trauma;
      const t = this.shakeTime * 38.0;
      _scratchCamDesired.x += (Math.sin(t * 1.7) + Math.cos(t * 3.1) * 0.5) * 0.06 * shake;
      _scratchCamDesired.y += (Math.cos(t * 1.5) + Math.sin(t * 2.9) * 0.5) * 0.06 * shake;
    }

    // 2. Head tracking stabilization:
    // Track the head bone position relative to the player ground position.
    // By smoothing the local head offset, the camera stays locked to the character's head
    // (faithfully following every crouch, lean, and stance) with zero velocity lag,
    // while absorbing keyframe animation jitter.
    _scratchLocalOffset.subVectors(_scratchCamDesired, this.position);

    if (snap || !this._headOffsetInitialized) {
      this._smoothedHeadOffset.copy(_scratchLocalOffset);
      this._headOffsetInitialized = true;
    } else {
      const smoothRate = 24.0;
      this._smoothedHeadOffset.x = THREE.MathUtils.damp(this._smoothedHeadOffset.x, _scratchLocalOffset.x, smoothRate, dt);
      this._smoothedHeadOffset.y = THREE.MathUtils.damp(this._smoothedHeadOffset.y, _scratchLocalOffset.y, smoothRate, dt);
      this._smoothedHeadOffset.z = THREE.MathUtils.damp(this._smoothedHeadOffset.z, _scratchLocalOffset.z, smoothRate, dt);
    }

    this.camera.position.copy(this.position).add(this._smoothedHeadOffset);

    // 3. Camera Rotation
    // Yaw: turns left/right with mouse steering
    // Pitch: tilts down/up (negative pitch tilts up, positive pitch tilts down)
    // Roll: locked to 0 for a rock-solid, level horizon with zero wobble
    _scratchCamEuler.set(-this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(_scratchCamEuler);

    // Synchronize 1st camera (character & snowboard overlay camera)
    if (this.characterCamera) {
      this.characterCamera.position.copy(this.camera.position);
      this.characterCamera.quaternion.copy(this.camera.quaternion);
    }
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
   * Accelerates with W / Up Arrow; steers smoothly via mouse gaze
   * @private
   */
  _updateSkiPhysics(dt, forward, right) {
    _scratchForwardXZ.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    _scratchRightXZ.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();

    const isAccelerating = this.keys.forward;

    const currentGroundHeight = this.terrainManager.getHeightAt(this.position.x, this.position.z);
    const normal = this.terrainManager.getNormalAt(this.position.x, this.position.z);

    const prevX = this.position.x;
    const prevZ = this.position.z;

    if (this.isGrounded) {
      this.airTime = 0.0;

      // 1. Downhill Gravity Acceleration (F = m * g * sin(theta))
      _scratchGVec.set(0, -this.gravity, 0);
      _scratchDownhill.copy(_scratchGVec).addScaledVector(normal, -_scratchGVec.dot(normal));

      const downhillBoost = isAccelerating ? this.tuckBonus : 1.0;
      this.velocity.addScaledVector(_scratchDownhill, dt * downhillBoost);

      // 2. Active Push on Flats / Gentle Slopes (W or ArrowUp or mobile touch)
      const hasTouch = (this.leftTouchIds && this.leftTouchIds.size > 0) || this.rightTouchId !== null;
      const initialHorizSpeed = Math.hypot(this.velocity.x, this.velocity.z);

      if (isAccelerating || (initialHorizSpeed < 2.5 && hasTouch)) {
        if (initialHorizSpeed < this.pushAccel) {
          const pushForce = Math.max(16.0, (this.pushAccel - initialHorizSpeed) * 4.0);
          this.velocity.addScaledVector(_scratchForwardXZ, pushForce * dt);
        } else {
          // Continuous tuck speed boost when holding W or left touch
          this.velocity.addScaledVector(_scratchForwardXZ, 9.0 * dt);
        }
      }

      // 3. Directional Mouse Steering & Carving Grip
      const postPushSpeed = Math.hypot(this.velocity.x, this.velocity.z);
      if (postPushSpeed > 0.05) {
        const lakeData = this.terrainManager.heightmap?.getLakeData ? this.terrainManager.heightmap.getLakeData(this.position.x, this.position.z) : null;
        const isOnIce = lakeData && lakeData.isFrozenLake;

        let frictionRate = isAccelerating ? this.snowFriction * 0.35 : this.snowFriction;
        if (isOnIce) {
          frictionRate *= 0.22;
        }

        const newSpeed = Math.max(0, postPushSpeed * (1.0 - frictionRate * dt));

        // Smooth carving alignment: turn velocity towards forward heading (mouse steering)
        const currentDirX = this.velocity.x / postPushSpeed;
        const currentDirZ = this.velocity.z / postPushSpeed;

        const targetDirX = _scratchForwardXZ.x;
        const targetDirZ = _scratchForwardXZ.z;

        const steerRate = isOnIce ? 4.5 : 8.5;
        const lerpFactor = Math.min(1.0, steerRate * dt);
        let dirX = currentDirX + (targetDirX - currentDirX) * lerpFactor;
        let dirZ = currentDirZ + (targetDirZ - currentDirZ) * lerpFactor;
        const dirLen = Math.hypot(dirX, dirZ);
        if (dirLen > 0.0001) {
          dirX /= dirLen;
          dirZ /= dirLen;
        }

        this.velocity.x = dirX * newSpeed;
        this.velocity.z = dirZ * newSpeed;

        // Compute carving bank angle for the character model (lean into turn)
        const lateralDot = this.velocity.x * _scratchRightXZ.x + this.velocity.z * _scratchRightXZ.z;
        const carveRatio = THREE.MathUtils.clamp(-lateralDot / Math.max(4.0, newSpeed), -1.0, 1.0);
        this.steerBank = carveRatio * 0.35;
      } else {
        this.steerBank = 0.0;
        // If stopped or nearly stopped and pressing forward or touching on mobile, immediately launch along gaze heading
        if (isAccelerating || hasTouch) {
          this.velocity.x = _scratchForwardXZ.x * 4.0;
          this.velocity.z = _scratchForwardXZ.z * 4.0;
        }
      }

      // 4. Ground Contact & Slope Following
      const nextX = this.position.x + this.velocity.x * dt;
      const nextZ = this.position.z + this.velocity.z * dt;
      const nextGroundHeight = this.terrainManager.getHeightAt(nextX, nextZ);

      const requiredSlopeVy = dt > 0.0001 ? (nextGroundHeight - this.position.y) / dt : 0;

      // 5. Natural Airtime Takeoff (crest launch or ramp launch)
      const currentGroundSpeed = Math.hypot(this.velocity.x, this.velocity.z);
      const ballisticVy = this.velocity.y - this.gravity * dt;
      const isDroppingOverCrest = requiredSlopeVy < ballisticVy - 2.5 && currentGroundSpeed > 15.0;
      const isLaunchingOffRamp = this.velocity.y > 1.0 && requiredSlopeVy < this.velocity.y - 1.5;

      if (isDroppingOverCrest || isLaunchingOffRamp) {
        this.isGrounded = false;
        this.airTime = 0.05;
        this.position.x = nextX;
        this.position.z = nextZ;

        // Cap upward takeoff velocity based on height cap (if configured)
        if (this.maxAirborneHeight !== Infinity) {
          const maxTakeoffVy = Math.sqrt(2 * this.gravity * this.maxAirborneHeight);
          if (this.velocity.y > maxTakeoffVy) {
            this.velocity.y = maxTakeoffVy;
          }
        }

        this.position.y += this.velocity.y * dt;

        // Enforce height cap immediately on takeoff (if configured)
        if (this.maxAirborneHeight !== Infinity) {
          const currentGround = this.terrainManager.getHeightAt(this.position.x, this.position.z);
          if (this.position.y > currentGround + this.maxAirborneHeight) {
            this.position.y = currentGround + this.maxAirborneHeight;
            if (this.velocity.y > 0) this.velocity.y = 0;
          }
        }
        if (this.maxWorldHeight !== Infinity && this.position.y > this.maxWorldHeight) {
          this.position.y = this.maxWorldHeight;
          if (this.velocity.y > 0) this.velocity.y = 0;
        }
      } else {
        // When grounded, respect maxWorldHeight if configured
        if (this.maxWorldHeight !== Infinity && nextGroundHeight > this.maxWorldHeight) {
          this.position.x = prevX;
          this.position.z = prevZ;
          this.velocity.x = 0;
          this.velocity.z = 0;
        } else {
          this.position.x = nextX;
          this.position.z = nextZ;
          this.position.y = nextGroundHeight;
          this.velocity.y = requiredSlopeVy;
        }
      }
    } else {
      // Ballistic airtime trajectory
      this.airTime += dt;
      this.velocity.y -= this.gravity * dt;

      const activeAirDrag = isAccelerating ? this.tuckAirDrag : this.airDrag;
      this.velocity.x -= this.velocity.x * activeAirDrag * dt;
      this.velocity.z -= this.velocity.z * activeAirDrag * dt;

      if (isAccelerating) {
        this.velocity.addScaledVector(_scratchForwardXZ, 8.0 * dt);
      }

      this.position.addScaledVector(this.velocity, dt);

      // Height cap enforcement: prevent player from going up higher than maxAirborneHeight above snow (if configured)
      if (this.maxAirborneHeight !== Infinity) {
        const currentGroundY = this.terrainManager.getHeightAt(this.position.x, this.position.z);
        const capY = currentGroundY + this.maxAirborneHeight;
        if (this.position.y > capY) {
          this.position.y = capY;
          if (this.velocity.y > 0) {
            this.velocity.y = 0; // Stop upward velocity at height cap
          }
        }
      }

      // World elevation height cap enforcement (if set)
      if (this.maxWorldHeight !== Infinity && this.position.y > this.maxWorldHeight) {
        this.position.y = this.maxWorldHeight;
        if (this.velocity.y > 0) {
          this.velocity.y = 0;
        }
      }

      // Ground landing collision detection
      const testGroundY = this.terrainManager.getHeightAt(this.position.x, this.position.z);
      if (this.position.y <= testGroundY) {
        this.position.y = testGroundY;
        this.isGrounded = true;
        this.airTime = 0.0;

        const landNormal = this.terrainManager.getNormalAt(this.position.x, this.position.z);
        const normalSpeed = this.velocity.dot(landNormal);
        if (normalSpeed < 0) {
          this.velocity.addScaledVector(landNormal, -normalSpeed);
        }
      }
    }

    // 6. Tree Trunk Collisions
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
      12.0,
      this._nearbyTrunks
    );

    if (!nearbyTrunks || nearbyTrunks.length === 0) return;

    const playerRadius = this.treeCollisionRadius || 0.22;
    const playerFeetY = this.position.y;
    const playerHeadY = this.position.y + 1.8;
    const playerMidY = this.position.y + 0.9;

    // Tree branch & foliage touch -> spawn fluttering leaf particles whenever touching any part of the branches
    if (this.leafParticles) {
      const currentGroundSpeed = Math.hypot(this.velocity.x, this.velocity.z);
      if (currentGroundSpeed >= 1.5) {
        _scratchForwardXZ.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
        _scratchRightXZ.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();

        for (let i = 0; i < nearbyTrunks.length; i++) {
          const t = nearbyTrunks[i];
          // Dry / dead trees (snags) have no foliage/leaves to shed
          if (t.isDead || t.isDry || t.foliageType === 'none' || t.category === 'snag') continue;

          const branchBottom = t.y - 0.6;
          const branchTop = t.y + t.height + 0.5;
          if (playerFeetY > branchTop || playerHeadY < branchBottom) continue;

          // Realistic conical branch profile: widest at base / lower third, tapering to crown
          const relY = Math.max(0, Math.min(1.0, (playerMidY - t.y) / Math.max(1.0, t.height)));
          const taper = relY <= 0.35 ? 1.0 : Math.max(0.25, 1.0 - ((relY - 0.35) / 0.65) * 0.70);
          const branchRadiusAtY = (t.branchRadius || 4.5) * taper;
          const touchThreshold = branchRadiusAtY + 0.45; // Accounts for player body, ski length, and poles

          const dx = this.position.x - t.x;
          const dz = this.position.z - t.z;
          let dist = Math.hypot(dx, dz);
          let isTouchingBranch = dist < touchThreshold;

          // Continuous swept motion check so fast-moving skiers never skip branch touches between frames
          if (!isTouchingBranch) {
            const segX = this.position.x - prevX;
            const segZ = this.position.z - prevZ;
            const segLenSq = segX * segX + segZ * segZ;
            if (segLenSq > 1e-4) {
              let tParam = ((t.x - prevX) * segX + (t.z - prevZ) * segZ) / segLenSq;
              if (tParam > 0 && tParam < 1) {
                const closeX = prevX + tParam * segX;
                const closeZ = prevZ + tParam * segZ;
                const cdx = closeX - t.x;
                const cdz = closeZ - t.z;
                const sweptDist = Math.hypot(cdx, cdz);
                if (sweptDist < touchThreshold) {
                  isTouchingBranch = true;
                  dist = sweptDist;
                }
              }
            }
          }

          if (isTouchingBranch) {
            this.leafParticles.spawnBrush(
              this.position,
              this.velocity,
              this.camera.position,
              _scratchForwardXZ,
              _scratchRightXZ,
              t,
              dist,
              branchRadiusAtY
            );
          }
        }
      }
    }

    let momentumDampened = false;

    for (let pass = 0; pass < 3; pass++) {
      let hadCollision = false;

      for (let i = 0; i < nearbyTrunks.length; i++) {
        const t = nearbyTrunks[i];

        const trunkBottom = t.y - 0.5;
        const trunkTop = t.y + t.height;
        if (playerFeetY > trunkTop || playerHeadY < trunkBottom) {
          continue;
        }

        const minDistance = t.radius + playerRadius;
        const minDistanceSq = minDistance * minDistance;

        // Current distance vector from tree center to player
        let dx = this.position.x - t.x;
        let dz = this.position.z - t.z;
        let distSq = dx * dx + dz * dz;

        // Continuous swept segment test between prev and current positions
        let isSwept = false;
        if (distSq >= minDistanceSq) {
          const segX = this.position.x - prevX;
          const segZ = this.position.z - prevZ;
          const segLenSq = segX * segX + segZ * segZ;
          if (segLenSq > 1e-6) {
            let tParam = ((t.x - prevX) * segX + (t.z - prevZ) * segZ) / segLenSq;
            if (tParam > 0 && tParam < 1) {
              const closeX = prevX + tParam * segX;
              const closeZ = prevZ + tParam * segZ;
              const cdx = closeX - t.x;
              const cdz = closeZ - t.z;
              if (cdx * cdx + cdz * cdz < minDistanceSq) {
                isSwept = true;
                dx = cdx;
                dz = cdz;
                distSq = cdx * cdx + cdz * cdz;
              }
            }
          }
        }

        if (distSq < minDistanceSq || isSwept) {
          hadCollision = true;
          let dist = Math.sqrt(distSq);
          let nx = 0;
          let nz = 0;

          if (dist > 1e-4) {
            nx = dx / dist;
            nz = dz / dist;
          } else {
            // Player is right on tree center: push out opposite to velocity or gaze
            const spd = Math.hypot(this.velocity.x, this.velocity.z);
            if (spd > 0.01) {
              nx = -this.velocity.x / spd;
              nz = -this.velocity.z / spd;
            } else {
              nx = _scratchForwardXZ.x || 1;
              nz = _scratchForwardXZ.z || 0;
            }
          }

          // Clean separation: push position outside with safety clearance margin (4cm) to prevent re-collision
          const separationMargin = 0.04;
          this.position.x = t.x + nx * (minDistance + separationMargin);
          this.position.z = t.z + nz * (minDistance + separationMargin);

          // Velocity Deflection & Momentum Reduction:
          // Hitting a tree removes 70% of momentum (retaining 30% speed)
          const vn = this.velocity.x * nx + this.velocity.z * nz;
          const currentSpeed = Math.hypot(this.velocity.x, this.velocity.z);

          // Determine which tangent aligns best with the player's movement direction
          // Tangent 1: (-nz, nx); Tangent 2: (nz, -nx)
          let tx = -nz;
          let tz = nx;
          if (this.velocity.x * tx + this.velocity.z * tz < 0) {
            tx = nz;
            tz = -nx;
          }

          if (vn < 0 && !momentumDampened) {
            momentumDampened = true;

            // Remove 70% of momentum -> retain 30% of current speed
            const remainingSpeed = currentSpeed * 0.30;

            // Direct remaining 30% momentum along the tangent around the trunk plus a slight outward pop (0.8 m/s)
            this.velocity.x = tx * remainingSpeed + nx * 0.8;
            this.velocity.z = tz * remainingSpeed + nz * 0.8;

            // Spawn explosive burst of torn leaves from trunk impact (live foliage trees only)
            if (this.leafParticles && !t.isDead && !t.isDry && t.foliageType !== 'none' && t.category !== 'snag') {
              this.leafParticles.spawnImpact(
                this.position,
                this.velocity,
                this.camera.position,
                _scratchForwardXZ,
                _scratchRightXZ,
                t
              );
            }

            // Impact camera shake feedback proportional to hit severity
            if (Math.abs(vn) > 3.0) {
              this.trauma = Math.min(0.45, this.trauma + Math.min(0.35, Math.abs(vn) * 0.025));
            }
          } else if (vn >= 0) {
            // Already moving outward: ensure clean clearance
            if (vn < 0.5) {
              this.velocity.x += nx * 0.5;
              this.velocity.z += nz * 0.5;
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
    // Spectator fly mode disabled; ski physics is active mode
  }

  dispose() {
    if (this.character) {
      this.character.dispose();
      this.character = null;
      this.snowboard = null;
    }
    if (this.leafParticles) {
      this.leafParticles.dispose(this.scene);
      this.leafParticles = null;
    }
  }
}
