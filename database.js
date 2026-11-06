'use strict';

/**
 * Работа с базой данных SQLite.
 *
 * Используется встроенный в Node.js модуль `node:sqlite` (Node.js 24+),
 * поэтому отдельная нативная библиотека и компиляция не требуются.
 */

const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Yakutsk';
const DB_PATH =
  process.env.DB_PATH || path.join(__dirname, 'data', 'nutrition.db');

// Единый пароль для всех тестовых учреждений. В реальной эксплуатации
// его необходимо заменить и передавать каждому учреждению отдельно.
const DEFAULT_PASSWORD = 'school2026';

// Перечень учреждений для первичного заполнения базы.
const SEED_SCHOOLS = [
  { name: 'МБОУ Сосновоборская СОШ', login: 'sosnovoborsk' },
  { name: 'МАОУ Береговая СОШ', login: 'beregovaya' },
  { name: 'МОАУ СОШ №1 города Зеи', login: 'school1' },
  { name: 'МОАУ СОШ №4', login: 'school4' },
  { name: 'Детский сад «Родничок»', login: 'rodnichok' },
];

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS schools (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL,
    login    TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL
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
    FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE CASCADE,
    UNIQUE (school_id, report_date)
  );

  CREATE INDEX IF NOT EXISTS idx_reports_date
    ON reports (report_date);
`);

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
 * Первичное заполнение базы учреждениями.
 * Добавляются только отсутствующие логины, поэтому повторный запуск
 * приложения не создаёт дубликаты и не сбрасывает пароли.
 */
function seedSchools() {
  const findByLogin = db.prepare('SELECT id FROM schools WHERE login = ?');
  const insert = db.prepare(
    'INSERT INTO schools (name, login, password) VALUES (?, ?, ?)'
  );

  db.exec('BEGIN');
  try {
    for (const school of SEED_SCHOOLS) {
      if (!findByLogin.get(school.login)) {
        insert.run(school.name, school.login, hashPassword(DEFAULT_PASSWORD));
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function initializeDatabase() {
  seedSchools();
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

const findSchoolByLoginStmt = db.prepare(`
  SELECT id, name, login, password
  FROM schools
  WHERE login = ?
`);

const findSchoolByIdStmt = db.prepare(`
  SELECT id, name, login
  FROM schools
  WHERE id = ?
`);

const getReportForDateStmt = db.prepare(`
  SELECT id, school_id, report_date, primary_hot_meals, beneficiaries, paying
  FROM reports
  WHERE school_id = ? AND report_date = ?
`);

const getReportByIdStmt = db.prepare(`
  SELECT id, school_id, report_date, primary_hot_meals, beneficiaries, paying
  FROM reports
  WHERE id = ?
`);

const insertReportStmt = db.prepare(`
  INSERT INTO reports
    (school_id, report_date, primary_hot_meals, beneficiaries, paying)
  VALUES (?, ?, ?, ?, ?)
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
  ORDER BY s.id ASC
`);

function findSchoolByLogin(login) {
  return findSchoolByLoginStmt.get(login);
}

function findSchoolById(id) {
  return findSchoolByIdStmt.get(id);
}

function getReportForDate(schoolId, date) {
  return getReportForDateStmt.get(schoolId, date);
}

function getReportById(id) {
  return getReportByIdStmt.get(id);
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

  return getReportById(result.lastInsertRowid);
}

function listSchoolsWithReports(date) {
  return listSchoolsWithReportsStmt.all(date);
}

module.exports = {
  db,
  APP_TIMEZONE,
  DEFAULT_PASSWORD,
  SEED_SCHOOLS,
  getTodayIso,
  findSchoolByLogin,
  findSchoolById,
  verifyPassword,
  getReportForDate,
  getReportById,
  createReport,
  listSchoolsWithReports,
  initializeDatabase,
};
