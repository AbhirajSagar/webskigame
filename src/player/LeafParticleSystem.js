import * as THREE from 'three';
import { getTreeFoliageType } from '../terrain/TreeGenerator.js';

export { getTreeFoliageType };

const MAX_PARTICLES_PER_TYPE = 220;

/**
 * FoliageTypePool
 * High-performance, zero-allocation particle pool for a specific foliage texture variant
 * (e.g. green pine needles, autumn orange pine needles, snow-covered needles).
 *
 * Configured with:
 * - renderOrder: 100 (renders after all trees and terrain, so depth testing correctly places leaves in front of trees)
 * - depthTest: true, depthWrite: true, alphaTest: 0.28
 * - Layer 0 (Secondary Camera / worldCamera only; excluded from CharacterCamera)
 */
class FoliageTypePool {
  /**
   * @param {THREE.Scene} scene
   * @param {string} textureUrl
   * @param {THREE.BufferGeometry} geometry
   * @param {number} maxCount
   */
  constructor(scene, textureUrl, geometry, maxCount = MAX_PARTICLES_PER_TYPE) {
    this.scene = scene;
    this.geometry = geometry;
    this.maxCount = maxCount;

    const textureLoader = new THREE.TextureLoader();
    this.texture = textureLoader.load(textureUrl);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      alphaTest: 0.28,
      depthTest: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      fog: true,
    });

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.maxCount);
    // Explicitly configure Layer 0 for the secondary camera (worldCamera / environment)
    this.mesh.layers.set(0);
    this.mesh.layers.disable(1);

    // CRITICAL: renderOrder = 100 ensures particles render AFTER all trees and terrain (renderOrder = 0)
    // Combined with depthTest = true, leaves closer than trees will render ON TOP OF the trees!
    this.mesh.renderOrder = 100;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;

    // Zero-allocation pre-allocated TypedArrays for physics & slipstream simulation
    this._positions = new Float32Array(this.maxCount * 3);
    this._velocities = new Float32Array(this.maxCount * 3);
    this._rotations = new Float32Array(this.maxCount * 3);
    this._rotVelocities = new Float32Array(this.maxCount * 3);
    this._lifetimes = new Float32Array(this.maxCount);
    this._maxLifetimes = new Float32Array(this.maxCount);
    this._baseScales = new Float32Array(this.maxCount);

    // Slipstream follow & drift parameters
    this._draftTimers = new Float32Array(this.maxCount);
    this._draftDurations = new Float32Array(this.maxCount);
    this._leadOffsets = new Float32Array(this.maxCount * 3); // leadFwd, leadSide, leadUp
    this._swirlPhases = new Float32Array(this.maxCount);
    this._swirlSpeeds = new Float32Array(this.maxCount);
    this._swirlRadii = new Float32Array(this.maxCount);
    this._driftDirs = new Float32Array(this.maxCount * 3); // outward drift on peel-off

    this._dummy = new THREE.Object3D();
    this._nextIndex = 0;

    // Initialize all particle matrices off-screen
    for (let i = 0; i < this.maxCount; i++) {
      this._dummy.position.set(0, -9999, 0);
      this._dummy.scale.set(0, 0, 0);
      this._dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this._dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    if (this.scene) {
      this.scene.add(this.mesh);
    }
  }

  /**
   * Spawns a single leaf particle.
   * @private
   */
  _spawnParticle(
    x, y, z,
    vx, vy, vz,
    scale,
    lifetime,
    draftDuration,
    leadFwd, leadSide, leadUp,
    driftX, driftY, driftZ,
    swirlSpeed, swirlRadius
  ) {
    const idx = this._nextIndex;
    this._nextIndex = (this._nextIndex + 1) % this.maxCount;

    const pIdx = idx * 3;
    this._positions[pIdx + 0] = x;
    this._positions[pIdx + 1] = y;
    this._positions[pIdx + 2] = z;

    this._velocities[pIdx + 0] = vx;
    this._velocities[pIdx + 1] = vy;
    this._velocities[pIdx + 2] = vz;

    // Random initial orientation
    this._rotations[pIdx + 0] = Math.random() * Math.PI * 2;
    this._rotations[pIdx + 1] = Math.random() * Math.PI * 2;
    this._rotations[pIdx + 2] = Math.random() * Math.PI * 2;

    // Chaotic angular tumble rates
    this._rotVelocities[pIdx + 0] = (Math.random() - 0.5) * 16.0;
    this._rotVelocities[pIdx + 1] = (Math.random() - 0.5) * 18.0;
    this._rotVelocities[pIdx + 2] = (Math.random() - 0.5) * 16.0;

    this._lifetimes[idx] = lifetime;
    this._maxLifetimes[idx] = lifetime;
    this._baseScales[idx] = scale;

    this._draftTimers[idx] = draftDuration;
    this._draftDurations[idx] = draftDuration;

    this._leadOffsets[pIdx + 0] = leadFwd;
    this._leadOffsets[pIdx + 1] = leadSide;
    this._leadOffsets[pIdx + 2] = leadUp;

    this._swirlPhases[idx] = Math.random() * Math.PI * 2;
    this._swirlSpeeds[idx] = swirlSpeed;
    this._swirlRadii[idx] = swirlRadius;

    this._driftDirs[pIdx + 0] = driftX;
    this._driftDirs[pIdx + 1] = driftY;
    this._driftDirs[pIdx + 2] = driftZ;
  }

  /**
   * Spawns 4 to 7 leaf particles distributed randomly on both left and right sides.
   */
  spawnBrush(playerPos, playerVel, cameraPos, forwardDir, rightDir, tree, dist, canopyRadius) {
    const speed = playerVel.length();
    const camPos = cameraPos || playerPos;

    // In the world environment (Camera 2), slipstream tracks physical skier travel direction in 3D space
    const horizSpeed = Math.hypot(playerVel.x, playerVel.z);
    let dirX, dirZ, rgtX, rgtZ;
    if (horizSpeed > 2.0) {
      dirX = playerVel.x / horizSpeed;
      dirZ = playerVel.z / horizSpeed;
      rgtX = -dirZ;
      rgtZ = dirX;
    } else {
      const fwdX = forwardDir ? forwardDir.x : 0;
      const fwdZ = forwardDir ? forwardDir.z : -1;
      const fwdLen = Math.hypot(fwdX, fwdZ) || 1.0;
      dirX = fwdX / fwdLen;
      dirZ = fwdZ / fwdLen;
      rgtX = rightDir ? rightDir.x : -dirZ;
      rgtZ = rightDir ? rightDir.z : dirX;
    }

    // Number of leaves per burst: clean 2 to 3 leaves as requested (no visual clutter)
    const count = 2 + (Math.random() < 0.45 ? 1 : 0); // 2 or 3 leaves

    for (let i = 0; i < count; i++) {
      // Distribute across BOTH left and right sides
      const sideSign = (i % 2 === 0) ? -1.0 : 1.0;

      // Position in front of the skier's movement
      const leadFwd = 1.0 + Math.random() * 1.2;
      const leadSide = sideSign * (0.25 + Math.random() * 0.45);
      const leadUp = -0.10 + (Math.random() - 0.5) * 0.35;

      // Initial spawn position directly in front of the player in world space
      const px = camPos.x + dirX * leadFwd + rgtX * leadSide;
      const py = camPos.y + leadUp;
      const pz = camPos.z + dirZ * leadFwd + rgtZ * leadSide;

      // Initial velocity matches player forward momentum
      const vx = playerVel.x;
      const vy = playerVel.y * 0.8;
      const vz = playerVel.z;

      // Speed-dependent duration: 0.5s at low speeds up to strictly 1.0s max at high speeds
      const speedRatio = Math.min(1.0, Math.max(0.0, (speed - 2.5) / 18.0));
      const totalLifetime = Math.min(1.0, Math.max(0.50, 0.50 + speedRatio * 0.50 + (Math.random() - 0.5) * 0.08));
      const draftDuration = totalLifetime * 0.65; // follows player for 65% of lifetime (0.32s - 0.65s)
      const lifetime = totalLifetime; // strictly capped at 1.0s max and 0.5s min

      const scale = 0.42 + Math.random() * 0.28;

      // Outward peel-off velocity when draft expires
      const driftSpeed = 2.8 + Math.random() * 2.2;
      const driftX = rgtX * (sideSign * driftSpeed) + (Math.random() - 0.5) * 1.0;
      const driftY = (Math.random() - 0.1) * 1.5;
      const driftZ = rgtZ * (sideSign * driftSpeed) + (Math.random() - 0.5) * 1.0;

      const swirlSpeed = 4.5 + Math.random() * 4.5;
      const swirlRadius = 0.16 + Math.random() * 0.22;

      this._spawnParticle(
        px, py, pz,
        vx, vy, vz,
        scale,
        lifetime,
        draftDuration,
        leadFwd, leadSide, leadUp,
        driftX, driftY, driftZ,
        swirlSpeed, swirlRadius
      );
    }
  }

  /**
   * Spawns an explosive burst of leaves upon a trunk impact.
   */
  spawnImpact(playerPos, playerVel, cameraPos, forwardDir, rightDir, tree, count = 10) {
    const camPos = cameraPos || playerPos;

    const fwdX = forwardDir ? forwardDir.x : 0;
    const fwdZ = forwardDir ? forwardDir.z : -1;
    const fwdLen = Math.hypot(fwdX, fwdZ) || 1.0;
    const nfwdX = fwdX / fwdLen;
    const nfwdZ = fwdZ / fwdLen;

    const rgtX = rightDir ? rightDir.x : -nfwdZ;
    const rgtZ = rightDir ? rightDir.z : nfwdX;

    const outX = playerPos.x - tree.x;
    const outZ = playerPos.z - tree.z;
    const d = Math.hypot(outX, outZ) || 1.0;
    const nx = outX / d;
    const nz = outZ / d;

    const speed = playerVel.length();
    const speedRatio = Math.min(1.0, Math.max(0.0, (speed - 2.5) / 18.0));

    for (let i = 0; i < count; i++) {
      const isSlipstream = i < count * 0.5;
      const sideSign = (i % 2 === 0) ? -1.0 : 1.0;

      const px = camPos.x + (Math.random() - 0.5) * 0.8 + nx * 0.3;
      const py = camPos.y + (Math.random() - 0.5) * 0.6;
      const pz = camPos.z + (Math.random() - 0.5) * 0.8 + nz * 0.3;

      const blastSpeed = 3.0 + Math.random() * 5.0;
      const angle = (Math.random() - 0.5) * Math.PI * 1.4;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const rx = nx * cosA - nz * sinA;
      const rz = nx * sinA + nz * cosA;

      const vx = rx * blastSpeed + playerVel.x * 0.5;
      const vy = 1.0 + Math.random() * 4.0;
      const vz = rz * blastSpeed + playerVel.z * 0.5;

      const totalLifetime = Math.min(1.0, Math.max(0.50, 0.50 + speedRatio * 0.50 + (Math.random() - 0.5) * 0.08));
      const draftDuration = isSlipstream ? totalLifetime * 0.55 : 0;
      const lifetime = totalLifetime;
      const scale = 0.44 + Math.random() * 0.35;

      const leadFwd = 1.0 + Math.random() * 1.5;
      const leadSide = sideSign * (0.3 + Math.random() * 0.5);
      const leadUp = -0.1 + (Math.random() - 0.5) * 0.4;

      const driftX = rx * 2.5;
      const driftY = (Math.random() - 0.2) * 2.0;
      const driftZ = rz * 2.5;

      this._spawnParticle(
        px, py, pz,
        vx, vy, vz,
        scale,
        lifetime,
        draftDuration,
        leadFwd, leadSide, leadUp,
        driftX, driftY, driftZ,
        5.5, 0.20
      );
    }
  }

  /**
   * Updates particle simulation.
   */
  update(dt, playerPos, playerVel, cameraPos, forwardDir, rightDir) {
    if (!this.mesh) return;

    let hasActiveParticles = false;

    const camX = cameraPos ? cameraPos.x : (playerPos ? playerPos.x : 0);
    const camY = cameraPos ? cameraPos.y : (playerPos ? playerPos.y + 1.5 : 0);
    const camZ = cameraPos ? cameraPos.z : (playerPos ? playerPos.z : 0);

    const pvx = playerVel ? playerVel.x : 0;
    const pvy = playerVel ? playerVel.y : 0;
    const pvz = playerVel ? playerVel.z : 0;

    // Movement direction in the world environment (Camera 2)
    const horizSpeed = Math.hypot(pvx, pvz);
    let dirX, dirZ, rgtX, rgtZ;
    if (horizSpeed > 2.0) {
      dirX = pvx / horizSpeed;
      dirZ = pvz / horizSpeed;
      rgtX = -dirZ;
      rgtZ = dirX;
    } else {
      const fwdX = forwardDir ? forwardDir.x : 0;
      const fwdZ = forwardDir ? forwardDir.z : -1;
      const fwdLen = Math.hypot(fwdX, fwdZ) || 1.0;
      dirX = fwdX / fwdLen;
      dirZ = fwdZ / fwdLen;
      rgtX = rightDir ? rightDir.x : -dirZ;
      rgtZ = rightDir ? rightDir.z : dirX;
    }

    for (let i = 0; i < this.maxCount; i++) {
      if (this._lifetimes[i] > 0) {
        hasActiveParticles = true;
        this._lifetimes[i] -= dt;

        const pIdx = i * 3;

        if (this._draftTimers[i] > 0) {
          // --- 1. SLIPSTREAM DRAFT PHASE (FOLLOWING THE PLAYER) ---
          this._draftTimers[i] -= dt;

          // Turbulent swirling oscillation
          this._swirlPhases[i] += this._swirlSpeeds[i] * dt;
          const swirlH = Math.sin(this._swirlPhases[i]) * this._swirlRadii[i];
          const swirlV = Math.cos(this._swirlPhases[i] * 1.4) * (this._swirlRadii[i] * 0.7);

          const leadFwd = this._leadOffsets[pIdx + 0];
          const leadSide = this._leadOffsets[pIdx + 1] + swirlH;
          const leadUp = this._leadOffsets[pIdx + 2] + swirlV;

          // Target position in the skier's forward view field in the world environment
          const targetX = camX + dirX * leadFwd + rgtX * leadSide;
          const targetY = camY + leadUp;
          const targetZ = camZ + dirZ * leadFwd + rgtZ * leadSide;

          // Suction force firmly keeps particle locked to target offset in front of camera
          const pullStrength = 12.0;
          const dx = targetX - this._positions[pIdx + 0];
          const dy = targetY - this._positions[pIdx + 1];
          const dz = targetZ - this._positions[pIdx + 2];

          this._velocities[pIdx + 0] = pvx + dx * pullStrength;
          this._velocities[pIdx + 1] = pvy * 0.8 + dy * pullStrength;
          this._velocities[pIdx + 2] = pvz + dz * pullStrength;
        } else {
          // --- 2. DRIFT-OFF / FREE FLIGHT PHASE ---
          const dragFactor = Math.max(0, 1.0 - 2.8 * dt);
          this._velocities[pIdx + 0] = (this._velocities[pIdx + 0] + this._driftDirs[pIdx + 0] * (2.2 * dt)) * dragFactor;
          this._velocities[pIdx + 1] -= 3.6 * dt; // gravity
          this._velocities[pIdx + 2] = (this._velocities[pIdx + 2] + this._driftDirs[pIdx + 2] * (2.2 * dt)) * dragFactor;
        }

        // Position integration
        this._positions[pIdx + 0] += this._velocities[pIdx + 0] * dt;
        this._positions[pIdx + 1] += this._velocities[pIdx + 1] * dt;
        this._positions[pIdx + 2] += this._velocities[pIdx + 2] * dt;

        // Rotation tumble integration
        this._rotations[pIdx + 0] += this._rotVelocities[pIdx + 0] * dt;
        this._rotations[pIdx + 1] += this._rotVelocities[pIdx + 1] * dt;
        this._rotations[pIdx + 2] += this._rotVelocities[pIdx + 2] * dt;

        // Life scale curve:
        // Pop in quickly in the first 10% of life, stay full size while following,
        // and smoothly shrink away in the final 28% of life.
        const lifeRatio = Math.max(0, this._lifetimes[i] / this._maxLifetimes[i]);
        let scaleMult = 1.0;
        if (lifeRatio > 0.90) {
          scaleMult = (1.0 - lifeRatio) / 0.10; // Pop in
        } else if (lifeRatio < 0.28) {
          scaleMult = lifeRatio / 0.28; // Smooth shrink
        }

        const s = this._baseScales[i] * scaleMult;

        this._dummy.position.set(
          this._positions[pIdx + 0],
          this._positions[pIdx + 1],
          this._positions[pIdx + 2]
        );
        this._dummy.rotation.set(
          this._rotations[pIdx + 0],
          this._rotations[pIdx + 1],
          this._rotations[pIdx + 2]
        );
        this._dummy.scale.set(s, s, s);
        this._dummy.updateMatrix();

        this.mesh.setMatrixAt(i, this._dummy.matrix);
      } else {
        // Hide inactive particle off-screen if it was previously visible
        if (this._maxLifetimes[i] > 0) {
          this._maxLifetimes[i] = 0;
          this._dummy.position.set(0, -9999, 0);
          this._dummy.scale.set(0, 0, 0);
          this._dummy.updateMatrix();
          this.mesh.setMatrixAt(i, this._dummy.matrix);
        }
      }
    }

    if (hasActiveParticles || this.mesh.instanceMatrix.needsUpdate) {
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Disposes GPU resources.
   * @param {THREE.Scene} [scene]
   */
  dispose(scene) {
    if (this.mesh) {
      if (scene) scene.remove(this.mesh);
      else if (this.scene) this.scene.remove(this.mesh);

      if (this.material) this.material.dispose();
      if (this.texture) this.texture.dispose();
      this.mesh = null;
    }
  }
}

/**
 * LeafParticleSystem
 * Manages multi-textured leaf particle pools:
 * - Green needles (BranchMat_diffuse_green.png)
 * - Autumn orange needles (BranchMat_diffuse_orange.png)
 * - Snow-covered pine needles (BranchMat_diffuse_snow.png)
 *
 * Automatically spawns matching particle colors based on the tree's foliage texture.
 * Ensures leaves render on top of trees via renderOrder: 100 with depthTest: true.
 */
export class LeafParticleSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {number} [seed=1337]
   */
  constructor(scene, seed = 1337) {
    this.scene = scene;
    this.seed = seed;
    this.geometry = new THREE.PlaneGeometry(0.52, 0.52);

    // Dedicated pools for each tree texture variant
    this.pools = {
      green: new FoliageTypePool(this.scene, '/textures/BranchMat_diffuse_green.png', this.geometry),
      orange: new FoliageTypePool(this.scene, '/textures/BranchMat_diffuse_orange.png', this.geometry),
      snow: new FoliageTypePool(this.scene, '/textures/BranchMat_diffuse_snow.png', this.geometry),
    };

    this._lastBrushTime = 0;
    this._treeBrushTimes = new Map();

    // Minimum canopy area penetration threshold required to spawn leaves (e.g. 0.32 = 32% area).
    // Light touches or nudges on the outer branch tips (< 30%-35% area) do not shed leaves.
    this.minAreaThreshold = 0.32;
  }

  /**
   * Sets the minimum canopy area percentage required to trigger leaf spawning.
   * @param {number} threshold - Area fraction between 0.0 and 1.0 (e.g. 0.35 for 35%)
   */
  setMinAreaThreshold(threshold) {
    this.minAreaThreshold = Math.max(0.0, Math.min(0.95, threshold));
  }

  /**
   * Gets the current minimum canopy area percentage threshold.
   * @returns {number}
   */
  getMinAreaThreshold() {
    return this.minAreaThreshold;
  }

  /**
   * Updates or overrides the deterministic seed used for tree foliage type lookup.
   * @param {number} seed
   */
  setSeed(seed) {
    this.seed = seed;
  }

  /**
   * Backward-compatibility getter returning green instanced mesh.
   */
  get mesh() {
    return this.pools.green ? this.pools.green.mesh : null;
  }

  /**
   * Resolves the appropriate pool key based on the tree's position and seed.
   * Deterministically computes the foliage type from (tree.x, tree.z, seed),
   * eliminating the need to store foliage types per tree collider.
   * @private
   */
  _resolvePool(tree) {
    if (!tree) return this.pools.green;
    const type = (tree.x !== undefined && tree.z !== undefined)
      ? getTreeFoliageType(tree.x, tree.z, this.seed)
      : (tree.foliageType || 'green');
    if (type === 'orange') return this.pools.orange;
    if (type === 'snow') return this.pools.snow;
    return this.pools.green;
  }

  /**
   * Spawns leaves from the matching tree texture pool when touching or grazing tree branches.
   */
  /**
   * Spawns leaves from the matching tree texture pool when colliding with at least 30%-35% of the tree canopy area.
   * Light nudges or touches on the outer boundary (< 30%-35% area) are ignored.
   */
  spawnBrush(playerPos, playerVel, cameraPos, forwardDir, rightDir, tree, dist, canopyRadius) {
    const speed = playerVel.length();
    if (speed < 1.5) return;

    // Collided percentage area check:
    // Requires colliding with at least 30% - 35% of the tree's cross-sectional canopy area.
    // Penetrated area fraction = 1.0 - (dist / canopyRadius)^2.
    // A light graze or nudge at the outer branch tips yields < 30% area penetration and is ignored.
    if (canopyRadius && canopyRadius > 0 && dist !== undefined) {
      const normDist = Math.min(1.0, Math.max(0.0, dist / canopyRadius));
      const penetratedAreaFraction = 1.0 - (normDist * normDist);
      if (penetratedAreaFraction < this.minAreaThreshold) {
        return; // Light nudge or touch; do not spawn leaves
      }
    }

    // Debounce per tree: 350ms ensures a clean, crisp burst of 2-3 leaves per tree pass without flooding
    const now = performance.now() * 0.001;
    const treeKey = tree ? `${Math.round(tree.x * 4)},${Math.round(tree.z * 4)}` : 'default';
    const lastTime = this._treeBrushTimes.get(treeKey) || 0;
    if (now - lastTime < 0.35) return;
    this._treeBrushTimes.set(treeKey, now);

    if (this._treeBrushTimes.size > 80) {
      for (const [k, tVal] of this._treeBrushTimes.entries()) {
        if (now - tVal > 2.0) this._treeBrushTimes.delete(k);
      }
    }

    const pool = this._resolvePool(tree);
    pool.spawnBrush(playerPos, playerVel, cameraPos, forwardDir, rightDir, tree, dist, canopyRadius);
  }

  /**
   * Spawns leaves from the matching tree texture pool upon violent trunk impact.
   */
  spawnImpact(playerPos, playerVel, cameraPos, forwardDir, rightDir, tree, count = 10) {
    const pool = this._resolvePool(tree);
    pool.spawnImpact(playerPos, playerVel, cameraPos, forwardDir, rightDir, tree, count);
  }

  /**
   * Updates all active particle pools.
   */
  update(dt, playerPos, playerVel, cameraPos, forwardDir, rightDir) {
    this.pools.green.update(dt, playerPos, playerVel, cameraPos, forwardDir, rightDir);
    this.pools.orange.update(dt, playerPos, playerVel, cameraPos, forwardDir, rightDir);
    this.pools.snow.update(dt, playerPos, playerVel, cameraPos, forwardDir, rightDir);
  }

  /**
   * Disposes all GPU resources.
   * @param {THREE.Scene} [scene]
   */
  dispose(scene) {
    if (this.pools) {
      this.pools.green.dispose(scene);
      this.pools.orange.dispose(scene);
      this.pools.snow.dispose(scene);
    }
    if (this.geometry) {
      this.geometry.dispose();
      this.geometry = null;
    }
  }
}
