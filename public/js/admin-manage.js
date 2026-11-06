'use strict';

/* Административная панель: отчёты, пользователи, журнал, резервные копии. */

const state = {
  user: null,
  today: '',
  schools: [],
  reports: [],
  users: [],
  audit: [],
  reportEditingId: null,
  userEditingId: null,
};

const els = {
  adminName: document.getElementById('adminName'),
  adminLogout: document.getElementById('adminLogout'),
  manageError: document.getElementById('manageError'),

  statSchools: document.getElementById('statSchools'),
  statUsers: document.getElementById('statUsers'),
  statReports: document.getElementById('statReports'),
  statToday: document.getElementById('statToday'),

  tabs: [...document.querySelectorAll('.manage__tab')],
  sections: {
    reports: document.getElementById('sectionReports'),
    users: document.getElementById('sectionUsers'),
    audit: document.getElementById('sectionAudit'),
    backup: document.getElementById('sectionBackup'),
  },

  reportFilterForm: document.getElementById('reportFilterForm'),
  filterFrom: document.getElementById('filterFrom'),
  filterTo: document.getElementById('filterTo'),
  filterSchool: document.getElementById('filterSchool'),
  filterQuery: document.getElementById('filterQuery'),
  filterReset: document.getElementById('filterReset'),
  exportReports: document.getElementById('exportReports'),
  reportsBody: document.getElementById('reportsBody'),

  reportCreate: document.getElementById('reportCreate'),
  reportEditForm: document.getElementById('reportEditForm'),
  reportFormTitle: document.getElementById('reportFormTitle'),
  reportId: document.getElementById('reportId'),
  reportSchool: document.getElementById('reportSchool'),
  reportDate: document.getElementById('reportDate'),
  reportPrimaryHot: document.getElementById('reportPrimaryHot'),
  reportBeneficiaries: document.getElementById('reportBeneficiaries'),
  reportPaying: document.getElementById('reportPaying'),
  reportFormError: document.getElementById('reportFormError'),
  reportSave: document.getElementById('reportSave'),
  reportCancel: document.getElementById('reportCancel'),

  userFilterForm: document.getElementById('userFilterForm'),
  userQuery: document.getElementById('userQuery'),
  userReset: document.getElementById('userReset'),
  usersBody: document.getElementById('usersBody'),

  userCreate: document.getElementById('userCreate'),
  userEditForm: document.getElementById('userEditForm'),
  userFormTitle: document.getElementById('userFormTitle'),
  userId: document.getElementById('userId'),
  userName: document.getElementById('userName'),
  userLogin: document.getElementById('userLogin'),
  userPassword: document.getElementById('userPassword'),
  userRole: document.getElementById('userRole'),
  userActive: document.getElementById('userActive'),
  userFormError: document.getElementById('userFormError'),
  userSave: document.getElementById('userSave'),
  userCancel: document.getElementById('userCancel'),

  auditFilterForm: document.getElementById('auditFilterForm'),
  auditQuery: document.getElementById('auditQuery'),
  auditReset: document.getElementById('auditReset'),
  auditBody: document.getElementById('auditBody'),

  backupDownload: document.getElementById('backupDownload'),
  integrityCheck: document.getElementById('integrityCheck'),
  integrityResult: document.getElementById('integrityResult'),
};

const numberFormatter = new Intl.NumberFormat('ru-RU');

const ACTION_LABELS = {
  login: 'Вход в систему',
  login_failed: 'Неудачная попытка входа',
  logout: 'Выход из системы',
  report_create: 'Создание отчёта',
  report_update: 'Изменение отчёта',
  report_delete: 'Удаление отчёта',
  report_export: 'Выгрузка отчётов',
  user_create: 'Создание пользователя',
  user_update: 'Изменение пользователя',
  user_delete: 'Удаление пользователя',
  backup_download: 'Резервная копия',
  integrity_check: 'Проверка целостности',
};

const ROLE_LABELS = {
  admin: 'Администратор',
  school: 'Учреждение',
};

/* ------------------------------------------------------------- Вспомогательные */

function showError(message) {
  els.manageError.textContent = message;
  els.manageError.hidden = false;
}

function clearError() {
  els.manageError.textContent = '';
  els.manageError.hidden = true;
}

function showFormError(element, message) {
  element.textContent = message;
  element.hidden = false;
}

