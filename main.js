import './style.css'
import {
  TilesRenderer,
  GlobeControls,
} from '3d-tiles-renderer';
import {
  GoogleCloudAuthPlugin,
  GLTFExtensionsPlugin,
} from '3d-tiles-renderer/plugins';
import {
  Scene,
  WebGLRenderer,
  PerspectiveCamera,
} from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

let scene, camera, renderer, tiles, controls;

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

  // Handle window resize
  window.addEventListener('resize', onWindowResize, false);

  // Update stats
  updateStats();
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
