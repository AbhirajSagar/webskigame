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
    this.activeTreeLOD = null; // 0 = 3D (<= 180m), 1 = cross-quad billboard impostor (> 200m)
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
    return this.activeTreeLOD === 0 ? this.treeMesh3D : (this.treeMeshImpostor || this.treeMesh3D);
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
    const posArr = positionAttr.array;
    const vertexCount = positionAttr.count;
    const normalArray = new Float32Array(vertexCount * 3);

    let minY = Infinity;
    let maxY = -Infinity;

    const stride = this.segments + 1;
    const step = this.size / this.segments;

    const lakeDataArray = new Float32Array(vertexCount * 2);
    const hasLakeData = Boolean(this.heightmap.getLakeData);

    // Pass 1: Compute heights, lake factors and elevation bounds
    for (let i = 0; i < vertexCount; i++) {
      const i3 = i * 3;
      const worldX = this.worldCenterX + posArr[i3];
      const worldZ = this.worldCenterZ + posArr[i3 + 2];

      const worldY = this.heightmap.getHeight(worldX, worldZ);
      posArr[i3 + 1] = worldY;

      if (hasLakeData) {
        const lake = this.heightmap.getLakeData(worldX, worldZ);
        lakeDataArray[i * 2] = lake.factor;
        lakeDataArray[i * 2 + 1] = lake.depth;
      }

      if (worldY < minY) minY = worldY;
      if (worldY > maxY) maxY = worldY;
    }

    // Pass 2: Ultra-fast normals using direct TypedArray indexing
    for (let iz = 0; iz <= this.segments; iz++) {
      for (let ix = 0; ix <= this.segments; ix++) {
        const i = iz * stride + ix;
        const i3 = i * 3;

        if (lakeDataArray[i * 2] > 0.65) {
          normalArray[i3] = 0.0;
          normalArray[i3 + 1] = 1.0;
          normalArray[i3 + 2] = 0.0;
          continue;
        }

        const worldX = this.worldCenterX + posArr[i3];
        const worldZ = this.worldCenterZ + posArr[i3 + 2];

        const hL = (ix > 0) ? posArr[(i - 1) * 3 + 1] : this.heightmap.getHeight(worldX - step, worldZ);
        const hR = (ix < this.segments) ? posArr[(i + 1) * 3 + 1] : this.heightmap.getHeight(worldX + step, worldZ);
        const hD = (iz > 0) ? posArr[(i - stride) * 3 + 1] : this.heightmap.getHeight(worldX, worldZ - step);
        const hU = (iz < this.segments) ? posArr[(i + stride) * 3 + 1] : this.heightmap.getHeight(worldX, worldZ + step);

        const dhdx = (hR - hL) / (2.0 * step);
        const dhdz = (hU - hD) / (2.0 * step);
        const nx = -dhdx;
        const ny = 1.0;
        const nz = -dhdz;
        const invLen = 1.0 / Math.sqrt(nx * nx + ny * ny + nz * nz);

        normalArray[i3] = nx * invLen;
        normalArray[i3 + 1] = ny * invLen;
        normalArray[i3 + 2] = nz * invLen;
      }
    }

    // Pass 3: Perimeter Skirt Generation (Completely eliminates far LOD cracks & T-junction seams)
    const skirtDepth = 35.0;
    const M = this.segments * 4;
    const perimeterIndices = new Uint16Array(M);
    let pPtr = 0;

    // 1. North edge (iz = 0): ix from 0 to segments - 1
    for (let ix = 0; ix < this.segments; ix++) {
      perimeterIndices[pPtr++] = ix;
    }
    // 2. East edge (ix = segments): iz from 0 to segments - 1
    for (let iz = 0; iz < this.segments; iz++) {
      perimeterIndices[pPtr++] = iz * stride + this.segments;
    }
    // 3. South edge (iz = segments): ix from segments down to 1
    for (let ix = this.segments; ix > 0; ix--) {
      perimeterIndices[pPtr++] = this.segments * stride + ix;
    }
    // 4. West edge (ix = 0): iz from segments down to 1
    for (let iz = this.segments; iz > 0; iz--) {
      perimeterIndices[pPtr++] = iz * stride;
    }

    const totalVertexCount = vertexCount + M;

    const finalPosArray = new Float32Array(totalVertexCount * 3);
    const finalNormArray = new Float32Array(totalVertexCount * 3);
    const finalUvArray = new Float32Array(totalVertexCount * 2);
    const finalLakeArray = new Float32Array(totalVertexCount * 2);

    const uvAttr = geometry.attributes.uv;

    // Copy surface vertices
    finalPosArray.set(positionAttr.array);
    finalNormArray.set(normalArray);
    finalUvArray.set(uvAttr.array);
    finalLakeArray.set(lakeDataArray);

    // Create skirt vertices directly below perimeter surface vertices
    for (let k = 0; k < M; k++) {
      const surfIdx = perimeterIndices[k];
      const skirtIdx = vertexCount + k;

      finalPosArray[skirtIdx * 3 + 0] = finalPosArray[surfIdx * 3 + 0];
      finalPosArray[skirtIdx * 3 + 1] = finalPosArray[surfIdx * 3 + 1] - skirtDepth;
      finalPosArray[skirtIdx * 3 + 2] = finalPosArray[surfIdx * 3 + 2];

      finalNormArray[skirtIdx * 3 + 0] = finalNormArray[surfIdx * 3 + 0];
      finalNormArray[skirtIdx * 3 + 1] = finalNormArray[surfIdx * 3 + 1];
      finalNormArray[skirtIdx * 3 + 2] = finalNormArray[surfIdx * 3 + 2];

      finalUvArray[skirtIdx * 2 + 0] = finalUvArray[surfIdx * 2 + 0];
      finalUvArray[skirtIdx * 2 + 1] = finalUvArray[surfIdx * 2 + 1];

      finalLakeArray[skirtIdx * 2 + 0] = finalLakeArray[surfIdx * 2 + 0];
      finalLakeArray[skirtIdx * 2 + 1] = finalLakeArray[surfIdx * 2 + 1];
    }

    // Build unified index buffer (surface triangles + skirt quad triangles)
    const surfaceIndices = geometry.index.array;
    const totalIndexCount = surfaceIndices.length + M * 6;
    const finalIndexArray = (totalVertexCount < 65535)
      ? new Uint16Array(totalIndexCount)
      : new Uint32Array(totalIndexCount);

    finalIndexArray.set(surfaceIndices);

    let idxPtr = surfaceIndices.length;
    for (let k = 0; k < M; k++) {
      const idxA = perimeterIndices[k];
      const idxB = perimeterIndices[(k + 1) % M];
      const idxASkirt = vertexCount + k;
      const idxBSkirt = vertexCount + ((k + 1) % M);

      // Triangle 1: (A, B, A_skirt) - outward-facing
      finalIndexArray[idxPtr++] = idxA;
      finalIndexArray[idxPtr++] = idxB;
      finalIndexArray[idxPtr++] = idxASkirt;

      // Triangle 2: (B, B_skirt, A_skirt) - outward-facing
      finalIndexArray[idxPtr++] = idxB;
      finalIndexArray[idxPtr++] = idxBSkirt;
      finalIndexArray[idxPtr++] = idxASkirt;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(finalPosArray, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(finalNormArray, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(finalUvArray, 2));
    geometry.setAttribute('aLakeData', new THREE.BufferAttribute(finalLakeArray, 2));
    geometry.setIndex(new THREE.BufferAttribute(finalIndexArray, 1));

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return { geometry, minY: minY - skirtDepth, maxY };
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
   * Updates terrain resolution seamlessly when distance tier changes.
   * Disposes old geometry and generates new LOD plane geometry in-place.
   * @param {number} targetSegments
   */
  setTargetSegments(targetSegments) {
    if (this.isDisposed) return;
    if (this.segments === targetSegments) return;

    this.segments = targetSegments;
    this.isNear = (targetSegments >= 16);

    if (this.mesh) {
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
  }

  /**
   * Backwards-compatible resolution update.
   * @param {boolean} isNear
   * @param {number} [nearSegments=26]
   * @param {number} [distantSegments=8]
   */
  setNearState(isNear, nearSegments = 20, distantSegments = 8) {
    this.setTargetSegments(isNear ? nearSegments : distantSegments);
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
   * 1. View Frustum Culling on terrain, tree bounds, and shadow caster bounds.
   * 2. Proximity-Gated Shadow Casting within shadowRange.
   * 3. Tree LOD System with hysteresis:
   *    - dist <= 115m: Full 3D conifer models
   *    - dist > 130m: Lightweight 4-poly billboard impostors
   * @param {number} dist - Distance (or squared distance when isSquared=true) from player to chunk
   * @param {THREE.Frustum|null} [cameraFrustum=null]
   * @param {number} [shadowRange=48] - Maximum distance within which trees cast shadows
   * @param {boolean} [isSquared=false] - Whether dist is squared distance
   */
  updateTreeLOD(dist, cameraFrustum = null, shadowRange = this.treeShadowRange || 48, isSquared = false) {
    if (this.isDisposed) return;

    // --- 1. Terrain Mesh Visibility (Frustum Culling) ---
    if (this.mesh) {
      const terrainInView = cameraFrustum ? (this.terrainBounds ? cameraFrustum.intersectsBox(this.terrainBounds) : true) : true;
      if (this.mesh.visible !== terrainInView) {
        this.mesh.visible = terrainInView;
      }
    }

    if (!this.treeMesh3D && !this.treeMeshImpostor) return;

    const distSq = isSquared ? dist : dist * dist;
    const shadowRangeSq = shadowRange * shadowRange;

    // --- 2. Camera View & Shadow Range Determination ---
    const inCameraView = cameraFrustum ? (this.treeBounds ? cameraFrustum.intersectsBox(this.treeBounds) : true) : true;
    const isWithinShadowRange = distSq <= shadowRangeSq;
    const shadowInView = isWithinShadowRange && (
      cameraFrustum ? (this.shadowCasterBounds ? cameraFrustum.intersectsBox(this.shadowCasterBounds) : true) : true
    );

    // --- 3. Tree LOD Selection with Hysteresis (Impostor beyond 200m) ---
    let targetLOD = this.activeTreeLOD;
    if (this.activeTreeLOD === null) {
      targetLOD = distSq <= 180 * 180 ? 0 : 1;
    } else if (this.activeTreeLOD === 0 && distSq > 200 * 200) {
      targetLOD = 1;
    } else if (this.activeTreeLOD === 1 && distSq <= 180 * 180) {
      targetLOD = 0;
    }

    if (targetLOD === 1 && !this.treeMeshImpostor) {
      targetLOD = 0;
    }

    this.activeTreeLOD = targetLOD;

    // --- 4. Visibility & Shadow Management ---
    if (targetLOD === 0) {
      const want3DVisible = shadowInView || inCameraView;
      if (this.treeMesh3D && this.treeMesh3D.visible !== want3DVisible) {
        this.treeMesh3D.visible = want3DVisible;
      }
      this._setCastShadowOnObj(this.treeMesh3D, shadowInView);

      if (this.treeMeshImpostor && this.treeMeshImpostor.visible) {
        this.treeMeshImpostor.visible = false;
      }
      this._setCastShadowOnObj(this.treeMeshImpostor, false);
    } else {
      if (this.treeMesh3D && this.treeMesh3D.visible) {
        this.treeMesh3D.visible = false;
      }
      this._setCastShadowOnObj(this.treeMesh3D, false);

      if (this.treeMeshImpostor && this.treeMeshImpostor.visible !== inCameraView) {
        this.treeMeshImpostor.visible = inCameraView;
      }
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
    this._setCastShadowOnObj(this.treeMesh3D, enabled);
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
