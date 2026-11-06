'use strict';

/* Личный кабинет образовательной организации. */

const state = {
  today: null,
  report: null,
};

const els = {
  loadingView: document.getElementById('loadingView'),
  loginView: document.getElementById('loginView'),
  reportView: document.getElementById('reportView'),

  todayLabel: document.getElementById('todayLabel'),
  loginForm: document.getElementById('loginForm'),
  loginInput: document.getElementById('login'),
  passwordInput: document.getElementById('password'),
  loginSubmit: document.getElementById('loginSubmit'),
  loginError: document.getElementById('loginError'),

  schoolName: document.getElementById('schoolName'),
  reportDate: document.getElementById('reportDate'),
  reportStatus: document.getElementById('reportStatus'),
  reportForm: document.getElementById('reportForm'),
  reportSubmit: document.getElementById('reportSubmit'),
  reportSuccess: document.getElementById('reportSuccess'),
  successDate: document.getElementById('successDate'),
  reportError: document.getElementById('reportError'),
  logoutBtn: document.getElementById('logoutBtn'),

  primaryHot: document.getElementById('primaryHot'),
  beneficiaries: document.getElementById('beneficiaries'),
  paying: document.getElementById('paying'),
};

const REPORT_INPUTS = [
  { key: 'primaryHot', element: els.primaryHot, label: 'Ученики начальных классов с горячим питанием' },
  { key: 'beneficiaries', element: els.beneficiaries, label: 'Льготники' },
  { key: 'paying', element: els.paying, label: 'Плательщики' },
];

/* ------------------------------------------------------------- Вспомогательные */

function show(element) {
  element.hidden = false;
}

function hide(element) {
  element.hidden = true;
}

function formatDateRu(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ''))) return '—';

  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function setButtonBusy(button, busy, busyText, idleText) {
  if (busy) {
    button.dataset.idleText = button.textContent;
    button.disabled = true;
    button.textContent = busyText;
  } else {
    button.disabled = false;
    button.textContent = idleText || button.dataset.idleText || button.textContent;
  }
}

function showMessage(element, message) {
  element.textContent = message;
  element.hidden = false;
}

function hideMessage(element) {
  element.textContent = '';
  element.hidden = true;
}

function clearInvalidState() {
  for (const field of REPORT_INPUTS) {
    field.element.removeAttribute('aria-invalid');
  }
}

async function api(url, options = {}) {
  const headers = {
    Accept: 'application/json',
    ...(options.headers || {}),
  };

  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  let response;

  try {
    response = await fetch(url, {
      ...options,
      headers,
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch {
    const networkError = new Error(
      'Нет связи с сервером. Проверьте подключение и обновите страницу.'
    );
    networkError.status = 0;
    throw networkError;
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

  return data;
}

/* ------------------------------------------------------------------ Отображение */

function showLogin(today) {
  hide(els.loadingView);
  hide(els.reportView);
  show(els.loginView);

  els.todayLabel.textContent = formatDateRu(today || state.today);
}

function fillReportInputs(report) {
  els.primaryHot.value = String(report.primaryHot);
  els.beneficiaries.value = String(report.beneficiaries);
  els.paying.value = String(report.paying);
}

function lockReport(report) {
  fillReportInputs(report);
  clearInvalidState();

  for (const field of REPORT_INPUTS) {
    field.element.disabled = true;
  }

  els.reportSubmit.disabled = true;
  els.reportSubmit.textContent = 'Отчёт за сегодня уже сдан';

  els.reportStatus.className = 'status status_value_ok';
  els.reportStatus.textContent = 'Сдан';

  els.successDate.textContent = formatDateRu(state.today);
  show(els.reportSuccess);
  hideMessage(els.reportError);
}

function unlockReport() {
  for (const field of REPORT_INPUTS) {
    field.element.disabled = false;
  }

  els.reportSubmit.disabled = false;
  els.reportSubmit.textContent = 'Отправить отчёт за сегодня';

  els.reportStatus.className = 'status status_value_pending';
  els.reportStatus.textContent = 'Не сдан';
  hide(els.reportSuccess);
}

function renderReport(data) {
  state.today = data.today;
  state.report = data.report;

  els.schoolName.textContent = data.school.name;
  els.reportDate.textContent = formatDateRu(data.today);
  els.todayLabel.textContent = formatDateRu(data.today);

  if (data.report) {
    lockReport(data.report);
  } else {
    els.reportForm.reset();
    clearInvalidState();
    unlockReport();
  }

  hide(els.loginView);
  hide(els.loadingView);
  show(els.reportView);
}

async function loadSession() {
  const data = await api('/api/auth/me');

  if (data.today) {
    state.today = data.today;
  }

  if (data.authenticated) {
    renderReport(data);
  } else {
    state.report = null;
    showLogin(data.today);
  }
}

/* ---------------------------------------------------------------------- Вход */

els.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideMessage(els.loginError);

  const login = els.loginInput.value.trim();
  const password = els.passwordInput.value;

  if (!login || !password) {
    showMessage(els.loginError, 'Введите логин и пароль.');
    (login ? els.passwordInput : els.loginInput).focus();
    return;
  }

  setButtonBusy(els.loginSubmit, true, 'Проверка…');

  try {
    await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login, password }),
    });

    els.loginForm.reset();
    await loadSession();
  } catch (error) {
    showMessage(els.loginError, error.message);
    els.passwordInput.focus();
    els.passwordInput.select();
  } finally {
    setButtonBusy(els.loginSubmit, false, '', 'Войти в личный кабинет');
  }
});

