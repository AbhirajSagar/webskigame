import * as THREE from 'three';

/**
 * PlayerController
 * First-person explorer with dual modes:
 * - Walking mode: seamlessly snaps & smoothly tracks terrain elevation with gravity/jump
 * - Fly mode: free-flying spectator mode for observing procedural generation from above
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

    // State
    this.position = new THREE.Vector3(0, 20, 0);
    this.velocity = new THREE.Vector3();
    this.eyeHeight = 2.0;

    // Modes: 'walk' | 'fly'
    this.mode = 'walk';

    // Speeds (units per second)
    this.walkSpeed = 16.0;
    this.sprintSpeed = 38.0;
    this.flySpeed = 45.0;
    this.flySprintSpeed = 120.0;

    // Walking physics
    this.verticalVelocity = 0;
    this.gravity = 35.0;
    this.jumpForce = 13.0;
    this.isGrounded = false;

    // Orientation (aimed toward the rising mountain ridges & snowy peaks)
    this.yaw = -1.9;
    this.pitch = 0.05;
    this.isPointerLocked = false;
    this.isDragging = false;
    this.prevMouseX = 0;
    this.prevMouseY = 0;

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

    // Mode change callback (for HUD update)
    this.onModeChange = null;

    this._initInput();

    // Place initial camera at ground level + eyeHeight
    const startHeight = this.terrainManager.getHeightAt(0, 0);
    this.position.set(0, startHeight + this.eyeHeight, 0);
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
        if (this.mode === 'walk' && this.isGrounded) {
          this.verticalVelocity = this.jumpForce;
          this.isGrounded = false;
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

    // Clamp pitch to prevent gimbal flipping
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
    this.mode = this.mode === 'walk' ? 'fly' : 'walk';
    this.verticalVelocity = 0;
    if (this.onModeChange) {
      this.onModeChange(this.mode);
    }
  }

  update(deltaTime) {
    const dt = Math.min(deltaTime, 0.1);

    // Compute forward and right directional vectors
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);

    let moveDir = new THREE.Vector3();

    if (this.mode === 'walk') {
      // In walking mode, horizontal movement only
      forward.y = 0;
      forward.normalize();
      right.y = 0;
      right.normalize();

      if (this.keys.forward) moveDir.add(forward);
      if (this.keys.backward) moveDir.sub(forward);
      if (this.keys.right) moveDir.add(right);
      if (this.keys.left) moveDir.sub(right);

      if (moveDir.lengthSq() > 0.0001) {
        moveDir.normalize();
        const speed = this.keys.sprint ? this.sprintSpeed : this.walkSpeed;
        this.position.addScaledVector(moveDir, speed * dt);
      }

      // Height and ground following
      const groundHeight = this.terrainManager.getHeightAt(this.position.x, this.position.z);
      const targetEyeHeight = groundHeight + this.eyeHeight;

      // Apply jump & gravity
      this.verticalVelocity -= this.gravity * dt;
      this.position.y += this.verticalVelocity * dt;

      if (this.position.y <= targetEyeHeight) {
        // Ground contact
        this.position.y = targetEyeHeight;
        this.verticalVelocity = 0;
        this.isGrounded = true;
      } else {
        this.isGrounded = false;
      }
    } else {
      // Fly mode (free 3D movement)
      if (this.keys.forward) moveDir.add(forward);
      if (this.keys.backward) moveDir.sub(forward);
      if (this.keys.right) moveDir.add(right);
      if (this.keys.left) moveDir.sub(right);
      if (this.keys.up) moveDir.y += 1.0;
      if (this.keys.down) moveDir.y -= 1.0;

      if (moveDir.lengthSq() > 0.0001) {
        moveDir.normalize();
        const speed = this.keys.sprint ? this.flySprintSpeed : this.flySpeed;
        this.position.addScaledVector(moveDir, speed * dt);
      }
    }

    this.camera.position.copy(this.position);
  }
}
