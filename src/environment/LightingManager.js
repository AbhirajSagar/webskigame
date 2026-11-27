import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { LIGHTING_PRESETS, cloneLightingPreset } from './LightingPresets.js';

function directionFromAngles(azimuthDeg, elevationDeg, out = new THREE.Vector3()) {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  const cosEl = Math.cos(el);
  out.set(Math.sin(az) * cosEl, Math.sin(el), Math.cos(az) * cosEl).normalize();
  return out;
}

/**
 * LightingManager
 * Applies hardcoded lighting, skybox, fog, and snow presets to both world and character scenes.
 */
export class LightingManager {
  /**
   * @param {Object} deps
   * @param {THREE.Scene} deps.scene
   * @param {THREE.Scene} deps.characterScene
   * @param {THREE.WebGLRenderer} deps.renderer
   * @param {import('../terrain/TerrainManager.js').TerrainManager} deps.terrainManager
   * @param {import('../player/PlayerController.js').PlayerController} deps.player
   * @param {string} [deps.initialPreset='default']
   */
  constructor({ scene, characterScene, renderer, terrainManager, player, cloudSystem = null, initialPreset = 'default' }) {
    this.scene = scene;
    this.characterScene = characterScene;
    this.renderer = renderer;
    this.terrainManager = terrainManager;
    this.player = player;
    this.cloudSystem = cloudSystem;

    this.activePresetId = LIGHTING_PRESETS[initialPreset] ? initialPreset : 'default';
    this.state = cloneLightingPreset(this.activePresetId);
    this.skyboxTexture = null;
    this._loadedSkyboxes = new Map();

    this._sunDir = new THREE.Vector3();
    this._sunOffset = new THREE.Vector3();
    this._forwardDir = new THREE.Vector3();
    this._shadowCenter = new THREE.Vector3();
    this._shadowCoverage = 58;
    this._shadowSnapStep = ((2 * this._shadowCoverage) / 1024) * 4;
    this._lastShadowSnapX = Infinity;
    this._lastShadowSnapZ = Infinity;
    this._shadowFrameCounter = 0;

    this._initLights();
    this._applySettings();
  }

  _initLights() {
    this.ambientLight = new THREE.AmbientLight(this.state.ambient.color, this.state.ambient.intensity);
    this.ambientLight.layers.enable(0);
    this.ambientLight.visible = false;
    this.scene.add(this.ambientLight);

    this.charAmbientLight = new THREE.AmbientLight(this.state.ambient.color, this.state.ambient.intensity);
    this.charAmbientLight.layers.enable(1);
    this.charAmbientLight.visible = false;
    this.characterScene.add(this.charAmbientLight);

    this.hemiLight = new THREE.HemisphereLight(
      this.state.hemisphere.skyColor,
      this.state.hemisphere.groundColor,
      this.state.hemisphere.intensity
    );
    this.hemiLight.layers.enable(0);
    this.hemiLight.visible = false;
    this.scene.add(this.hemiLight);

    this.charHemiLight = new THREE.HemisphereLight(
      this.state.hemisphere.skyColor,
      this.state.hemisphere.groundColor,
      this.state.hemisphere.intensity
    );
    this.charHemiLight.layers.enable(1);
    this.charHemiLight.visible = false;
    this.characterScene.add(this.charHemiLight);

    this.dirLight = new THREE.DirectionalLight(this.state.directional.color, this.state.directional.intensity);
    this.dirLight.layers.enable(0);
    this.dirLight.shadow.camera.layers.set(0);
    this.dirLight.shadow.mapSize.set(1024, 1024);
    this.dirLight.shadow.camera.near = 15;
    this.dirLight.shadow.camera.far = 650;
    this.dirLight.shadow.camera.left = -this._shadowCoverage;
    this.dirLight.shadow.camera.right = this._shadowCoverage;
    this.dirLight.shadow.camera.top = this._shadowCoverage;
    this.dirLight.shadow.camera.bottom = -this._shadowCoverage;
    this.dirLight.shadow.bias = -0.0003;
    this.dirLight.shadow.normalBias = 0.03;
    this.dirLight.shadow.radius = 1.2;
    this.dirLight.visible = false;
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    this.charDirLight = new THREE.DirectionalLight(this.state.directional.color, this.state.directional.intensity);
    this.charDirLight.layers.enable(1);
    this.charDirLight.visible = false;
    this.characterScene.add(this.charDirLight);

    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;

    this._baseFog = this.scene.fog && this.scene.fog.isFog
      ? this.scene.fog
      : new THREE.Fog(this.state.fog.color, this.state.fog.near, this.state.fog.far);
  }

