import * as THREE from 'three';

/**
 * TerrainChunk
 * Generates an individual terrain mesh with seamless border normals and zero color overhead.
 * Also manages procedural tree instances (InstancedMesh or Group) for this chunk.
 */
export class TerrainChunk {
  /**
   * @param {number} chunkX
   * @param {number} chunkZ
   * @param {number} size
   * @param {number} segments
   * @param {TerrainHeightmap} heightmap
   * @param {TerrainMaterialFactory} materialFactory
   * @param {TreeGenerator|null} treeGenerator
   * @param {boolean} [isNear=true]
   * @param {number} [treeShadowRange=55]
   */
  constructor(chunkX, chunkZ, size, segments, heightmap, materialFactory, treeGenerator = null, isNear = true, treeShadowRange = 55) {
    this.chunkX = chunkX;
    this.chunkZ = chunkZ;
    this.size = size;
    this.segments = segments;
    this.heightmap = heightmap;
    this.materialFactory = materialFactory;
    this.treeGenerator = treeGenerator;
    this.isNear = isNear;
    this.treeShadowRange = treeShadowRange;

    this.mesh = null;
    this.treeMesh3D = null;
    this.treeMeshImpostor = null;
    this.activeTreeLOD = null; // 0 = 3D (<= 55m), 1 = 4-poly cross-quad impostor (> 65m)
    this.treeColliders = null;
    this.isDisposed = false;

    this.worldCenterX = (chunkX + 0.5) * size;
    this.worldCenterZ = (chunkZ + 0.5) * size;

    // World-space bounding boxes for hierarchical view frustum and shadow culling
    this.terrainBounds = null;
    this.treeBounds = null;
    this.shadowCasterBounds = null;

    this._build();
  }

  /**
   * Compatibility getter for legacy callers referencing chunk.treeMesh
   */
  get treeMesh() {
    return this.activeTreeLOD === 0 ? this.treeMesh3D : this.treeMeshImpostor;
  }

  /**
   * Builds the procedural plane geometry with heights, lake factors, and analytical border normals.
   * @private
   */
  _buildGeometry() {
    const geometry = new THREE.PlaneGeometry(
      this.size,
      this.size,
      this.segments,
      this.segments
    );
    // Align with XZ plane (Y is up)
    geometry.rotateX(-Math.PI / 2);

    const positionAttr = geometry.attributes.position;
    const vertexCount = positionAttr.count;
    const normalArray = new Float32Array(vertexCount * 3);

    let minY = Infinity;
    let maxY = -Infinity;

    const stride = this.segments + 1;
    const step = this.size / this.segments;

    const lakeDataArray = new Float32Array(vertexCount * 2);

    // Pass 1: Compute heights, lake factors and elevation bounds
    for (let i = 0; i < vertexCount; i++) {
      const localX = positionAttr.getX(i);
      const localZ = positionAttr.getZ(i);

      const worldX = this.worldCenterX + localX;
      const worldZ = this.worldCenterZ + localZ;

      const worldY = this.heightmap.getHeight(worldX, worldZ);
      positionAttr.setY(i, worldY);

      if (this.heightmap.getLakeData) {
        const lake = this.heightmap.getLakeData(worldX, worldZ);
        lakeDataArray[i * 2 + 0] = lake.factor;
        lakeDataArray[i * 2 + 1] = lake.depth;
      }

      if (worldY < minY) minY = worldY;
      if (worldY > maxY) maxY = worldY;
    }

    // Pass 2: Ultra-fast normals
    // - Internal vertices (~90% of chunk): Fast central differences directly from grid (0 noise evaluations!)
    // - Border vertices (~10%): Analytical finite difference matching adjacent chunks to guarantee 0 lighting seams
    for (let iz = 0; iz <= this.segments; iz++) {
      const isBorderZ = (iz === 0 || iz === this.segments);
      for (let ix = 0; ix <= this.segments; ix++) {
        const i = iz * stride + ix;
        const isBorder = isBorderZ || (ix === 0 || ix === this.segments);

        if (isBorder) {
          const worldX = this.worldCenterX + positionAttr.getX(i);
          const worldZ = this.worldCenterZ + positionAttr.getZ(i);
          const norm = this.heightmap.getNormal(worldX, worldZ, step);
          normalArray[i * 3 + 0] = norm.x;
          normalArray[i * 3 + 1] = norm.y;
          normalArray[i * 3 + 2] = norm.z;
        } else {
          const hL = positionAttr.getY(i - 1);
          const hR = positionAttr.getY(i + 1);
          const hD = positionAttr.getY(i - stride);
          const hU = positionAttr.getY(i + stride);

          const dhdx = (hR - hL) / (2.0 * step);
          const dhdz = (hU - hD) / (2.0 * step);
          const nx = -dhdx;
          const ny = 1.0;
          const nz = -dhdz;
          const invLen = 1.0 / Math.sqrt(nx * nx + ny * ny + nz * nz);

          normalArray[i * 3 + 0] = nx * invLen;
          normalArray[i * 3 + 1] = ny * invLen;
          normalArray[i * 3 + 2] = nz * invLen;
        }
      }
    }

    positionAttr.needsUpdate = true;
    geometry.setAttribute('normal', new THREE.BufferAttribute(normalArray, 3));
    geometry.setAttribute('aLakeData', new THREE.BufferAttribute(lakeDataArray, 2));

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return { geometry, minY, maxY };
  }

