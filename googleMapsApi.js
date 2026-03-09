let mapsApiPromise;

export function loadGoogleMapsApi(apiKey) {
  if (window.google?.maps?.importLibrary) {
    return Promise.resolve(window.google.maps);
  }

  if (mapsApiPromise) {
    return mapsApiPromise;
  }

  mapsApiPromise = new Promise((resolve, reject) => {
    const googleNamespace = window.google || (window.google = {});
    const mapsNamespace = googleNamespace.maps || (googleNamespace.maps = {});
    const callbackName = '__ib__';
    const script = document.createElement('script');
    const params = new URLSearchParams({
      key: apiKey,
      v: 'weekly',
      loading: 'async',
      callback: `google.maps.${callbackName}`,
    });

    mapsNamespace[callbackName] = () => {
      delete mapsNamespace[callbackName];
      resolve(mapsNamespace);
    };

    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.onerror = () => {
      delete mapsNamespace[callbackName];
      reject(new Error('Google Maps JavaScript API could not load.'));
    };

    document.head.appendChild(script);
  });

  return mapsApiPromise;
}
