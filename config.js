(function () {
  function resolveApiBaseUrl() {
    if (window.__API_BASE_URL__ != null && String(window.__API_BASE_URL__).trim() !== '') {
      return String(window.__API_BASE_URL__).trim();
    }

    if (window.API_BASE_URL) {
      return String(window.API_BASE_URL).trim();
    }

    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '';
    return isLocal ? 'http://localhost:3000' : window.location.origin;
  }

  window.APP_CONFIG = {
    apiBaseUrl: resolveApiBaseUrl(),
  };
})();
