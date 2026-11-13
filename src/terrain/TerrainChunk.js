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
    this.treeMesh = null;
    this.isDisposed = false;

    this.worldCenterX = (chunkX + 0.5) * size;
    this.worldCenterZ = (chunkZ + 0.5) * size;

    this._build();
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

    for (let i = 0; i < vertexCount; i++) {
      const localX = positionAttr.getX(i);
      const localZ = positionAttr.getZ(i);

      const worldX = this.worldCenterX + localX;
      const worldZ = this.worldCenterZ + localZ;

      // Continuous natural height
      const worldY = this.heightmap.getHeight(worldX, worldZ);
      positionAttr.setY(i, worldY);

      // Continuous analytical normal (eliminates lighting seams across chunk boundaries)
      const norm = this.heightmap.getNormal(worldX, worldZ, 0.75);
      normalArray[i * 3 + 0] = norm.x;
      normalArray[i * 3 + 1] = norm.y;
      normalArray[i * 3 + 2] = norm.z;
    }

    positionAttr.needsUpdate = true;
    geometry.setAttribute('normal', new THREE.BufferAttribute(normalArray, 3));

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    this.mesh = new THREE.Mesh(geometry, this.materialFactory.getMaterial());
    this.mesh.position.set(this.worldCenterX, 0, this.worldCenterZ);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }

  /**
   * Generates and adds tree instances for this chunk if tree generator is ready.
   * @param {THREE.Scene} scene
   */
  buildTrees(scene) {
    if (this.isDisposed || this.treeMesh || !this.treeGenerator || !this.treeGenerator.isLoaded) {
      return;
    }

    const mesh = this.treeGenerator.generateChunkTreeMesh(this.chunkX, this.chunkZ);
    if (mesh && !this.isDisposed) {
      this.treeMesh = mesh;
      if (scene) {
        scene.add(this.treeMesh);
      }
    }
  }

  /**
   * Replaces existing trees with newly generated trees (e.g. when tree model is switched).
   * @param {THREE.Scene} scene
   */
  rebuildTrees(scene) {
    if (this.treeMesh) {
      this._disposeTreeMesh(this.treeMesh, scene);
      this.treeMesh = null;
    }
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

    if (this.mesh) {
      if (scene) {
        scene.remove(this.mesh);
      }
      if (this.mesh.geometry) {
        this.mesh.geometry.dispose();
      }
      this.mesh = null;
    }

    if (this.treeMesh) {
      this._disposeTreeMesh(this.treeMesh, scene);
      this.treeMesh = null;
    }
  }
}
