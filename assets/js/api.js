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

  async function fetchRequest(url, action, payload, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        body: JSON.stringify({ action, payload }),
        signal: controller.signal
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.message || 'API error');
      return data.data;
    } finally {
      clearTimeout(timer);
    }
  }

  function post(action, payload = {}, timeoutMs = 60000) {
    const config = window.APP_CONFIG || {};
    if (!config.GAS_WEB_APP_URL) {
      return Promise.reject(new Error('config.js の GAS_WEB_APP_URL が未設定です'));
    }
    return opaquePostRequest(config.GAS_WEB_APP_URL, action, payload, timeoutMs);
  }

  function jsonpRequest(url, action, payload) {
    return jsonpRequestRaw(url, action, payload).then((data) => {
      if (!data || !data.success) throw new Error((data && data.message) || 'API error');
      return data.data;
    });
  }

  function jsonpRequestRaw(url, action, payload, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const callbackName = `__shiftApiCallback_${Date.now()}_${seq++}`;
      const script = document.createElement('script');
      const timer = setTimeout(() => cleanup(new Error('API timeout')), timeoutMs);

      window[callbackName] = (data) => {
        cleanup(null, data);
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

  async function opaquePostRequest(url, action, payload, timeoutMs) {
    const probe = await probeAction(url, action);
    if (!probe.available) throw new Error(probe.message);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        body: JSON.stringify({ action, payload }),
        signal: controller.signal
      });
      return { success: true, submitted: true };
    } finally {
      clearTimeout(timer);
    }
  }

  async function probeAction(url, action) {
    const data = await jsonpRequestRaw(url, action, { __probe: true }, 30000);
    const message = (data && data.message) || '';
    if (!data || (data.success === false && /^Unknown action:/.test(message))) {
      return {
        available: false,
        message: 'GAS WebAppが古い可能性があります。clasp push後に新しいバージョンをデプロイしてください。'
      };
    }
    return { available: true };
  }

  return { request, post };
})();
