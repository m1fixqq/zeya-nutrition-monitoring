'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const session = require('express-session');

const {
  db,
  APP_TIMEZONE,
  getTodayIso,
  findUserByLogin,
  findUserById,
  listUsers,
  listSchoolUsers,
  createUser,
  updateUser,
  deleteUser,
  countUserReports,
  countActiveAdmins,
  verifyPassword,
  getReportForDate,
  getReportById,
  reportExists,
  createReport,
  updateReport,
  deleteReport,
  listReports,
  listSchoolsWithReports,
  addAuditLog,
  listAuditLog,
  getStats,
  checkDatabaseIntegrity,
  createBackupFile,
} = require('./database');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const PUBLIC_DIR = path.join(__dirname, 'public');

const SESSION_SECRET =
  process.env.SESSION_SECRET || 'zeya-nutrition-dev-secret-change-in-production';

if (IS_PRODUCTION && !process.env.SESSION_SECRET) {
  console.warn(
    '[ВНИМАНИЕ] Переменная SESSION_SECRET не задана. Используется значение по умолчанию.'
  );
}

app.disable('x-powered-by');
app.set('trust proxy', 1);

// Базовые защитные заголовки. CSP запрещает inline-скрипты и inline-стили.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=()'
  );
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  );
  if (IS_PRODUCTION) {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=15552000; includeSubDomains'
    );
  }
  next();
});

app.use(express.json({ limit: '16kb' }));

app.use(
  session({
    name: 'zeya.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PRODUCTION,
      maxAge: 8 * 60 * 60 * 1000, // 8 часов
    },
  })
);

// Загружаем пользователя из сессии для проверки ролей и активности.
app.use((req, res, next) => {
  const userId = req.session ? req.session.userId : null;

  if (!userId) return next();

  const user = findUserById(userId);

  if (user && user.isActive) {
    req.currentUser = user;
  } else {
    delete req.session.userId;
  }

  next();
});

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

/* --------------------------------------------------------------- Вспомогательные */

function toPublicReport(row) {
  if (!row) return null;

  return {
    id: Number(row.id),
    date: row.report_date,
    primaryHot: Number(row.primary_hot_meals),
    beneficiaries: Number(row.beneficiaries),
    paying: Number(row.paying),
  };
}