  _build() {
    const { geometry, minY, maxY } = this._buildGeometry();

    const half = this.size * 0.5;
    this.terrainBounds = new THREE.Box3(
      new THREE.Vector3(this.worldCenterX - half, minY - 1, this.worldCenterZ - half),
      new THREE.Vector3(this.worldCenterX + half, maxY + 1, this.worldCenterZ + half)
    );

    // Tree envelope: base at minY - 0.5, canopy tops reach maxY + 28m.
    // 6m horizontal margin covers branch spreads across chunk boundaries.
    this.treeBounds = new THREE.Box3(
      new THREE.Vector3(this.worldCenterX - half - 6, minY - 1, this.worldCenterZ - half - 6),
      new THREE.Vector3(this.worldCenterX + half + 6, maxY + 28, this.worldCenterZ + half + 6)
    );

    // Sun light direction is (-130, -190, -90). Trees up-sun (+X, +Z) cast shadows down-sun (-X, -Z).
    // Expanding up-sun by 25m captures any off-screen tree whose shadow falls into camera view.
    this.shadowCasterBounds = new THREE.Box3(
      new THREE.Vector3(this.worldCenterX - half - 10, minY - 1, this.worldCenterZ - half - 10),
      new THREE.Vector3(this.worldCenterX + half + 26, maxY + 28, this.worldCenterZ + half + 26)
    );

    // All chunks retain the rich original TerrainMaterial
    const mat = this.materialFactory.getMaterial();

    this.mesh = new THREE.Mesh(geometry, mat);
    this.mesh.position.set(this.worldCenterX, 0, this.worldCenterZ);
    this.mesh.castShadow = false; // Terrain only receives shadows, never casts onto itself
    this.mesh.receiveShadow = true;
  }

  /**
   * Upgrades resolution seamlessly when chunk enters player proximity.
   * All chunks retain the original TerrainMaterial.
   * @param {boolean} isNear
   * @param {number} [targetSegments=28]
   */
  setNearState(isNear, targetSegments = 28) {
    if (this.isDisposed) return;
    this.isNear = isNear;

    // Upgrade resolution seamlessly if chunk became near and has low segment count
    if (isNear && this.segments < targetSegments && this.mesh) {
      const oldGeom = this.mesh.geometry;
      this.segments = targetSegments;
      const { geometry } = this._buildGeometry();
      this.mesh.geometry = geometry;
      if (oldGeom) oldGeom.dispose();
    }
  }