function hideFormError(element) {
  element.textContent = '';
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

function formatDateTime(value) {
  if (!value) return '—';

  const text = String(value);
  const normalized = text.includes('T')
    ? text
    : `${text.replace(' ', 'T')}Z`;
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) return text;

  return date.toLocaleString('ru-RU', {
    timeZone: 'Asia/Yakutsk',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatNumber(value) {
  return numberFormatter.format(value);
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

function createCell(text, className) {
  const cell = document.createElement('td');
  cell.className = className ? `admin-table__cell ${className}` : 'admin-table__cell';
  cell.textContent = text;
  return cell;
}

function createActionButton(action, id, label, danger = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = danger
    ? 'admin-table__action admin-table__action_type_danger'
    : 'admin-table__action';
  button.dataset.action = action;
  button.dataset.id = String(id);
  button.textContent = label;
  return button;
}

function createEmptyRow(colspan, text) {
  const row = document.createElement('tr');
  row.className = 'admin-table__row';

  const cell = document.createElement('td');
  cell.className = 'admin-table__cell admin-table__cell_type_empty';
  cell.colSpan = colspan;
  cell.textContent = text;

  row.appendChild(cell);
  return row;
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

function handleApiError(error) {
  if (error.status === 401) {
    window.location.href = '/admin/login';
    return;
  }

  showError(error.message);
}

/* ---------------------------------------------------------------------- Вкладки */

function setupTabs() {
  for (const tab of els.tabs) {
    tab.addEventListener('click', () => {
      const section = tab.dataset.section;

      for (const item of els.tabs) {
        item.classList.toggle(
          'manage__tab_state_active',
          item === tab
        );
      }

      for (const [name, element] of Object.entries(els.sections)) {
        element.hidden = name !== section;
      }
    });
  }
}

/* --------------------------------------------------------------------- Данные */

function fillSchoolSelects() {
  const currentFilter = els.filterSchool.value;

  els.filterSchool.replaceChildren();
  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = 'Все учреждения';
  els.filterSchool.appendChild(allOption);

  els.reportSchool.replaceChildren();

  for (const school of state.schools) {
    const filterOption = document.createElement('option');
    filterOption.value = String(school.id);
    filterOption.textContent = school.name;
    els.filterSchool.appendChild(filterOption);

    const formOption = document.createElement('option');
    formOption.value = String(school.id);
    formOption.textContent = school.name;
    els.reportSchool.appendChild(formOption);
  }

  els.filterSchool.value = currentFilter;
}

async function loadSchools() {
  const data = await api('/api/admin/schools');
  state.schools = data.schools;
  fillSchoolSelects();
}

async function loadStats() {
  const stats = await api('/api/admin/stats');

  els.statSchools.textContent = String(stats.schools);
  els.statUsers.textContent = String(stats.users);
  els.statReports.textContent = String(stats.reports);
  els.statToday.textContent = String(stats.todayReports);
}

function buildReportQuery() {
  const params = new URLSearchParams();

  if (els.filterFrom.value) params.set('from', els.filterFrom.value);
  if (els.filterTo.value) params.set('to', els.filterTo.value);
  if (els.filterSchool.value) params.set('schoolId', els.filterSchool.value);
  if (els.filterQuery.value.trim()) {
    params.set('q', els.filterQuery.value.trim());
  }

  return params;
}

function updateExportLink() {
  const params = buildReportQuery().toString();
  els.exportReports.href = params
    ? `/api/admin/reports/export?${params}`
    : '/api/admin/reports/export';
}

function renderReports() {
  els.reportsBody.replaceChildren();

  if (state.reports.length === 0) {
    els.reportsBody.appendChild(
      createEmptyRow(7, 'Отчёты не найдены.')
    );
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const report of state.reports) {
    const row = document.createElement('tr');
    row.className = 'admin-table__row';

    row.appendChild(createCell(String(report.id), 'admin-table__cell_type_index'));
    row.appendChild(createCell(formatDateRu(report.date), 'admin-table__cell_type_date'));
    row.appendChild(createCell(report.schoolName, 'admin-table__cell_type_name'));
    row.appendChild(createCell(formatNumber(report.primaryHot), 'admin-table__cell_type_number'));
    row.appendChild(createCell(formatNumber(report.beneficiaries), 'admin-table__cell_type_number'));
    row.appendChild(createCell(formatNumber(report.paying), 'admin-table__cell_type_number'));

    const actions = document.createElement('td');
    actions.className = 'admin-table__cell admin-table__cell_type_actions';
    actions.appendChild(createActionButton('edit', report.id, 'Изменить'));
    actions.appendChild(
      createActionButton('delete', report.id, 'Удалить', true)
    );
    row.appendChild(actions);

    fragment.appendChild(row);
  }

  els.reportsBody.appendChild(fragment);
}

async function loadReports() {
  const params = buildReportQuery();
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const data = await api(`/api/admin/reports${suffix}`);

  state.reports = data.reports;
  renderReports();
  updateExportLink();
}

function openReportForm(id = null) {
  hideFormError(els.reportFormError);
  els.reportEditForm.reset();
  state.reportEditingId = id;

  if (id) {
    const report = state.reports.find((item) => item.id === id);

    if (!report) {
      showError('Отчёт не найден в текущем списке.');
      return;
    }

    els.reportFormTitle.textContent = 'Редактирование отчёта';
    els.reportId.value = String(report.id);
    els.reportSchool.value = String(report.schoolId);
    els.reportDate.value = report.date;
    els.reportPrimaryHot.value = String(report.primaryHot);
    els.reportBeneficiaries.value = String(report.beneficiaries);
    els.reportPaying.value = String(report.paying);
  } else {
    els.reportFormTitle.textContent = 'Новый отчёт';
    els.reportId.value = '';
    els.reportDate.value = state.today;
    els.reportPrimaryHot.value = '';
    els.reportBeneficiaries.value = '';
    els.reportPaying.value = '';
  }

  els.reportEditForm.hidden = false;
  els.reportSchool.focus();
}

function closeReportForm() {
  els.reportEditForm.hidden = true;
  state.reportEditingId = null;
  hideFormError(els.reportFormError);
}

function readReportPayload() {
  const schoolId = Number(els.reportSchool.value);
  const date = els.reportDate.value;
  const rawValues = [
    els.reportPrimaryHot.value.trim(),
    els.reportBeneficiaries.value.trim(),
    els.reportPaying.value.trim(),
  ];

  if (!schoolId) {
    return { error: 'Выберите учреждение.' };
  }

  if (!date) {
    return { error: 'Укажите дату отчёта.' };
  }

  if (rawValues.some((value) => value === '' || !/^\d+$/.test(value))) {
    return { error: 'Все показатели должны быть целыми неотрицательными числами.' };
  }

  const values = rawValues.map(Number);

  if (values.some((value) => value > 100000)) {
    return { error: 'Показатели не должны превышать 100 000.' };
  }

  return {
    schoolId,
    date,
    primaryHot: values[0],
    beneficiaries: values[1],
    paying: values[2],
  };
}

async function saveReport(event) {
  event.preventDefault();
  hideFormError(els.reportFormError);

  const payload = readReportPayload();

  if (payload.error) {
    showFormError(els.reportFormError, payload.error);
    return;
  }

  setButtonBusy(els.reportSave, true, 'Сохранение…');

  try {
    const id = state.reportEditingId;

    await api(
      id ? `/api/admin/reports/${id}` : '/api/admin/reports',
      {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      }
    );

    closeReportForm();
    await Promise.all([loadReports(), loadStats(), loadAudit()]);
  } catch (error) {
    if (error.status === 401) {
      handleApiError(error);
      return;
    }
    showFormError(els.reportFormError, error.message);
  } finally {
    setButtonBusy(els.reportSave, false, '', 'Сохранить');
  }
}

async function removeReport(id) {
  const report = state.reports.find((item) => item.id === id);

  if (!report) return;

  const confirmed = window.confirm(
    `Удалить отчёт «${report.schoolName}» за ${formatDateRu(report.date)}?`
  );

  if (!confirmed) return;

  try {
    await api(`/api/admin/reports/${id}`, { method: 'DELETE' });
    await Promise.all([loadReports(), loadStats(), loadAudit()]);
  } catch (error) {
    handleApiError(error);
  }
}

/* ------------------------------------------------------------------ Пользователи */

function renderUsers() {
  els.usersBody.replaceChildren();

  if (state.users.length === 0) {
    els.usersBody.appendChild(
      createEmptyRow(7, 'Пользователи не найдены.')
    );
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const user of state.users) {
    const row = document.createElement('tr');
    row.className = 'admin-table__row';

    row.appendChild(createCell(String(user.id), 'admin-table__cell_type_index'));
    row.appendChild(createCell(user.name, 'admin-table__cell_type_name'));
    row.appendChild(createCell(user.login, 'admin-table__cell_type_login'));
    row.appendChild(createCell(ROLE_LABELS[user.role] || user.role, 'admin-table__cell_type_role'));

    const statusCell = document.createElement('td');
    statusCell.className = 'admin-table__cell admin-table__cell_type_status';
    const badge = document.createElement('span');
    badge.className = user.isActive
      ? 'status status_value_ok'
      : 'status status_value_missing';
    badge.textContent = user.isActive ? 'Активен' : 'Отключён';
    statusCell.appendChild(badge);
    row.appendChild(statusCell);

    row.appendChild(createCell(formatDateTime(user.createdAt), 'admin-table__cell_type_date'));

    const actions = document.createElement('td');
    actions.className = 'admin-table__cell admin-table__cell_type_actions';
    actions.appendChild(createActionButton('edit', user.id, 'Изменить'));
    actions.appendChild(
      createActionButton('delete', user.id, 'Удалить', true)
    );
    row.appendChild(actions);

    fragment.appendChild(row);
  }

  els.usersBody.appendChild(fragment);
}

async function loadUsers() {
  const query = els.userQuery.value.trim();
  const suffix = query ? `?q=${encodeURIComponent(query)}` : '';
  const data = await api(`/api/admin/users${suffix}`);

  state.users = data.users;
  renderUsers();
}

function openUserForm(id = null) {
  hideFormError(els.userFormError);
  els.userEditForm.reset();
  state.userEditingId = id;

  if (id) {
    const user = state.users.find((item) => item.id === id);

    if (!user) {
      showError('Пользователь не найден в текущем списке.');
      return;
    }

    els.userFormTitle.textContent = 'Редактирование пользователя';
    els.userId.value = String(user.id);
    els.userName.value = user.name;
    els.userLogin.value = user.login;
    els.userPassword.value = '';
    els.userPassword.required = false;
    els.userRole.value = user.role;
    els.userActive.checked = user.isActive;
  } else {
    els.userFormTitle.textContent = 'Новый пользователь';
    els.userId.value = '';
    els.userPassword.required = true;
    els.userRole.value = 'school';
    els.userActive.checked = true;
  }

  els.userEditForm.hidden = false;
  els.userName.focus();
}

function closeUserForm() {
  els.userEditForm.hidden = true;
  state.userEditingId = null;
  hideFormError(els.userFormError);
}

function readUserPayload() {
  const name = els.userName.value.trim();
  const login = els.userLogin.value.trim().toLowerCase();
  const password = els.userPassword.value;
  const role = els.userRole.value;
  const isActive = els.userActive.checked;

  if (!name) {
    return { error: 'Укажите название организации или имя пользователя.' };
  }

  if (!/^[a-z0-9_-]{3,50}$/.test(login)) {
    return {
      error:
        'Логин: от 3 до 50 символов, латиница, цифры, дефис или подчёркивание.',
    };
  }

  if (!state.userEditingId && password.length < 6) {
    return { error: 'Пароль должен содержать не менее 6 символов.' };
  }

  if (password && password.length < 6) {
    return { error: 'Пароль должен содержать не менее 6 символов.' };
  }

  return { name, login, password, role, isActive };
}

async function saveUser(event) {
  event.preventDefault();
  hideFormError(els.userFormError);

  const payload = readUserPayload();

  if (payload.error) {
    showFormError(els.userFormError, payload.error);
    return;
  }

  setButtonBusy(els.userSave, true, 'Сохранение…');

  try {
    const id = state.userEditingId;

    await api(
      id ? `/api/admin/users/${id}` : '/api/admin/users',
      {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      }
    );

    closeUserForm();
    await Promise.all([
      loadUsers(),
      loadSchools(),
      loadStats(),
      loadAudit(),
    ]);
  } catch (error) {
    if (error.status === 401) {
      handleApiError(error);
      return;
    }
    showFormError(els.userFormError, error.message);
  } finally {
    setButtonBusy(els.userSave, false, '', 'Сохранить');
  }
}

async function removeUser(id) {
  const user = state.users.find((item) => item.id === id);

  if (!user) return;

  const confirmed = window.confirm(
    `Удалить пользователя «${user.name}» (${user.login})?`
  );

  if (!confirmed) return;

  try {
    await api(`/api/admin/users/${id}`, { method: 'DELETE' });
    await Promise.all([
      loadUsers(),
      loadSchools(),
      loadStats(),
      loadAudit(),
    ]);
  } catch (error) {
    handleApiError(error);
  }
}

/* -------------------------------------------------------------------- Журнал */

function renderAudit() {
  els.auditBody.replaceChildren();

  if (state.audit.length === 0) {
    els.auditBody.appendChild(
      createEmptyRow(4, 'Записи журнала не найдены.')
    );
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const entry of state.audit) {
    const row = document.createElement('tr');
    row.className = 'admin-table__row';

    row.appendChild(createCell(formatDateTime(entry.createdAt), 'admin-table__cell_type_date'));
    row.appendChild(createCell(entry.userName, 'admin-table__cell_type_name'));
    row.appendChild(createCell(ACTION_LABELS[entry.action] || entry.action, 'admin-table__cell_type_role'));
    row.appendChild(createCell(entry.details || '—', 'admin-table__cell_type_details'));

    fragment.appendChild(row);
  }

  els.auditBody.appendChild(fragment);
}

async function loadAudit() {
  const query = els.auditQuery.value.trim();
  const params = new URLSearchParams();

  if (query) params.set('q', query);
  params.set('limit', '200');

  const data = await api(`/api/admin/audit?${params.toString()}`);

  state.audit = data.audit;
  renderAudit();
}

/* ------------------------------------------------------------- Целостность */

async function checkIntegrity() {
  setButtonBusy(els.integrityCheck, true, 'Проверка…');
  els.integrityResult.hidden = true;

  try {
    const result = await api('/api/admin/integrity');

    els.integrityResult.className = result.ok
      ? 'notice notice_type_success'
      : 'notice notice_type_error';
    els.integrityResult.textContent = result.ok
      ? 'Целостность базы данных: ошибок не найдено.'
      : 'Проверка целостности выявила ошибки. Требуется восстановление из резервной копии.';
    els.integrityResult.hidden = false;

    await loadAudit();
  } catch (error) {
    handleApiError(error);
  } finally {
    setButtonBusy(els.integrityCheck, false, '', 'Проверить целостность');
  }
}

/* -------------------------------------------------------------------- События */

function setupEvents() {
  setupTabs();

  els.reportFilterForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();

    try {
      await loadReports();
    } catch (error) {
      handleApiError(error);
    }
  });

  els.filterReset.addEventListener('click', async () => {
    els.reportFilterForm.reset();
    clearError();

    try {
      await loadReports();
    } catch (error) {
      handleApiError(error);
    }
  });

  els.reportCreate.addEventListener('click', () => openReportForm());
  els.reportCancel.addEventListener('click', closeReportForm);
  els.reportEditForm.addEventListener('submit', saveReport);

  els.reportsBody.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const id = Number(button.dataset.id);

    if (button.dataset.action === 'edit') {
      openReportForm(id);
    } else if (button.dataset.action === 'delete') {
      removeReport(id);
    }
  });

  els.userFilterForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();

    try {
      await loadUsers();
    } catch (error) {
      handleApiError(error);
    }
  });

  els.userReset.addEventListener('click', async () => {
    els.userFilterForm.reset();
    clearError();

    try {
      await loadUsers();
    } catch (error) {
      handleApiError(error);
    }
  });

  els.userCreate.addEventListener('click', () => openUserForm());
  els.userCancel.addEventListener('click', closeUserForm);
  els.userEditForm.addEventListener('submit', saveUser);

  els.usersBody.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const id = Number(button.dataset.id);

    if (button.dataset.action === 'edit') {
      openUserForm(id);
    } else if (button.dataset.action === 'delete') {
      removeUser(id);
    }
  });

  els.auditFilterForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();

    try {
      await loadAudit();
    } catch (error) {
      handleApiError(error);
    }
  });

  els.auditReset.addEventListener('click', async () => {
    els.auditFilterForm.reset();
    clearError();

    try {
      await loadAudit();
    } catch (error) {
      handleApiError(error);
    }
  });

  els.integrityCheck.addEventListener('click', checkIntegrity);

  els.backupDownload.addEventListener('click', () => {
    window.setTimeout(loadAudit, 1500);
  });

  els.adminLogout.addEventListener('click', async () => {
    setButtonBusy(els.adminLogout, true, 'Выход…');

    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // Даже при сетевой ошибке возвращаем пользователя к форме входа.
    } finally {
      window.location.href = '/admin/login';
    }
  });
}

/* -------------------------------------------------------------------- Запуск */

(async function init() {
  setupEvents();

  try {
    const data = await api('/api/auth/me');

    if (!data.authenticated || !data.user || data.user.role !== 'admin') {
      window.location.href = '/admin/login';
      return;
    }

    state.user = data.user;
    state.today = data.today;
    els.adminName.textContent = data.user.name;

    await loadSchools();
    await Promise.all([
      loadStats(),
      loadReports(),
      loadUsers(),
      loadAudit(),
    ]);
  } catch (error) {
    handleApiError(error);
  }
})();
