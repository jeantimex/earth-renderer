import './style.css'
import {
  TilesRenderer,
  GlobeControls,
  WGS84_ELLIPSOID,
  CAMERA_FRAME,
} from '3d-tiles-renderer';
import {
  GoogleCloudAuthPlugin,
  GLTFExtensionsPlugin,
} from '3d-tiles-renderer/plugins';
import {
  Scene,
  WebGLRenderer,
  PerspectiveCamera,
  MathUtils,
  Vector3,
} from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';

let scene, camera, renderer, tiles, controls;

// Camera parameters
const params = {
  tiltAngle: 70, // degrees (0 = top-down, 90 = horizontal)
  distanceFromTower: 800, // meters (3D distance from Tokyo Tower)
};

function init() {
  // Get the API key from environment variable
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    console.error('Google Maps API key not found. Please check your .env file.');
    document.getElementById('stats').innerText = 'Error: API key not found';
    return;
  }

  // Create renderer
  renderer = new WebGLRenderer({ antialias: true });
  renderer.setClearColor(0x151c1f);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  document.body.appendChild(renderer.domElement);

  // Create scene
  scene = new Scene();

  // Create camera
  camera = new PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    1,
    160000000
  );
  camera.position.set(4800000, 2570000, 14720000);
  camera.lookAt(0, 0, 0);

  // Create tiles renderer (without URL - plugin will handle it)
  tiles = new TilesRenderer();

  // Register Google Cloud authentication plugin
  tiles.registerPlugin(new GoogleCloudAuthPlugin({
    apiToken: apiKey,
    autoRefreshToken: true
  }));

  // Register GLTF extensions plugin with DRACO support
  tiles.registerPlugin(new GLTFExtensionsPlugin({
    dracoLoader: new DRACOLoader().setDecoderPath('https://unpkg.com/three@0.153.0/examples/jsm/libs/draco/gltf/')
  }));

  // Rotate the tiles group to align with Three.js coordinate system
  tiles.group.rotation.x = -Math.PI / 2;
  scene.add(tiles.group);

  // Set up tiles renderer
  tiles.setResolutionFromRenderer(camera, renderer);
  tiles.setCamera(camera);

  // Create globe controls for camera interaction
  controls = new GlobeControls(scene, camera, renderer.domElement, null);
  controls.enableDamping = true;
  controls.setEllipsoid(tiles.ellipsoid, tiles.group);

  // Position camera at Tokyo Tower
  positionCameraAtTokyoTower();

  // Setup GUI controls
  setupGUI();

  // Handle window resize
  window.addEventListener('resize', onWindowResize, false);

  // Update stats
  updateStats();
}

function setupGUI() {
  const gui = new GUI();
  gui.width = 300;

  const cameraFolder = gui.addFolder('Camera Settings');

  cameraFolder.add(params, 'distanceFromTower', 200, 5000, 50)
    .name('Distance (m)')
    .onChange(() => {
      positionCameraAtTokyoTower();
    });

  cameraFolder.add(params, 'tiltAngle', 0, 90, 1)
    .name('Tilt Angle (°)')
    .onChange(() => {
      positionCameraAtTokyoTower();
    });

  cameraFolder.open();
}

function positionCameraAtTokyoTower() {
  // Tokyo Tower coordinates
  const lat = 35.6586; // degrees
  const lon = 139.7454; // degrees
  const towerHeight = 333; // Tokyo Tower is 333 meters tall

  // Update tiles group matrix world so we can use it
  tiles.group.updateMatrixWorld();

  // Calculate Tokyo Tower's position at the middle
  const targetPosition = new Vector3();
  WGS84_ELLIPSOID.getCartographicToPosition(
    lat * MathUtils.DEG2RAD,
    lon * MathUtils.DEG2RAD,
    towerHeight / 2, // Middle of the tower
    targetPosition
  );
  targetPosition.applyMatrix4(tiles.group.matrixWorld);

  // Camera settings from params
  // tiltAngle: 0° = top-down view, 90° = horizontal view
  const { tiltAngle, distanceFromTower } = params;

  // Convert tilt to elevation angle from horizontal
  // 0° tilt = 90° elevation (straight down)
  // 90° tilt = 0° elevation (horizontal)
  const elevationFromHorizontal = 90 - tiltAngle;
  const elevationRad = elevationFromHorizontal * MathUtils.DEG2RAD;

  // Calculate camera position based on distance and tilt angle
  // Using spherical coordinates: distance, elevation angle
  const cameraDistance = distanceFromTower * Math.cos(elevationRad); // horizontal distance
  const verticalDistance = distanceFromTower * Math.sin(elevationRad); // vertical distance
  const cameraHeight = (towerHeight / 2) + verticalDistance;

  // Offset the latitude to position camera south of the tower
  // Approximate: 1 degree latitude ≈ 111km
  const cameraLat = lat - (cameraDistance / 111000);

  WGS84_ELLIPSOID.getCartographicToPosition(
    cameraLat * MathUtils.DEG2RAD,
    lon * MathUtils.DEG2RAD,
    cameraHeight,
    camera.position
  );
  camera.position.applyMatrix4(tiles.group.matrixWorld);

  // Make camera look at Tokyo Tower
  camera.lookAt(targetPosition);
  camera.updateProjectionMatrix();
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
}

function updateStats() {
  if (!tiles) return;

  const stats = tiles.stats;
  const statsDiv = document.getElementById('stats');
  statsDiv.innerHTML = `
    Downloading: ${stats.downloading}
    Parsing: ${stats.parsing}
    Visible: ${tiles.visibleTiles.size}
  `;
}

function animate() {
  requestAnimationFrame(animate);

  if (!tiles) return;

  // Update controls
  controls.update();

  // Update tiles
  camera.updateMatrixWorld();
  tiles.setResolutionFromRenderer(camera, renderer);
  tiles.setCamera(camera);
  tiles.update();

  // Render scene
  renderer.render(scene, camera);

  // Update stats periodically
  if (Math.random() < 0.01) {
    updateStats();
  }
}

// Start the application
init();
animate();