function toAdminReport(row) {
  if (!row) return null;

  return {
    id: Number(row.id),
    schoolId: Number(row.school_id),
    schoolName: row.school_name,
    date: row.report_date,
    primaryHot: Number(row.primary_hot_meals),
    beneficiaries: Number(row.beneficiaries),
    paying: Number(row.paying),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const REPORT_FIELDS = [
  ['primaryHot', 'Ученики начальных классов с горячим питанием'],
  ['beneficiaries', 'Льготники'],
  ['paying', 'Плательщики'],
];

/** Проверка и нормализация трёх числовых показателей отчёта. */
function parseReportValues(body) {
  if (!body || typeof body !== 'object') {
    return { error: 'Некорректные данные запроса.' };
  }

  const values = {};

  for (const [key, label] of REPORT_FIELDS) {
    const raw = body[key];

    if (raw === undefined || raw === null || raw === '') {
      return { error: `Заполните поле «${label}».` };
    }

    if (typeof raw === 'string' && raw.trim() === '') {
      return { error: `Заполните поле «${label}».` };
    }

    const value = typeof raw === 'number' ? raw : Number(String(raw).trim());

    if (!Number.isInteger(value) || value < 0 || value > 100000) {
      return {
        error: `Поле «${label}» должно быть целым числом от 0 до 100 000.`,
      };
    }

    values[key] = value;
  }

  return values;
}

function parseDate(value) {
  const text = typeof value === 'string' ? value.trim() : '';

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;

  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return text;
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseUserPayload(body, { requirePassword }) {
  if (!body || typeof body !== 'object') {
    return { error: 'Некорректные данные запроса.' };
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const login =
    typeof body.login === 'string' ? body.login.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const role = body.role === 'admin' || body.role === 'school' ? body.role : '';
  const isActive = body.isActive === undefined ? true : Boolean(body.isActive);

  if (!name || name.length > 200) {
    return { error: 'Укажите название организации или имя пользователя.' };
  }

  if (!/^[a-z0-9_-]{3,50}$/.test(login)) {
    return {
      error:
        'Логин: от 3 до 50 символов, латиница, цифры, дефис или подчёркивание.',
    };
  }

  if (requirePassword && password.length < 6) {
    return { error: 'Пароль должен содержать не менее 6 символов.' };
  }

  if (password && password.length < 6) {
    return { error: 'Пароль должен содержать не менее 6 символов.' };
  }

  if (password.length > 200) {
    return { error: 'Пароль слишком длинный.' };
  }

  if (!role) {
    return { error: 'Выберите роль пользователя.' };
  }

  return { name, login, password, role, isActive };
}

function requireSchool(req, res, next) {
  if (!req.currentUser) {
    return res
      .status(401)
      .json({ error: 'Сессия не найдена. Войдите в личный кабинет.' });
  }

  if (req.currentUser.role !== 'school') {
    return res.status(403).json({ error: 'Недостаточно прав.' });
  }

  next();
}

function requireAdmin(req, res, next) {
  if (!req.currentUser) {
    return res
      .status(401)
      .json({ error: 'Сессия не найдена. Войдите в панель управления.' });
  }

  if (req.currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Недостаточно прав.' });
  }

  next();
}

function logAction(req, action, entity, entityId, details) {
  const user = req.currentUser;

  addAuditLog({
    userId: user ? user.id : null,
    userName: user ? user.name : 'Гость',
    action,
    entity,
    entityId: entityId || null,
    details: details || '',
  });
}

/* --------------------------------------------------------------- Ограничение входа */

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function loginKey(req, login) {
  return `${req.ip || 'unknown'}:${String(login || '').toLowerCase()}`;
}

function isLoginLimited(key) {
  const entry = loginAttempts.get(key);

  if (!entry) return false;

  if (Date.now() - entry.startedAt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
    return false;
  }

  return entry.count >= LOGIN_MAX_ATTEMPTS;
}

function registerFailedLogin(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key);

  if (!entry || now - entry.startedAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { startedAt: now, count: 1 });
    return;
  }

  entry.count += 1;
}

function clearLoginAttempts(key) {
  loginAttempts.delete(key);
}

function createLoginHandler(requiredRole) {
  return (req, res, next) => {
    const login =
      typeof req.body?.login === 'string'
        ? req.body.login.trim().toLowerCase()
        : '';
    const password =
      typeof req.body?.password === 'string' ? req.body.password : '';

    if (!login || !password) {
      return res.status(400).json({ error: 'Введите логин и пароль.' });
    }

    if (login.length > 100 || password.length > 200) {
      return res
        .status(400)
        .json({ error: 'Слишком длинный логин или пароль.' });
    }

    const key = loginKey(req, login);

    if (isLoginLimited(key)) {
      return res.status(429).json({
        error: 'Слишком много попыток входа. Повторите через 15 минут.',
      });
    }

    const user = findUserByLogin(login);
    const valid =
      user &&
      user.role === requiredRole &&
      user.isActive &&
      verifyPassword(password, user.password);

    if (!valid) {
      registerFailedLogin(key);

      addAuditLog({
        userName: login,
        action: 'login_failed',
        entity: 'auth',
        details:
          requiredRole === 'admin'
            ? 'Неудачный вход в панель управления'
            : 'Неудачный вход в личный кабинет',
      });

      return res.status(401).json({ error: 'Неверный логин или пароль.' });
    }

    clearLoginAttempts(key);

    // Пересоздаём сессию после успешного входа (защита от session fixation).
    req.session.regenerate((regenerateError) => {
      if (regenerateError) return next(regenerateError);

      req.session.userId = user.id;
      req.session.role = user.role;

      req.session.save((saveError) => {
        if (saveError) return next(saveError);

        addAuditLog({
          userId: user.id,
          userName: user.name,
          action: 'login',
          entity: 'auth',
          details:
            requiredRole === 'admin'
              ? 'Вход в панель управления'
              : 'Вход в личный кабинет',
        });

        res.json({
          ok: true,
          user: { id: user.id, name: user.name, role: user.role },
        });
      });
    });
  };
}

/* ---------------------------------------------------------------- Авторизация */

app.post('/api/auth/login', createLoginHandler('school'));
app.post('/api/admin/login', createLoginHandler('admin'));

app.post('/api/auth/logout', (req, res, next) => {
  const user = req.currentUser;

  if (user) {
    addAuditLog({
      userId: user.id,
      userName: user.name,
      action: 'logout',
      entity: 'auth',
      details: 'Выход из системы',
    });
  }

  if (!req.session) {
    res.clearCookie('zeya.sid', { path: '/' });
    return res.json({ ok: true });
  }

  req.session.destroy((error) => {
    if (error) return next(error);

    res.clearCookie('zeya.sid', { path: '/' });
    res.json({ ok: true });
  });
});

app.get('/api/auth/me', (req, res) => {
  const today = getTodayIso();
  const user = req.currentUser;

  if (!user) {
    return res.json({ authenticated: false, today, timezone: APP_TIMEZONE });
  }

  const payload = {
    authenticated: true,
    today,
    timezone: APP_TIMEZONE,
    user: { id: user.id, name: user.name, role: user.role },
  };

  if (user.role === 'school') {
    payload.school = { id: user.id, name: user.name };
    payload.report = toPublicReport(getReportForDate(user.id, today));
  }

  res.json(payload);
});

// -------------------------------------------------------------------- Отчёты

app.post('/api/reports', requireSchool, (req, res, next) => {
  const date = getTodayIso();
  const values = parseReportValues(req.body);

  if (values.error) {
    return res.status(400).json({ error: values.error });
  }

  // Дубликат за одни сутки отсекается и здесь, и ограничением UNIQUE в SQLite.
  if (getReportForDate(req.currentUser.id, date)) {
    return res.status(409).json({
      error: 'Отчёт за сегодня уже сдан. Повторная отправка невозможна.',
    });
  }

  try {
    const report = createReport({
      schoolId: req.currentUser.id,
      date,
      primaryHot: values.primaryHot,
      beneficiaries: values.beneficiaries,
      paying: values.paying,
    });

    logAction(
      req,
      'report_create',
      'report',
      report.id,
      `Отчёт за ${date}: ${values.primaryHot}, ${values.beneficiaries}, ${values.paying}`
    );

    res.status(201).json({
      ok: true,
      report: toPublicReport(report),
    });
  } catch (error) {
    if (String(error.message).includes('UNIQUE constraint failed')) {
      return res.status(409).json({
        error: 'Отчёт за сегодня уже сдан. Повторная отправка невозможна.',
      });
    }
    next(error);
  }
});

// --------------------------------------------------------- Панель управления

// Публичная сводка за текущую дату (по исходному ТЗ — без пароля).
app.get('/api/admin/today', (req, res) => {
  const date = getTodayIso();
  const rows = listSchoolsWithReports(date);

  const schools = rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    report: row.report_id
      ? {
          id: Number(row.report_id),
          primaryHot: Number(row.primary_hot_meals),
          beneficiaries: Number(row.beneficiaries),
          paying: Number(row.paying),
        }
      : null,
  }));

  res.json({ date, timezone: APP_TIMEZONE, schools });
});

