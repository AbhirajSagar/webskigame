import * as THREE from 'three';

// Scratch vectors for zero runtime heap allocation in 60 FPS update loop
const _scratchVecA = new THREE.Vector3();
const _scratchVecB = new THREE.Vector3();
const _scratchVecC = new THREE.Vector3();
const _scratchWirePt = new THREE.Vector3();
const _scratchTangent = new THREE.Vector3();
const _scratchDummy = new THREE.Object3D();

const MAX_SPARKS = 140;

/**
 * WireSegment
 * Represents a single suspended wire/cable segment between two poles with natural catenary sag.
 */
export class WireSegment {
  constructor(start, end, options = {}) {
    this.start = start.clone();
    this.end = end.clone();
    this.sag = options.sag ?? 0.45; // Maximum vertical catenary sag at midpoint in meters
    this.radius = options.radius ?? 0.040; // Cable thickness in meters
    this.lineId = options.lineId || 'main';
    this.index = options.index ?? 0;
    this.nextSegment = null;
    this.prevSegment = null;

    this.chord = new THREE.Vector3().subVectors(this.end, this.start);
    this.length = this.chord.length();
    this.chordDir = this.chord.clone().normalize();

    // Bounding sphere for fast coarse culling
    this.center = new THREE.Vector3().addVectors(this.start, this.end).multiplyScalar(0.5);
    this.center.y -= this.sag * 0.5;
    this.boundingRadius = this.length * 0.55 + 2.0;
  }

  /**
   * Retrieves 3D position along wire at parametric coordinate t in [0, 1].
   * @param {number} t
   * @param {THREE.Vector3} target
   * @returns {THREE.Vector3}
   */
  getPointAt(t, target) {
    target.copy(this.start).lerp(this.end, t);
    // Catenary parabolic sag: 4 * sag * t * (1 - t)
    target.y -= 4.0 * this.sag * t * (1.0 - t);
    return target;
  }

  /**
   * Retrieves normalized 3D tangent vector pointing along wire at coordinate t.
   * @param {number} t
   * @param {THREE.Vector3} target
   * @returns {THREE.Vector3}
   */
  getTangentAt(t, target) {
    target.copy(this.chord);
    // Derivative of sag: -4 * sag * (1 - 2t)
    target.y -= 4.0 * this.sag * (1.0 - 2.0 * t);
    return target.normalize();
  }

  /**
   * Tests closest point and distance from a query position to this wire segment.
   * @param {THREE.Vector3} pos
   * @returns {{ t: number, point: THREE.Vector3, distance: number } | null}
   */
  getClosestPoint(pos) {
    // Quick coarse distance check against bounding center
    if (pos.distanceToSquared(this.center) > this.boundingRadius * this.boundingRadius) {
      return null;
    }

    _scratchVecA.subVectors(pos, this.start);
    const chordLenSq = this.length * this.length;
    if (chordLenSq < 1e-4) return null;

    let t = _scratchVecA.dot(this.chord) / chordLenSq;
    // Allow slight longitudinal lead-in / lead-out margin (0.05) for smooth lock-in
    if (t < -0.05 || t > 1.05) return null;

    t = Math.max(0.0, Math.min(1.0, t));
    this.getPointAt(t, _scratchWirePt);
    const dist = pos.distanceTo(_scratchWirePt);

    return {
      t,
      point: _scratchWirePt.clone(),
      distance: dist,
    };
  }
}

/**
 * GrindRailSystem
 * Manages alpine utility poles, high-tension electrical transmission wires,
 * ski-lift pylon towers, and park rails on which the snowboarder can grind.
 *
 * Features:
 * - Procedural placement adapting to the mountain terrain elevation and ski valley.
 * - 3D procedural meshes for poles, crossarms, ceramic insulators, and steel cables.
 * - Soft dynamic shadows cast across the snow.
 * - Precision proximity snapping: jumping near a cable locks the snowboard onto the wire.
 * - High-speed downhill rail slide physics with slope gravity acceleration.
 * - Brilliant friction sparks particle emitter spraying backward from the snowboard deck.
 * - Solid pole trunk physical obstacle collision.
 */