  /**
   * Rebuilds the chunk's terrain mesh and bounding boxes in-place.
   * Useful when terrain parameters or heightmap configuration change dynamically.
   */
  rebuildMesh() {
    if (this.isDisposed || !this.mesh) return;
    const oldGeom = this.mesh.geometry;
    const { geometry, minY, maxY } = this._buildGeometry();
    this.mesh.geometry = geometry;
    if (oldGeom) oldGeom.dispose();

    const half = this.size * 0.5;
    if (this.terrainBounds) {
      this.terrainBounds.set(
        new THREE.Vector3(this.worldCenterX - half, minY - 1, this.worldCenterZ - half),
        new THREE.Vector3(this.worldCenterX + half, maxY + 1, this.worldCenterZ + half)
      );
    }
    if (this.treeBounds) {
      this.treeBounds.set(
        new THREE.Vector3(this.worldCenterX - half - 6, minY - 1, this.worldCenterZ - half - 6),
        new THREE.Vector3(this.worldCenterX + half + 6, maxY + 28, this.worldCenterZ + half + 6)
      );
    }
    if (this.shadowCasterBounds) {
      this.shadowCasterBounds.set(
        new THREE.Vector3(this.worldCenterX - half - 10, minY - 1, this.worldCenterZ - half - 10),
        new THREE.Vector3(this.worldCenterX + half + 26, maxY + 28, this.worldCenterZ + half + 26)
      );
    }
  }

  /**
   * Generates and adds tree instances (both 3D and 2D cross-quad impostors) for this chunk.
   * @param {THREE.Scene} scene
   * @param {boolean} [canCastShadow=true]
   * @param {number} [initialDist=0]
   * @param {THREE.Frustum|null} [cameraFrustum=null]
   */
  buildTrees(scene, canCastShadow = true, initialDist = 0, cameraFrustum = null) {
    if (this.isDisposed || this.treeMesh3D || this.treeMeshImpostor || !this.treeGenerator || !this.treeGenerator.isLoaded) {
      return;
    }

    const { mesh3D, meshImpostor, treeColliders } = this.treeGenerator.generateChunkTrees(this.chunkX, this.chunkZ);
    if (!this.isDisposed) {
      this.treeMesh3D = mesh3D;
      this.treeMeshImpostor = meshImpostor;
      this.treeColliders = treeColliders || [];

      if (scene) {
        if (this.treeMesh3D) scene.add(this.treeMesh3D);
        if (this.treeMeshImpostor) scene.add(this.treeMeshImpostor);
      }

      this.updateTreeLOD(initialDist, cameraFrustum, this.treeShadowRange);
    }
  }

  /**
   * Updates chunk visibility, tree LOD, and shadow casting dynamically:
   * 1. View Frustum Culling:
   *    - Terrain mesh is visible if its bounding box intersects camera view frustum.
   * 2. Proximity-Gated Shadow Casting:
   *    - Only trees around the player within shadowRange (default 55m) cast shadows.
   *    - Distant trees and impostors do not cast shadows, optimizing GPU fillrate and draw calls.
   * 3. Two-Tier Tree LOD:
   *    - dist <= 55m: LOD 0 (detailed 3D conifer models). Casts shadows when within shadowRange.
   *    - dist > 65m: LOD 1 (ultra-lightweight billboard impostors). Never casts shadows.
   *    - 55m to 65m: hysteresis deadband prevents boundary thrashing.
   * @param {number} dist - Distance from player to nearest chunk boundary
   * @param {THREE.Frustum|null} [cameraFrustum=null]
   * @param {number} [shadowRange=55] - Maximum distance within which trees cast shadows
   */
  updateTreeLOD(dist, cameraFrustum = null, shadowRange = this.treeShadowRange || 55) {
    if (this.isDisposed) return;

    // --- 1. Terrain Mesh Visibility (Frustum Culling) ---
    if (this.mesh) {
      const terrainInView = cameraFrustum ? (this.terrainBounds ? cameraFrustum.intersectsBox(this.terrainBounds) : true) : true;
      if (this.mesh.visible !== terrainInView) {
        this.mesh.visible = terrainInView;
      }
    }

    if (!this.treeMesh3D && !this.treeMeshImpostor) return;

    // --- 2. Camera View & Shadow Range Determination ---
    const inCameraView = cameraFrustum ? (this.treeBounds ? cameraFrustum.intersectsBox(this.treeBounds) : true) : true;
    const isWithinShadowRange = (dist <= shadowRange);

    // --- 3. LOD Selection with Hysteresis ---
    let targetLOD = this.activeTreeLOD;
    if (this.activeTreeLOD === null) {
      targetLOD = dist <= 55 ? 0 : 1;
    } else if (this.activeTreeLOD === 0 && dist > 65) {
      targetLOD = 1;
    } else if (this.activeTreeLOD === 1 && dist <= 52) {
      targetLOD = 0;
    }

    this.activeTreeLOD = targetLOD;

    // --- 4. Visibility & Shadow Management ---
    if (targetLOD === 0) {
      // Near LOD: High-detail 3D Tree Models
      // If within shadow range, treeMesh3D must remain visible in scene graph so Three.js renders its
      // shadow into the directional light shadow map (even if the tree is behind the skier camera,
      // its shadow will fall forward into view). Three.js's native frustum culling will handle camera culling.
      const want3DVisible = isWithinShadowRange || inCameraView;
      if (this.treeMesh3D && this.treeMesh3D.visible !== want3DVisible) {
        this.treeMesh3D.visible = want3DVisible;
      }
      this._setCastShadowOnObj(this.treeMesh3D, isWithinShadowRange);

      // Hide impostors in near LOD
      if (this.treeMeshImpostor && this.treeMeshImpostor.visible) {
        this.treeMeshImpostor.visible = false;
      }
      this._setCastShadowOnObj(this.treeMeshImpostor, false);
    } else {
      // Distant LOD: Lightweight Billboard Impostors
      if (this.treeMesh3D && this.treeMesh3D.visible) {
        this.treeMesh3D.visible = false;
      }
      this._setCastShadowOnObj(this.treeMesh3D, false);

      // Impostors are only rendered if directly in camera view
      if (this.treeMeshImpostor && this.treeMeshImpostor.visible !== inCameraView) {
        this.treeMeshImpostor.visible = inCameraView;
      }
      // Impostors NEVER cast shadows (saves GPU fillrate and prevents billboard shadow artifacts)
      this._setCastShadowOnObj(this.treeMeshImpostor, false);
    }
  }