els.loginInput.addEventListener('input', () => hideMessage(els.loginError));
els.passwordInput.addEventListener('input', () => hideMessage(els.loginError));

/* -------------------------------------------------------------------- Отчёт */

for (const field of REPORT_INPUTS) {
  field.element.addEventListener('input', () => {
    field.element.removeAttribute('aria-invalid');
    hideMessage(els.reportError);
  });
}

els.reportForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideMessage(els.reportError);
  clearInvalidState();

  const values = {};

  for (const field of REPORT_INPUTS) {
    const raw = field.element.value.trim();

    if (raw === '') {
      field.element.setAttribute('aria-invalid', 'true');
      field.element.focus();
      showMessage(els.reportError, `Заполните поле «${field.label}».`);
      return;
    }

    if (!/^\d+$/.test(raw)) {
      field.element.setAttribute('aria-invalid', 'true');
      field.element.focus();
      showMessage(
        els.reportError,
        `Поле «${field.label}» должно содержать целое неотрицательное число.`
      );
      return;
    }

    const value = Number(raw);

    if (!Number.isSafeInteger(value) || value > 100000) {
      field.element.setAttribute('aria-invalid', 'true');
      field.element.focus();
      showMessage(
        els.reportError,
        `Поле «${field.label}» должно быть целым числом от 0 до 100 000.`
      );
      return;
    }

    values[field.key] = value;
  }

  setButtonBusy(els.reportSubmit, true, 'Отправка…');

  try {
    const data = await api('/api/reports', {
      method: 'POST',
      body: JSON.stringify(values),
    });

    // Сервер возвращает фактическую дату отчёта: она могла измениться,
    // если пользователь отправил форму сразу после полуночи.
    state.today = data.report.date;
    state.report = data.report;
    els.reportDate.textContent = formatDateRu(state.today);
    els.todayLabel.textContent = formatDateRu(state.today);
    lockReport(data.report);
  } catch (error) {
    if (error.status === 401) {
      try {
        await loadSession();
      } catch {
        showMessage(
          els.reportError,
          'Сессия завершена. Войдите в личный кабинет заново.'
        );
      }
      return;
    }

    if (error.status === 409) {
      try {
        await loadSession();
        return;
      } catch {
        // Ниже покажем исходный текст ошибки.
      }
    }

    showMessage(els.reportError, error.message);
    els.reportSubmit.disabled = false;
    els.reportSubmit.textContent = 'Отправить отчёт за сегодня';
  }
});

/* --------------------------------------------------------------------- Выход */

els.logoutBtn.addEventListener('click', async () => {
  els.logoutBtn.disabled = true;
  els.logoutBtn.textContent = 'Выход…';

  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch {
    // Даже при сетевой ошибке возвращаем пользователя к форме входа.
  } finally {
    state.report = null;
    els.reportForm.reset();
    clearInvalidState();
    unlockReport();
    hideMessage(els.reportError);
    showLogin(state.today);
    els.logoutBtn.disabled = false;
    els.logoutBtn.textContent = 'Выйти';
    els.loginInput.focus();
  }
});

/* ------------------------------------------------------------------- Запуск */

(async function init() {
  try {
    await loadSession();
  } catch (error) {
    showLogin();
    showMessage(els.loginError, error.message);
  }
})();
