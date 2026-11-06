'use strict';

/**
 * Восстановление базы данных из резервной копии.
 * Запуск: npm run db:restore -- путь\к\файлу.db
 *
 * Перед заменой текущая база сохраняется в файл с суффиксом .before-restore.
 * После замены выполняется проверка целостности.
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dbPath =
  process.env.DB_PATH || path.join(__dirname, '..', 'data', 'nutrition.db');
const sourceArg = process.argv[2];

if (!sourceArg) {
  console.error('Укажите путь к файлу резервной копии.');
  console.error('Пример: npm run db:restore -- data\\nutrition-backup.db');
  process.exit(1);
}

const sourcePath = path.resolve(sourceArg);

if (!fs.existsSync(sourcePath)) {
  console.error(`Файл не найден: ${sourcePath}`);
  process.exit(1);
}

if (path.resolve(dbPath) === sourcePath) {
  console.error('Нельзя восстановить базу из неё же.');
  process.exit(1);
}

const backupPath = `${dbPath}.before-restore-${Date.now()}`;

if (fs.existsSync(dbPath)) {
  fs.copyFileSync(dbPath, backupPath);
  console.log(`Текущая база сохранена: ${backupPath}`);
}

for (const suffix of ['-wal', '-shm']) {
  const file = `${dbPath}${suffix}`;

  if (fs.existsSync(file)) {
    fs.rmSync(file);
  }
}

fs.copyFileSync(sourcePath, dbPath);
console.log(`База восстановлена из файла: ${sourcePath}`);

const db = new DatabaseSync(dbPath);
const integrity = db.prepare('PRAGMA integrity_check').all();
const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
db.close();

const ok =
  integrity.length === 1 &&
  integrity[0].integrity_check === 'ok' &&
  foreignKeys.length === 0;

if (!ok) {
  console.error('Проверка целостности выявила ошибки.');
  console.error('Используйте файл .before-restore или другую резервную копию.');
  process.exit(1);
}

console.log('Проверка целостности пройдена. Запустите сервер: npm start');