  /**
   * Helper to set castShadow recursively on instanced meshes or groups.
   * Compares state before assignment to prevent dirtying Three.js render cache.
   * @private
   */
  _setCastShadowOnObj(obj, enabled) {
    if (!obj) return;
    if (obj.isInstancedMesh) {
      if (obj.castShadow !== enabled) obj.castShadow = enabled;
    } else if (obj.isGroup) {
      const children = obj.children;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.isInstancedMesh && child.castShadow !== enabled) {
          child.castShadow = enabled;
        }
      }
    }
  }

  /**
   * Compatibility method to set shadow casting state.
   * @param {boolean} enabled
   */
  setCastShadow(enabled) {
    this._setCastShadowOnObj(this.treeMesh3D, enabled && this.activeTreeLOD === 0);
    this._setCastShadowOnObj(this.treeMeshImpostor, false);
  }

  /**
   * Replaces existing trees with newly generated trees (e.g. when tree model is switched).
   * @param {THREE.Scene} scene
   */
  rebuildTrees(scene) {
    if (this.treeMesh3D) {
      this._disposeTreeMesh(this.treeMesh3D, scene);
      this.treeMesh3D = null;
    }
    if (this.treeMeshImpostor) {
      this._disposeTreeMesh(this.treeMeshImpostor, scene);
      this.treeMeshImpostor = null;
    }
    this.treeColliders = null;
    this.activeTreeLOD = null;
    this.buildTrees(scene);
  }

  /**
   * Safely disposes tree mesh (InstancedMesh or Group) without memory leaks.
   * @private
   */
  _disposeTreeMesh(treeObj, scene) {
    if (!treeObj) return;

    if (scene) {
      scene.remove(treeObj);
    }

    if (treeObj.isInstancedMesh) {
      treeObj.dispose();
    } else if (treeObj.isGroup) {
      for (const child of treeObj.children) {
        if (child.isInstancedMesh) {
          child.dispose();
        }
      }
      treeObj.clear();
    }
  }

  dispose(scene) {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.treeColliders = null;

    if (this.mesh) {
      if (scene) {
        scene.remove(this.mesh);
      }
      if (this.mesh.geometry) {
        this.mesh.geometry.dispose();
      }
      this.mesh = null;
    }

    if (this.treeMesh3D) {
      this._disposeTreeMesh(this.treeMesh3D, scene);
      this.treeMesh3D = null;
    }
    if (this.treeMeshImpostor) {
      this._disposeTreeMesh(this.treeMeshImpostor, scene);
      this.treeMeshImpostor = null;
    }
  }
}
