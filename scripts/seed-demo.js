'use strict';

/**
 * Демонстрационные отчёты за предыдущие рабочие дни.
 * Запуск: npm run db:demo
 *
 * Скрипт идемпотентен: уже существующие отчёты не изменяются.
 * Сегодняшняя дата не заполняется, чтобы можно было показать отправку отчёта.
 */

const {
  db,
  getTodayIso,
  getReportForDate,
  createReport,
  addAuditLog,
} = require('../database');

const VALUES_BY_LOGIN = {
  sosnovoborsk: { primaryHot: 120, beneficiaries: 35, paying: 85 },
  beregovaya: { primaryHot: 95, beneficiaries: 28, paying: 60 },
  school1: { primaryHot: 210, beneficiaries: 48, paying: 150 },
  school4: { primaryHot: 180, beneficiaries: 40, paying: 120 },
  rodnichok: { primaryHot: 60, beneficiaries: 12, paying: 45 },
};

const MISSING_BY_INDEX = [
  ['school4'],
  [],
  ['beregovaya', 'rodnichok'],
  ['sosnovoborsk'],
  [],
];

const OFFSETS = [0, 3, -2, 1, 4];

function previousWeekdays(todayIso, count) {
  const dates = [];
  const cursor = new Date(`${todayIso}T00:00:00Z`);

  while (dates.length < count) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);

    const day = cursor.getUTCDay();

    if (day === 0 || day === 6) continue;

    dates.push(cursor.toISOString().slice(0, 10));
  }

  return dates;
}

const today = getTodayIso();
const dates = previousWeekdays(today, 5);
const schools = db
  .prepare(
    "SELECT id, login FROM schools WHERE role = 'school' AND is_active = 1 ORDER BY id"
  )
  .all();

let inserted = 0;

for (const [index, date] of dates.entries()) {
  const missing = MISSING_BY_INDEX[index] || [];
  const offset = OFFSETS[index] || 0;

  for (const school of schools) {
    if (missing.includes(school.login)) continue;
    if (getReportForDate(school.id, date)) continue;

    const base = VALUES_BY_LOGIN[school.login] || {
      primaryHot: 50,
      beneficiaries: 10,
      paying: 30,
    };

    createReport({
      schoolId: Number(school.id),
      date,
      primaryHot: Math.max(0, base.primaryHot + offset),
      beneficiaries: Math.max(0, base.beneficiaries + Math.floor(offset / 2)),
      paying: Math.max(0, base.paying + offset),
    });

    inserted += 1;
  }
}

if (inserted > 0) {
  addAuditLog({
    userName: 'Система',
    action: 'demo_seed',
    entity: 'report',
    details: `Загружены демонстрационные отчёты за ${dates.length} рабочих дней`,
  });
}

console.log(
  inserted > 0
    ? `Добавлено отчётов: ${inserted} за даты: ${dates.join(', ')}`
    : 'Демонстрационные отчёты уже существуют. Изменений нет.'
);

db.close();
