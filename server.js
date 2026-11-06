'use strict';

const path = require('node:path');
const express = require('express');
const session = require('express-session');

const {
  db,
  APP_TIMEZONE,
  getTodayIso,
  findSchoolByLogin,
  findSchoolById,
  verifyPassword,
  getReportForDate,
  createReport,
  listSchoolsWithReports,
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

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

/** Приведение строки отчёта к виду, удобному для фронтенда. */
function toPublicReport(row) {
  if (!row) return null;

  return {
    id: row.id,
    date: row.report_date,
    primaryHot: row.primary_hot_meals,
    beneficiaries: row.beneficiaries,
    paying: row.paying,
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

function requireSchool(req, res, next) {
  const schoolId = req.session.schoolId;

  if (!schoolId) {
    return res
      .status(401)
      .json({ error: 'Сессия не найдена. Войдите в личный кабинет.' });
  }

  const school = findSchoolById(schoolId);

  if (!school) {
    req.session.destroy(() => {});
    return res
      .status(401)
      .json({ error: 'Учреждение не найдено. Войдите в систему заново.' });
  }

  req.school = school;
  next();
}

// ---------------------------------------------------------------- Авторизация

app.post('/api/auth/login', (req, res, next) => {
  const login =
    typeof req.body?.login === 'string'
      ? req.body.login.trim().toLowerCase()
      : '';
  const password =
    typeof req.body?.password === 'string' ? req.body.password : '';

  if (!login || !password) {
    return res
      .status(400)
      .json({ error: 'Введите логин и пароль.' });
  }

  if (login.length > 100 || password.length > 200) {
    return res.status(400).json({ error: 'Слишком длинный логин или пароль.' });
  }

  const school = findSchoolByLogin(login);

  if (!school || !verifyPassword(password, school.password)) {
    return res.status(401).json({ error: 'Неверный логин или пароль.' });
  }

  // Пересоздаём сессию после успешного входа (защита от session fixation).
  req.session.regenerate((regenerateError) => {
    if (regenerateError) return next(regenerateError);

    req.session.schoolId = school.id;
    req.session.save((saveError) => {
      if (saveError) return next(saveError);

      res.json({
        ok: true,
        school: { id: school.id, name: school.name },
      });
    });
  });
});

app.post('/api/auth/logout', (req, res, next) => {
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

  if (!req.session.schoolId) {
    return res.json({ authenticated: false, today });
  }

  const school = findSchoolById(req.session.schoolId);

  if (!school) {
    req.session.destroy(() => {});
    return res.json({ authenticated: false, today });
  }

  const report = getReportForDate(school.id, today);

  res.json({
    authenticated: true,
    today,
    school: { id: school.id, name: school.name },
    report: toPublicReport(report),
  });
});

// -------------------------------------------------------------------- Отчёты

app.post('/api/reports', requireSchool, (req, res, next) => {
  const date = getTodayIso();
  const values = parseReportValues(req.body);

  if (values.error) {
    return res.status(400).json({ error: values.error });
  }

  // Дубликат за одни сутки отсекается и здесь, и ограничением UNIQUE в SQLite.
  if (getReportForDate(req.school.id, date)) {
    return res.status(409).json({
      error: 'Отчёт за сегодня уже сдан. Повторная отправка невозможна.',
    });
  }

  try {
    const report = createReport({
      schoolId: req.school.id,
      date,
      primaryHot: values.primaryHot,
      beneficiaries: values.beneficiaries,
      paying: values.paying,
    });

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

app.get('/api/admin/today', (req, res) => {
  const date = getTodayIso();
  const rows = listSchoolsWithReports(date);

  const schools = rows.map((row) => ({
    id: row.id,
    name: row.name,
    report: row.report_id
      ? {
          primaryHot: row.primary_hot_meals,
          beneficiaries: row.beneficiaries,
          paying: row.paying,
        }
      : null,
  }));

  res.json({ date, timezone: APP_TIMEZONE, schools });
});

// ---------------------------------------------------------------- Страницы

app.get(['/admin', '/admin/'], (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

app.get('/admin.html', (req, res) => {
  res.redirect(301, '/admin');
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
