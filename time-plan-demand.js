(() => {
  'use strict';

  const API_BASE = 'https://n8n-pi.taild8d05f.ts.net/webhook';
  const VIEW_URL = `${API_BASE}/workplan-time-plan`;
  const SAVE_URL = `${API_BASE}/workplan-time-plan-save`;
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

  if (!user?.userId) return;

  const canEdit = ['admin', 'leader'].includes(
    String(user.role || '').toLowerCase()
  );

  const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;
  const fmt = (value) =>
    Number(value || 0).toLocaleString('pl-PL', { maximumFractionDigits: 2 });

  function setPageMessage(text, error = false) {
    const node = document.getElementById('pageMessage');
    if (!node) return;
    node.textContent = text || '';
    node.style.color = error ? '#ff9aa4' : '';
  }

  async function post(payload) {
    const date = document.getElementById('planDate')?.value || '';
    const body = new URLSearchParams({
      ...payload,
      requestedBy: user.userId,
      date
    });

    const response = await fetch(SAVE_URL, {
      method: 'POST',
      body,
      cache: 'no-store',
      credentials: 'omit'
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Nie udało się zapisać danych.');
    }
    return data;
  }

  async function readProcess(processId) {
    const date = document.getElementById('planDate')?.value || '';
    const response = await fetch(`${VIEW_URL}?date=${encodeURIComponent(date)}`, {
      cache: 'no-store',
      credentials: 'omit'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Nie udało się potwierdzić zapisu.');
    }
    const process = (data.demand || []).find((row) => row.processId === processId);
    if (!process) throw new Error('Nie znaleziono procesu po zapisie.');
    return process;
  }

  function getShiftValues(card) {
    return [...card.querySelectorAll('[data-shift-hours]')]
      .map((input) => ({
        shiftNo: Number(input.dataset.shiftHours),
        requiredHours: round2(Math.max(0, Number(input.value || 0)))
      }))
      .sort((a, b) => a.shiftNo - b.shiftNo);
  }

  function getSavedShiftValues(card) {
    try {
      const value = JSON.parse(card.dataset.savedShiftHours || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function sameShifts(a, b) {
    if (a.length !== b.length) return false;
    return a.every((row, index) =>
      Number(row.shiftNo) === Number(b[index]?.shiftNo) &&
      Math.abs(Number(row.requiredHours || 0) - Number(b[index]?.requiredHours || 0)) <= 0.01
    );
  }

  function snapshotCard(card) {
    const total = card.querySelector('[data-total-hours]');
    const hpp = card.querySelector('[data-person-hours]');
    const skill = card.querySelector('[data-required-skill]');

    card.dataset.savedTotalHours = String(round2(total?.value || 0));
    card.dataset.savedPersonHours = String(round2(hpp?.value || 8));
    card.dataset.savedSkillId = String(skill?.value || '');
    card.dataset.savedShiftHours = JSON.stringify(getShiftValues(card));
    card.dataset.dayDemandSaved = Number(total?.value || 0) > 0 ? '1' : '0';
  }

  function dayDirty(card) {
    const total = round2(card.querySelector('[data-total-hours]')?.value || 0);
    const hpp = round2(card.querySelector('[data-person-hours]')?.value || 8);
    const skill = String(card.querySelector('[data-required-skill]')?.value || '');
    return (
      Math.abs(total - Number(card.dataset.savedTotalHours || 0)) > 0.01 ||
      Math.abs(hpp - Number(card.dataset.savedPersonHours || 8)) > 0.01 ||
      skill !== String(card.dataset.savedSkillId || '')
    );
  }

  function shiftsDirty(card) {
    return !sameShifts(getShiftValues(card), getSavedShiftValues(card));
  }

  function updateDistribution(card) {
    const total = round2(Math.max(0, Number(card.querySelector('[data-total-hours]')?.value || 0)));
    const distributed = round2(
      getShiftValues(card).reduce((sum, row) => sum + row.requiredHours, 0)
    );
    const diff = round2(total - distributed);

    const summary = card.querySelector('[data-distribution-summary]');
    const detail = card.querySelector('[data-distribution-detail]');

    if (summary) summary.textContent = `Rozdzielono ${fmt(distributed)} / ${fmt(total)} h`;
    if (detail) {
      detail.textContent = Math.abs(diff) <= 0.02
        ? 'Całe zapotrzebowanie dnia jest rozdzielone na zmiany.'
        : diff > 0
          ? `Pozostało ${fmt(diff)} h do rozdzielenia.`
          : `Przekroczono zapotrzebowanie dnia o ${fmt(Math.abs(diff))} h.`;
    }
  }

  function updateState(card) {
    const dirtyDay = dayDirty(card);
    const dirtyShifts = shiftsDirty(card);
    const total = round2(card.querySelector('[data-total-hours]')?.value || 0);
    const persistedDay = card.dataset.dayDemandSaved === '1' && total > 0 && !dirtyDay;

    card.dataset.dayDirty = dirtyDay ? '1' : '0';
    card.dataset.shiftsDirty = dirtyShifts ? '1' : '0';

    const dayState = card.querySelector('[data-day-save-state]');
    const shiftState = card.querySelector('[data-shift-save-state]');
    const dayButton = card.querySelector('[data-save-day-demand]');
    const shiftButton = card.querySelector('[data-save-shift-demand]');

    if (dayState) {
      dayState.textContent = dirtyDay
        ? 'Dzień: niezapisane zmiany'
        : total > 0
          ? 'Dzień: zapisany'
          : 'Dzień: ustaw zapotrzebowanie';
      dayState.classList.toggle('dirty', dirtyDay);
      dayState.classList.toggle('saved', !dirtyDay && total > 0);
    }

    if (shiftState) {
      shiftState.textContent = dirtyShifts
        ? 'Zmiany: niezapisane zmiany'
        : 'Zmiany: zapisane';
      shiftState.classList.toggle('dirty', dirtyShifts);
      shiftState.classList.toggle('saved', !dirtyShifts);
    }

    if (dayButton) {
      dayButton.disabled = !canEdit || !dirtyDay;
      dayButton.textContent = dirtyDay ? 'Zapisz dzień' : 'Dzień zapisany';
    }

    if (shiftButton) {
      shiftButton.disabled = !canEdit || !dirtyShifts || total <= 0 || dirtyDay;
      shiftButton.title = dirtyDay
        ? 'Najpierw zapisz zapotrzebowanie dnia.'
        : total <= 0
          ? 'Najpierw ustaw i zapisz zapotrzebowanie dnia.'
          : '';
    }

    const assign = card.querySelector('[data-assign]');
    if (assign) {
      const blockAssign = !canEdit || !persistedDay || dirtyShifts;
      assign.disabled = blockAssign;
      assign.title = dirtyDay
        ? 'Najpierw zapisz zapotrzebowanie dnia.'
        : dirtyShifts
          ? 'Najpierw zapisz podział na zmiany.'
          : total <= 0
            ? 'Najpierw ustaw zapotrzebowanie dnia.'
            : '';
    }

    updateDistribution(card);
  }

  async function saveDay(card) {
    const processId = card.dataset.process;
    const totalHours = round2(Math.max(0, Number(card.querySelector('[data-total-hours]')?.value || 0)));
    const defaultHoursPerPerson = round2(
      Math.max(0.25, Number(card.querySelector('[data-person-hours]')?.value || 8))
    );
    const requiredSkillId = String(card.querySelector('[data-required-skill]')?.value || '');

    if (totalHours <= 0) {
      setPageMessage('Zapotrzebowanie dnia musi być większe od 0 h.', true);
      return;
    }

    const button = card.querySelector('[data-save-day-demand]');
    if (button) button.disabled = true;
    setPageMessage('Zapisywanie zapotrzebowania dnia…');

    try {
      await post({
        action: 'demandDay',
        processId,
        requiredSkillId,
        totalHours: String(totalHours),
        defaultHoursPerPerson: String(defaultHoursPerPerson)
      });

      const persisted = await readProcess(processId);
      if (Math.abs(Number(persisted.totalHours || 0) - totalHours) > 0.01) {
        throw new Error('Backend nie potwierdził zapisanej wartości dnia.');
      }

      card.dataset.savedTotalHours = String(totalHours);
      card.dataset.savedPersonHours = String(defaultHoursPerPerson);
      card.dataset.savedSkillId = requiredSkillId;
      card.dataset.dayDemandSaved = '1';
      setPageMessage(`Zapisano zapotrzebowanie dnia: ${fmt(totalHours)} h.`);
      updateState(card);
    } catch (error) {
      setPageMessage(error.message || 'Nie udało się zapisać dnia.', true);
      updateState(card);
    }
  }

  async function saveShifts(card) {
    const processId = card.dataset.process;
    const requiredSkillId = String(card.querySelector('[data-required-skill]')?.value || '');
    const shiftHours = getShiftValues(card);
    const button = card.querySelector('[data-save-shift-demand]');

    if (dayDirty(card) || card.dataset.dayDemandSaved !== '1') {
      setPageMessage('Najpierw zapisz zapotrzebowanie dnia.', true);
      return;
    }

    if (button) button.disabled = true;
    setPageMessage('Zapisywanie podziału na zmiany…');

    try {
      await post({
        action: 'demandShifts',
        processId,
        requiredSkillId,
        shiftHours: JSON.stringify(shiftHours)
      });

      const persisted = await readProcess(processId);
      const persistedShifts = (persisted.shiftParts || [])
        .map((part) => ({
          shiftNo: Number(part.shiftNo),
          requiredHours: round2(Number(part.requiredHours || 0))
        }))
        .sort((a, b) => a.shiftNo - b.shiftNo);

      if (!sameShifts(shiftHours, persistedShifts)) {
        throw new Error('Backend nie potwierdził zapisanego podziału zmian.');
      }

      card.dataset.savedShiftHours = JSON.stringify(shiftHours);
      setPageMessage('Podział zapotrzebowania na zmiany został zapisany.');
      updateState(card);
    } catch (error) {
      setPageMessage(error.message || 'Nie udało się zapisać podziału zmian.', true);
      updateState(card);
    }
  }

  function enhanceCard(card) {
    if (!card || card.dataset.demandPersistenceV2 === '1') return;

    const oldSave = card.querySelector('[data-save-demand]');
    const actions = card.querySelector('.demand-actions');
    if (!oldSave || !actions) return;

    card.dataset.demandPersistenceV2 = '1';
    snapshotCard(card);

    const dayButton = document.createElement('button');
    dayButton.type = 'button';
    dayButton.className = 'secondary-button demand-save demand-save-day';
    dayButton.dataset.saveDayDemand = '1';
    dayButton.textContent = 'Dzień zapisany';

    const shiftButton = document.createElement('button');
    shiftButton.type = 'button';
    shiftButton.className = 'secondary-button demand-save demand-save-shifts';
    shiftButton.dataset.saveShiftDemand = '1';
    shiftButton.textContent = 'Zapisz podział zmian';

    oldSave.replaceWith(dayButton, shiftButton);

    const stateRow = document.createElement('div');
    stateRow.className = 'demand-persist-state';
    stateRow.innerHTML = `
      <span data-day-save-state>Dzień: zapisany</span>
      <span data-shift-save-state>Zmiany: zapisane</span>
    `;

    const dailyBlock = card.querySelector('.daily-demand-block');
    if (dailyBlock) dailyBlock.before(stateRow);
    else card.querySelector('.shift-demand-rail')?.before(stateRow);

    card.querySelector('[data-total-hours]')?.addEventListener('input', () => updateState(card));
    card.querySelector('[data-total-hours]')?.addEventListener('change', () => updateState(card));
    card.querySelector('[data-person-hours]')?.addEventListener('input', () => updateState(card));
    card.querySelector('[data-person-hours]')?.addEventListener('change', () => updateState(card));
    card.querySelector('[data-required-skill]')?.addEventListener('change', () => updateState(card));
    card.querySelectorAll('[data-shift-hours]').forEach((input) => {
      input.addEventListener('input', () => updateState(card));
      input.addEventListener('change', () => updateState(card));
    });

    dayButton.addEventListener('click', () => saveDay(card));
    shiftButton.addEventListener('click', () => saveShifts(card));

    updateState(card);
  }

  function enhanceAll() {
    document.querySelectorAll('.demand-card').forEach(enhanceCard);
  }

  document.addEventListener(
    'click',
    (event) => {
      const assign = event.target.closest?.('[data-assign]');
      if (!assign) return;

      const card = assign.closest('.demand-card');
      if (!card) return;

      const total = round2(card.querySelector('[data-total-hours]')?.value || 0);
      const dirtyDay = dayDirty(card);
      const dirtyShifts = shiftsDirty(card);
      const daySaved = card.dataset.dayDemandSaved === '1' && total > 0;

      if (dirtyDay || dirtyShifts || !daySaved) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const message = dirtyDay
          ? 'Najpierw kliknij „Zapisz dzień”.'
          : dirtyShifts
            ? 'Najpierw kliknij „Zapisz podział zmian”.'
            : 'Najpierw ustaw i zapisz zapotrzebowanie dnia.';

        setPageMessage(message, true);
      }
    },
    true
  );

  const grid = document.getElementById('demandGrid');
  if (grid) {
    new MutationObserver(() => enhanceAll()).observe(grid, {
      childList: true,
      subtree: false
    });
  }

  enhanceAll();
})();