/* ------------------------------------------------------- Административные API */

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  res.json(getStats());
});

app.get('/api/admin/schools', requireAdmin, (req, res) => {
  res.json({ schools: listSchoolUsers() });
});

app.get('/api/admin/reports', requireAdmin, (req, res) => {
  const from = req.query.from ? parseDate(req.query.from) : '';
  const to = req.query.to ? parseDate(req.query.to) : '';
  const schoolId = req.query.schoolId ? parseId(req.query.schoolId) : 0;
  const query =
    typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';

  if (req.query.from && !from) {
    return res.status(400).json({ error: 'Некорректная дата начала.' });
  }

  if (req.query.to && !to) {
    return res.status(400).json({ error: 'Некорректная дата окончания.' });
  }

  if (req.query.schoolId && !schoolId) {
    return res.status(400).json({ error: 'Некорректное учреждение.' });
  }

  const reports = listReports({
    from,
    to,
    schoolId: schoolId || 0,
    query,
  }).map((row) => toAdminReport(row));

  res.json({ reports });
});

app.post('/api/admin/reports', requireAdmin, (req, res, next) => {
  const schoolId = parseId(req.body?.schoolId);
  const date = parseDate(req.body?.date);
  const values = parseReportValues(req.body);

  if (!schoolId) {
    return res.status(400).json({ error: 'Выберите учреждение.' });
  }

  if (!date) {
    return res.status(400).json({ error: 'Укажите корректную дату отчёта.' });
  }

  if (values.error) {
    return res.status(400).json({ error: values.error });
  }

  const school = findUserById(schoolId);

  if (!school || school.role !== 'school') {
    return res.status(400).json({ error: 'Учреждение не найдено.' });
  }

  if (reportExists(schoolId, date)) {
    return res.status(409).json({
      error: 'Отчёт этого учреждения за указанную дату уже существует.',
    });
  }

  try {
    const report = createReport({
      schoolId,
      date,
      primaryHot: values.primaryHot,
      beneficiaries: values.beneficiaries,
      paying: values.paying,
    });

    logAction(
      req,
      'report_create',
      'report',
      report.id,
      `Создан отчёт: ${school.name}, ${date}`
    );

    res.status(201).json({ ok: true, report: toAdminReport(report) });
  } catch (error) {
    if (String(error.message).includes('UNIQUE constraint failed')) {
      return res.status(409).json({
        error: 'Отчёт этого учреждения за указанную дату уже существует.',
      });
    }
    next(error);
  }
});

