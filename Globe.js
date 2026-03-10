import {
  TilesRenderer,
  GlobeControls,
  WGS84_ELLIPSOID,
} from '3d-tiles-renderer';
import {
  GoogleCloudAuthPlugin,
  GLTFExtensionsPlugin,
  UpdateOnChangePlugin,
} from '3d-tiles-renderer/plugins';
import {
  CatmullRomCurve3,
  Color,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

const _globeCenter = new Vector3();
const _cameraForward = new Vector3();
const _cameraToCenter = new Vector3();
const _surfaceNormal = new Vector3();
const _rayOrigin = new Vector3();
const _snappedPoint = new Vector3();

/**
 * Globe class encapsulates the 3D tiles renderer and controls for viewing Earth
 */
export class Globe {
  constructor(scene, camera, renderer, apiKey, disableControls = false) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.apiKey = apiKey;

    // Target center coordinates (Tokyo Tower by default)
    this.targetLat = 35.6586; // degrees
    this.targetLon = 139.7454; // degrees
    this.centerHeight = 333; // meters

    // Control activation tracking
    this._initialInteractionPerformed = false;
    this.routeGroup = new Group();
    this.scene.add(this.routeGroup);
    this.routeRaycaster = new Raycaster();
    this.routeRaycaster.firstHitOnly = true;
    this.routeSurfaceOffset = 12;
    this.routeRaycastOffset = 80;
    this.routeRaycastFar = 200;
    this.routeMaxStepHeight = 18;

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
    this.tiles.registerPlugin(new UpdateOnChangePlugin());

    // Rotate the tiles group to align with Three.js coordinate system
    this.tiles.group.rotation.x = -Math.PI / 2;
    this.scene.add(this.tiles.group);

    // Set up tiles renderer
    this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
    this.tiles.setCamera(this.camera);
  }

  initializeControls(disableControls) {
    // Create globe controls for camera interaction
    this.controls = new GlobeControls(
      this.scene,
      this.camera,
      this.renderer.domElement
    );
    this.controls.setScene(this.scene);
    this.controls.setEllipsoid(this.tiles.ellipsoid, this.tiles.group);
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
   * Position camera to look at target center
   * @param {number} distanceFromCenter - 3D distance from target center in meters
   * @param {number} tiltAngle - Camera tilt angle (0° = top-down, 90° = horizontal)
   */
  positionCameraAtTarget(distanceFromCenter, tiltAngle) {
    // Update tiles group matrix world so we can use it
    this.tiles.group.updateMatrixWorld();

    // Calculate target center's position
    const targetPosition = new Vector3();
    WGS84_ELLIPSOID.getCartographicToPosition(
      this.targetLat * MathUtils.DEG2RAD,
      this.targetLon * MathUtils.DEG2RAD,
      this.centerHeight / 2, // Middle of the target
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
    const cameraDistance = distanceFromCenter * Math.cos(elevationRad); // horizontal distance
    const verticalDistance = distanceFromCenter * Math.sin(elevationRad); // vertical distance
    const cameraHeight = (this.centerHeight / 2) + verticalDistance;

    // Offset the latitude to position camera south of the target
    // Approximate: 1 degree latitude ≈ 111km
    const cameraLat = this.targetLat - (cameraDistance / 111000);

    WGS84_ELLIPSOID.getCartographicToPosition(
      cameraLat * MathUtils.DEG2RAD,
      this.targetLon * MathUtils.DEG2RAD,
      cameraHeight,
      this.camera.position
    );
    this.camera.position.applyMatrix4(this.tiles.group.matrixWorld);

    // Make camera look at target center
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

    // Fade the x-ray pass out in top-down views.
    this.updateRouteXRayOpacity();
  }

  clearRoutes() {
    this.routeGroup.children.forEach((routeLine) => {
      routeLine.geometry.dispose();
      routeLine.material.dispose();
    });
    this.routeGroup.clear();
  }

  drawRoutes(routes) {
    this.clearRoutes();
    this.tiles.group.updateMatrixWorld();

    console.log('drawRoutes input:', routes);

    routes.forEach((route, index) => {
      if (!Array.isArray(route?.path) || route.path.length < 2) {
        console.warn('Skipping route with missing path.', { index, path: route?.path });
        return;
      }

      const points = this.stabilizeRoutePoints(route.path
        .map((point) => this.getRouteWorldPosition(point))
        .filter(Boolean));

      console.log('drawRoutes converted points:', {
        index,
        pathLength: route.path.length,
        pointCount: points.length,
        firstPoint: points[0],
        lastPoint: points[points.length - 1],
      });

      if (points.length < 2) {
        return;
      }

      const routeColor = index === 0 ? 0x7ad7ff : 0xffb347;
      const routeLine = this.createRouteTube(points, routeColor);
      this.routeGroup.add(routeLine);

      this.routeGroup.add(this.createRouteMarker(points[0], 0x00ffcc));
      this.routeGroup.add(this.createRouteMarker(points[points.length - 1], 0xff8844));
    });
  }

  createRouteTube(points, color) {
    const curve = new CatmullRomCurve3(points);
    const geometry = new TubeGeometry(curve, Math.max(points.length * 2, 64), 6, 10, false);
    const material = new MeshBasicMaterial({
      color: new Color(color),
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const xrayMaterial = new MeshBasicMaterial({
      color: new Color(color),
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false,
    });

    const routeGroup = new Group();

    const routeMesh = new Mesh(geometry, material);
    routeMesh.frustumCulled = false;
    routeGroup.add(routeMesh);

    const xrayRouteMesh = new Mesh(geometry.clone(), xrayMaterial);
    xrayRouteMesh.frustumCulled = false;
    xrayRouteMesh.renderOrder = 1000;
    xrayRouteMesh.userData.isRouteXRay = true;
    xrayRouteMesh.userData.baseOpacity = 0.85;
    routeGroup.add(xrayRouteMesh);

    return routeGroup;
  }

  updateRouteXRayOpacity() {
    _globeCenter.setFromMatrixPosition(this.tiles.group.matrixWorld);
    _cameraForward.set(0, 0, -1).transformDirection(this.camera.matrixWorld);
    _cameraToCenter.subVectors(_globeCenter, this.camera.position).normalize();

    const alignment = Math.max(0, _cameraForward.dot(_cameraToCenter));
    const xrayOpacity = alignment > 0.94
      ? 0.35
      : MathUtils.mapLinear(alignment, 0.7, 0.94, 0.85, 0.35);

    this.routeGroup.traverse((object) => {
      if (!object.userData?.isRouteXRay) {
        return;
      }

      object.material.opacity = Math.max(0, Math.min(object.userData.baseOpacity, xrayOpacity));
      object.visible = object.material.opacity > 0.001;
    });
  }

  createRouteMarker(position, color) {
    const marker = new Mesh(
      new SphereGeometry(20, 16, 16),
      new MeshBasicMaterial({
        color,
        depthTest: true,
        depthWrite: false,
      })
    );
    marker.position.copy(position);
    return marker;
  }

  cartographicToWorldPosition(point) {
    const lat = this.getCoordinateValue(point, 'lat');
    const lng = this.getCoordinateValue(point, 'lng');

    if (lat == null || lng == null) {
      return null;
    }

    const altitude = 0;
    const position = new Vector3();
    WGS84_ELLIPSOID.getCartographicToPosition(
      lat * MathUtils.DEG2RAD,
      lng * MathUtils.DEG2RAD,
      altitude,
      position
    );
    return position.applyMatrix4(this.tiles.group.matrixWorld);
  }

  getRouteWorldPosition(point) {
    const fallbackPosition = this.cartographicToWorldPosition(point);
    if (!fallbackPosition) {
      return null;
    }

    return this.snapRoutePointToTiles(fallbackPosition);
  }

  snapRoutePointToTiles(fallbackPosition) {
    _globeCenter.setFromMatrixPosition(this.tiles.group.matrixWorld);
    _surfaceNormal.subVectors(fallbackPosition, _globeCenter).normalize();
    _rayOrigin.copy(fallbackPosition).addScaledVector(_surfaceNormal, this.routeRaycastOffset);

    this.routeRaycaster.near = 0;
    this.routeRaycaster.far = this.routeRaycastFar;
    this.routeRaycaster.set(_rayOrigin, _surfaceNormal.clone().negate());

    const intersections = this.routeRaycaster.intersectObject(this.tiles.group, true);
    if (intersections.length === 0) {
      return fallbackPosition;
    }

    return _snappedPoint
      .copy(intersections[0].point)
      .addScaledVector(_surfaceNormal, this.routeSurfaceOffset)
      .clone();
  }

  stabilizeRoutePoints(points) {
    if (points.length < 3) {
      return points;
    }

    const clamped = points.map((point) => point.clone());

    for (let i = 1; i < clamped.length; i += 1) {
      const previous = clamped[i - 1];
      const current = clamped[i];
      const previousHeight = previous.distanceTo(_globeCenter);
      const currentHeight = current.distanceTo(_globeCenter);
      const heightDelta = currentHeight - previousHeight;

      if (Math.abs(heightDelta) <= this.routeMaxStepHeight) {
        continue;
      }

      _surfaceNormal.copy(current).sub(_globeCenter).normalize();
      current.addScaledVector(
        _surfaceNormal,
        Math.sign(previousHeight - currentHeight) * (Math.abs(heightDelta) - this.routeMaxStepHeight)
      );
    }

    const smoothed = clamped.map((point) => point.clone());
    for (let i = 1; i < clamped.length - 1; i += 1) {
      smoothed[i]
        .copy(clamped[i - 1])
        .add(clamped[i])
        .add(clamped[i + 1])
        .multiplyScalar(1 / 3);
    }

    return smoothed;
  }

  getCoordinateValue(point, key) {
    const value = point?.[key];
    return typeof value === 'number' ? value : null;
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
    this.clearRoutes();
    this.scene.remove(this.routeGroup);

    if (this.tiles) {
      this.scene.remove(this.tiles.group);
      this.tiles.dispose();
    }
  }
}
