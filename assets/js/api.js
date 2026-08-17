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
    return formPostRequest(config.GAS_WEB_APP_URL, action, payload, timeoutMs);
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

  async function formPostRequest(url, action, payload, timeoutMs) {
    const probe = await probeAction(url, action);
    if (!probe.available) throw new Error(probe.message);

    return new Promise((resolve, reject) => {
      const frameName = `shiftUploadFrame_${Date.now()}_${seq++}`;
      const iframe = document.createElement('iframe');
      const form = document.createElement('form');
      let submitted = false;
      let settled = false;
      const timer = setTimeout(() => cleanup(new Error('API timeout')), timeoutMs);

      iframe.name = frameName;
      iframe.style.display = 'none';

      form.method = 'POST';
      form.action = url;
      form.target = frameName;
      form.enctype = 'application/x-www-form-urlencoded';
      form.style.display = 'none';

      appendField(form, 'action', action);
      appendField(form, 'payload', JSON.stringify(payload));

      iframe.onload = () => {
        if (!submitted || settled) return;
        setTimeout(() => cleanup(null, { success: true, submitted: true }), 500);
      };

      function cleanup(err, data) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (form.parentNode) form.parentNode.removeChild(form);
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        if (err) reject(err); else resolve(data);
      }

      document.body.appendChild(iframe);
      document.body.appendChild(form);
      submitted = true;
      form.submit();
    });
  }

  function appendField(form, name, value) {
    const field = document.createElement('textarea');
    field.name = name;
    field.value = value;
    form.appendChild(field);
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