  /**
   * Preloads a skybox texture into cache without changing the active scene skybox.
   * @param {string} url
   * @returns {Promise<THREE.Texture|null>}
   */
  preloadSkybox(url) {
    if (!url || this._loadedSkyboxes.has(url)) {
      return Promise.resolve(this._loadedSkyboxes.get(url) || null);
    }
    const isHdr = url.toLowerCase().split('?')[0].endsWith('.hdr');
    return new Promise((resolve) => {
      const onLoad = (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        if (!isHdr) texture.colorSpace = THREE.SRGBColorSpace;
        this._loadedSkyboxes.set(url, texture);
        resolve(texture);
      };
      const onError = () => resolve(null);
      if (isHdr) {
        new RGBELoader().load(url, onLoad, undefined, onError);
      } else {
        new THREE.TextureLoader().load(url, onLoad, undefined, onError);
      }
    });
  }

  /**
   * Loads (with caching) an equirectangular skybox image or HDR file.
   * @param {string} url
   * @returns {Promise<THREE.Texture|null>}
   */
  loadSkybox(url) {
    if (!url) return Promise.resolve(null);
    if (this._loadedSkyboxes.has(url)) {
      const cached = this._loadedSkyboxes.get(url);
      this._applySkyboxTexture(cached);
      return Promise.resolve(cached);
    }

    const isHdr = url.toLowerCase().split('?')[0].endsWith('.hdr');
    return new Promise((resolve) => {
      const onLoad = (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        if (!isHdr) {
          texture.colorSpace = THREE.SRGBColorSpace;
        }
        this._loadedSkyboxes.set(url, texture);
        this._applySkyboxTexture(texture);
        resolve(texture);
      };
      const onError = (err) => {
        console.warn('LightingManager: Failed to load skybox:', url, err);
        this.scene.background = this._baseFog.color;
        resolve(null);
      };

      if (isHdr) {
        new RGBELoader().load(url, onLoad, undefined, onError);
      } else {
        new THREE.TextureLoader().load(url, onLoad, undefined, onError);
      }
    });
  }

  _applySkyboxTexture(texture) {
    this.skyboxTexture = texture;
    this.scene.background = texture;
    this.scene.environment = texture;
    this.characterScene.environment = texture;
    if (this.terrainManager?.treeGenerator?.isLoaded) {
      this._rebakeTreeImpostors();
    }
  }

  _rebakeTreeImpostors() {
    const tg = this.terrainManager?.treeGenerator;
    if (!tg?.isLoaded) return;

    const { ambient, hemisphere, directional } = this.state;
    const sunPos = directionFromAngles(directional.azimuthDeg, directional.elevationDeg).multiplyScalar(240);

    tg.initImpostors(this.renderer, this.skyboxTexture, {
      sunPosition: sunPos,
      sunColor: directional.color,
      sunIntensity: directional.enabled ? directional.intensity : 0,
      ambientColor: ambient.color,
      ambientIntensity: ambient.enabled ? ambient.intensity : 0,
      hemiSkyColor: hemisphere.skyColor,
      hemiGroundColor: hemisphere.groundColor,
      hemiIntensity: hemisphere.enabled ? hemisphere.intensity : 0,
      groundBounceIntensity: 0,
    });
  }

  /**
   * Switches to a named preset from LIGHTING_PRESETS.
   * @param {string} presetId
   * @returns {Promise<void>}
   */
  async applyPreset(presetId = 'default') {
    const resolvedId = LIGHTING_PRESETS[presetId] ? presetId : 'default';
    const prevSkybox = { ...this.state.skybox };
    this.activePresetId = resolvedId;
    this.state = cloneLightingPreset(resolvedId);

    this._applySettings();

    const skyChanged = prevSkybox.mode !== this.state.skybox.mode
      || prevSkybox.path !== this.state.skybox.path
      || prevSkybox.solidColor !== this.state.skybox.solidColor
      || !this.skyboxTexture;

    if (this.state.skybox.mode === 'solid') {
      this.skyboxTexture = null;
      this.scene.background = new THREE.Color(this.state.skybox.solidColor);
      this.scene.environment = null;
      this.characterScene.environment = null;
      this._rebakeTreeImpostors();
    } else if (skyChanged) {
      await this.loadSkybox(this.state.skybox.path);
    } else {
      this._rebakeTreeImpostors();
    }
  }

