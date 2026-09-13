(() => {
  'use strict';

  const API_BASE = 'https://n8n-pi.taild8d05f.ts.net/webhook';
  const VIEW_URL = `${API_BASE}/workplan-time-plan`;
  const STORAGE_KEY = 'workplan_user';

  const parse = (raw) => {
    try {
      return JSON.parse(raw || 'null');
    } catch {
      return null;
    }
  };

  const user =
    parse(sessionStorage.getItem(STORAGE_KEY)) ||
    parse(localStorage.getItem(STORAGE_KEY));

  if (!user?.userId) {
    location.replace('index.html');
    return;
  }

  const state = { data: null };

  const els = {
    date: document.getElementById('dayPlanDate'),
    report: document.getElementById('dayPlanReport'),
    shifts: document.getElementById('dayShiftBoards'),
    ribbon: document.getElementById('dayCoverageRibbon'),
    processSummary: document.getElementById('dayProcessSummaryGrid'),
    message: document.getElementById('dayPlanMessage'),
    exportExcel: document.getElementById('exportDayExcel'),
    exportPdf: document.getElementById('exportDayPdf')
  };

  const display = user.displayName || user.login || 'Użytkownik';
  document.getElementById('userDisplay').textContent = display;
  document.getElementById('userAvatar').textContent =
    display.trim().charAt(0).toUpperCase() || 'U';

  document.getElementById('logoutBtn').onclick = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    location.replace('index.html');
  };

  document
    .getElementById('menuToggle')
    ?.addEventListener('click', () => document.body.classList.toggle('nav-open'));

  const today = () =>
    new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' });

  const esc = (value) =>
    String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');

  const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;

  const fmt = (value) =>
    Number(value || 0).toLocaleString('pl-PL', { maximumFractionDigits: 2 });

  const addDays = (iso, days) => {
    const date = new Date(`${iso}T12:00:00`);
    date.setDate(date.getDate() + Number(days || 0));
    return date.toISOString().slice(0, 10);
  };

  function setMessage(text, error = false) {
    els.message.textContent = text || '';
    els.message.classList.toggle('error', error);
  }

  function initials(name) {
    return String(name || '?')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || '?';
  }

  function dataForShift(shiftNo) {
    const data = state.data || {};
    const shift = (data.shifts || []).find((row) => Number(row.shiftNo) === Number(shiftNo));
    if (!shift) return null;

    const processes = (data.demand || [])
      .map((demand) => {
        const part = (demand.shiftParts || []).find(
          (row) => Number(row.shiftNo) === Number(shiftNo)
        ) || {};
        const employees = (data.plans || [])
          .filter(
            (plan) =>
              Number(plan.shiftNo) === Number(shiftNo) &&
              plan.processId === demand.processId
          )
          .slice()
          .sort((a, b) =>
            String(a.displayName || '').localeCompare(String(b.displayName || ''), 'pl')
          );

        return {
          processId: demand.processId,
          name: demand.name,
          requiredHours: round2(part.requiredHours),
          assignedHours: round2(part.assignedHours),
          employees
        };
      })
      .filter((row) => row.requiredHours > 0 || row.assignedHours > 0 || row.employees.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name, 'pl', { numeric: true }));

    return { shift, processes };
  }

  function employeeChips(employees) {
    if (!employees.length) {
      return '<span class="no-people">Brak przypisanych pracowników</span>';
    }

    return employees
      .map(
        (employee) => `
          <span class="person-chip">
            <i>${esc(initials(employee.displayName || employee.userId))}</i>
            <span>
              <b>${esc(employee.displayName || employee.userId)}</b>
              <small>${fmt(employee.plannedHours)} h · ${esc(employee.startTime)}–${esc(employee.endTime)}</small>
            </span>
          </span>
        `
      )
      .join('');
  }

  function renderSummary() {
    const data = state.data || {};
    const required = round2(
      (data.demand || []).reduce((sum, row) => sum + Number(row.totalHours || 0), 0)
    );
    const assigned = round2(
      (data.plans || []).reduce((sum, row) => sum + Number(row.plannedHours || 0), 0)
    );
    const balance = round2(assigned - required);
    const uniquePeople = new Set((data.plans || []).map((row) => row.userId)).size;

    document.getElementById('daySummaryShifts').textContent = data.shifts?.length || 0;
    document.getElementById('daySummaryRequired').textContent = `${fmt(required)} h`;
    document.getElementById('daySummaryAssigned').textContent = `${fmt(assigned)} h`;
    document.getElementById('daySummaryPeople').textContent = uniquePeople;

    const balanceCard = document.getElementById('daySummaryAssigned')?.closest('article');
    balanceCard?.classList.remove('ok', 'shortage');
    balanceCard?.classList.add(assigned >= required ? 'ok' : 'shortage');

    const balanceText = document.getElementById('daySummaryBalanceText');
    if (balanceText) {
      balanceText.textContent =
        balance >= 0
          ? `Bilans +${fmt(balance)} h`
          : `Brakuje ${fmt(Math.abs(balance))} h`;
    }
  }

  function renderRibbon() {
    const data = state.data || {};
    const rows = (data.shifts || []).map((shift) => {
      const shiftData = dataForShift(shift.shiftNo);
      const required = round2(
        (shiftData?.processes || []).reduce((sum, row) => sum + row.requiredHours, 0)
      );
      const assigned = round2(
        (shiftData?.processes || []).reduce((sum, row) => sum + row.assignedHours, 0)
      );
      const ok = assigned >= required;
      const coverage = required > 0 ? Math.min(100, Math.round((assigned / required) * 100)) : assigned > 0 ? 100 : 0;

      return `
        <article class="coverage-ribbon-segment ${ok ? 'ok' : ''}" style="--coverage:${coverage}%">
          <div><b>Z${shift.shiftNo} · ${esc(shift.name)}</b><time>${esc(shift.startTime)}–${esc(shift.endTime)}</time></div>
          <small>${fmt(assigned)} / ${fmt(required)} h · ${coverage}% pokrycia</small>
        </article>
      `;
    });

    els.ribbon.innerHTML = rows.join('') || '<span class="day-empty">Brak skonfigurowanych zmian dla tego dnia.</span>';
  }

  function renderShifts() {
    const data = state.data || {};
    const shifts = data.shifts || [];

    if (!shifts.length) {
      els.shifts.innerHTML = `
        <div class="day-empty">
          <strong>Brak planu zmian</strong>
          Dla wybranego dnia nie ma jeszcze skonfigurowanych zmian.
        </div>
      `;
      return;
    }

    els.shifts.innerHTML = shifts
      .map((shift) => {
        const shiftData = dataForShift(shift.shiftNo);
        const processes = shiftData?.processes || [];
        const required = round2(processes.reduce((sum, row) => sum + row.requiredHours, 0));
        const assigned = round2(processes.reduce((sum, row) => sum + row.assignedHours, 0));
        const balance = round2(assigned - required);
        const people = new Set(
          processes.flatMap((row) => row.employees.map((employee) => employee.userId))
        ).size;
        const ok = assigned >= required;

        const processRows = processes.length
          ? processes
              .map((row) => {
                const diff = round2(row.assignedHours - row.requiredHours);
                const rowOk = row.assignedHours >= row.requiredHours;
                return `
                  <div class="process-board-row">
                    <div class="process-cell">
                      <strong>${esc(row.name)}</strong>
                      <small>${row.employees.length} ${row.employees.length === 1 ? 'osoba' : 'osób'} w obsadzie</small>
                    </div>
                    <div class="hours-cell"><span>Potrzeba</span><strong>${fmt(row.requiredHours)} h</strong></div>
                    <div class="hours-cell"><span>Przypisano</span><strong>${fmt(row.assignedHours)} h</strong></div>
                    <div><span class="balance-chip ${rowOk ? 'ok' : 'shortage'}">${diff >= 0 ? '+' : '−'}${fmt(Math.abs(diff))} h</span></div>
                    <div class="people-cell">${employeeChips(row.employees)}</div>
                  </div>
                `;
              })
              .join('')
          : '<div class="empty-shift">Na tej zmianie nie ma zapotrzebowania ani przypisanych pracowników.</div>';

        return `
          <section class="shift-board">
            <header class="shift-board-head">
              <div class="shift-identity">
                <span class="shift-number">Z${shift.shiftNo}</span>
                <div><strong>${esc(shift.name)}</strong><time>${esc(shift.startTime)}–${esc(shift.endTime)}</time></div>
              </div>
              <div class="shift-metric"><span>Zapotrzebowanie</span><strong>${fmt(required)} h</strong></div>
              <div class="shift-metric"><span>Przypisano</span><strong>${fmt(assigned)} h</strong></div>
              <div class="shift-metric balance ${ok ? 'ok' : 'shortage'}"><span>Bilans · ${people} os.</span><strong>${balance >= 0 ? '+' : '−'}${fmt(Math.abs(balance))} h</strong></div>
            </header>
            <div class="process-board-list">${processRows}</div>
          </section>
        `;
      })
      .join('');
  }

  function renderProcessSummary() {
    const demand = state.data?.demand || [];
    const visible = demand.filter(
      (row) => Number(row.totalHours || 0) > 0 || Number(row.assignedHours || 0) > 0
    );

    els.processSummary.innerHTML = visible.length
      ? visible
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name, 'pl', { numeric: true }))
          .map((row) => {
            const required = round2(row.totalHours);
            const assigned = round2(row.assignedHours);
            const ok = assigned >= required;
            const coverage = required > 0 ? Math.min(100, Math.round((assigned / required) * 100)) : assigned > 0 ? 100 : 0;
            return `
              <article class="process-total-card ${ok ? 'ok' : ''}" style="--coverage:${coverage}%">
                <div><div><strong>${esc(row.name)}</strong><small>Cały dzień</small></div><span class="balance-chip ${ok ? 'ok' : 'shortage'}">${assigned >= required ? 'OK' : 'BRAK'}</span></div>
                <div class="process-total-line"><span></span></div>
                <div class="process-total-numbers"><span>Potrzeba <b>${fmt(required)} h</b></span><span>Przypisano <b>${fmt(assigned)} h</b></span></div>
              </article>
            `;
          })
          .join('')
      : '<div class="day-empty">Brak procesów z zapotrzebowaniem lub obsadą w tym dniu.</div>';
  }

  function render() {
    renderSummary();
    renderRibbon();
    renderShifts();
    renderProcessSummary();
    document.getElementById('reportDateLabel').textContent = els.date.value;
  }

  async function load() {
    setMessage('Pobieranie planu dnia…');
    els.exportExcel.disabled = true;
    els.exportPdf.disabled = true;

    try {
      const response = await fetch(`${VIEW_URL}?date=${encodeURIComponent(els.date.value)}`, {
        cache: 'no-store',
        credentials: 'omit'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        throw new Error(data.message || 'Nie udało się pobrać planu dnia.');
      }
      state.data = data;
      render();
      setMessage('');
      els.exportExcel.disabled = false;
      els.exportPdf.disabled = false;
    } catch (error) {
      state.data = null;
      els.shifts.innerHTML = `
        <div class="day-empty">
          <strong>Nie udało się pobrać danych</strong>
          ${esc(error.message || 'Spróbuj ponownie.')}
        </div>
      `;
      setMessage(error.message || 'Nie udało się pobrać planu dnia.', true);
    }
  }

  function processExportRows() {
    const data = state.data || {};
    const rows = [];

    (data.shifts || []).forEach((shift) => {
      const shiftData = dataForShift(shift.shiftNo);
      (shiftData?.processes || []).forEach((process) => {
        const balance = round2(process.assignedHours - process.requiredHours);
        rows.push({
          Data: els.date.value,
          Zmiana: `Z${shift.shiftNo} · ${shift.name}`,
          Godziny_zmiany: `${shift.startTime}-${shift.endTime}`,
          Proces: process.name,
          Zapotrzebowanie_h: process.requiredHours,
          Przypisane_h: process.assignedHours,
          Bilans_h: balance,
          Pracownicy: process.employees.map((employee) => `${employee.displayName} (${fmt(employee.plannedHours)} h)`).join(', ')
        });
      });
    });

    return rows;
  }

  function employeeExportRows() {
    return (state.data?.plans || []).map((plan) => ({
      Data: els.date.value,
      Zmiana: `Z${plan.shiftNo}`,
      Proces: plan.processName,
      Pracownik: plan.displayName,
      Od: plan.startTime,
      Do: plan.endTime,
      Godziny: round2(plan.plannedHours)
    }));
  }

  function downloadLegacyExcel(rows) {
    const columns = Object.keys(rows[0] || { Data: '' });
    const table = `
      <html><head><meta charset="utf-8"></head><body><table border="1">
      <tr>${columns.map((column) => `<th>${esc(column)}</th>`).join('')}</tr>
      ${rows.map((row) => `<tr>${columns.map((column) => `<td>${esc(row[column])}</td>`).join('')}</tr>`).join('')}
      </table></body></html>
    `;
    const blob = new Blob(['\ufeff', table], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Plan_dnia_${els.date.value}.xls`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportExcel() {
    if (!state.data) return;
    const processRows = processExportRows();
    const employeeRows = employeeExportRows();

    if (!processRows.length && !employeeRows.length) {
      setMessage('Brak danych do eksportu.', true);
      return;
    }

    try {
      if (!window.XLSX) {
        downloadLegacyExcel(processRows.length ? processRows : employeeRows);
        setMessage('Pobrano plik Excel w formacie XLS.');
        return;
      }

      const wb = XLSX.utils.book_new();
      const wsPlan = XLSX.utils.json_to_sheet(processRows.length ? processRows : [{ Data: els.date.value }]);
      wsPlan['!cols'] = [
        { wch: 12 }, { wch: 24 }, { wch: 18 }, { wch: 28 },
        { wch: 18 }, { wch: 16 }, { wch: 12 }, { wch: 55 }
      ];
      XLSX.utils.book_append_sheet(wb, wsPlan, 'Plan dnia');

      const wsPeople = XLSX.utils.json_to_sheet(employeeRows.length ? employeeRows : [{ Data: els.date.value }]);
      wsPeople['!cols'] = [
        { wch: 12 }, { wch: 10 }, { wch: 28 }, { wch: 28 }, { wch: 10 }, { wch: 10 }, { wch: 12 }
      ];
      XLSX.utils.book_append_sheet(wb, wsPeople, 'Pracownicy');
      XLSX.writeFile(wb, `Plan_dnia_${els.date.value}.xlsx`);
      setMessage('Pobrano raport Excel.');
    } catch (error) {
      setMessage(error.message || 'Nie udało się utworzyć pliku Excel.', true);
    }
  }

  async function exportPdf() {
    if (!state.data) return;
    els.exportPdf.disabled = true;
    setMessage('Tworzenie PDF…');

    try {
      if (!window.html2pdf) {
        window.print();
        setMessage('Otworzono widok wydruku. Wybierz „Zapisz jako PDF”.');
        return;
      }

      await html2pdf()
        .set({
          margin: [7, 7, 7, 7],
          filename: `Plan_dnia_${els.date.value}.pdf`,
          image: { type: 'jpeg', quality: 0.96 },
          html2canvas: { scale: 1.55, useCORS: true, backgroundColor: '#07101c' },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
          pagebreak: { mode: ['css', 'legacy'], avoid: ['.shift-board', '.process-total-card'] }
        })
        .from(els.report)
        .save();

      setMessage('Pobrano raport PDF.');
    } catch (error) {
      setMessage(error.message || 'Nie udało się utworzyć PDF.', true);
    } finally {
      els.exportPdf.disabled = false;
    }
  }

  function moveDay(delta) {
    els.date.value = addDays(els.date.value, delta);
    load();
  }

  els.date.value = today();
  els.date.addEventListener('change', load);
  document.getElementById('dayPrev').onclick = () => moveDay(-1);
  document.getElementById('dayNext').onclick = () => moveDay(1);
  document.getElementById('dayToday').onclick = () => {
    els.date.value = today();
    load();
  };
  els.exportExcel.onclick = exportExcel;
  els.exportPdf.onclick = exportPdf;

  load();
})();
