'use strict';

/**
 * Работа с базой данных SQLite.
 *
 * Используется встроенный в Node.js модуль `node:sqlite` (Node.js 24+),
 * поэтому отдельная нативная библиотека и компиляция не требуются.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Yakutsk';
const DB_PATH =
  process.env.DB_PATH || path.join(__dirname, 'data', 'nutrition.db');

// Пароли тестовых учреждений и администратора. В реальной эксплуатации
// их необходимо заменить и передавать каждому пользователю отдельно.
const DEFAULT_PASSWORD = 'school2026';
const DEFAULT_ADMIN_PASSWORD = 'admin2026';

// Перечень учреждений для первичного заполнения базы.
const SEED_SCHOOLS = [
  { name: 'МБОУ Сосновоборская СОШ', login: 'sosnovoborsk' },
  { name: 'МАОУ Береговая СОШ', login: 'beregovaya' },
  { name: 'МОАУ СОШ №1 города Зеи', login: 'school1' },
  { name: 'МОАУ СОШ №4', login: 'school4' },
  { name: 'Детский сад «Родничок»', login: 'rodnichok' },
];

const SEED_ADMIN = {
  name: 'Администратор отдела образования',
  login: 'admin',
  role: 'admin',
};

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS schools (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    login      TEXT NOT NULL UNIQUE,
    password   TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'school',
    is_active  INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reports (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id         INTEGER NOT NULL,
    report_date       TEXT NOT NULL,
    primary_hot_meals INTEGER NOT NULL DEFAULT 0
                      CHECK (primary_hot_meals BETWEEN 0 AND 100000),
    beneficiaries     INTEGER NOT NULL DEFAULT 0
                      CHECK (beneficiaries BETWEEN 0 AND 100000),
    paying            INTEGER NOT NULL DEFAULT 0
                      CHECK (paying BETWEEN 0 AND 100000),
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    UNIQUE (school_id, report_date)
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    user_name  TEXT NOT NULL,
    action     TEXT NOT NULL,
    entity     TEXT NOT NULL,
    entity_id  INTEGER,
    details    TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function columnExists(table, column) {
  const rows = db
    .prepare(`SELECT name FROM pragma_table_info('${table}')`)
    .all();
  return rows.some((row) => row.name === column);
}

function addColumn(table, column, definition) {
  if (!columnExists(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Миграции для баз, созданных предыдущей версией приложения.
 * Добавляются роли, признак активности, даты создания и обновления.
 */