  _applySettings() {
    const { skybox, environment, ambient, hemisphere, directional, clouds, fog, snow } = this.state;

    const rotRad = THREE.MathUtils.degToRad(skybox.backgroundRotationDeg || 0);
    if (this.scene.backgroundRotation) {
      this.scene.backgroundRotation.set(0, rotRad, 0);
    }
    if (this.scene.environmentRotation) {
      this.scene.environmentRotation.set(0, rotRad, 0);
    }

    this.renderer.toneMappingExposure = environment.toneMappingExposure;
    this.scene.environmentIntensity = environment.environmentIntensity;
    this.characterScene.environmentIntensity = environment.environmentIntensity;
    this.scene.backgroundIntensity = environment.backgroundIntensity;
    this.scene.backgroundBlurriness = environment.backgroundBlurriness;

    this.ambientLight.visible = ambient.enabled;
    this.ambientLight.color.set(ambient.color);
    this.ambientLight.intensity = ambient.enabled ? ambient.intensity : 0;
    this.charAmbientLight.visible = ambient.enabled;
    this.charAmbientLight.color.set(ambient.color);
    this.charAmbientLight.intensity = ambient.enabled ? ambient.intensity : 0;

    this.hemiLight.visible = hemisphere.enabled;
    this.hemiLight.color.set(hemisphere.skyColor);
    this.hemiLight.groundColor.set(hemisphere.groundColor);
    this.hemiLight.intensity = hemisphere.enabled ? hemisphere.intensity : 0;
    this.charHemiLight.visible = hemisphere.enabled;
    this.charHemiLight.color.set(hemisphere.skyColor);
    this.charHemiLight.groundColor.set(hemisphere.groundColor);
    this.charHemiLight.intensity = hemisphere.enabled ? hemisphere.intensity : 0;

    directionFromAngles(directional.azimuthDeg, directional.elevationDeg, this._sunDir);
    this._sunOffset.copy(this._sunDir).multiplyScalar(240);

    this.dirLight.visible = directional.enabled;
    this.dirLight.color.set(directional.color);
    this.dirLight.intensity = directional.enabled ? directional.intensity : 0;
    this.dirLight.castShadow = directional.enabled && directional.castShadows;

    this.charDirLight.visible = directional.enabled;
    this.charDirLight.color.set(directional.color);
    this.charDirLight.intensity = directional.enabled ? directional.intensity : 0;
    this.charDirLight.position.copy(this._sunOffset);

    const wantShadows = directional.enabled && directional.castShadows;
    if (this.renderer.shadowMap.enabled !== wantShadows) {
      this.renderer.shadowMap.enabled = wantShadows;
      this.scene.traverse((obj) => {
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => { if (m) m.needsUpdate = true; });
        }
      });
    }
    this._lastShadowSnapX = Infinity;
    this._lastShadowSnapZ = Infinity;

    if (fog.enabled) {
      this._baseFog.color.set(fog.color);
      this._baseFog.near = fog.near;
      this._baseFog.far = Math.max(fog.near + 10, fog.far);
      this.scene.fog = this._baseFog;
    } else {
      this.scene.fog = null;
    }
    if (this.player?.snowDust?.material?.uniforms) {
      const u = this.player.snowDust.material.uniforms;
      u.uFogColor.value.set(fog.color);
      u.uFogNear.value = fog.enabled ? fog.near : 99999;
      u.uFogFar.value = fog.enabled ? Math.max(fog.near + 10, fog.far) : 100000;
    }

    if (this.cloudSystem?.mesh) {
      const cloudsEnabled = Boolean(clouds?.enabled);
      this.cloudSystem.mesh.visible = cloudsEnabled;
      if (cloudsEnabled && this.cloudSystem.material?.uniforms) {
        const cu = this.cloudSystem.material.uniforms;
        cu.uSunDirection.value.copy(this._sunDir);
        cu.uSunColor.value.set(clouds.sunColor || '#ffffff');
        cu.uSkyColor.value.set(clouds.skyColor || '#f7faff');
        cu.uShadowColor.value.set(clouds.shadowColor || '#dfe6ef');
        cu.uFogColor.value.set(fog.color);
      }
    }

    const matFactory = this.terrainManager?.materialFactory;
    if (matFactory) {
      matFactory.uniforms.uSunDirection.value.copy(this._sunDir);
      matFactory.setSnowConfig({
        sunlitColor: snow.sunlitColor,
        shadowColor: snow.shadowColor,
        creviceColor: snow.creviceColor,
        sssColor: snow.sssColor,
        sssIntensity: snow.sssIntensity,
        sheenColor: snow.sheenColor,
        sheenIntensity: snow.sheenIntensity,
      });
      if (matFactory.sharedDistantMaterial) {
        matFactory.sharedDistantMaterial.color.set(snow.distantColor);
      }
    }
  }

  update(camera) {
    if (!this.state.directional.enabled || !this.state.directional.castShadows) return;

    camera.getWorldDirection(this._forwardDir);
    this._forwardDir.y = 0;
    if (this._forwardDir.lengthSq() > 0.001) this._forwardDir.normalize();

    this._shadowCenter.copy(this.player.position).addScaledVector(this._forwardDir, 16);
    this._shadowCenter.x = Math.floor(this._shadowCenter.x / this._shadowSnapStep) * this._shadowSnapStep;
    this._shadowCenter.z = Math.floor(this._shadowCenter.z / this._shadowSnapStep) * this._shadowSnapStep;

    this._shadowFrameCounter++;
    if (
      this._shadowCenter.x !== this._lastShadowSnapX ||
      this._shadowCenter.z !== this._lastShadowSnapZ ||
      (this._shadowFrameCounter % 6) === 0
    ) {
      this._lastShadowSnapX = this._shadowCenter.x;
      this._lastShadowSnapZ = this._shadowCenter.z;
      this.dirLight.position.copy(this._shadowCenter).add(this._sunOffset);
      this.dirLight.target.position.copy(this._shadowCenter);
      this.dirLight.target.updateMatrixWorld();
      this.renderer.shadowMap.needsUpdate = true;
    }
  }
}
