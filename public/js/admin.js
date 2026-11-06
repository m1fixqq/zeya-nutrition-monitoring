'use strict';

/* Сводная панель отдела образования. */

const els = {
  dashboardDate: document.getElementById('dashboardDate'),
  dashboardBody: document.getElementById('dashboardBody'),
  dashboardFoot: document.getElementById('dashboardFoot'),
  dashboardError: document.getElementById('dashboardError'),
};

const numberFormatter = new Intl.NumberFormat('ru-RU');

function formatDateRu(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ''))) return '—';

  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatNumber(value) {
  return numberFormatter.format(value);
}

function showError(message) {
  els.dashboardError.textContent = message;
  els.dashboardError.hidden = false;
}

function clearError() {
  els.dashboardError.textContent = '';
  els.dashboardError.hidden = true;
}

function createCell(text, modifier) {
  const cell = document.createElement('td');
  cell.className = modifier
    ? `report-table__cell ${modifier}`
    : 'report-table__cell';
  cell.textContent = text;
  return cell;
}

function createStatusCell(modifier, text) {
  const cell = document.createElement('td');
  cell.className = 'report-table__cell report-table__cell_type_status';

  const badge = document.createElement('span');
  badge.className = `status status_value_${modifier}`;
  badge.textContent = text;

  cell.appendChild(badge);
  return cell;
}

function renderRows(schools) {
  const body = document.createDocumentFragment();
  const totals = {
    primaryHot: 0,
    beneficiaries: 0,
    paying: 0,
    submitted: 0,
  };

  schools.forEach((school, index) => {
    const row = document.createElement('tr');
    const hasReport = Boolean(school.report);

    row.className = hasReport
      ? 'report-table__row'
      : 'report-table__row report-table__row_state_missing';

    row.appendChild(
      createCell(String(index + 1), 'report-table__cell_type_index')
    );
    row.appendChild(
      createCell(school.name, 'report-table__cell_type_name')
    );

    if (hasReport) {
      totals.primaryHot += school.report.primaryHot;
      totals.beneficiaries += school.report.beneficiaries;
      totals.paying += school.report.paying;
      totals.submitted += 1;

      row.appendChild(
        createCell(
          formatNumber(school.report.primaryHot),
          'report-table__cell_type_number'
        )
      );
      row.appendChild(
        createCell(
          formatNumber(school.report.beneficiaries),
          'report-table__cell_type_number'
        )
      );
      row.appendChild(
        createCell(
          formatNumber(school.report.paying),
          'report-table__cell_type_number'
        )
      );
      row.appendChild(createStatusCell('ok', 'Сдан'));
    } else {
      for (let i = 0; i < 3; i += 1) {
        row.appendChild(
          createCell('—', 'report-table__cell_type_number')
        );
      }

      row.appendChild(createStatusCell('missing', 'Нет данных'));
    }

    body.appendChild(row);
  });

  els.dashboardBody.replaceChildren(body);
  renderTotals(totals, schools.length);
}

function renderTotals(totals, totalSchools) {
  const row = document.createElement('tr');

  const label = document.createElement('td');
  label.className = 'report-table__cell report-table__total-label';
  label.colSpan = 2;
  label.textContent = 'Итого по Зейскому муниципальному округу';

  const primaryHot = document.createElement('td');
  primaryHot.className = 'report-table__cell report-table__total-value';
  primaryHot.textContent = formatNumber(totals.primaryHot);

  const beneficiaries = document.createElement('td');
  beneficiaries.className = 'report-table__cell report-table__total-value';
  beneficiaries.textContent = formatNumber(totals.beneficiaries);

  const paying = document.createElement('td');
  paying.className = 'report-table__cell report-table__total-value';
  paying.textContent = formatNumber(totals.paying);

  const status = document.createElement('td');
  status.className = 'report-table__cell report-table__total-status';
  status.textContent = `${totals.submitted} из ${totalSchools} отчётов`;

  row.append(label, primaryHot, beneficiaries, paying, status);
  els.dashboardFoot.replaceChildren(row);
}

function renderMessageRow(message) {
  const row = document.createElement('tr');
  row.className = 'report-table__row';

  const cell = document.createElement('td');
  cell.className = 'report-table__cell report-table__cell_type_message';
  cell.colSpan = 6;
  cell.textContent = message;

  row.appendChild(cell);
  els.dashboardBody.replaceChildren(row);
  els.dashboardFoot.replaceChildren();
}

async function loadDashboard() {
  clearError();

  try {
    const response = await fetch('/api/admin/today', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      credentials: 'same-origin',
    });

    let data = null;

    try {
      data = await response.json();
    } catch {
      // Обработаем как ошибку ниже.
    }

    if (!response.ok) {
      throw new Error(
        (data && data.error) || 'Не удалось получить сводные данные.'
      );
    }

    const schools = Array.isArray(data.schools) ? data.schools : [];

    els.dashboardDate.textContent = formatDateRu(data.date);
    renderRows(schools);
  } catch (error) {
    const message =
      error instanceof TypeError
        ? 'Нет связи с сервером. Проверьте подключение и обновите страницу.'
        : error.message;

    showError(message);
    renderMessageRow('Не удалось загрузить сводную ведомость.');
  }
}

loadDashboard();
