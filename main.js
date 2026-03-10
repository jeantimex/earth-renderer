import './style.css'
import { Scene, WebGLRenderer, PerspectiveCamera } from 'three';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { Globe } from './Globe.js';
import Stats from 'stats.js';
import { loadGoogleMapsApi } from './googleMapsApi.js';

let scene, camera, renderer, globe, stats;
let rendererLabel = 'WebGL';
let placesLibrary;
let routesLibrary;

// Camera parameters
const params = {
  tiltAngle: 70, // degrees (0 = top-down, 90 = horizontal)
  distanceFromCenter: 800, // meters (3D distance from target center)
  showGoogleTiles: true,
  showExtractedMeshes: false,
};

const routeParams = {
  origin: '',
  destination: '',
  getRoutes: () => {
    void fetchAndRenderRoutes();
  },
};

const routePlaces = {
  origin: null,
  destination: null,
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

  // Initialize FPS stats overlay
  stats = new Stats();
  stats.showPanel(0); // 0: FPS panel
  document.body.appendChild(stats.dom);

  // Create camera
  camera = new PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    1,
    160000000
  );

  // Create globe instance with controls disabled initially
  globe = new Globe(scene, camera, renderer, apiKey, true);

  await initializeGoogleMapsLibraries(apiKey);

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
  rendererLabel = 'WebGL';
  return new WebGLRenderer({ antialias: true });
}

async function initializeGoogleMapsLibraries(apiKey) {
  await loadGoogleMapsApi(apiKey);
  placesLibrary = await google.maps.importLibrary('places');
  routesLibrary = await google.maps.importLibrary('routes');
}

async function fetchAndRenderRoutes() {
  if (!routePlaces.origin?.location || !routePlaces.destination?.location) {
    console.warn('Select both an origin and a destination before requesting routes.');
    return;
  }

  try {
    const { Route } = routesLibrary;
    const response = await Route.computeRoutes({
      origin: { location: routePlaces.origin.location },
      destination: { location: routePlaces.destination.location },
      travelMode: 'DRIVING',
      fields: ['path'],
    });

    console.log('computeRoutes response:', response);
    console.log('computeRoutes paths:', response.routes?.map((route, index) => ({
      index,
      pathLength: route.path?.length ?? 0,
      path: route.path,
    })));

    if (!response.routes?.length) {
      console.warn('No driving routes were returned for the selected places.');
      globe.clearRoutes();
      return;
    }

    const elevatedRoutes = await Promise.all(
      response.routes.map(async (route) => ({
        ...route,
        path: await applyTerrainElevationToPath(route.path || []),
      }))
    );

    globe.drawRoutes(elevatedRoutes);
  } catch (error) {
    console.error('Failed to compute routes.', error);
    globe.clearRoutes();
  }
}

async function applyTerrainElevationToPath(path) {
  if (path.length === 0) {
    return path;
  }

  return path.map((point) => ({
    lat: point.lat,
    lng: point.lng,
  }));
}

