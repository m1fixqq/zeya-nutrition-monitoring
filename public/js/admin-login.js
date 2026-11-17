'use strict';

/* Вход в административную панель. */

const els = {
  form: document.getElementById('adminLoginForm'),
  login: document.getElementById('adminLogin'),
  password: document.getElementById('adminPassword'),
  submit: document.getElementById('adminLoginSubmit'),
  error: document.getElementById('adminLoginError'),
};

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = false;
}

function hideError() {
  els.error.textContent = '';
  els.error.hidden = true;
}

function setButtonBusy(busy, text) {
  els.submit.disabled = busy;
  els.submit.textContent = busy ? text : 'Войти в панель управления';
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function api(url, options = {}, attempt = 0) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = {
    Accept: 'application/json',
    ...(options.headers || {}),
  };

  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  let response;

  try {
    response = await fetch(url, {
      ...options,
      headers,
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    });
  } catch (error) {
    if (method === 'GET' && attempt < 1) {
      await delay(500 * (attempt + 1));
      return api(url, options, attempt + 1);
    }

    const networkError = new Error(
      error.name === 'AbortError'
        ? 'Сервер не ответил вовремя. Проверьте подключение и повторите попытку.'
        : 'Нет связи с сервером. Проверьте подключение и обновите страницу.'
    );
    networkError.status = 0;
    throw networkError;
  } finally {
    window.clearTimeout(timeout);
  }

  let data = null;

  try {
    data = await response.json();
  } catch {
    // Ответ может быть пустым или не содержать JSON.
  }

  if (!response.ok) {
    const requestError = new Error(
      (data && data.error) || 'Не удалось выполнить запрос. Попробуйте ещё раз.'
    );
    requestError.status = response.status;
    throw requestError;
  }

  if (data === null) {
    const emptyError = new Error(
      'Сервер вернул пустой ответ. Обновите страницу и повторите попытку.'
    );
    emptyError.status = response.status;
    throw emptyError;
  }

  return data;
}

els.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideError();

  const login = els.login.value.trim();
  const password = els.password.value;

  if (!login || !password) {
    showError('Введите логин и пароль.');
    (login ? els.password : els.login).focus();
    return;
  }

  setButtonBusy(true, 'Проверка…');

  try {
    await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ login, password }),
    });

    window.location.href = '/admin/manage';
  } catch (error) {
    showError(error.message);
    els.password.focus();
    els.password.select();
    setButtonBusy(false);
  }
});

els.login.addEventListener('input', hideError);
els.password.addEventListener('input', hideError);

(async function init() {
  try {
    const data = await api('/api/auth/me');

    if (data && data.authenticated && data.user && data.user.role === 'admin') {
      window.location.href = '/admin/manage';
    }
  } catch {
    // Если проверка сессии не удалась, форма входа остаётся доступной.
  }
})();
