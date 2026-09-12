(() => {
  'use strict';

  const API_BASE = 'https://n8n-pi.taild8d05f.ts.net/webhook';
  const VIEW_URL = `${API_BASE}/workplan-time-plan`;
  const SAVE_URL = `${API_BASE}/workplan-time-plan-save`;
  const SKILLS_URL = `${API_BASE}/workplan-skills`;
  const STORAGE_KEY = 'workplan_user';

  const parse = (raw) => { try { return JSON.parse(raw || 'null'); } catch { return null; } };
  const user = parse(sessionStorage.getItem(STORAGE_KEY)) || parse(localStorage.getItem(STORAGE_KEY));
  if (!user?.userId) { location.replace('index.html'); return; }

  const canEdit = ['admin', 'leader'].includes(String(user.role || '').toLowerCase());
  const state = {
    data: null,
    skills: [],
    assignProcessId: '',
    assignShiftNo: 0,
    selectedIds: new Set()
  };

  const els = {
    date: document.getElementById('planDate'),
    shiftStrip: document.getElementById('shiftStrip'),
    demandGrid: document.getElementById('demandGrid'),
    message: document.getElementById('pageMessage'),
    shiftDrawer: document.getElementById('shiftDrawer'),
    shiftBackdrop: document.getElementById('shiftBackdrop'),
    shiftCount: document.getElementById('shiftCount'),
    shiftRows: document.getElementById('shiftEditorRows'),
    shiftMessage: document.getElementById('shiftMessage'),
    assignDrawer: document.getElementById('assignDrawer'),
    assignBackdrop: document.getElementById('assignBackdrop'),
    assignShiftTabs: document.getElementById('assignShiftTabs'),
    assignPeople: document.getElementById('assignPeople'),
    assignSearch: document.getElementById('assignEmployeeSearch'),
    assignMessage: document.getElementById('assignMessage'),
    assignButton: document.getElementById('assignSelectedBtn')
  };

  const display = user.displayName || user.login || 'Użytkownik';
  document.getElementById('userDisplay').textContent = display;
  document.getElementById('userAvatar').textContent = display.trim().charAt(0).toUpperCase() || 'U';
  document.getElementById('logoutBtn').onclick = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    location.replace('index.html');
  };
  document.getElementById('menuToggle')?.addEventListener('click', () => document.body.classList.toggle('nav-open'));

  const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' });
  const fmtHours = (n) => Number(n || 0).toLocaleString('pl-PL', { maximumFractionDigits: 2 });
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  function calcHours(a, b) {
    if (!a || !b) return 0;
    const [h1, m1] = a.split(':').map(Number);
    const [h2, m2] = b.split(':').map(Number);
    let minutes = h2 * 60 + m2 - (h1 * 60 + m1);
    if (minutes <= 0) minutes += 1440;
    return minutes / 60;
  }

  function shiftDuration(shift) { return calcHours(shift.startTime, shift.endTime); }
  function equalSplit(total, count) {
    if (!count) return [];
    const base = Math.floor((Number(total || 0) / count) * 100) / 100;
    const out = Array(count).fill(base);
    out[count - 1] = Math.round((Number(total || 0) - out.slice(0, -1).reduce((a, b) => a + b, 0)) * 100) / 100;
    return out;
  }
  function skillName(skillId) { return state.skills.find((s) => s.skillId === skillId)?.name || ''; }
  function demandFor(processId) { return (state.data?.demand || []).find((d) => d.processId === processId); }
  function planForUser(userId) { return (state.data?.plans || []).find((p) => p.userId === userId); }
  function plansForProcess(processId) { return (state.data?.plans || []).filter((p) => p.processId === processId); }
  function shiftByNo(no) { return (state.data?.shifts || []).find((s) => Number(s.shiftNo) === Number(no)); }

  function setSummary() {
    const d = state.data;
    document.getElementById('summaryShifts').textContent = d?.summary?.activeShifts ?? 0;
    document.getElementById('summaryRequired').textContent = fmtHours(d?.summary?.requiredHours);
    document.getElementById('summaryAssigned').textContent = fmtHours(d?.summary?.assignedHours);
    document.getElementById('summaryEmployees').textContent = d?.summary?.plannedEmployees ?? 0;
  }

  function renderShifts() {
    const shifts = state.data?.shifts || [];
    els.shiftStrip.innerHTML = shifts.length
      ? shifts.map((s) => `<button class="shift-card" type="button" data-shift="${s.shiftNo}"><div><span>Zmiana ${s.shiftNo}</span><strong>${esc(s.name)}</strong></div><div><time>${esc(s.startTime)}–${esc(s.endTime)}</time><span>${fmtHours(shiftDuration(s))} h</span></div></button>`).join('')
      : '<div class="shift-card empty"><strong>Brak konfiguracji zmian</strong><span>Ustaw przynajmniej jedną zmianę dla tego dnia.</span></div>';
    els.shiftStrip.querySelectorAll('[data-shift]').forEach((button) => { button.onclick = openShiftDrawer; });
  }

  function skillOptions(selectedId) {
    const active = state.skills.filter((s) => s.active !== false);
    const current = state.skills.find((s) => s.skillId === selectedId);
    const list = current && !active.some((s) => s.skillId === current.skillId) ? [current, ...active] : active;
    return `<option value="">Brak wymaganego skilla</option>${list.map((s) => `<option value="${esc(s.skillId)}" ${s.skillId === selectedId ? 'selected' : ''}>${esc(s.name)}${s.active === false ? ' · nieaktywny' : ''}</option>`).join('')}`;
  }

  function assignedPills(processId) {
    const plans = plansForProcess(processId);
    if (!plans.length) return '';
    return plans
      .slice()
      .sort((a, b) => Number(a.shiftNo) - Number(b.shiftNo) || String(a.displayName || '').localeCompare(String(b.displayName || ''), 'pl'))
      .map((p) => `<span class="assigned-pill"><em>Z${p.shiftNo}</em><b>${esc(p.displayName || p.userId)}</b><span>${esc(p.startTime)}–${esc(p.endTime)}</span>${canEdit ? `<button type="button" data-unassign-user="${esc(p.userId)}" aria-label="Usuń przypisanie">×</button>` : ''}</span>`)
      .join('');
  }

  function renderDemand() {
    const shifts = state.data?.shifts || [];
    const demand = state.data?.demand || [];

    els.demandGrid.innerHTML = demand.map((d) => {
      const savedByShift = shifts.map((s) => Number(d.shiftParts?.find((x) => Number(x.shiftNo) === Number(s.shiftNo))?.requiredHours || 0));
      const savedSum = savedByShift.reduce((a, b) => a + b, 0);
      const requiredByShift = savedSum > 0 || Number(d.totalHours || 0) === 0 ? savedByShift : equalSplit(Number(d.totalHours || 0), shifts.length);
      const covered = Number(d.assignedHours || 0) >= Number(d.totalHours || 0);
      const requiredPeople = Number(d.totalHours || 0) > 0 ? Math.ceil(Number(d.totalHours || 0) / (Number(d.defaultHoursPerPerson || 8) || 8)) : 0;
      const gap = Number(d.assignedHours || 0) - Number(d.totalHours || 0);
      const coverageText = covered ? `Pokryte · +${fmtHours(Math.max(0, gap))} h` : `Brakuje ${fmtHours(Math.abs(gap))} h`;

      const shiftRail = shifts.map((s, index) => {
        const part = d.shiftParts?.find((x) => Number(x.shiftNo) === Number(s.shiftNo)) || {};
        const required = Number(requiredByShift[index] || 0);
        const assigned = Number(part.assignedHours || 0);
        const ok = assigned >= required;
        const pct = required > 0 ? Math.min(100, Math.round((assigned / required) * 100)) : (assigned > 0 ? 100 : 0);
        return `<div class="shift-demand-cell ${ok ? 'ok' : 'shortage'}" data-shift-cell="${s.shiftNo}"><div class="shift-demand-label"><strong>Z${s.shiftNo} · ${esc(s.startTime)}–${esc(s.endTime)}</strong><span><b data-shift-assigned>${fmtHours(assigned)}</b> / <b data-shift-required-label>${fmtHours(required)}</b> h</span></div><div class="shift-demand-input"><input type="number" min="0" step="0.25" data-shift-hours="${s.shiftNo}" value="${required}" ${canEdit ? '' : 'disabled'}><small>h</small></div><div class="shift-coverage-line"><span style="width:${pct}%"></span></div></div>`;
      }).join('');

      return `<article class="demand-card ${covered ? 'covered' : ''}" data-process="${esc(d.processId)}" data-assigned="${Number(d.assignedHours || 0)}">
        <div class="demand-main">
          <div class="process-name"><strong>${esc(d.name)}</strong><small><b data-required-people>${requiredPeople}</b> os. przy <b data-person-hours-label>${fmtHours(d.defaultHoursPerPerson || 8)}</b> h/os.</small></div>
          <div class="process-skill"><label>Wymagany skill</label><select data-required-skill ${canEdit ? '' : 'disabled'}>${skillOptions(d.requiredSkillId || '')}</select></div>
          <div class="metric-input"><label>Zapotrzebowanie</label><input type="number" min="0" step="0.25" data-total-hours value="${Number(d.totalHours || 0)}" ${canEdit ? '' : 'disabled'}></div>
          <div class="metric-input"><label>h / osobę</label><input type="number" min="0.25" max="24" step="0.25" data-person-hours value="${Number(d.defaultHoursPerPerson || 8)}" ${canEdit ? '' : 'disabled'}></div>
          <div class="coverage ${covered ? 'ok' : 'shortage'}"><strong><b data-assigned-total>${fmtHours(d.assignedHours)}</b> / <b data-required-total>${fmtHours(d.totalHours)}</b> h</strong><span data-coverage-text>${coverageText}</span></div>
          <div class="demand-actions"><button class="primary-button assign-button" type="button" data-assign ${canEdit && shifts.length ? '' : 'disabled'}>Przypisz osoby</button><button class="secondary-button demand-save" type="button" data-save-demand ${canEdit ? '' : 'disabled'}>Zapisz zapotrzebowanie</button></div>
        </div>
        <div class="shift-demand-rail">${shiftRail || '<div class="process-demand-note">Najpierw skonfiguruj zmiany dla tego dnia.</div>'}</div>
        <div class="assigned-people">${assignedPills(d.processId)}</div>
      </article>`;
    }).join('');

    els.demandGrid.querySelectorAll('.demand-card').forEach((card) => {
      const demandRow = demandFor(card.dataset.process);
      const total = card.querySelector('[data-total-hours]');
      const personHours = card.querySelector('[data-person-hours]');
      const skill = card.querySelector('[data-required-skill]');
      const shiftInputs = [...card.querySelectorAll('[data-shift-hours]')];

      const refresh = () => refreshDemandCard(card);
      total?.addEventListener('change', () => {
        const split = equalSplit(Number(total.value || 0), shiftInputs.length);
        shiftInputs.forEach((input, index) => { input.value = split[index] ?? 0; });
        refresh();
      });
      total?.addEventListener('input', refresh);
      personHours?.addEventListener('input', refresh);
      shiftInputs.forEach((input) => input.addEventListener('input', refresh));
      skill?.addEventListener('change', () => { if (demandRow) demandRow.requiredSkillId = skill.value; });
      card.querySelector('[data-save-demand]')?.addEventListener('click', () => saveDemand(card));
      card.querySelector('[data-assign]')?.addEventListener('click', () => openAssignDrawer(card.dataset.process));
      card.querySelectorAll('[data-unassign-user]').forEach((button) => button.addEventListener('click', (event) => {
        event.stopPropagation();
        cancelPlan(button.dataset.unassignUser);
      }));
    });
  }

  function refreshDemandCard(card) {
    const total = Number(card.querySelector('[data-total-hours]')?.value || 0);
    const hpp = Math.max(0.25, Number(card.querySelector('[data-person-hours]')?.value || 8));
    const assigned = Number(card.dataset.assigned || 0);
    const requiredPeople = total > 0 ? Math.ceil(total / hpp) : 0;
    card.querySelector('[data-required-people]').textContent = requiredPeople;
    card.querySelector('[data-person-hours-label]').textContent = fmtHours(hpp);
    card.querySelector('[data-required-total]').textContent = fmtHours(total);
    const gap = assigned - total;
    const ok = assigned >= total;
    card.classList.toggle('covered', ok);
    const coverage = card.querySelector('.coverage');
    coverage.classList.toggle('ok', ok);
    coverage.classList.toggle('shortage', !ok);
    card.querySelector('[data-coverage-text]').textContent = ok ? `Pokryte · +${fmtHours(Math.max(0, gap))} h` : `Brakuje ${fmtHours(Math.abs(gap))} h`;

    card.querySelectorAll('[data-shift-cell]').forEach((cell) => {
      const required = Number(cell.querySelector('[data-shift-hours]')?.value || 0);
      const assignedShift = Number(cell.querySelector('[data-shift-assigned]')?.textContent.replace(',', '.') || 0);
      const shiftOk = assignedShift >= required;
      cell.classList.toggle('ok', shiftOk);
      cell.classList.toggle('shortage', !shiftOk);
      cell.querySelector('[data-shift-required-label]').textContent = fmtHours(required);
      const pct = required > 0 ? Math.min(100, Math.round((assignedShift / required) * 100)) : (assignedShift > 0 ? 100 : 0);
      cell.querySelector('.shift-coverage-line span').style.width = `${pct}%`;
    });
  }

  async function apiSave(payload, reload = true) {
    els.message.textContent = 'Zapisywanie…';
    const body = new URLSearchParams({ ...payload, requestedBy: user.userId, date: els.date.value });
    const response = await fetch(SAVE_URL, { method: 'POST', body, cache: 'no-store', credentials: 'omit' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.message || 'Nie udało się zapisać.');
    els.message.textContent = data.message || 'Zapisano.';
    if (reload) await load();
    return data;
  }

  async function saveDemand(card) {
    try {
      const shiftHours = [...card.querySelectorAll('[data-shift-hours]')].map((input) => ({ shiftNo: Number(input.dataset.shiftHours), requiredHours: Number(input.value || 0) }));
      await apiSave({
        action: 'demand',
        processId: card.dataset.process,
        requiredSkillId: card.querySelector('[data-required-skill]').value,
        totalHours: card.querySelector('[data-total-hours]').value,
        defaultHoursPerPerson: card.querySelector('[data-person-hours]').value,
        shiftHours: JSON.stringify(shiftHours)
      });
    } catch (error) { els.message.textContent = error.message; }
  }

  async function cancelPlan(userId) {
    const plan = planForUser(userId);
    if (!plan || !canEdit) return;
    try {
      await apiSave({ action: 'plan', userId, processId: plan.processId, shiftNo: plan.shiftNo, startTime: plan.startTime, endTime: plan.endTime, status: 'cancelled' });
    } catch (error) { els.message.textContent = error.message; }
  }

  function bestShiftForProcess(demand) {
    const shifts = state.data?.shifts || [];
    if (!shifts.length) return 0;
    const parts = demand?.shiftParts || [];
    const ranked = shifts.map((shift) => {
      const part = parts.find((p) => Number(p.shiftNo) === Number(shift.shiftNo));
      const gap = Number(part?.assignedHours || 0) - Number(part?.requiredHours || 0);
      return { shiftNo: Number(shift.shiftNo), gap };
    }).sort((a, b) => a.gap - b.gap);
    return ranked[0]?.shiftNo || Number(shifts[0].shiftNo);
  }

  function openAssignDrawer(processId) {
    if (!canEdit) return;
    const demand = demandFor(processId);
    if (!demand || !(state.data?.shifts || []).length) return;
    const card = els.demandGrid.querySelector(`[data-process="${CSS.escape(processId)}"]`);
    if (card) demand.requiredSkillId = card.querySelector('[data-required-skill]')?.value || demand.requiredSkillId || '';
    state.assignProcessId = processId;
    state.assignShiftNo = bestShiftForProcess(demand);
    state.selectedIds.clear();
    els.assignSearch.value = '';
    els.assignMessage.textContent = '';
    els.assignBackdrop.hidden = false;
    els.assignDrawer.classList.add('open');
    els.assignDrawer.setAttribute('aria-hidden', 'false');
    renderAssignDrawer();
  }

  function closeAssignDrawer() {
    els.assignBackdrop.hidden = true;
    els.assignDrawer.classList.remove('open');
    els.assignDrawer.setAttribute('aria-hidden', 'true');
    state.assignProcessId = '';
    state.assignShiftNo = 0;
    state.selectedIds.clear();
  }

  function renderAssignDrawer() {
    const demand = demandFor(state.assignProcessId);
    if (!demand) return;
    const shifts = state.data?.shifts || [];
    const requiredSkillId = demand.requiredSkillId || '';
    const requiredSkill = skillName(requiredSkillId);
    document.getElementById('assignProcessName').textContent = demand.name;
    document.getElementById('assignSkillBadge').textContent = requiredSkill ? `Wymagany skill: ${requiredSkill}` : 'Brak wymaganego skilla';
    document.getElementById('assignCoverageBadge').textContent = `${fmtHours(demand.assignedHours)} / ${fmtHours(demand.totalHours)} h`;

    els.assignShiftTabs.innerHTML = shifts.map((shift) => {
      const part = demand.shiftParts?.find((p) => Number(p.shiftNo) === Number(shift.shiftNo)) || {};
      const active = Number(shift.shiftNo) === Number(state.assignShiftNo);
      return `<button class="assign-shift-tab ${active ? 'active' : ''}" type="button" data-assign-shift="${shift.shiftNo}"><strong>Zmiana ${shift.shiftNo}</strong><span>${esc(shift.startTime)}–${esc(shift.endTime)}</span><small>${fmtHours(part.assignedHours)} / ${fmtHours(part.requiredHours)} h</small></button>`;
    }).join('');
    els.assignShiftTabs.querySelectorAll('[data-assign-shift]').forEach((button) => button.addEventListener('click', () => {
      state.assignShiftNo = Number(button.dataset.assignShift);
      state.selectedIds.clear();
      renderAssignDrawer();
    }));

    renderPeopleChoices();
    updateAssignFooter();
  }

  function renderPeopleChoices() {
    const demand = demandFor(state.assignProcessId);
    if (!demand) return;
    const requiredSkillId = demand.requiredSkillId || '';
    const q = els.assignSearch.value.trim().toLowerCase();
    const employees = (state.data?.employees || []).filter((e) => e.available !== false).filter((e) => !q || `${e.displayName || ''} ${e.login || ''}`.toLowerCase().includes(q));
    const matching = requiredSkillId ? employees.filter((e) => (e.skillIds || []).includes(requiredSkillId)) : [];
    const others = requiredSkillId ? employees.filter((e) => !(e.skillIds || []).includes(requiredSkillId)) : employees;

    const groupHtml = (title, subtitle, list, qualified) => `<section class="people-group"><div class="people-group-head"><strong>${esc(title)}</strong><span>${list.length} osób</span></div>${list.length ? list.map((employee) => personChoiceHtml(employee, qualified)).join('') : `<div class="people-empty">${esc(subtitle)}</div>`}</section>`;

    els.assignPeople.innerHTML = requiredSkillId
      ? groupHtml(`Mają skill: ${skillName(requiredSkillId) || 'wymagany'}`, 'Brak dostępnych osób z wymaganym skillem.', matching, true) + groupHtml('Bez wymaganego skilla', 'Brak pozostałych dostępnych osób.', others, false)
      : groupHtml('Dostępni pracownicy', 'Brak dostępnych pracowników w tym dniu.', others, false);

    els.assignPeople.querySelectorAll('.person-choice').forEach((row) => {
      const checkbox = row.querySelector('input');
      if (checkbox.disabled) return;
      row.addEventListener('click', (event) => {
        if (event.target === checkbox) return;
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
      });
      checkbox.addEventListener('change', () => {
        checkbox.checked ? state.selectedIds.add(row.dataset.userId) : state.selectedIds.delete(row.dataset.userId);
        row.classList.toggle('selected', checkbox.checked);
        updateAssignFooter();
      });
    });
  }

  function personChoiceHtml(employee, qualified) {
    const plan = planForUser(employee.userId);
    const same = plan && plan.processId === state.assignProcessId && Number(plan.shiftNo) === Number(state.assignShiftNo);
    const selected = state.selectedIds.has(employee.userId);
    let planLabel = 'Wolny w planie';
    let planClass = 'free';
    if (same) { planLabel = `Już przypisany · Z${plan.shiftNo} · ${plan.startTime}–${plan.endTime}`; planClass = ''; }
    else if (plan) { planLabel = `Zastąpi: ${plan.processName} · Z${plan.shiftNo} · ${plan.startTime}–${plan.endTime}`; planClass = 'conflict'; }
    const role = employee.role === 'leader' ? 'Lider' : 'Pracownik';
    return `<label class="person-choice ${selected ? 'selected' : ''} ${same ? 'already' : ''}" data-user-id="${esc(employee.userId)}"><input type="checkbox" ${selected ? 'checked' : ''} ${same ? 'disabled' : ''}><div class="person-info"><strong>${esc(employee.displayName)}</strong><span>${role}${qualified ? ' · ma wymagany skill' : ''}</span></div><div class="person-plan-state ${planClass}">${esc(planLabel)}</div></label>`;
  }

  function updateAssignFooter() {
    const count = state.selectedIds.size;
    const shift = shiftByNo(state.assignShiftNo);
    const hours = count * (shift ? shiftDuration(shift) : 0);
    document.getElementById('assignSelectedCount').textContent = `${count} ${count === 1 ? 'osoba' : 'osób'}`;
    document.getElementById('assignSelectedHours').textContent = `${fmtHours(hours)} h do przypisania`;
    els.assignButton.disabled = !canEdit || !count || !shift;
  }

  async function assignSelected() {
    if (!state.selectedIds.size || !state.assignProcessId || !state.assignShiftNo) return;
    const shift = shiftByNo(state.assignShiftNo);
    if (!shift) return;
    els.assignButton.disabled = true;
    els.assignMessage.textContent = 'Zapisywanie przypisania…';
    try {
      await apiSave({
        action: 'bulkPlan',
        userIds: JSON.stringify([...state.selectedIds]),
        processId: state.assignProcessId,
        shiftNo: state.assignShiftNo,
        startTime: shift.startTime,
        endTime: shift.endTime,
        status: 'active'
      });
      closeAssignDrawer();
    } catch (error) {
      els.assignMessage.textContent = error.message || 'Nie udało się przypisać pracowników.';
      els.assignButton.disabled = false;
    }
  }

  function openShiftDrawer() {
    if (!canEdit) return;
    const shifts = state.data?.shifts || [];
    els.shiftCount.value = String(Math.max(1, shifts.length || 1));
    renderShiftEditors();
    els.shiftBackdrop.hidden = false;
    els.shiftDrawer.classList.add('open');
  }
  function closeShiftDrawer() { els.shiftBackdrop.hidden = true; els.shiftDrawer.classList.remove('open'); }
  function renderShiftEditors() {
    const count = Number(els.shiftCount.value);
    const current = state.data?.shifts || [];
    const defaults = [['06:00', '14:00'], ['14:00', '22:00'], ['22:00', '06:00'], ['06:00', '18:00'], ['18:00', '06:00'], ['08:00', '16:00']];
    els.shiftRows.innerHTML = Array.from({ length: count }, (_, i) => {
      const no = i + 1;
      const s = current.find((x) => x.shiftNo === no);
      return `<div class="shift-edit-row" data-no="${no}"><div class="shift-number">Z${no}</div><input class="shift-name" type="text" maxlength="80" value="${esc(s?.name || `Zmiana ${no}`)}"><input data-start type="time" value="${s?.startTime || defaults[i][0]}"><input data-end type="time" value="${s?.endTime || defaults[i][1]}"></div>`;
    }).join('');
  }
  async function saveShifts(event) {
    event.preventDefault();
    els.shiftMessage.textContent = '';
    const shifts = [...els.shiftRows.querySelectorAll('.shift-edit-row')].map((row) => ({ shiftNo: Number(row.dataset.no), name: row.querySelector('.shift-name').value.trim(), startTime: row.querySelector('[data-start]').value, endTime: row.querySelector('[data-end]').value, active: true }));
    try { await apiSave({ action: 'shifts', shifts: JSON.stringify(shifts) }); closeShiftDrawer(); }
    catch (error) { els.shiftMessage.textContent = error.message; }
  }

  async function load() {
    els.message.textContent = '';
    const [viewResponse, skillResponse] = await Promise.all([
      fetch(`${VIEW_URL}?date=${encodeURIComponent(els.date.value)}`, { cache: 'no-store', credentials: 'omit' }),
      fetch(SKILLS_URL, { cache: 'no-store', credentials: 'omit' })
    ]);
    const [data, skillData] = await Promise.all([viewResponse.json().catch(() => ({})), skillResponse.json().catch(() => ({}))]);
    if (!viewResponse.ok || !data.ok) throw new Error(data.message || 'Nie udało się pobrać planu.');
    state.data = data;
    state.skills = skillResponse.ok && skillData.ok && Array.isArray(skillData.skills) ? skillData.skills : [];
    setSummary();
    renderShifts();
    renderDemand();
  }
  async function safeLoad() { try { await load(); } catch (error) { els.message.textContent = error.message; } }
  function moveDay(delta) {
    const d = new Date(`${els.date.value}T12:00:00`);
    d.setDate(d.getDate() + delta);
    els.date.value = d.toISOString().slice(0, 10);
    safeLoad();
  }

  els.date.value = today();
  els.date.onchange = safeLoad;
  document.getElementById('prevDay').onclick = () => moveDay(-1);
  document.getElementById('nextDay').onclick = () => moveDay(1);
  document.getElementById('todayBtn').onclick = () => { els.date.value = today(); safeLoad(); };
  document.getElementById('configureShiftsBtn').onclick = openShiftDrawer;
  document.getElementById('shiftDrawerClose').onclick = closeShiftDrawer;
  document.getElementById('shiftCancel').onclick = closeShiftDrawer;
  els.shiftBackdrop.onclick = closeShiftDrawer;
  els.shiftCount.onchange = renderShiftEditors;
  document.getElementById('shiftForm').onsubmit = saveShifts;
  document.getElementById('assignDrawerClose').onclick = closeAssignDrawer;
  els.assignBackdrop.onclick = closeAssignDrawer;
  els.assignSearch.oninput = renderPeopleChoices;
  els.assignButton.onclick = assignSelected;
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (els.assignDrawer.classList.contains('open')) closeAssignDrawer();
    else if (els.shiftDrawer.classList.contains('open')) closeShiftDrawer();
  });
  if (!canEdit) document.getElementById('configureShiftsBtn').disabled = true;

  safeLoad();
})();
