(() => {
  'use strict';

  const API_BASE = 'https://n8n-pi.taild8d05f.ts.net/webhook';
  const TIME_PLAN_URL = `${API_BASE}/workplan-time-plan`;
  const EMPLOYEES_URL = `${API_BASE}/workplan-employees`;

  const fmt = (value, digits = 1) => Number(value || 0).toLocaleString('pl-PL', {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0
  });

  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const todayIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' });

  const todayLabel = () => new Intl.DateTimeFormat('pl-PL', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Warsaw'
  }).format(new Date());

  async function getJson(url) {
    const response = await fetch(url, { cache: 'no-store', credentials: 'omit' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.message || 'Nie udało się pobrać danych.');
    return data;
  }

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function setMessage(text, error = false) {
    const node = document.getElementById('homeMessage');
    if (!node) return;
    node.textContent = text || '';
    node.classList.toggle('error', error);
  }

  function renderCoverage(required, assigned) {
    const percent = required > 0 ? Math.round((assigned / required) * 100) : 0;
    const clamped = Math.max(0, Math.min(100, percent));
    const diff = assigned - required;
    const dial = document.getElementById('homeCoverageDial');
    const circle = document.getElementById('homeCoverageCircle');

    setText('homeCoverageValue', required > 0 ? `${percent}%` : '—');
    setText('homeCoverageRequired', `${fmt(required)} h`);
    setText('homeCoverageAssigned', `${fmt(assigned)} h`);
    setText('homeCoverageBalance', required > 0
      ? `${diff >= 0 ? '+' : ''}${fmt(diff)} h`
      : 'Brak zapotrzebowania');

    if (circle) circle.style.strokeDasharray = `${clamped} 100`;
    if (dial) dial.classList.toggle('shortage', required > 0 && assigned < required);

    const balance = document.getElementById('homeCoverageBalanceFact');
    if (balance) {
      balance.classList.toggle('danger', required > 0 && diff < 0);
      balance.classList.toggle('good', required > 0 && diff >= 0);
    }

    setText('homeCoverageBadge', required <= 0 ? 'Brak planu' : (assigned >= required ? 'Pokryte' : 'Braki'));
  }

  function renderShifts(timePlan) {
    const box = document.getElementById('homeShiftRows');
    const shifts = Array.isArray(timePlan.shifts) ? timePlan.shifts : [];
    const demand = Array.isArray(timePlan.demand) ? timePlan.demand : [];

    if (!box) return;
    if (!shifts.length) {
      box.innerHTML = '<div class="home-empty">Brak skonfigurowanych zmian na dziś.</div>';
      return;
    }

    box.innerHTML = shifts.map((shift) => {
      const parts = demand.flatMap((process) => Array.isArray(process.shiftParts)
        ? process.shiftParts.filter((part) => Number(part.shiftNo) === Number(shift.shiftNo))
        : []);
      const required = parts.reduce((sum, part) => sum + Number(part.requiredHours || 0), 0);
      const assigned = parts.reduce((sum, part) => sum + Number(part.assignedHours || 0), 0);
      const percent = required > 0 ? Math.min(100, (assigned / required) * 100) : 0;
      const shortage = required > 0 && assigned < required;

      return `<div class="home-shift-row">
        <div class="home-shift-name"><strong>${esc(shift.name || `Zmiana ${shift.shiftNo}`)}</strong><span>${esc(shift.startTime || '—')}–${esc(shift.endTime || '—')}</span></div>
        <div class="home-bar ${shortage ? 'shortage' : ''}" title="${fmt(assigned)} z ${fmt(required)} h"><i style="width:${percent}%"></i></div>
        <div class="home-shift-metric"><strong>${fmt(assigned)} / ${fmt(required)} h</strong><span>${required > 0 ? (shortage ? `brakuje ${fmt(required - assigned)} h` : `nadwyżka ${fmt(Math.max(0, assigned - required))} h`) : 'brak zapotrzebowania'}</span></div>
      </div>`;
    }).join('');
  }

  function renderProcesses(timePlan) {
    const box = document.getElementById('homeProcessChart');
    if (!box) return;

    const rows = (Array.isArray(timePlan.demand) ? timePlan.demand : [])
      .filter((row) => Number(row.totalHours || 0) > 0 || Number(row.assignedHours || 0) > 0)
      .sort((a, b) => Number(b.totalHours || 0) - Number(a.totalHours || 0));

    setText('homeProcessBadge', `${rows.length} procesów`);

    if (!rows.length) {
      box.innerHTML = '<div class="home-empty">Na dziś nie zapisano jeszcze zapotrzebowania procesów.</div>';
      return;
    }

    box.innerHTML = rows.map((row) => {
      const required = Number(row.totalHours || 0);
      const assigned = Number(row.assignedHours || 0);
      const percent = required > 0 ? Math.min(100, (assigned / required) * 100) : (assigned > 0 ? 100 : 0);
      const shortage = required > 0 && assigned < required;
      const diff = assigned - required;
      return `<div class="process-bar-row">
        <div class="process-bar-name" title="${esc(row.name || row.processId)}">${esc(row.name || row.processId)}</div>
        <div class="home-bar ${shortage ? 'shortage' : ''}"><i style="width:${percent}%"></i></div>
        <div class="process-bar-metric"><strong>${fmt(assigned)} / ${fmt(required)} h</strong>${required > 0 ? `${diff >= 0 ? '+' : ''}${fmt(diff)} h` : 'bez zapotrzebowania'}</div>
      </div>`;
    }).join('');
  }

  function renderAvailability(employeeData) {
    const employees = Array.isArray(employeeData.employees) ? employeeData.employees : [];
    const active = employees.filter((row) => row.accountActive !== false);
    const available = active.filter((row) => row.available !== false).length;
    const unavailable = Math.max(0, active.length - available);
    const availablePercent = active.length ? (available / active.length) * 100 : 0;
    const unavailablePercent = active.length ? 100 - availablePercent : 0;

    setText('homeAvailable', String(available));
    setText('homeAvailableTotal', `z ${active.length} aktywnych osób`);
    setText('homeAvailableLegend', String(available));
    setText('homeUnavailableLegend', String(unavailable));
    setText('homeAvailabilityBadge', `${active.length} osób`);

    const a = document.getElementById('homeAvailableBar');
    const u = document.getElementById('homeUnavailableBar');
    if (a) a.style.width = `${availablePercent}%`;
    if (u) u.style.width = `${unavailablePercent}%`;
  }

  function renderTimePlan(timePlan) {
    const summary = timePlan.summary || {};
    const plans = Array.isArray(timePlan.plans) ? timePlan.plans : [];
    const plannedEmployees = Number(summary.plannedEmployees ?? new Set(plans.map((row) => row.userId)).size);
    const required = Number(summary.requiredHours || 0);
    const assigned = Number(summary.assignedHours || 0);
    const shifts = Array.isArray(timePlan.shifts) ? timePlan.shifts.length : Number(summary.activeShifts || 0);
    const coverage = required > 0 ? Math.round((assigned / required) * 100) : 0;

    setText('homePlannedEmployees', String(plannedEmployees));
    setText('homePlannedEmployeesNote', plannedEmployees ? 'unikalne osoby w planie' : 'brak przypisanych osób');
    setText('homeRequiredHours', `${fmt(required)} h`);
    setText('homeRequiredHoursNote', 'zapotrzebowanie wszystkich procesów');
    setText('homeAssignedHours', `${fmt(assigned)} h`);
    setText('homeAssignedHoursNote', 'godziny przypisanych pracowników');
    setText('homeCoverageKpi', required > 0 ? `${coverage}%` : '—');
    setText('homeCoverageKpiNote', required > 0 ? (assigned >= required ? 'plan pokryty' : `brakuje ${fmt(required - assigned)} h`) : 'brak zapotrzebowania');
    setText('homeShiftBadge', `${shifts} zmian`);

    renderCoverage(required, assigned);
    renderShifts(timePlan);
    renderProcesses(timePlan);
  }

  async function load() {
    const main = document.querySelector('.home-dashboard');
    main?.classList.add('home-loading');
    setText('homeTodayLabel', todayLabel());
    setText('homeTodayIso', todayIso());
    setMessage('Pobieranie aktualnych danych…');

    const date = todayIso();
    const [timeResult, employeeResult] = await Promise.allSettled([
      getJson(`${TIME_PLAN_URL}?date=${encodeURIComponent(date)}`),
      getJson(EMPLOYEES_URL)
    ]);

    let failures = 0;

    if (timeResult.status === 'fulfilled') renderTimePlan(timeResult.value);
    else failures += 1;

    if (employeeResult.status === 'fulfilled') renderAvailability(employeeResult.value);
    else failures += 1;

    main?.classList.remove('home-loading');

    if (failures === 0) setMessage('Dane aktualne — źródło: Plan pracy i Pracownicy.');
    else if (failures === 1) setMessage('Część danych nie została pobrana. Odśwież stronę, aby spróbować ponownie.', true);
    else setMessage('Nie udało się pobrać danych dashboardu. Sprawdź połączenie z backendem.', true);
  }

  load();
})();
