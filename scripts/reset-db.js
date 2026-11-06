'use strict';

/**
 * Полное пересоздание базы данных.
 * Запуск: npm run db:reset
 */

const fs = require('node:fs');
const path = require('node:path');

const dbPath =
  process.env.DB_PATH || path.join(__dirname, '..', 'data', 'nutrition.db');

for (const suffix of ['', '-wal', '-shm']) {
  const file = `${dbPath}${suffix}`;

  if (fs.existsSync(file)) {
    fs.rmSync(file);
    console.log(`Удалён файл: ${file}`);
  }
}

// При подключении database.js автоматически создаст таблицы и тестовые записи.
const { db } = require('../database');

db.close();
console.log('База данных создана заново и заполнена учреждениями и администратором.');