function setupGUI() {
  const gui = new GUI();
  gui.width = 340;

  const routeFolder = gui.addFolder('Route Search');
  const originController = routeFolder.add(routeParams, 'origin').name('Origin');
  const destinationController = routeFolder.add(routeParams, 'destination').name('Destination');
  routeFolder.add(routeParams, 'getRoutes').name('Get Routes');

  originController.domElement.classList.add('route-field');
  destinationController.domElement.classList.add('route-field');

  setupPlaceAutocomplete(originController, 'origin');
  setupPlaceAutocomplete(destinationController, 'destination');
  routeFolder.open();

  const displayFolder = gui.addFolder('Display');
  displayFolder.add(params, 'showGoogleTiles')
    .name('Google Tiles')
    .onChange((value) => {
      globe.setGoogleTilesVisible(value);
    });
  displayFolder.add(params, 'showExtractedMeshes')
    .name('Extracted Meshes')
    .onChange((value) => {
      globe.setExtractedMeshesVisible(value);
    });
  displayFolder.open();

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

function setupPlaceAutocomplete(controller, fieldName) {
  const input = controller.domElement.querySelector('input');
  if (!input || !placesLibrary?.AutocompleteSuggestion) {
    return;
  }

  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = fieldName === 'origin' ? 'Start typing a place' : 'Choose destination';

  const popup = document.createElement('div');
  popup.className = 'autocomplete-popup is-hidden';
  document.body.appendChild(popup);

  let blurTimer = null;
  let activeIndex = -1;
  let requestId = 0;
  let sessionToken = null;
  let suggestions = [];
  let debounceTimer = null;
  let suppressFetchUntil = 0;

  const ensureSessionToken = () => {
    if (!sessionToken) {
      sessionToken = new placesLibrary.AutocompleteSessionToken();
    }

    return sessionToken;
  };

  const positionPopup = () => {
    const rect = input.getBoundingClientRect();
    const popupWidth = Math.max(rect.width, 320);
    const popupLeft = Math.max(12, rect.right - popupWidth);

    popup.style.left = `${popupLeft}px`;
    popup.style.top = `${rect.bottom + 6}px`;
    popup.style.width = `${popupWidth}px`;
  };

  const closePopup = () => {
    popup.classList.add('is-hidden');
    popup.replaceChildren();
    popup.dataset.state = 'idle';
    activeIndex = -1;
    suggestions = [];
  };

  const openPopup = () => {
    if (popup.childElementCount === 0 || routePlaces[fieldName]) {
      return;
    }

    positionPopup();
    popup.classList.remove('is-hidden');
  };

  const setActiveItem = (nextIndex) => {
    activeIndex = nextIndex;
    Array.from(popup.children).forEach((element, index) => {
      element.classList.toggle('active', index === activeIndex);
    });
  };

  const clearSelectionIfEditing = () => {
    const selectedPlace = routePlaces[fieldName];
    if (!selectedPlace) {
      return;
    }

    const selectedLabel = selectedPlace.formattedAddress || selectedPlace.displayName;
    if (input.value !== selectedLabel) {
      routePlaces[fieldName] = null;
    }
  };

  const getSelectedPlaceLabel = () => {
    const selectedPlace = routePlaces[fieldName];
    return selectedPlace?.formattedAddress || selectedPlace?.displayName || '';
  };

  const getSuggestionPrimaryText = (suggestion) => {
    return suggestion.placePrediction?.mainText?.text
      || suggestion.placePrediction?.text?.text
      || '';
  };

  const getSuggestionSecondaryText = (suggestion) => {
    return suggestion.placePrediction?.secondaryText?.text || '';
  };

  const applyResolvedPlace = async (suggestion) => {
    requestId += 1;
    window.clearTimeout(debounceTimer);
    suppressFetchUntil = Date.now() + 300;
    closePopup();

    const place = suggestion.placePrediction.toPlace();
    await place.fetchFields({
      fields: ['displayName', 'formattedAddress', 'location'],
    });

    routePlaces[fieldName] = place;
    routeParams[fieldName] = place.formattedAddress || place.displayName || getSuggestionPrimaryText(suggestion);
    controller.updateDisplay();
    sessionToken = null;
  };

  const renderSuggestions = () => {
    popup.replaceChildren();

    suggestions.forEach((suggestion, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'autocomplete-item';

      const primary = document.createElement('span');
      primary.className = 'autocomplete-primary';
      primary.textContent = getSuggestionPrimaryText(suggestion);

      const secondaryText = getSuggestionSecondaryText(suggestion);
      item.appendChild(primary);

      if (secondaryText) {
        const secondary = document.createElement('span');
        secondary.className = 'autocomplete-secondary';
        secondary.textContent = secondaryText;
        item.appendChild(secondary);
      }

      item.addEventListener('mouseenter', () => setActiveItem(index));
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        void applyResolvedPlace(suggestion);
      });
      popup.appendChild(item);
    });

    setActiveItem(suggestions.length > 0 ? 0 : -1);
    openPopup();
  };

  const fetchSuggestions = async () => {
    const query = input.value.trim();
    routeParams[fieldName] = input.value;
    clearSelectionIfEditing();

    if (routePlaces[fieldName]) {
      closePopup();
      return;
    }

    if (Date.now() < suppressFetchUntil) {
      closePopup();
      return;
    }

    if (routePlaces[fieldName] && query === getSelectedPlaceLabel()) {
      closePopup();
      return;
    }

    if (query.length < 3) {
      closePopup();
      return;
    }

    const currentRequestId = ++requestId;

    try {
      const response = await placesLibrary.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: query,
        language: navigator.language,
        sessionToken: ensureSessionToken(),
      });

      if (currentRequestId !== requestId) {
        return;
      }

      suggestions = response.suggestions || [];
      if (suggestions.length === 0) {
        closePopup();
        return;
      }

      renderSuggestions();
    } catch (error) {
      console.error(`Failed to fetch autocomplete suggestions for ${fieldName}.`, error);
      closePopup();
    }
  };

  const scheduleFetch = () => {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      void fetchSuggestions();
    }, 250);
  };

  input.addEventListener('input', scheduleFetch);
  input.addEventListener('focus', () => {
    if (routePlaces[fieldName]) {
      closePopup();
      return;
    }

    if (popup.childElementCount > 0) {
      openPopup();
    }
  });
  input.addEventListener('blur', () => {
    blurTimer = window.setTimeout(closePopup, 120);
  });
  input.addEventListener('keydown', (event) => {
    if (popup.classList.contains('is-hidden') || suggestions.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveItem((activeIndex + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveItem((activeIndex - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === 'Enter') {
      if (activeIndex < 0) {
        return;
      }

      event.preventDefault();
      void applyResolvedPlace(suggestions[activeIndex]);
    } else if (event.key === 'Escape') {
      closePopup();
    }
  });

  popup.addEventListener('mousedown', (event) => {
    event.preventDefault();
    if (blurTimer) {
      window.clearTimeout(blurTimer);
      blurTimer = null;
    }
  });

  window.addEventListener('resize', () => {
    if (!popup.classList.contains('is-hidden')) {
      positionPopup();
    }
  });
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

function animate() {
  requestAnimationFrame(animate);

  if (!globe || !renderer) return;

  if (stats) {
    stats.begin();
  }

  // Update globe (controls, camera, tiles)
  globe.update();

  // Render scene
  renderer.render(scene, camera);

  if (stats) {
    stats.end();
  }
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
