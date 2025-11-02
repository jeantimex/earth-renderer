import './style.css'
import { Scene, WebGLRenderer, PerspectiveCamera } from 'three';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { WebGPURenderer } from 'three/webgpu';
import { Globe } from './Globe.js';

let scene, camera, renderer, globe;
let rendererLabel = 'WebGL';

// Camera parameters
const params = {
  tiltAngle: 70, // degrees (0 = top-down, 90 = horizontal)
  distanceFromCenter: 800, // meters (3D distance from target center)
};

async function init() {
  // Get the API key from environment variable
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    console.error('Google Maps API key not found. Please check your .env file.');
    return;
  }

  // Create renderer (prefers WebGPU, falls back to WebGL)
  renderer = await createRenderer();
  if (!renderer) {
    console.error('Failed to initialize renderer.');
    return;
  }
  renderer.setClearColor(0x151c1f);
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (renderer.setPixelRatio) {
    renderer.setPixelRatio(window.devicePixelRatio);
  }
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

  console.info(`Renderer initialized with ${rendererLabel}.`);
  return true;
}

async function createRenderer() {
  if (await isWebGPUAvailable()) {
    try {
      const webgpuRenderer = new WebGPURenderer({ antialias: true });
      // Match WebGL large-world precision behavior
      webgpuRenderer.highPrecision = true;
      await webgpuRenderer.init();
      rendererLabel = 'WebGPU';
      return webgpuRenderer;
    } catch (error) {
      console.warn('WebGPU initialization failed, falling back to WebGL.', error);
    }
  }

  rendererLabel = 'WebGL';
  return new WebGLRenderer({ antialias: true });
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
  if (!renderer) return;

  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (renderer.setPixelRatio) {
    renderer.setPixelRatio(window.devicePixelRatio);
  }
}

async function isWebGPUAvailable() {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    return false;
  }

  try {
    return Boolean(await navigator.gpu.requestAdapter());
  } catch (error) {
    console.warn('navigator.gpu.requestAdapter() failed.', error);
    return false;
  }
}

function animate() {
  requestAnimationFrame(animate);

  if (!globe || !renderer) return;

  // Update globe (controls, camera, tiles)
  globe.update();

  // Render scene
  renderer.render(scene, camera);
}

// Start the application
init()
  .then((initialized) => {
    if (initialized) {
      animate();
    }
  })
  .catch((error) => {
    console.error('Application initialization failed.', error);
  });
