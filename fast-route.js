(() => {
  if (window.__iconiaFastRoute) return;
  window.__iconiaFastRoute = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    try {
      const url = typeof input === 'string' ? input : input?.url;
      if (url && url.startsWith('/api/generate') && !url.includes('generate-fast')) {
        if (typeof input === 'string') input = url.replace('/api/generate', '/api/generate-fast');
        else input = new Request(url.replace('/api/generate', '/api/generate-fast'), input);
      }
    } catch {}
    return nativeFetch(input, init);
  };
})();
