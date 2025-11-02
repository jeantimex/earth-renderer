import './style.css'
import { Scene, WebGLRenderer, PerspectiveCamera } from 'three';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { Globe } from './Globe.js';

let scene, camera, renderer, globe;

// Camera parameters
const params = {
  tiltAngle: 70, // degrees (0 = top-down, 90 = horizontal)
  distanceFromCenter: 800, // meters (3D distance from target center)
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

  // Create globe instance with controls disabled initially
  globe = new Globe(scene, camera, renderer, apiKey, true);

  // Setup GUI controls
  setupGUI();

  // Position camera at target center (controls are disabled, so this won't be disrupted)
  globe.positionCameraAtTarget(params.distanceFromCenter, params.tiltAngle);

  // Handle window resize
  window.addEventListener('resize', onWindowResize, false);
}

function setupGUI() {
  const gui = new GUI();
  gui.width = 300;

  const cameraFolder = gui.addFolder('Camera Settings');

  const distanceController = cameraFolder.add(params, 'distanceFromCenter', 200, 6500000, 1000)
    .name('Distance (m)')
    .onChange(() => {
      // Automatically set tilt to 0 (top-down) when viewing from far distance
      if (params.distanceFromCenter > 200000) {
        params.tiltAngle = 0;
        tiltController.updateDisplay();
      }
      globe.positionCameraAtTarget(params.distanceFromCenter, params.tiltAngle);
    });

  const tiltController = cameraFolder.add(params, 'tiltAngle', 0, 90, 1)
    .name('Tilt Angle (°)')
    .onChange(() => {
      globe.positionCameraAtTarget(params.distanceFromCenter, params.tiltAngle);
    });

  cameraFolder.open();
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
}

function animate() {
  requestAnimationFrame(animate);

  if (!globe) return;

  // Update globe (controls, camera, tiles)
  globe.update();

  // Render scene
  renderer.render(scene, camera);
}

// Start the application
init();
animate();
