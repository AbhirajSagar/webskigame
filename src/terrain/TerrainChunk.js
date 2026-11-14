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
   */
  constructor(chunkX, chunkZ, size, segments, heightmap, materialFactory, treeGenerator = null) {
    this.chunkX = chunkX;
    this.chunkZ = chunkZ;
    this.size = size;
    this.segments = segments;
    this.heightmap = heightmap;
    this.materialFactory = materialFactory;
    this.treeGenerator = treeGenerator;

    this.mesh = null;
    this.treeMesh3D = null;
    this.treeMeshImpostor = null;
    this.activeTreeLOD = null; // 0 = 3D (<= 65m), 1 = 4-poly cross-quad impostor (> 65m)
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

  _build() {
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

    this.mesh = new THREE.Mesh(geometry, this.materialFactory.getMaterial());
    this.mesh.position.set(this.worldCenterX, 0, this.worldCenterZ);
    this.mesh.castShadow = false; // Terrain only receives shadows, never casts onto itself
    this.mesh.receiveShadow = true;
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

      this.updateTreeLOD(initialDist, cameraFrustum);
    }
  }

  /**
   * Updates chunk visibility, tree LOD, and shadow casting dynamically based on:
   * 1. View Frustum Culling: If neither trees nor their cast shadows intersect the camera view frustum,
   *    the chunk's trees (both 3D and impostors) and terrain mesh are completely hidden (visible = false).
   *    Three.js immediately skips traversing and drawing them in both main and shadow passes.
   * 2. Shadow-Caster Offset: Trees outside the view frustum that cast shadows into the camera view are
   *    rendered via ultra-lightweight 4-poly impostor depth passes to preserve shadow continuity at minimal cost.
   * 3. Distance-Gated LOD:
   *    - dist <= 65m: LOD 0 (high-poly 3D models with detailed branch shadow casting)
   *    - dist > 80m: LOD 1 (4-triangle cross-quad billboard impostors with baked scene lighting)
   *    - 65m to 80m: hysteresis deadband prevents boundary thrashing
   * 4. Shadow Distance:
   *    - dist <= 95m: casts shadows
   *    - dist > 95m: shadow casting culled
   * @param {number} dist
   * @param {THREE.Frustum|null} [cameraFrustum=null]
   */
  updateTreeLOD(dist, cameraFrustum = null) {
    if (this.isDisposed) return;

    // --- 1. Frustum Culling ---
    let inCameraView = true;
    let inShadowView = true;

    if (cameraFrustum) {
      inCameraView = this.treeBounds ? cameraFrustum.intersectsBox(this.treeBounds) : true;
      inShadowView = inCameraView || (this.shadowCasterBounds ? cameraFrustum.intersectsBox(this.shadowCasterBounds) : false);

      // Terrain mesh frustum culling: terrain only receives shadows and does not cast them,
      // so it only needs to be rendered if directly in camera view
      if (this.mesh) {
        const terrainInView = this.terrainBounds ? cameraFrustum.intersectsBox(this.terrainBounds) : inCameraView;
        if (this.mesh.visible !== terrainInView) {
          this.mesh.visible = terrainInView;
        }
      }

      // If entirely outside both camera view and shadow caster volume, cull all trees completely
      if (!inShadowView) {
        if (this.treeMesh3D && this.treeMesh3D.visible) this.treeMesh3D.visible = false;
        if (this.treeMeshImpostor && this.treeMeshImpostor.visible) this.treeMeshImpostor.visible = false;
        this._setCastShadowOnObj(this.treeMesh3D, false);
        this._setCastShadowOnObj(this.treeMeshImpostor, false);
        return;
      }
    } else {
      if (this.mesh && !this.mesh.visible) {
        this.mesh.visible = true;
      }
    }

    if (!this.treeMesh3D && !this.treeMeshImpostor) return;

    // --- 2. Tree LOD & Shadow Assignment ---
    // If chunk is only in shadow view (just off-screen, casting shadows into view),
    // use lightweight impostors for the shadow pass to eliminate high-poly vertex overhead
    if (!inCameraView && inShadowView) {
      if (this.treeMesh3D && this.treeMesh3D.visible) this.treeMesh3D.visible = false;
      const canCast = dist <= 95;
      if (this.treeMeshImpostor) {
        if (this.treeMeshImpostor.visible !== canCast) this.treeMeshImpostor.visible = canCast;
        this._setCastShadowOnObj(this.treeMeshImpostor, canCast);
      }
      this._setCastShadowOnObj(this.treeMesh3D, false);
      return;
    }

    // Normal in-view LOD selection
    let targetLOD = this.activeTreeLOD;
    if (this.activeTreeLOD === null) {
      targetLOD = dist <= 65 ? 0 : 1;
    } else if (this.activeTreeLOD === 0 && dist > 80) {
      targetLOD = 1;
    } else if (this.activeTreeLOD === 1 && dist <= 65) {
      targetLOD = 0;
    }

    if (this.activeTreeLOD !== targetLOD) {
      this.activeTreeLOD = targetLOD;
    }

    const want3DVisible = (targetLOD === 0);
    const wantImpVisible = (targetLOD === 1);

    if (this.treeMesh3D && this.treeMesh3D.visible !== want3DVisible) {
      this.treeMesh3D.visible = want3DVisible;
    }
    if (this.treeMeshImpostor && this.treeMeshImpostor.visible !== wantImpVisible) {
      this.treeMeshImpostor.visible = wantImpVisible;
    }

    const canCast = dist <= 95;
    this._setCastShadowOnObj(this.treeMesh3D, want3DVisible && canCast);
    this._setCastShadowOnObj(this.treeMeshImpostor, wantImpVisible && canCast);
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
    this._setCastShadowOnObj(this.treeMeshImpostor, enabled && this.activeTreeLOD === 1);
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