app.put('/api/admin/reports/:id', requireAdmin, (req, res, next) => {
  const id = parseId(req.params.id);
  const existing = id ? getReportById(id) : null;

  if (!existing) {
    return res.status(404).json({ error: 'Отчёт не найден.' });
  }

  const schoolId = parseId(req.body?.schoolId);
  const date = parseDate(req.body?.date);
  const values = parseReportValues(req.body);

  if (!schoolId) {
    return res.status(400).json({ error: 'Выберите учреждение.' });
  }

  if (!date) {
    return res.status(400).json({ error: 'Укажите корректную дату отчёта.' });
  }

  if (values.error) {
    return res.status(400).json({ error: values.error });
  }

  const school = findUserById(schoolId);

  if (!school || school.role !== 'school') {
    return res.status(400).json({ error: 'Учреждение не найдено.' });
  }

  if (reportExists(schoolId, date, id)) {
    return res.status(409).json({
      error: 'Отчёт этого учреждения за указанную дату уже существует.',
    });
  }

  try {
    const report = updateReport(id, {
      schoolId,
      date,
      primaryHot: values.primaryHot,
      beneficiaries: values.beneficiaries,
      paying: values.paying,
    });

    logAction(
      req,
      'report_update',
      'report',
      id,
      `Изменён отчёт: ${school.name}, ${date}`
    );

    res.json({ ok: true, report: toAdminReport(report) });
  } catch (error) {
    if (String(error.message).includes('UNIQUE constraint failed')) {
      return res.status(409).json({
        error: 'Отчёт этого учреждения за указанную дату уже существует.',
      });
    }
    next(error);
  }
});