function migrateDatabase() {
  addColumn('schools', 'role', "TEXT NOT NULL DEFAULT 'school'");
  addColumn('schools', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
  addColumn('schools', 'created_at', 'TEXT');
  addColumn('reports', 'created_at', 'TEXT');
  addColumn('reports', 'updated_at', 'TEXT');

  db.exec(`
    UPDATE schools SET role = 'school' WHERE role IS NULL OR role = '';
    UPDATE schools SET is_active = 1 WHERE is_active IS NULL;
    UPDATE schools SET created_at = datetime('now') WHERE created_at IS NULL;
    UPDATE reports SET created_at = datetime('now') WHERE created_at IS NULL;
    UPDATE reports SET updated_at = datetime('now') WHERE updated_at IS NULL;
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_reports_school_date
      ON reports (school_id, report_date);

    CREATE INDEX IF NOT EXISTS idx_schools_role
      ON schools (role, is_active);

    CREATE INDEX IF NOT EXISTS idx_audit_created
      ON audit_log (created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_audit_user
      ON audit_log (user_id);

    DROP VIEW IF EXISTS v_reports_full;

    CREATE VIEW v_reports_full AS
      SELECT
        r.id,
        r.school_id,
        s.name AS school_name,
        r.report_date,
        r.primary_hot_meals,
        r.beneficiaries,
        r.paying,
        r.created_at,
        r.updated_at
      FROM reports AS r
      JOIN schools AS s ON s.id = r.school_id;
  `);
}

/** Хеширование пароля в формате scrypt$соль$хеш. */
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

/** Проверка пароля без хранения открытого текста в базе. */
function verifyPassword(password, storedPassword) {
  const parts = String(storedPassword || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

  const [, salt, expectedHex] = parts;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = scryptSync(password, salt, 64);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Первичное заполнение базы учреждениями и администратором.
 * Добавляются только отсутствующие логины, поэтому повторный запуск
 * приложения не создаёт дубликаты и не сбрасывает пароли.
 */
function seedUsers() {
  const findByLogin = db.prepare('SELECT id FROM schools WHERE login = ?');
  const insert = db.prepare(
    'INSERT INTO schools (name, login, password, role) VALUES (?, ?, ?, ?)'
  );

  db.exec('BEGIN');
  try {
    for (const school of SEED_SCHOOLS) {
      if (!findByLogin.get(school.login)) {
        insert.run(
          school.name,
          school.login,
          hashPassword(DEFAULT_PASSWORD),
          'school'
        );
      }
    }

    if (!findByLogin.get(SEED_ADMIN.login)) {
      insert.run(
        SEED_ADMIN.name,
        SEED_ADMIN.login,
        hashPassword(DEFAULT_ADMIN_PASSWORD),
        'admin'
      );
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  db.prepare(
    "UPDATE schools SET role = 'admin', is_active = 1 WHERE login = ?"
  ).run(SEED_ADMIN.login);
}

function initializeDatabase() {
  migrateDatabase();
  seedUsers();
}

initializeDatabase();

/** Текущая дата отчёта в формате YYYY-MM-DD (часовой пояс Зеи). */
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function getTodayIso(date = new Date()) {
  return dateFormatter.format(date);
}

function mapUser(row) {
  if (!row) return null;

  return {
    id: Number(row.id),
    name: row.name,
    login: row.login,
    role: row.role,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
  };
}

const findUserByLoginStmt = db.prepare(`
  SELECT id, name, login, password, role, is_active, created_at
  FROM schools
  WHERE login = ?
`);

const findUserByIdStmt = db.prepare(`
  SELECT id, name, login, role, is_active, created_at
  FROM schools
  WHERE id = ?
`);

const listUsersStmt = db.prepare(`
  SELECT id, name, login, role, is_active, created_at
  FROM schools
  WHERE (? = '' OR name LIKE ? OR login LIKE ?)
  ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, name COLLATE NOCASE
`);

const listSchoolUsersStmt = db.prepare(`
  SELECT id, name
  FROM schools
  WHERE role = 'school' AND is_active = 1
  ORDER BY name COLLATE NOCASE
`);

const insertUserStmt = db.prepare(`
  INSERT INTO schools (name, login, password, role, is_active)
  VALUES (?, ?, ?, ?, ?)
`);

const updateUserStmt = db.prepare(`
  UPDATE schools
  SET name = ?, login = ?, role = ?, is_active = ?
  WHERE id = ?
`);

const updateUserWithPasswordStmt = db.prepare(`
  UPDATE schools
  SET name = ?, login = ?, role = ?, is_active = ?, password = ?
  WHERE id = ?
`);

const deleteUserStmt = db.prepare('DELETE FROM schools WHERE id = ?');

const countUserReportsStmt = db.prepare(
  'SELECT COUNT(*) AS n FROM reports WHERE school_id = ?'
);

const countActiveAdminsStmt = db.prepare(
  "SELECT COUNT(*) AS n FROM schools WHERE role = 'admin' AND is_active = 1"
);

const getReportForDateStmt = db.prepare(`
  SELECT id, school_id, report_date, primary_hot_meals, beneficiaries, paying
  FROM reports
  WHERE school_id = ? AND report_date = ?
`);

const getReportByIdStmt = db.prepare(`
  SELECT
    id,
    school_id,
    school_name,
    report_date,
    primary_hot_meals,
    beneficiaries,
    paying,
    created_at,
    updated_at
  FROM v_reports_full
  WHERE id = ?
`);

const reportExistsStmt = db.prepare(`
  SELECT id
  FROM reports
  WHERE school_id = ? AND report_date = ? AND id <> ?
`);

const insertReportStmt = db.prepare(`
  INSERT INTO reports
    (school_id, report_date, primary_hot_meals, beneficiaries, paying)
  VALUES (?, ?, ?, ?, ?)
`);

const updateReportStmt = db.prepare(`
  UPDATE reports
  SET
    school_id = ?,
    report_date = ?,
    primary_hot_meals = ?,
    beneficiaries = ?,
    paying = ?,
    updated_at = datetime('now')
  WHERE id = ?
`);

const deleteReportStmt = db.prepare('DELETE FROM reports WHERE id = ?');

const listReportsStmt = db.prepare(`
  SELECT
    id,
    school_id,
    school_name,
    report_date,
    primary_hot_meals,
    beneficiaries,
    paying,
    created_at,
    updated_at
  FROM v_reports_full
  WHERE (? = '' OR report_date >= ?)
    AND (? = '' OR report_date <= ?)
    AND (? = 0 OR school_id = ?)
    AND (
      ? = ''
      OR school_name LIKE ?
      OR report_date LIKE ?
      OR CAST(id AS TEXT) LIKE ?
    )
  ORDER BY report_date DESC, school_name COLLATE NOCASE ASC
`);

const listSchoolsWithReportsStmt = db.prepare(`
  SELECT
    s.id,
    s.name,
    r.id                AS report_id,
    r.primary_hot_meals,
    r.beneficiaries,
    r.paying
  FROM schools AS s
  LEFT JOIN reports AS r
    ON r.school_id = s.id AND r.report_date = ?
  WHERE s.role = 'school' AND s.is_active = 1
  ORDER BY s.id ASC
`);

const insertAuditStmt = db.prepare(`
  INSERT INTO audit_log
    (user_id, user_name, action, entity, entity_id, details)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const listAuditStmt = db.prepare(`
  SELECT id, user_id, user_name, action, entity, entity_id, details, created_at
  FROM audit_log
  WHERE (
    ? = ''
    OR user_name LIKE ?
    OR action LIKE ?
    OR details LIKE ?
  )
  ORDER BY id DESC
  LIMIT ?
`);

function findUserByLogin(login) {
  const row = findUserByLoginStmt.get(login);
  if (!row) return null;

  return {
    ...mapUser(row),
    password: row.password,
  };
}

function findUserById(id) {
  return mapUser(findUserByIdStmt.get(id));
}

function listUsers(query = '') {
  const like = `%${query}%`;
  return listUsersStmt
    .all(query, like, like)
    .map((row) => mapUser(row));
}

function listSchoolUsers() {
  return listSchoolUsersStmt.all().map((row) => ({
    id: Number(row.id),
    name: row.name,
  }));
}

function createUser({ name, login, password, role, isActive = true }) {
  const result = insertUserStmt.run(
    name,
    login,
    hashPassword(password),
    role,
    isActive ? 1 : 0
  );

  return findUserById(Number(result.lastInsertRowid));
}

function updateUser(id, { name, login, role, isActive, password }) {
  if (password) {
    updateUserWithPasswordStmt.run(
      name,
      login,
      role,
      isActive ? 1 : 0,
      hashPassword(password),
      id
    );
  } else {
    updateUserStmt.run(name, login, role, isActive ? 1 : 0, id);
  }

  return findUserById(id);
}

function deleteUser(id) {
  deleteUserStmt.run(id);
}

function countUserReports(id) {
  return Number(countUserReportsStmt.get(id).n);
}

function countActiveAdmins() {
  return Number(countActiveAdminsStmt.get().n);
}

function getReportForDate(schoolId, date) {
  return getReportForDateStmt.get(schoolId, date);
}

function getReportById(id) {
  return getReportByIdStmt.get(id);
}

function reportExists(schoolId, date, excludeId = 0) {
  return Boolean(reportExistsStmt.get(schoolId, date, excludeId));
}

function createReport({
  schoolId,
  date,
  primaryHot,
  beneficiaries,
  paying,
}) {
  const result = insertReportStmt.run(
    schoolId,
    date,
    primaryHot,
    beneficiaries,
    paying
  );

  return getReportById(Number(result.lastInsertRowid));
}

function updateReport(id, { schoolId, date, primaryHot, beneficiaries, paying }) {
  updateReportStmt.run(
    schoolId,
    date,
    primaryHot,
    beneficiaries,
    paying,
    id
  );

  return getReportById(id);
}

function deleteReport(id) {
  deleteReportStmt.run(id);
}

function listReports({ from = '', to = '', schoolId = 0, query = '' } = {}) {
  const like = `%${query}%`;
  return listReportsStmt.all(
    from,
    from,
    to,
    to,
    schoolId,
    schoolId,
    query,
    like,
    like,
    like
  );
}

function listSchoolsWithReports(date) {
  return listSchoolsWithReportsStmt.all(date);
}

function addAuditLog({
  userId = null,
  userName,
  action,
  entity,
  entityId = null,
  details = '',
}) {
  insertAuditStmt.run(
    userId,
    userName,
    action,
    entity,
    entityId,
    details
  );
}

function listAuditLog({ query = '', limit = 200 } = {}) {
  const like = `%${query}%`;
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);

  return listAuditStmt
    .all(query, like, like, like, safeLimit)
    .map((row) => ({
      id: Number(row.id),
      userId: row.user_id === null ? null : Number(row.user_id),
      userName: row.user_name,
      action: row.action,
      entity: row.entity,
      entityId: row.entity_id === null ? null : Number(row.entity_id),
      details: row.details,
      createdAt: row.created_at,
    }));
}

function getStats() {
  const schools = Number(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM schools WHERE role = 'school' AND is_active = 1"
      )
      .get().n
  );
  const users = Number(
    db.prepare('SELECT COUNT(*) AS n FROM schools').get().n
  );
  const reports = Number(
    db.prepare('SELECT COUNT(*) AS n FROM reports').get().n
  );
  const todayReports = Number(
    db
      .prepare('SELECT COUNT(*) AS n FROM reports WHERE report_date = ?')
      .get(getTodayIso()).n
  );

  return { schools, users, reports, todayReports };
}

function checkDatabaseIntegrity() {
  const integrity = db.prepare('PRAGMA integrity_check').all();
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
  const ok =
    integrity.length === 1 &&
    integrity[0].integrity_check === 'ok' &&
    foreignKeys.length === 0;

  return { ok, integrity, foreignKeys };
}

function createBackupFile() {
  const file = path.join(
    os.tmpdir(),
    `nutrition-backup-${Date.now()}-${process.pid}.db`
  );

  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

module.exports = {
  db,
  DB_PATH,
  APP_TIMEZONE,
  DEFAULT_PASSWORD,
  DEFAULT_ADMIN_PASSWORD,
  SEED_SCHOOLS,
  SEED_ADMIN,
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
  initializeDatabase,
};