export class GrindRailSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {TerrainManager} terrainManager
   */
  constructor(scene, terrainManager) {
    this.scene = scene;
    this.terrainManager = terrainManager;

    this.group = new THREE.Group();
    this.group.name = 'GrindRailSystem';
    this.group.layers.set(0); // World camera layer

    this.wireSegments = [];
    this.poleColliders = [];
    this.lines = [];

    // Snap tolerance: distance in meters to lock onto a wire while airborne
    this.snapRadius = 1.45;

    // Sparks Particle System
    this._sparksPositions = new Float32Array(MAX_SPARKS * 3);
    this._sparksVelocities = new Float32Array(MAX_SPARKS * 3);
    this._sparksLifetimes = new Float32Array(MAX_SPARKS);
    this._sparksMaxLifetimes = new Float32Array(MAX_SPARKS);
    this.sparksMesh = null;

    this._initMaterials();
    this._buildAllLines();
    this._initSparksSystem();

    if (this.scene) {
      this.scene.add(this.group);
    }
  }

  _initMaterials() {
    // Treated alpine timber material for utility poles
    this.woodPoleMaterial = new THREE.MeshStandardMaterial({
      color: 0x422f22,
      roughness: 0.82,
      metalness: 0.08,
    });

    // Dark timber crossbeam
    this.woodBeamMaterial = new THREE.MeshStandardMaterial({
      color: 0x362419,
      roughness: 0.85,
      metalness: 0.05,
    });

    // White ceramic bell insulators
    this.insulatorMaterial = new THREE.MeshStandardMaterial({
      color: 0xdde4eb,
      roughness: 0.28,
      metalness: 0.15,
    });

    // Galvanized steel ski-lift tower pylon material
    this.steelPylonMaterial = new THREE.MeshStandardMaterial({
      color: 0x6e767d,
      roughness: 0.40,
      metalness: 0.75,
    });

    // Heavy tensioned steel wire cable
    this.cableMaterial = new THREE.MeshStandardMaterial({
      color: 0x181c20,
      roughness: 0.25,
      metalness: 0.90,
    });

    // High-visibility aerial warning marker spheres on high spans
    this.markerBallMaterial = new THREE.MeshStandardMaterial({
      color: 0xff6600,
      roughness: 0.35,
      metalness: 0.20,
    });

    // Concrete base foundation footing
    this.concreteMaterial = new THREE.MeshStandardMaterial({
      color: 0x8a8a86,
      roughness: 0.90,
      metalness: 0.05,
    });
  }

  /**
   * Generates all lines of poles and suspended grindable wires down the mountain.
   * @private
   */
  _buildAllLines() {
    // 1. Line 1: "Summit Express Line" (Wooden utility poles, double wire right by summit drop)
    this._createUtilityPoleLine({
      lineId: 'summit_line',
      startZ: -15,
      endZ: -620,
      startX: 14,
      endX: -140,
      poleSpacing: 46.0,
      poleHeight: 4.8,
      wireSag: 0.50,
      wireRadius: 0.040,
      hasDoubleWire: true,
      wireSpacing: 1.6,
      isParkLow: false,
    });

    // 2. Line 2: "Alpine Ski-Lift Line" (Heavy steel pylons, high-tension haul rope)
    this._createLiftPylonLine({
      lineId: 'lift_line',
      startZ: -35,
      endZ: -1150,
      startX: -22,
      endX: -260,
      pylonSpacing: 58.0,
      pylonHeight: 5.6,
      wireSag: 0.65,
      wireRadius: 0.052,
    });

    // 3. Line 3: "Terrain Park Low Rail Cable" (Low-slung 1.9m rail wire right down the central gully)
    this._createUtilityPoleLine({
      lineId: 'park_rail_line',
      startZ: -80,
      endZ: -520,
      startX: -4,
      endX: -45,
      poleSpacing: 38.0,
      poleHeight: 2.1,
      wireSag: 0.25,
      wireRadius: 0.045,
      hasDoubleWire: false,
      isParkLow: true,
    });
  }

  /**
   * Creates a sequence of wooden utility poles with crossarms and strung wire cables.
   * @private
   */
  _createUtilityPoleLine(cfg) {
    const totalDistZ = cfg.startZ - cfg.endZ;
    const numPoles = Math.max(3, Math.round(totalDistZ / cfg.poleSpacing));
    const poles = [];

    const poleGeo = new THREE.CylinderGeometry(0.14, 0.20, cfg.poleHeight, 8);
    const crossGeo = new THREE.BoxGeometry(cfg.hasDoubleWire ? (cfg.wireSpacing + 0.6) : 1.2, 0.14, 0.14);
    const insulatorGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.16, 6);
    const footingGeo = new THREE.CylinderGeometry(0.28, 0.32, 0.45, 8);

    for (let i = 0; i < numPoles; i++) {
      const alpha = i / (numPoles - 1);
      const pz = THREE.MathUtils.lerp(cfg.startZ, cfg.endZ, alpha);

      // Meander slightly with the natural alpine ski valley
      const valleyWarp = Math.sin(pz * 0.0035) * 18.0;
      const px = THREE.MathUtils.lerp(cfg.startX, cfg.endX, alpha) + valleyWarp;

      const groundY = this.terrainManager?.getHeightAt
        ? this.terrainManager.getHeightAt(px, pz)
        : 20.0;

      const poleTopY = groundY + cfg.poleHeight;

      // Construct pole visual assembly
      const poleMesh = new THREE.Mesh(poleGeo, this.woodPoleMaterial);
      poleMesh.position.set(px, groundY + cfg.poleHeight * 0.5, pz);
      poleMesh.castShadow = true;
      poleMesh.receiveShadow = true;
      this.group.add(poleMesh);

      const footMesh = new THREE.Mesh(footingGeo, this.concreteMaterial);
      footMesh.position.set(px, groundY + 0.2, pz);
      footMesh.receiveShadow = true;
      this.group.add(footMesh);

      // Register solid trunk obstacle collider (for player collision deflection)
      this.poleColliders.push({
        x: px,
        y: groundY,
        z: pz,
        radius: 0.25,
        height: cfg.poleHeight,
      });

      // Crossarm beam
      const crossMesh = new THREE.Mesh(crossGeo, this.woodBeamMaterial);
      crossMesh.position.set(px, poleTopY - 0.20, pz);
      crossMesh.castShadow = true;
      this.group.add(crossMesh);

      // Insulators & wire anchor points
      const wireAnchors = [];
      if (cfg.hasDoubleWire) {
        const halfSpan = cfg.wireSpacing * 0.5;
        // Left insulator & anchor
        const insLeft = new THREE.Mesh(insulatorGeo, this.insulatorMaterial);
        insLeft.position.set(px - halfSpan, poleTopY - 0.10, pz);
        this.group.add(insLeft);
        wireAnchors.push(new THREE.Vector3(px - halfSpan, poleTopY - 0.02, pz));

        // Right insulator & anchor
        const insRight = new THREE.Mesh(insulatorGeo, this.insulatorMaterial);
        insRight.position.set(px + halfSpan, poleTopY - 0.10, pz);
        this.group.add(insRight);
        wireAnchors.push(new THREE.Vector3(px + halfSpan, poleTopY - 0.02, pz));
      } else {
        const insCenter = new THREE.Mesh(insulatorGeo, this.insulatorMaterial);
        insCenter.position.set(px, poleTopY - 0.10, pz);
        this.group.add(insCenter);
        wireAnchors.push(new THREE.Vector3(px, poleTopY - 0.02, pz));
      }

      poles.push({ px, groundY, poleTopY, pz, wireAnchors });
    }

    // Connect suspended wire segments between consecutive poles
    const numWires = cfg.hasDoubleWire ? 2 : 1;
    for (let w = 0; w < numWires; w++) {
      let prevSeg = null;

      for (let i = 0; i < poles.length - 1; i++) {
        const startPt = poles[i].wireAnchors[w];
        const endPt = poles[i + 1].wireAnchors[w];

        const seg = new WireSegment(startPt, endPt, {
          sag: cfg.wireSag,
          radius: cfg.wireRadius,
          lineId: `${cfg.lineId}_${w}`,
          index: i,
        });

        if (prevSeg) {
          prevSeg.nextSegment = seg;
          seg.prevSegment = prevSeg;
        }
        prevSeg = seg;

        this.wireSegments.push(seg);
        this._buildWireMesh(seg);

        // Aerial orange marker ball on longer mid-mountain spans
        if (i % 3 === 1 && !cfg.isParkLow) {
          const ballGeo = new THREE.SphereGeometry(0.28, 8, 6);
          const ballMesh = new THREE.Mesh(ballGeo, this.markerBallMaterial);
          seg.getPointAt(0.5, ballMesh.position);
          ballMesh.castShadow = true;
          this.group.add(ballMesh);
        }
      }
    }
  }

  /**
   * Creates a line of heavy steel ski-lift pylons with cable roller assemblies.
   * @private
   */
  _createLiftPylonLine(cfg) {
    const totalDistZ = cfg.startZ - cfg.endZ;
    const numPylons = Math.max(3, Math.round(totalDistZ / cfg.pylonSpacing));
    const pylons = [];

    const pylonGeo = new THREE.CylinderGeometry(0.28, 0.42, cfg.pylonHeight, 10);
    const crossTGeo = new THREE.BoxGeometry(3.6, 0.28, 0.28);
    const rollerGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.35, 8);
    const footingGeo = new THREE.CylinderGeometry(0.60, 0.70, 0.60, 8);

    for (let i = 0; i < numPylons; i++) {
      const alpha = i / (numPylons - 1);
      const pz = THREE.MathUtils.lerp(cfg.startZ, cfg.endZ, alpha);
      const px = THREE.MathUtils.lerp(cfg.startX, cfg.endX, alpha) + Math.sin(pz * 0.0028) * 14.0;

      const groundY = this.terrainManager?.getHeightAt
        ? this.terrainManager.getHeightAt(px, pz)
        : 25.0;

      const topY = groundY + cfg.pylonHeight;

      // Steel pylon tube
      const pylonMesh = new THREE.Mesh(pylonGeo, this.steelPylonMaterial);
      pylonMesh.position.set(px, groundY + cfg.pylonHeight * 0.5, pz);
      pylonMesh.castShadow = true;
      pylonMesh.receiveShadow = true;
      this.group.add(pylonMesh);

      // Concrete footing
      const footMesh = new THREE.Mesh(footingGeo, this.concreteMaterial);
      footMesh.position.set(px, groundY + 0.3, pz);
      footMesh.receiveShadow = true;
      this.group.add(footMesh);

      // Register solid obstacle collider
      this.poleColliders.push({
        x: px,
        y: groundY,
        z: pz,
        radius: 0.45,
        height: cfg.pylonHeight,
        foliageType: 'none',
      });

      // Crossarm T-beam
      const crossMesh = new THREE.Mesh(crossTGeo, this.steelPylonMaterial);
      crossMesh.position.set(px, topY - 0.35, pz);
      crossMesh.castShadow = true;
      this.group.add(crossMesh);

      // Cable roller assemblies (downhill track on right at x + 1.4, return track on left at x - 1.4)
      const rollRight = new THREE.Mesh(rollerGeo, this.woodBeamMaterial);
      rollRight.rotation.z = Math.PI * 0.5;
      rollRight.position.set(px + 1.4, topY - 0.50, pz);
      this.group.add(rollRight);

      const rollLeft = new THREE.Mesh(rollerGeo, this.woodBeamMaterial);
      rollLeft.rotation.z = Math.PI * 0.5;
      rollLeft.position.set(px - 1.4, topY - 0.50, pz);
      this.group.add(rollLeft);

      // Downhill cable anchor point
      const downhillAnchor = new THREE.Vector3(px + 1.4, topY - 0.42, pz);
      pylons.push({ px, groundY, topY, pz, anchor: downhillAnchor });
    }

    // Connect heavy steel lift cable between pylons
    let prevSeg = null;
    for (let i = 0; i < pylons.length - 1; i++) {
      const startPt = pylons[i].anchor;
      const endPt = pylons[i + 1].anchor;

      const seg = new WireSegment(startPt, endPt, {
        sag: cfg.wireSag,
        radius: cfg.wireRadius,
        lineId: `${cfg.lineId}_downhill`,
        index: i,
      });

      if (prevSeg) {
        prevSeg.nextSegment = seg;
        seg.prevSegment = prevSeg;
      }
      prevSeg = seg;

      this.wireSegments.push(seg);
      this._buildWireMesh(seg);
    }
  }

  /**
   * Generates a 3D tubular mesh for a wire segment with smooth catenary sag.
   * @private
   */
  _buildWireMesh(seg) {
    const numSubdivisions = 10;
    const points = [];

    for (let s = 0; s <= numSubdivisions; s++) {
      const t = s / numSubdivisions;
      const pt = new THREE.Vector3();
      seg.getPointAt(t, pt);
      points.push(pt);
    }

    const curve = new THREE.CatmullRomCurve3(points);
    const tubeGeo = new THREE.TubeGeometry(curve, numSubdivisions, seg.radius, 5, false);
    const tubeMesh = new THREE.Mesh(tubeGeo, this.cableMaterial);
    tubeMesh.castShadow = true;
    tubeMesh.receiveShadow = false;
    this.group.add(tubeMesh);
  }

  /**
   * Initializes lightweight GPU-instanced friction sparks particle system.
   * @private
   */
  _initSparksSystem() {
    const sparkGeo = new THREE.SphereGeometry(0.045, 4, 3);
    const sparkMat = new THREE.MeshBasicMaterial({
      color: 0xffea77,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });

    this.sparksMesh = new THREE.InstancedMesh(sparkGeo, sparkMat, MAX_SPARKS);
    this.sparksMesh.layers.set(0);
    this.sparksMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sparksMesh.frustumCulled = false;

    for (let i = 0; i < MAX_SPARKS; i++) {
      _scratchDummy.position.set(0, -9999, 0);
      _scratchDummy.scale.set(0, 0, 0);
      _scratchDummy.updateMatrix();
      this.sparksMesh.setMatrixAt(i, _scratchDummy.matrix);
      this._sparksLifetimes[i] = 0;
    }
    this.sparksMesh.instanceMatrix.needsUpdate = true;

    if (this.scene) {
      this.scene.add(this.sparksMesh);
    }
  }

  /**
   * Checks if an airborne player is within proximity to lock onto any nearby wire segment.
   * @param {THREE.Vector3} playerPos - Contact position at the snowboard deck
   * @param {THREE.Vector3} playerVel - Current 3D velocity
   * @returns {{ segment: WireSegment, t: number, point: THREE.Vector3, distance: number } | null}
   */
  checkGrindLock(playerPos, playerVel) {
    let closestMatch = null;
    let minDistance = this.snapRadius;

    for (let i = 0; i < this.wireSegments.length; i++) {
      const seg = this.wireSegments[i];
      const hit = seg.getClosestPoint(playerPos);
      if (!hit) continue;

      if (hit.distance < minDistance) {
        // Ensure player is moving roughly along the wire direction or falling onto it
        seg.getTangentAt(hit.t, _scratchTangent);
        const forwardDot = playerVel.dot(_scratchTangent);

        // Allow snap if player is moving with the wire or dropping down onto it (downward Vy)
        if (forwardDot > -2.0 || playerVel.y < -0.5) {
          minDistance = hit.distance;
          closestMatch = {
            segment: seg,
            t: hit.t,
            point: hit.point,
            distance: hit.distance,
          };
        }
      }
    }

    return closestMatch;
  }

  /**
   * Spawns bright friction sparks at the snowboard-wire contact point.
   * @param {THREE.Vector3} contactPos
   * @param {THREE.Vector3} wireTangent
   * @param {number} grindSpeed
   */
  spawnGrindSparks(contactPos, wireTangent, grindSpeed) {
    const spawnCount = grindSpeed > 24.0 ? 3 : 2;

    for (let s = 0; s < spawnCount; s++) {
      // Find inactive particle slot
      for (let i = 0; i < MAX_SPARKS; i++) {
        if (this._sparksLifetimes[i] <= 0) {
          const idx = i * 3;
          this._sparksPositions[idx] = contactPos.x + (Math.random() - 0.5) * 0.12;
          this._sparksPositions[idx + 1] = contactPos.y + (Math.random() - 0.5) * 0.08;
          this._sparksPositions[idx + 2] = contactPos.z + (Math.random() - 0.5) * 0.12;

          // Spray backward along the wire with explosive variance
          const backSpeed = grindSpeed * (0.35 + Math.random() * 0.30);
          this._sparksVelocities[idx] = -wireTangent.x * backSpeed + (Math.random() - 0.5) * 3.5;
          this._sparksVelocities[idx + 1] = -wireTangent.y * backSpeed + 1.2 + Math.random() * 2.2;
          this._sparksVelocities[idx + 2] = -wireTangent.z * backSpeed + (Math.random() - 0.5) * 3.5;

          const life = 0.22 + Math.random() * 0.20;
          this._sparksLifetimes[i] = life;
          this._sparksMaxLifetimes[i] = life;
          break;
        }
      }
    }
  }

  /**
   * Updates spark particle physics and lifetimes.
   * @param {number} dt
   * @param {PlayerController} [player=null]
   */
  update(dt, player = null) {
    if (!this.sparksMesh) return;

    // If player is actively grinding, continuously generate sparks
    if (player && player.isGrinding && player.currentWireSegment) {
      player.currentWireSegment.getTangentAt(player.grindParam, _scratchTangent);
      this.spawnGrindSparks(player.position, _scratchTangent, player.grindSpeed || 25.0);
    }

    let needsUpdate = false;

    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this._sparksLifetimes[i] > 0) {
        this._sparksLifetimes[i] -= dt;

        const idx = i * 3;
        this._sparksPositions[idx] += this._sparksVelocities[idx] * dt;
        this._sparksPositions[idx + 1] += this._sparksVelocities[idx + 1] * dt;
        this._sparksPositions[idx + 2] += this._sparksVelocities[idx + 2] * dt;

        // Gravity pull on spark embers
        this._sparksVelocities[idx + 1] -= 14.0 * dt;

        const lifeRatio = Math.max(0, this._sparksLifetimes[i] / this._sparksMaxLifetimes[i]);
        const scale = lifeRatio * 1.6;

        _scratchDummy.position.set(
          this._sparksPositions[idx],
          this._sparksPositions[idx + 1],
          this._sparksPositions[idx + 2]
        );
        _scratchDummy.scale.set(scale, scale, scale);
        _scratchDummy.updateMatrix();
        this.sparksMesh.setMatrixAt(i, _scratchDummy.matrix);
        needsUpdate = true;
      } else {
        _scratchDummy.position.set(0, -9999, 0);
        _scratchDummy.scale.set(0, 0, 0);
        _scratchDummy.updateMatrix();
        this.sparksMesh.setMatrixAt(i, _scratchDummy.matrix);
      }
    }

    if (needsUpdate) {
      this.sparksMesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Retrieves solid pole obstacle colliders near position for player deflection.
   * @param {number} px
   * @param {number} pz
   * @param {number} range
   * @param {Array} outList
   * @returns {Array}
   */
  getNearbyPoleColliders(px, pz, range, outList = []) {
    outList.length = 0;
    const rSq = range * range;
    for (let i = 0; i < this.poleColliders.length; i++) {
      const p = this.poleColliders[i];
      const dx = p.x - px;
      const dz = p.z - pz;
      if (dx * dx + dz * dz < rSq) {
        outList.push(p);
      }
    }
    return outList;
  }

  dispose() {
    if (this.scene) {
      if (this.group) this.scene.remove(this.group);
      if (this.sparksMesh) this.scene.remove(this.sparksMesh);
    }
  }
}