app.delete('/api/admin/reports/:id', requireAdmin, (req, res) => {
  const id = parseId(req.params.id);
  const existing = id ? getReportById(id) : null;

  if (!existing) {
    return res.status(404).json({ error: 'Отчёт не найден.' });
  }

  deleteReport(id);

  logAction(
    req,
    'report_delete',
    'report',
    id,
    `Удалён отчёт: ${existing.school_name}, ${existing.report_date}`
  );

  res.json({ ok: true });
});

app.get('/api/admin/reports/export', requireAdmin, (req, res) => {
  const from = req.query.from ? parseDate(req.query.from) : '';
  const to = req.query.to ? parseDate(req.query.to) : '';
  const schoolId = req.query.schoolId ? parseId(req.query.schoolId) : 0;
  const query =
    typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';

  const rows = listReports({
    from: from || '',
    to: to || '',
    schoolId: schoolId || 0,
    query,
  });

  const escapeCsv = (value) => {
    const text = String(value === null || value === undefined ? '' : value);
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };

  const header = [
    'ID',
    'Дата',
    'Учреждение',
    'Начальные классы',
    'Льготники',
    'Плательщики',
  ];

  const lines = [header.map(escapeCsv).join(';')];

  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.report_date,
        row.school_name,
        row.primary_hot_meals,
        row.beneficiaries,
        row.paying,
      ]
        .map(escapeCsv)
        .join(';')
    );
  }

  logAction(
    req,
    'report_export',
    'report',
    null,
    `Выгрузка отчётов в CSV (${rows.length} записей)`
  );

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="reports-${getTodayIso()}.csv"`
  );
  res.send(`\uFEFF${lines.join('\r\n')}`);
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const query =
    typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';

  res.json({ users: listUsers(query) });
});

app.post('/api/admin/users', requireAdmin, (req, res, next) => {
  const payload = parseUserPayload(req.body, { requirePassword: true });

  if (payload.error) {
    return res.status(400).json({ error: payload.error });
  }

  try {
    const user = createUser(payload);

    logAction(
      req,
      'user_create',
      'user',
      user.id,
      `Создан пользователь «${user.name}» (${user.login})`
    );

    res.status(201).json({ ok: true, user });
  } catch (error) {
    if (String(error.message).includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Пользователь с таким логином уже существует.' });
    }
    next(error);
  }
});

app.put('/api/admin/users/:id', requireAdmin, (req, res, next) => {
  const id = parseId(req.params.id);
  const existing = id ? findUserById(id) : null;

  if (!existing) {
    return res.status(404).json({ error: 'Пользователь не найден.' });
  }

  const payload = parseUserPayload(req.body, { requirePassword: false });

  if (payload.error) {
    return res.status(400).json({ error: payload.error });
  }

  if (id === req.currentUser.id && (!payload.isActive || payload.role !== 'admin')) {
    return res.status(400).json({
      error: 'Нельзя изменить собственную роль или отключить свою учётную запись.',
    });
  }

  if (
    existing.role === 'admin' &&
    (payload.role !== 'admin' || !payload.isActive) &&
    countActiveAdmins() <= 1
  ) {
    return res.status(400).json({
      error: 'Нельзя отключить или понизить последнего администратора.',
    });
  }

  if (
    existing.role === 'school' &&
    payload.role !== 'school' &&
    countUserReports(id) > 0
  ) {
    return res.status(409).json({
      error: 'У учреждения есть отчёты. Нельзя изменить его роль.',
    });
  }

  try {
    const user = updateUser(id, payload);

    logAction(
      req,
      'user_update',
      'user',
      id,
      `Изменён пользователь «${user.name}» (${user.login})`
    );

    res.json({ ok: true, user });
  } catch (error) {
    if (String(error.message).includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Пользователь с таким логином уже существует.' });
    }
    next(error);
  }
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const id = parseId(req.params.id);
  const existing = id ? findUserById(id) : null;

  if (!existing) {
    return res.status(404).json({ error: 'Пользователь не найден.' });
  }

  if (id === req.currentUser.id) {
    return res.status(400).json({ error: 'Нельзя удалить собственную учётную запись.' });
  }

  if (existing.role === 'admin' && countActiveAdmins() <= 1) {
    return res.status(400).json({
      error: 'Нельзя удалить последнего администратора.',
    });
  }

  if (countUserReports(id) > 0) {
    return res.status(409).json({
      error: 'У пользователя есть отчёты. Сначала удалите или перенесите их.',
    });
  }

  deleteUser(id);

  logAction(
    req,
    'user_delete',
    'user',
    id,
    `Удалён пользователь «${existing.name}» (${existing.login})`
  );

  res.json({ ok: true });
});

app.get('/api/admin/audit', requireAdmin, (req, res) => {
  const query =
    typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const limit = Number(req.query.limit) || 200;

  res.json({ audit: listAuditLog({ query, limit }) });
});

app.get('/api/admin/integrity', requireAdmin, (req, res) => {
  const result = checkDatabaseIntegrity();

  logAction(
    req,
    'integrity_check',
    'database',
    null,
    result.ok ? 'Проверка целостности: ошибок не найдено' : 'Проверка целостности: обнаружены ошибки'
  );

  res.json(result);
});

app.get('/api/admin/backup', requireAdmin, (req, res, next) => {
  let file;

  try {
    logAction(
      req,
      'backup_download',
      'database',
      null,
      'Скачивание резервной копии базы данных'
    );

    file = createBackupFile();
  } catch (error) {
    return next(error);
  }

  res.download(
    file,
    `nutrition-backup-${getTodayIso()}.db`,
    (error) => {
      fs.rmSync(file, { force: true });

      if (error) {
        console.error('[Резервная копия]', error);
      }
    }
  );
});

/* ---------------------------------------------------------------------- Страницы */

app.get(['/admin', '/admin/'], (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

app.get('/admin/login', (req, res) => {
  if (req.currentUser && req.currentUser.role === 'admin') {
    return res.redirect('/admin/manage');
  }

  res.sendFile(path.join(PUBLIC_DIR, 'admin-login.html'));
});

app.get('/admin/manage', (req, res) => {
  if (!req.currentUser || req.currentUser.role !== 'admin') {
    return res.redirect('/admin/login');
  }

  res.sendFile(path.join(PUBLIC_DIR, 'admin-manage.html'));
});

app.get('/admin.html', (req, res) => {
  res.redirect(301, '/admin');
});

app.get('/admin-login.html', (req, res) => {
  res.redirect(301, '/admin/login');
});

app.get('/admin-manage.html', (req, res) => {
  res.redirect(301, '/admin/manage');
});

app.use(express.static(PUBLIC_DIR, { index: 'index.html' }));

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Метод API не найден.' });
});

app.use((req, res) => {
  res.status(404).type('text/plain; charset=utf-8').send('Страница не найдена.');
});

// ------------------------------------------------------------ Обработка ошибок

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  // Некорректный JSON или слишком большое тело запроса — ошибка клиента.
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Некорректный формат JSON в теле запроса.' });
  }

  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Слишком большой размер запроса.' });
  }

  console.error('[Ошибка сервера]', error);

  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: 'Внутренняя ошибка сервера.' });
  }

  res.status(500).type('text/plain; charset=utf-8').send('Внутренняя ошибка сервера.');
});

const server = app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
  console.log(`Панель отдела образования: http://localhost:${PORT}/admin`);
  console.log(`Управление: http://localhost:${PORT}/admin/login`);
  console.log(`Часовой пояс отчётной даты: ${APP_TIMEZONE}`);
});

function shutdown(signal) {
  console.log(`\nПолучен сигнал ${signal}. Завершение работы...`);

  server.close(() => {
    try {
      db.close();
    } catch (error) {
      console.error('Не удалось корректно закрыть базу данных:', error);
    }
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
