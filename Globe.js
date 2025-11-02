import {
  TilesRenderer,
  GlobeControls,
  WGS84_ELLIPSOID,
} from '3d-tiles-renderer';
import {
  GoogleCloudAuthPlugin,
  GLTFExtensionsPlugin,
} from '3d-tiles-renderer/plugins';
import { MathUtils, Vector3 } from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

/**
 * Globe class encapsulates the 3D tiles renderer and controls for viewing Earth
 */
export class Globe {
  constructor(scene, camera, renderer, apiKey, disableControls = false) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.apiKey = apiKey;

    // Tokyo Tower coordinates
    this.targetLat = 35.6586; // degrees
    this.targetLon = 139.7454; // degrees
    this.towerHeight = 333; // meters

    // Control activation tracking
    this._initialInteractionPerformed = false;

    // Initialize tiles and controls
    this.initializeTiles();
    this.initializeControls(disableControls);
  }

  initializeTiles() {
    // Create tiles renderer
    this.tiles = new TilesRenderer();

    // Register Google Cloud authentication plugin
    this.tiles.registerPlugin(new GoogleCloudAuthPlugin({
      apiToken: this.apiKey,
      autoRefreshToken: true
    }));

    // Register GLTF extensions plugin with DRACO support
    this.tiles.registerPlugin(new GLTFExtensionsPlugin({
      dracoLoader: new DRACOLoader().setDecoderPath('https://unpkg.com/three@0.153.0/examples/jsm/libs/draco/gltf/')
    }));

    // Rotate the tiles group to align with Three.js coordinate system
    this.tiles.group.rotation.x = -Math.PI / 2;
    this.scene.add(this.tiles.group);

    // Set up tiles renderer
    this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
    this.tiles.setCamera(this.camera);
  }

  initializeControls(disableControls) {
    // Create globe controls for camera interaction
    // Pass tiles as 4th parameter - critical for proper globe transformation handling
    this.controls = new GlobeControls(
      this.scene,
      this.camera,
      this.renderer.domElement,
      this.tiles
    );
    this.controls.enableDamping = true;
    this.controls.enabled = !disableControls;

    // If controls are disabled, set up deferred activation on first user interaction
    if (disableControls) {
      const activateControlsAndRedispatch = (event) => {
        // Prevent duplicate activation from competing event types
        if (this._initialInteractionPerformed) {
          return;
        }

        this.controls.enabled = true;
        this._initialInteractionPerformed = true;

        // Re-dispatch the event so controls can process it
        let newEventToRedispatch;
        if (event instanceof PointerEvent) {
          newEventToRedispatch = new PointerEvent(event.type, event);
        } else if (event instanceof WheelEvent) {
          newEventToRedispatch = new WheelEvent(event.type, event);
        }

        if (newEventToRedispatch) {
          this.renderer.domElement.dispatchEvent(newEventToRedispatch);
        }
      };

      // Add one-time listeners for pointerdown and wheel events
      this.renderer.domElement.addEventListener(
        'pointerdown',
        activateControlsAndRedispatch,
        { once: true }
      );
      this.renderer.domElement.addEventListener(
        'wheel',
        activateControlsAndRedispatch,
        { once: true }
      );
    }
  }

  /**
   * Position camera to look at Tokyo Tower
   * @param {number} distanceFromTower - 3D distance from Tokyo Tower in meters
   * @param {number} tiltAngle - Camera tilt angle (0° = top-down, 90° = horizontal)
   */
  positionCameraAtTarget(distanceFromTower, tiltAngle) {
    // Update tiles group matrix world so we can use it
    this.tiles.group.updateMatrixWorld();

    // Calculate Tokyo Tower's position at the middle
    const targetPosition = new Vector3();
    WGS84_ELLIPSOID.getCartographicToPosition(
      this.targetLat * MathUtils.DEG2RAD,
      this.targetLon * MathUtils.DEG2RAD,
      this.towerHeight / 2, // Middle of the tower
      targetPosition
    );
    targetPosition.applyMatrix4(this.tiles.group.matrixWorld);

    // Convert tilt to elevation angle from horizontal
    // 0° tilt = 90° elevation (straight down)
    // 90° tilt = 0° elevation (horizontal)
    const elevationFromHorizontal = 90 - tiltAngle;
    const elevationRad = elevationFromHorizontal * MathUtils.DEG2RAD;

    // Calculate camera position based on distance and tilt angle
    // Using spherical coordinates: distance, elevation angle
    const cameraDistance = distanceFromTower * Math.cos(elevationRad); // horizontal distance
    const verticalDistance = distanceFromTower * Math.sin(elevationRad); // vertical distance
    const cameraHeight = (this.towerHeight / 2) + verticalDistance;

    // Offset the latitude to position camera south of the tower
    // Approximate: 1 degree latitude ≈ 111km
    const cameraLat = this.targetLat - (cameraDistance / 111000);

    WGS84_ELLIPSOID.getCartographicToPosition(
      cameraLat * MathUtils.DEG2RAD,
      this.targetLon * MathUtils.DEG2RAD,
      cameraHeight,
      this.camera.position
    );
    this.camera.position.applyMatrix4(this.tiles.group.matrixWorld);

    // Make camera look at Tokyo Tower
    this.camera.lookAt(targetPosition);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Update the globe (called every frame)
   */
  update() {
    // Update controls
    this.controls.update();

    // Update camera matrix world
    this.camera.updateMatrixWorld();

    // Update tiles with current camera state
    this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
    this.tiles.setCamera(this.camera);

    // Update tiles rendering
    this.tiles.update();
  }

  /**
   * Get tiles statistics
   */
  getStats() {
    return this.tiles.stats;
  }

  /**
   * Get visible tiles count
   */
  getVisibleTilesCount() {
    return this.tiles.visibleTiles.size;
  }

  /**
   * Dispose of resources
   */
  dispose() {
    if (this.tiles) {
      this.scene.remove(this.tiles.group);
      this.tiles.dispose();
    }
  }
}
