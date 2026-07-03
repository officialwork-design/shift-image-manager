const Api = (() => {
  let seq = 0;

  function request(action, payload = {}) {
    const config = window.APP_CONFIG || {};
    if (!config.GAS_WEB_APP_URL) {
      return Promise.reject(new Error('config.js の GAS_WEB_APP_URL が未設定です'));
    }
    if (config.API_MODE === 'fetch') return fetchRequest(config.GAS_WEB_APP_URL, action, payload);
    return jsonpRequest(config.GAS_WEB_APP_URL, action, payload);
  }

  async function fetchRequest(url, action, payload) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'API error');
    return data.data;
  }

  function jsonpRequest(url, action, payload) {
    return new Promise((resolve, reject) => {
      const callbackName = `__shiftApiCallback_${Date.now()}_${seq++}`;
      const script = document.createElement('script');
      const timer = setTimeout(() => cleanup(new Error('API timeout')), 30000);

      window[callbackName] = (data) => {
        if (!data || !data.success) cleanup(new Error((data && data.message) || 'API error'));
        else cleanup(null, data.data);
      };

      function cleanup(err, data) {
        clearTimeout(timer);
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
        if (err) reject(err); else resolve(data);
      }

      const params = new URLSearchParams({
        action,
        payload: JSON.stringify(payload),
        callback: callbackName
      });
      script.onerror = () => cleanup(new Error('API script load error'));
      script.src = `${url}?${params.toString()}`;
      document.body.appendChild(script);
    });
  }

  return { request };
})();
