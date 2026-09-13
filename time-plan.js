(() => {
  'use strict';

  const API_BASE = 'https://n8n-pi.taild8d05f.ts.net/webhook';
  const VIEW_URL = `${API_BASE}/workplan-time-plan`;
  const SAVE_URL = `${API_BASE}/workplan-time-plan-save`;
  const SKILLS_URL = `${API_BASE}/workplan-skills`;
  const TEMPLATES_URL = `${API_BASE}/workplan-shift-templates`;
  const TEMPLATE_MANAGE_URL = `${API_BASE}/workplan-shift-template-manage`;
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

  const canEdit = ['admin', 'leader'].includes(
    String(user.role || '').toLowerCase()
  );

  const state = {
    data: null,
    skills: [],
    templates: [],
    selectedTemplateId: '',
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
    assignButton: document.getElementById('assignSelectedBtn'),
    templateDrawer: document.getElementById('templateDrawer'),
    templateBackdrop: document.getElementById('templateBackdrop'),
    templateName: document.getElementById('templateName'),
    templateScope: document.getElementById('templateScope'),
    templateMessage: document.getElementById('templateMessage'),
    templateList: document.getElementById('templateList'),
    templateApplyPanel: document.getElementById('templateApplyPanel'),
    templateDateFrom: document.getElementById('templateDateFrom'),
    templateDateTo: document.getElementById('templateDateTo')
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
    new Date().toLocaleDateString('sv-SE', {
      timeZone: 'Europe/Warsaw'
    });

  const fmtHours = (n) =>
    Number(n || 0).toLocaleString('pl-PL', {
      maximumFractionDigits: 2
    });

  const esc = (v) =>
    String(v ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');

  const roundHours = (n) => Math.round(Number(n || 0) * 100) / 100;

  function addDays(iso, days) {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + Number(days || 0));
    return d.toISOString().slice(0, 10);
  }

  function mondayOf(iso) {
    const d = new Date(`${iso}T12:00:00`);
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d.toISOString().slice(0, 10);
  }

  function endOfMonth(iso) {
    const [y, m] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0, 12)).toISOString().slice(0, 10);
  }

  function calcHours(a, b) {
    if (!a || !b) return 0;

    const [h1, m1] = a.split(':').map(Number);
    const [h2, m2] = b.split(':').map(Number);

    let minutes = h2 * 60 + m2 - (h1 * 60 + m1);

    if (minutes <= 0) minutes += 1440;

    return minutes / 60;
  }

  function shiftDuration(shift) {
    return calcHours(shift.startTime, shift.endTime);
  }

  function skillName(skillId) {
    return state.skills.find((s) => s.skillId === skillId)?.name || '';
  }

  function employeeSkillNames(employee) {
    return (employee?.skillIds || []).map(skillName).filter(Boolean);
  }

  function demandFor(processId) {
    return (state.data?.demand || []).find((d) => d.processId === processId);
  }

  function planForUser(userId) {
    return (state.data?.plans || []).find((p) => p.userId === userId);
  }

  function plansForProcess(processId) {
    return (state.data?.plans || []).filter(
      (p) => p.processId === processId
    );
  }

  function shiftByNo(no) {
    return (state.data?.shifts || []).find(
      (s) => Number(s.shiftNo) === Number(no)
    );
  }

  function setSummary() {
    const d = state.data;

    document.getElementById('summaryShifts').textContent =
      d?.summary?.activeShifts ?? 0;

    document.getElementById('summaryRequired').textContent =
      fmtHours(d?.summary?.requiredHours);

    document.getElementById('summaryAssigned').textContent =
      fmtHours(d?.summary?.assignedHours);

    document.getElementById('summaryEmployees').textContent =
      d?.summary?.plannedEmployees ?? 0;
  }

  function renderShifts() {
    const shifts = state.data?.shifts || [];

    els.shiftStrip.innerHTML = shifts.length
      ? shifts
          .map(
            (s) => `
              <button
                class="shift-card"
                type="button"
                data-shift="${s.shiftNo}"
              >
                <div>
                  <span>Zmiana ${s.shiftNo}</span>
                  <strong>${esc(s.name)}</strong>
                </div>
                <div>
                  <time>${esc(s.startTime)}–${esc(s.endTime)}</time>
                  <span>${fmtHours(shiftDuration(s))} h</span>
                </div>
              </button>
            `
          )
          .join('')
      : `
          <div class="shift-card empty">
            <strong>Brak konfiguracji zmian</strong>
            <span>Ustaw przynajmniej jedną zmianę dla tego dnia.</span>
          </div>
        `;

    els.shiftStrip
      .querySelectorAll('[data-shift]')
      .forEach((button) => {
        button.onclick = openShiftDrawer;
      });
  }

  function skillOptions(selectedId) {
    const active = state.skills.filter((s) => s.active !== false);
    const current = state.skills.find((s) => s.skillId === selectedId);

    const list =
      current && !active.some((s) => s.skillId === current.skillId)
        ? [current, ...active]
        : active;

    return `
      <option value="">Brak wymaganego skilla</option>
      ${list
        .map(
          (s) => `
            <option
              value="${esc(s.skillId)}"
              ${s.skillId === selectedId ? 'selected' : ''}
            >
              ${esc(s.name)}${s.active === false ? ' · nieaktywny' : ''}
            </option>
          `
        )
        .join('')}
    `;
  }

  function assignedPills(processId) {
    const plans = plansForProcess(processId);

    if (!plans.length) return '';

    return plans
      .slice()
      .sort(
        (a, b) =>
          Number(a.shiftNo) - Number(b.shiftNo) ||
          String(a.displayName || '').localeCompare(
            String(b.displayName || ''),
            'pl'
          )
      )
      .map(
        (p) => `
          <span class="assigned-pill">
            <em>Z${p.shiftNo}</em>
            <b>${esc(p.displayName || p.userId)}</b>
            <span>${esc(p.startTime)}–${esc(p.endTime)}</span>
            ${
              canEdit
                ? `
                    <button
                      type="button"
                      data-unassign-user="${esc(p.userId)}"
                    >
                      Usuń
                    </button>
                  `
                : ''
            }
          </span>
        `
      )
      .join('');
  }

  function renderDemand() {
    const shifts = state.data?.shifts || [];
    const demand = state.data?.demand || [];

    els.demandGrid.innerHTML = demand
      .map((d) => {
        /*
         * Zapotrzebowanie dnia i zapotrzebowanie zmian są niezależne.
         * Nie wykonujemy equalSplit ani nie wyliczamy totalHours z sumy zmian.
         */
        const requiredByShift = shifts.map((s) =>
          roundHours(
            Math.max(
              0,
              Number(
                d.shiftParts?.find(
                  (x) => Number(x.shiftNo) === Number(s.shiftNo)
                )?.requiredHours || 0
              )
            )
          )
        );

        const totalHours = roundHours(
          Math.max(0, Number(d.totalHours || 0))
        );

        const assignedHours = roundHours(
          Math.max(0, Number(d.assignedHours || 0))
        );

        const defaultHoursPerPerson = Math.max(
          0.25,
          Number(d.defaultHoursPerPerson || 8)
        );

        const covered = assignedHours >= totalHours;

        const requiredPeople =
          totalHours > 0
            ? Math.ceil(totalHours / defaultHoursPerPerson)
            : 0;

        const gap = roundHours(assignedHours - totalHours);

        const coverageText = covered
          ? `Pokryte · +${fmtHours(Math.max(0, gap))} h`
          : `Brakuje ${fmtHours(Math.abs(gap))} h`;

        const shiftRail = shifts
          .map((s, index) => {
            const part =
              d.shiftParts?.find(
                (x) => Number(x.shiftNo) === Number(s.shiftNo)
              ) || {};

            const required = requiredByShift[index] || 0;
            const assigned = roundHours(
              Math.max(0, Number(part.assignedHours || 0))
            );

            const ok = assigned >= required;

            const pct =
              required > 0
                ? Math.min(
                    100,
                    Math.round((assigned / required) * 100)
                  )
                : assigned > 0
                  ? 100
                  : 0;

            return `
              <div
                class="shift-demand-cell ${ok ? 'ok' : 'shortage'}"
                data-shift-cell="${s.shiftNo}"
              >
                <div class="shift-demand-label">
                  <strong>
                    Z${s.shiftNo} · ${esc(s.startTime)}–${esc(s.endTime)}
                  </strong>
                  <span>
                    <b data-shift-assigned>${fmtHours(assigned)}</b>
                    /
                    <b data-shift-required-label>${fmtHours(required)}</b>
                    h
                  </span>
                </div>

                <div class="shift-demand-input">
                  <input
                    type="number"
                    min="0"
                    step="0.25"
                    data-shift-hours="${s.shiftNo}"
                    value="${required}"
                    ${canEdit ? '' : 'disabled'}
                  >
                  <small>h</small>
                </div>

                <div class="shift-coverage-line">
                  <span style="width:${pct}%"></span>
                </div>
              </div>
            `;
          })
          .join('');

        return `
          <article
            class="demand-card ${covered ? 'covered' : ''}"
            data-process="${esc(d.processId)}"
            data-assigned="${assignedHours}"
          >
            <div class="demand-main">
              <div class="process-name">
                <strong>${esc(d.name)}</strong>
                <small>
                  <b data-required-people>${requiredPeople}</b>
                  os. przy
                  <b data-person-hours-label>
                    ${fmtHours(defaultHoursPerPerson)}
                  </b>
                  h/os.
                </small>
              </div>

              <div class="process-skill">
                <label>Wymagany skill</label>
                <select
                  data-required-skill
                  ${canEdit ? '' : 'disabled'}
                >
                  ${skillOptions(d.requiredSkillId || '')}
                </select>
              </div>

              <div class="metric-input daily-demand">
                <label>Zapotrzebowanie dzień</label>
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  data-total-hours
                  value="${totalHours}"
                  ${canEdit ? '' : 'disabled'}
                >
              </div>

              <div class="metric-input">
                <label>h / osobę</label>
                <input
                  type="number"
                  min="0.25"
                  max="24"
                  step="0.25"
                  data-person-hours
                  value="${defaultHoursPerPerson}"
                  ${canEdit ? '' : 'disabled'}
                >
              </div>

              <div class="coverage ${covered ? 'ok' : 'shortage'}">
                <strong>
                  <b data-assigned-total>${fmtHours(assignedHours)}</b>
                  /
                  <b data-required-total>${fmtHours(totalHours)}</b>
                  h
                </strong>
                <span data-coverage-text>${coverageText}</span>
              </div>

              <div class="demand-actions">
                <button
                  class="primary-button assign-button"
                  type="button"
                  data-assign
                  ${canEdit && shifts.length ? '' : 'disabled'}
                >
                  Przypisz osoby
                </button>

                <button
                  class="secondary-button demand-save"
                  type="button"
                  data-save-demand
                  ${canEdit ? '' : 'disabled'}
                >
                  Zapisz zapotrzebowanie
                </button>
              </div>
            </div>

            <div class="daily-demand-block">
              <div>
                <strong>Podział zapotrzebowania na zmiany</strong>
                <small data-distribution-detail></small>
              </div>
              <span data-distribution-summary></span>
            </div>

            <div class="shift-demand-rail">
              ${
                shiftRail ||
                `
                  <div class="process-demand-note">
                    Najpierw skonfiguruj zmiany dla tego dnia.
                  </div>
                `
              }
            </div>

            <div class="assigned-people">
              ${assignedPills(d.processId)}
            </div>
          </article>
        `;
      })
      .join('');

    els.demandGrid
      .querySelectorAll('.demand-card')
      .forEach((card) => {
        const demandRow = demandFor(card.dataset.process);
        const totalInput = card.querySelector('[data-total-hours]');
        const personHoursInput =
          card.querySelector('[data-person-hours]');
        const skillInput =
          card.querySelector('[data-required-skill]');
        const shiftInputs = [
          ...card.querySelectorAll('[data-shift-hours]')
        ];

        const refresh = () => refreshDemandCard(card);

        /*
         * Zmiana wartości jednej zmiany odświeża wyłącznie walidację.
         * Nie zmienia wartości zapotrzebowania dnia.
         */
        totalInput?.addEventListener('input', refresh);
        totalInput?.addEventListener('change', refresh);
        personHoursInput?.addEventListener('input', refresh);

        shiftInputs.forEach((input) => {
          input.addEventListener('input', refresh);
          input.addEventListener('change', refresh);
        });

        skillInput?.addEventListener('change', () => {
          if (demandRow) {
            demandRow.requiredSkillId = skillInput.value;
          }
        });

        card
          .querySelector('[data-save-demand]')
          ?.addEventListener('click', () => saveDemand(card));

        card
          .querySelector('[data-assign]')
          ?.addEventListener('click', () =>
            openAssignDrawer(card.dataset.process)
          );

        card
          .querySelectorAll('[data-unassign-user]')
          .forEach((button) =>
            button.addEventListener('click', (event) => {
              event.stopPropagation();
              cancelPlan(button.dataset.unassignUser);
            })
          );

        refreshDemandCard(card);
      });
  }

  function refreshDemandCard(card) {
    const total = roundHours(
      Math.max(
        0,
        Number(
          card.querySelector('[data-total-hours]')?.value || 0
        )
      )
    );

    const hpp = Math.max(
      0.25,
      Number(
        card.querySelector('[data-person-hours]')?.value || 8
      )
    );

    const assigned = roundHours(
      Math.max(0, Number(card.dataset.assigned || 0))
    );

    const shiftInputs = [
      ...card.querySelectorAll('[data-shift-hours]')
    ];

    const distributed = roundHours(
      shiftInputs.reduce(
        (sum, input) =>
          sum + Math.max(0, Number(input.value || 0)),
        0
      )
    );

    const diff = roundHours(total - distributed);
    const balanced = Math.abs(diff) <= 0.02;

    const status = card.querySelector('.daily-demand-block');

    status?.classList.toggle('ok', balanced);
    status?.classList.toggle('pending', !balanced);

    const summary = status?.querySelector(
      '[data-distribution-summary]'
    );

    const detail = status?.querySelector(
      '[data-distribution-detail]'
    );

    if (summary) {
      summary.textContent =
        `Rozdzielono ${fmtHours(distributed)} / ${fmtHours(total)} h`;
    }

    if (detail) {
      detail.textContent = balanced
        ? 'Całe zapotrzebowanie dnia jest rozdzielone na zmiany.'
        : diff > 0
          ? `Pozostało ${fmtHours(diff)} h do rozdzielenia między zmiany.`
          : `Przekroczono zapotrzebowanie dnia o ${fmtHours(
              Math.abs(diff)
            )} h.`;
    }

    const saveButton =
      card.querySelector('[data-save-demand]');

    if (saveButton) {
      saveButton.disabled = !canEdit || !balanced;
      saveButton.title = balanced
        ? ''
        : 'Suma godzin na zmianach musi być równa zapotrzebowaniu dnia.';
    }

    const requiredPeople =
      total > 0 ? Math.ceil(total / hpp) : 0;

    card.querySelector('[data-required-people]').textContent =
      requiredPeople;

    card.querySelector('[data-person-hours-label]').textContent =
      fmtHours(hpp);

    card.querySelector('[data-required-total]').textContent =
      fmtHours(total);

    const gap = roundHours(assigned - total);
    const covered = assigned >= total;

    card.classList.toggle('covered', covered);

    const coverage = card.querySelector('.coverage');

    coverage?.classList.toggle('ok', covered);
    coverage?.classList.toggle('shortage', !covered);

    const coverageText =
      card.querySelector('[data-coverage-text]');

    if (coverageText) {
      coverageText.textContent = covered
        ? `Pokryte · +${fmtHours(Math.max(0, gap))} h`
        : `Brakuje ${fmtHours(Math.abs(gap))} h`;
    }

    card
      .querySelectorAll('[data-shift-cell]')
      .forEach((cell) => {
        const required = roundHours(
          Math.max(
            0,
            Number(
              cell.querySelector('[data-shift-hours]')?.value || 0
            )
          )
        );

        const assignedText =
          cell.querySelector('[data-shift-assigned]')
            ?.textContent || '0';

        const assignedShift =
          Number(
            assignedText
              .replace(/\s/g, '')
              .replace(',', '.')
          ) || 0;

        const shiftCovered = assignedShift >= required;

        cell.classList.toggle('ok', shiftCovered);
        cell.classList.toggle('shortage', !shiftCovered);

        const requiredLabel = cell.querySelector(
          '[data-shift-required-label]'
        );

        if (requiredLabel) {
          requiredLabel.textContent = fmtHours(required);
        }

        const pct =
          required > 0
            ? Math.min(
                100,
                Math.round((assignedShift / required) * 100)
              )
            : assignedShift > 0
              ? 100
              : 0;

        const bar = cell.querySelector(
          '.shift-coverage-line span'
        );

        if (bar) {
          bar.style.width = `${pct}%`;
        }
      });
  }

  async function apiSave(payload, reload = true) {
    els.message.textContent = 'Zapisywanie…';

    const body = new URLSearchParams({
      ...payload,
      requestedBy: user.userId,
      date: els.date.value
    });

    const response = await fetch(SAVE_URL, {
      method: 'POST',
      body,
      cache: 'no-store',
      credentials: 'omit'
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.ok) {
      throw new Error(
        data.message || 'Nie udało się zapisać.'
      );
    }

    els.message.textContent =
      data.message || 'Zapisano.';

    if (reload) {
      await load();
    }

    return data;
  }

  async function saveDemand(card) {
    try {
      /*
       * totalHours jest odczytywane bezpośrednio z osobnego pola dnia.
       * Nie jest wyliczane z pierwszej zmiany ani z sumy zmian.
       */
      const totalHours = roundHours(
        Math.max(
          0,
          Number(
            card.querySelector('[data-total-hours]')?.value || 0
          )
        )
      );

      const shiftHours = [
        ...card.querySelectorAll('[data-shift-hours]')
      ].map((input) => ({
        shiftNo: Number(input.dataset.shiftHours),
        requiredHours: roundHours(
          Math.max(0, Number(input.value || 0))
        )
      }));

      const distributed = roundHours(
        shiftHours.reduce(
          (sum, row) => sum + row.requiredHours,
          0
        )
      );

      if (Math.abs(distributed - totalHours) > 0.02) {
        throw new Error(
          `Nie zapisano. Rozdzielono ${fmtHours(
            distributed
          )} / ${fmtHours(totalHours)} h.`
        );
      }

      await apiSave({
        action: 'demand',
        processId: card.dataset.process,
        requiredSkillId:
          card.querySelector('[data-required-skill]')?.value || '',
        totalHours,
        defaultHoursPerPerson:
          card.querySelector('[data-person-hours]')?.value || 8,
        shiftHours: JSON.stringify(shiftHours)
      });
    } catch (error) {
      els.message.textContent =
        error.message || 'Nie udało się zapisać zapotrzebowania.';
    }
  }

  async function cancelPlan(userId) {
    const plan = planForUser(userId);

    if (!plan || !canEdit) return;

    const name = plan.displayName || userId;

    if (
      !window.confirm(
        `Usunąć ${name} z planu na ${els.date.value}?`
      )
    ) {
      return;
    }

    try {
      await apiSave({
        action: 'plan',
        userId,
        processId: plan.processId,
        shiftNo: plan.shiftNo,
        startTime: plan.startTime,
        endTime: plan.endTime,
        status: 'cancelled'
      });
    } catch (error) {
      els.message.textContent = error.message;
    }
  }

  function openAssignDrawer(processId) {
    if (!canEdit) return;

    const demand = demandFor(processId);

    if (!demand || !(state.data?.shifts || []).length) return;

    const card = els.demandGrid.querySelector(
      `[data-process="${CSS.escape(processId)}"]`
    );

    if (card) {
      demand.requiredSkillId =
        card.querySelector('[data-required-skill]')?.value ||
        demand.requiredSkillId ||
        '';
    }

    state.assignProcessId = processId;
    state.assignShiftNo = 0;
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

    document.getElementById('assignProcessName').textContent =
      demand.name;

    document.getElementById('assignSkillBadge').textContent =
      requiredSkill
        ? `Wymagany skill: ${requiredSkill}`
        : 'Brak wymaganego skilla';

    document.getElementById('assignCoverageBadge').textContent =
      `${fmtHours(demand.assignedHours)} / ${fmtHours(
        demand.totalHours
      )} h`;

    els.assignShiftTabs.innerHTML = shifts
      .map((shift) => {
        const part =
          demand.shiftParts?.find(
            (p) =>
              Number(p.shiftNo) === Number(shift.shiftNo)
          ) || {};

        const active =
          Number(shift.shiftNo) ===
          Number(state.assignShiftNo);

        return `
          <button
            class="assign-shift-tab ${active ? 'active' : ''}"
            type="button"
            data-assign-shift="${shift.shiftNo}"
          >
            <strong>Zmiana ${shift.shiftNo}</strong>
            <span>
              ${esc(shift.startTime)}–${esc(shift.endTime)}
            </span>
            <small>
              ${fmtHours(part.assignedHours)} /
              ${fmtHours(part.requiredHours)} h
            </small>
          </button>
        `;
      })
      .join('');

    els.assignShiftTabs
      .querySelectorAll('[data-assign-shift]')
      .forEach((button) =>
        button.addEventListener('click', () => {
          state.assignShiftNo =
            Number(button.dataset.assignShift);

          renderAssignDrawer();
        })
      );

    renderPeopleChoices();
    updateAssignFooter();
  }

  function renderPeopleChoices() {
    const demand = demandFor(state.assignProcessId);

    if (!demand) return;

    const requiredSkillId = demand.requiredSkillId || '';
    const q = els.assignSearch.value.trim().toLowerCase();

    const employees = (state.data?.employees || [])
      .filter((e) => e.available !== false)
      .filter((e) => {
        const haystack = `
          ${e.displayName || ''}
          ${e.login || ''}
          ${employeeSkillNames(e).join(' ')}
        `.toLowerCase();

        return !q || haystack.includes(q);
      });

    const matching = requiredSkillId
      ? employees.filter((e) =>
          (e.skillIds || []).includes(requiredSkillId)
        )
      : [];

    const others = requiredSkillId
      ? employees.filter(
          (e) =>
            !(e.skillIds || []).includes(requiredSkillId)
        )
      : employees;

    const groupHtml = (
      title,
      subtitle,
      list,
      qualified
    ) => `
      <section class="people-group">
        <div class="people-group-head">
          <strong>${esc(title)}</strong>
          <span>${list.length} osób</span>
        </div>

        ${
          list.length
            ? list
                .map((employee) =>
                  personChoiceHtml(employee, qualified)
                )
                .join('')
            : `<div class="people-empty">${esc(subtitle)}</div>`
        }
      </section>
    `;

    els.assignPeople.innerHTML = requiredSkillId
      ? groupHtml(
          `Mają skill: ${
            skillName(requiredSkillId) || 'wymagany'
          }`,
          'Brak dostępnych osób z wymaganym skillem.',
          matching,
          true
        ) +
        groupHtml(
          'Bez wymaganego skilla',
          'Brak pozostałych dostępnych osób.',
          others,
          false
        )
      : groupHtml(
          'Dostępni pracownicy',
          'Brak dostępnych pracowników w tym dniu.',
          others,
          false
        );

    els.assignPeople
      .querySelectorAll('.person-choice')
      .forEach((row) => {
        const checkbox = row.querySelector('input');

        row.addEventListener('click', (event) => {
          if (
            event.target === checkbox ||
            checkbox.disabled
          ) {
            return;
          }

          checkbox.checked = !checkbox.checked;
          checkbox.dispatchEvent(new Event('change'));
        });

        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            state.selectedIds.add(row.dataset.userId);
          } else {
            state.selectedIds.delete(row.dataset.userId);
          }

          row.classList.toggle(
            'selected',
            checkbox.checked
          );

          updateAssignFooter();
        });
      });
  }

  function personChoiceHtml(employee, qualified) {
    const plan = planForUser(employee.userId);

    const same = Boolean(
      state.assignShiftNo &&
      plan &&
      plan.processId === state.assignProcessId &&
      Number(plan.shiftNo) === Number(state.assignShiftNo)
    );

    const selected = state.selectedIds.has(employee.userId);

    let planLabel = 'Wolny w planie';
    let planClass = 'free';

    if (same) {
      planLabel =
        `Już przypisany · Z${plan.shiftNo} · ` +
        `${plan.startTime}–${plan.endTime}`;

      planClass = '';
    } else if (plan) {
      planLabel =
        `Zastąpi: ${plan.processName} · Z${plan.shiftNo} · ` +
        `${plan.startTime}–${plan.endTime}`;

      planClass = 'conflict';
    }

    const role =
      employee.role === 'leader' ? 'Lider' : 'Pracownik';

    const skills = employeeSkillNames(employee);

    const requiredName = skillName(
      demandFor(state.assignProcessId)?.requiredSkillId || ''
    );

    const skillHtml = skills.length
      ? `
          <div class="person-skills">
            ${skills
              .map(
                (name) => `
                  <span
                    class="person-skill ${
                      requiredName && name === requiredName
                        ? 'required'
                        : ''
                    }"
                  >
                    ${esc(name)}
                  </span>
                `
              )
              .join('')}
          </div>
        `
      : `
          <span class="person-no-skills">
            Brak przypisanych skilli
          </span>
        `;

    return `
      <label
        class="person-choice ${
          selected ? 'selected' : ''
        } ${same ? 'already' : ''}"
        data-user-id="${esc(employee.userId)}"
      >
        <input
          type="checkbox"
          ${selected ? 'checked' : ''}
          ${same ? 'disabled' : ''}
        >

        <div class="person-info">
          <strong>${esc(employee.displayName)}</strong>
          <span>
            ${role}${
              qualified ? ' · ma wymagany skill' : ''
            }
          </span>
          ${skillHtml}
        </div>

        <div class="person-plan-state ${planClass}">
          ${esc(planLabel)}
        </div>
      </label>
    `;
  }

  function updateAssignFooter() {
    const count = state.selectedIds.size;
    const shift = shiftByNo(state.assignShiftNo);

    const hours =
      count * (shift ? shiftDuration(shift) : 0);

    document.getElementById(
      'assignSelectedCount'
    ).textContent =
      `${count} ${count === 1 ? 'osoba' : 'osób'}`;

    document.getElementById(
      'assignSelectedHours'
    ).textContent = shift
      ? `${fmtHours(hours)} h do przypisania · Z${shift.shiftNo}`
      : 'Wybierz zmianę poniżej';

    els.assignButton.disabled =
      !canEdit || !count || !shift;
  }

  async function assignSelected() {
    if (
      !state.selectedIds.size ||
      !state.assignProcessId ||
      !state.assignShiftNo
    ) {
      return;
    }

    const shift = shiftByNo(state.assignShiftNo);

    if (!shift) return;

    els.assignButton.disabled = true;
    els.assignMessage.textContent =
      'Zapisywanie przypisania…';

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
      els.assignMessage.textContent =
        error.message ||
        'Nie udało się przypisać pracowników.';

      els.assignButton.disabled = false;
    }
  }

  function openShiftDrawer() {
    if (!canEdit) return;

    const shifts = state.data?.shifts || [];

    els.shiftCount.value = String(
      Math.max(1, shifts.length || 1)
    );

    renderShiftEditors();

    els.shiftBackdrop.hidden = false;
    els.shiftDrawer.classList.add('open');
  }

  function closeShiftDrawer() {
    els.shiftBackdrop.hidden = true;
    els.shiftDrawer.classList.remove('open');
  }

  function renderShiftEditors() {
    const count = Number(els.shiftCount.value);
    const current = state.data?.shifts || [];

    const defaults = [
      ['06:00', '14:00'],
      ['14:00', '22:00'],
      ['22:00', '06:00'],
      ['06:00', '18:00'],
      ['18:00', '06:00'],
      ['08:00', '16:00']
    ];

    els.shiftRows.innerHTML = Array.from(
      { length: count },
      (_, i) => {
        const no = i + 1;
        const shift = current.find(
          (x) => Number(x.shiftNo) === no
        );

        return `
          <div class="shift-edit-row" data-no="${no}">
            <div class="shift-number">Z${no}</div>

            <input
              class="shift-name"
              type="text"
              maxlength="80"
              value="${esc(
                shift?.name || `Zmiana ${no}`
              )}"
            >

            <input
              data-start
              type="time"
              value="${shift?.startTime || defaults[i][0]}"
            >

            <input
              data-end
              type="time"
              value="${shift?.endTime || defaults[i][1]}"
            >
          </div>
        `;
      }
    ).join('');
  }

  async function saveShifts(event) {
    event.preventDefault();
    els.shiftMessage.textContent = '';

    const shifts = [
      ...els.shiftRows.querySelectorAll('.shift-edit-row')
    ].map((row) => ({
      shiftNo: Number(row.dataset.no),
      name:
        row.querySelector('.shift-name').value.trim(),
      startTime:
        row.querySelector('[data-start]').value,
      endTime:
        row.querySelector('[data-end]').value,
      active: true
    }));

    try {
      await apiSave({
        action: 'shifts',
        shifts: JSON.stringify(shifts)
      });

      closeShiftDrawer();
    } catch (error) {
      els.shiftMessage.textContent = error.message;
    }
  }

  function templateShiftRows(shifts) {
    return (shifts || []).map((s) => ({
      shiftNo: Number(s.shiftNo),
      name: String(s.name || `Zmiana ${s.shiftNo}`),
      startTime: s.startTime,
      endTime: s.endTime,
      active: true
    }));
  }

  async function templateManage(payload) {
    const body = new URLSearchParams({
      ...payload,
      requestedBy: user.userId
    });

    const response = await fetch(TEMPLATE_MANAGE_URL, {
      method: 'POST',
      body,
      cache: 'no-store',
      credentials: 'omit'
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.ok) {
      throw new Error(
        data.message ||
        'Nie udało się wykonać operacji na szablonie.'
      );
    }

    return data;
  }

  async function loadTemplates() {
    const response = await fetch(
      `${TEMPLATES_URL}?requestedBy=${encodeURIComponent(
        user.userId
      )}`,
      {
        cache: 'no-store',
        credentials: 'omit'
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.ok) {
      throw new Error(
        data.message || 'Nie udało się pobrać szablonów.'
      );
    }

    state.templates = Array.isArray(data.templates)
      ? data.templates
      : [];

    renderTemplates();
  }

  async function openTemplateDrawer() {
    if (!canEdit) return;

    els.templateBackdrop.hidden = false;
    els.templateDrawer.classList.add('open');
    els.templateDrawer.setAttribute('aria-hidden', 'false');
    els.templateMessage.textContent =
      'Pobieranie szablonów…';

    state.selectedTemplateId = '';
    els.templateApplyPanel.hidden = true;

    try {
      await loadTemplates();
      els.templateMessage.textContent = '';
    } catch (error) {
      els.templateMessage.textContent = error.message;
    }
  }

  function closeTemplateDrawer() {
    els.templateBackdrop.hidden = true;
    els.templateDrawer.classList.remove('open');
    els.templateDrawer.setAttribute('aria-hidden', 'true');
    state.selectedTemplateId = '';
  }

  async function collectWeekPattern() {
    const monday = mondayOf(els.date.value);

    const dates = Array.from(
      { length: 7 },
      (_, i) => addDays(monday, i)
    );

    const responses = await Promise.all(
      dates.map((date) =>
        fetch(
          `${VIEW_URL}?date=${encodeURIComponent(date)}`,
          {
            cache: 'no-store',
            credentials: 'omit'
          }
        )
      )
    );

    const payloads = await Promise.all(
      responses.map((response) =>
        response.json().catch(() => ({}))
      )
    );

    const days = {};

    payloads.forEach((data, index) => {
      if (!responses[index].ok || !data.ok) {
        throw new Error(
          `Nie udało się pobrać zmian dla ${dates[index]}.`
        );
      }

      days[String(index + 1)] =
        templateShiftRows(data.shifts || []);
    });

    return { days };
  }

  async function saveTemplate() {
    const name = els.templateName.value.trim();
    const scope = els.templateScope.value;

    if (!name) {
      els.templateMessage.textContent =
        'Podaj nazwę szablonu.';
      return;
    }

    els.templateMessage.textContent =
      scope === 'week'
        ? 'Pobieranie całego tygodnia…'
        : 'Zapisywanie szablonu…';

    const saveButton =
      document.getElementById('templateSaveBtn');

    saveButton.disabled = true;

    try {
      let pattern;

      if (scope === 'day') {
        const shifts = templateShiftRows(
          state.data?.shifts || []
        );

        if (!shifts.length) {
          throw new Error(
            'Wybrany dzień nie ma skonfigurowanych zmian.'
          );
        }

        pattern = { shifts };
      } else {
        pattern = await collectWeekPattern();

        const count = Object.values(
          pattern.days
        ).reduce(
          (sum, rows) => sum + rows.length,
          0
        );

        if (!count) {
          throw new Error(
            'Wybrany tydzień nie ma skonfigurowanych zmian.'
          );
        }
      }

      await templateManage({
        action: 'save',
        name,
        scope,
        patternJson: JSON.stringify(pattern)
      });

      els.templateName.value = '';
      els.templateMessage.textContent =
        'Szablon zapisany.';

      await loadTemplates();
    } catch (error) {
      els.templateMessage.textContent = error.message;
    } finally {
      saveButton.disabled = false;
    }
  }

  function renderTemplates() {
    document.getElementById('templateCount').textContent =
      state.templates.length;

    els.templateList.innerHTML = state.templates.length
      ? state.templates
          .map((template) => {
            let summary = 'Szablon zmian';

            if (template.scope === 'day') {
              summary =
                `${template.pattern?.shifts?.length || 0} zmian w dniu`;
            } else {
              const days = template.pattern?.days || {};

              const activeDays = Object.values(days).filter(
                (rows) =>
                  Array.isArray(rows) && rows.length
              ).length;

              const shifts = Object.values(days).reduce(
                (sum, rows) =>
                  sum +
                  (Array.isArray(rows) ? rows.length : 0),
                0
              );

              summary =
                `${activeDays} dni · ${shifts} konfiguracji zmian`;
            }

            return `
              <article class="template-item">
                <div class="template-item-info">
                  <strong>${esc(template.name)}</strong>
                  <span>
                    ${
                      template.scope === 'week'
                        ? 'Tydzień'
                        : 'Dzień'
                    }
                    · ${esc(summary)}
                  </span>
                </div>

                <div class="template-item-actions">
                  <button
                    type="button"
                    data-template-apply="${esc(template.templateId)}"
                  >
                    Zastosuj
                  </button>

                  <button
                    type="button"
                    data-template-delete="${esc(template.templateId)}"
                  >
                    Usuń
                  </button>
                </div>
              </article>
            `;
          })
          .join('')
      : `
          <div class="template-empty">
            Nie ma jeszcze zapisanych szablonów.
          </div>
        `;

    els.templateList
      .querySelectorAll('[data-template-apply]')
      .forEach((button) =>
        button.addEventListener('click', () =>
          chooseTemplate(button.dataset.templateApply)
        )
      );

    els.templateList
      .querySelectorAll('[data-template-delete]')
      .forEach((button) =>
        button.addEventListener('click', () =>
          deleteTemplate(button.dataset.templateDelete)
        )
      );
  }

  function chooseTemplate(templateId) {
    const template = state.templates.find(
      (item) => item.templateId === templateId
    );

    if (!template) return;

    state.selectedTemplateId = templateId;

    document.getElementById(
      'templateApplyName'
    ).textContent = template.name;

    els.templateDateFrom.value = els.date.value;
    els.templateDateTo.value =
      addDays(els.date.value, 29);

    els.templateApplyPanel.hidden = false;

    els.templateApplyPanel.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest'
    });
  }

  async function deleteTemplate(templateId) {
    const template = state.templates.find(
      (item) => item.templateId === templateId
    );

    if (
      !template ||
      !window.confirm(
        `Usunąć szablon „${template.name}”?`
      )
    ) {
      return;
    }

    try {
      await templateManage({
        action: 'delete',
        templateId
      });

      if (state.selectedTemplateId === templateId) {
        els.templateApplyPanel.hidden = true;
      }

      await loadTemplates();

      els.templateMessage.textContent =
        'Szablon usunięty.';
    } catch (error) {
      els.templateMessage.textContent = error.message;
    }
  }

  function setTemplateRange(value) {
    const from =
      els.templateDateFrom.value || els.date.value;

    if (value === 'month') {
      els.templateDateTo.value = endOfMonth(from);
    } else {
      els.templateDateTo.value = addDays(
        from,
        Math.max(0, Number(value) - 1)
      );
    }
  }

  async function applyTemplate() {
    if (!state.selectedTemplateId) return;

    const from = els.templateDateFrom.value;
    const to = els.templateDateTo.value;

    if (!from || !to) {
      els.templateMessage.textContent =
        'Podaj zakres dat.';
      return;
    }

    const button =
      document.getElementById('templateApplyBtn');

    button.disabled = true;
    els.templateMessage.textContent =
      'Stosowanie szablonu…';

    try {
      const result = await templateManage({
        action: 'apply',
        templateId: state.selectedTemplateId,
        dateFrom: from,
        dateTo: to
      });

      els.templateMessage.textContent =
        result.message || 'Szablon zastosowany.';

      if (
        els.date.value >= from &&
        els.date.value <= to
      ) {
        await load();
      }
    } catch (error) {
      els.templateMessage.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  async function load() {
    els.message.textContent = '';

    const [viewResponse, skillResponse] =
      await Promise.all([
        fetch(
          `${VIEW_URL}?date=${encodeURIComponent(
            els.date.value
          )}`,
          {
            cache: 'no-store',
            credentials: 'omit'
          }
        ),
        fetch(SKILLS_URL, {
          cache: 'no-store',
          credentials: 'omit'
        })
      ]);

    const [data, skillData] = await Promise.all([
      viewResponse.json().catch(() => ({})),
      skillResponse.json().catch(() => ({}))
    ]);

    if (!viewResponse.ok || !data.ok) {
      throw new Error(
        data.message || 'Nie udało się pobrać planu.'
      );
    }

    state.data = data;

    state.skills =
      skillResponse.ok &&
      skillData.ok &&
      Array.isArray(skillData.skills)
        ? skillData.skills
        : [];

    setSummary();
    renderShifts();
    renderDemand();
  }

  async function safeLoad() {
    try {
      await load();
    } catch (error) {
      els.message.textContent = error.message;
    }
  }

  function moveDay(delta) {
    els.date.value = addDays(els.date.value, delta);
    safeLoad();
  }

  els.date.value = today();
  els.date.onchange = safeLoad;

  document.getElementById('prevDay').onclick =
    () => moveDay(-1);

  document.getElementById('nextDay').onclick =
    () => moveDay(1);

  document.getElementById('todayBtn').onclick = () => {
    els.date.value = today();
    safeLoad();
  };

  document.getElementById(
    'configureShiftsBtn'
  ).onclick = openShiftDrawer;

  document.getElementById(
    'shiftTemplatesBtn'
  ).onclick = openTemplateDrawer;

  document.getElementById(
    'shiftDrawerClose'
  ).onclick = closeShiftDrawer;

  document.getElementById(
    'shiftCancel'
  ).onclick = closeShiftDrawer;

  els.shiftBackdrop.onclick = closeShiftDrawer;
  els.shiftCount.onchange = renderShiftEditors;

  document.getElementById(
    'shiftForm'
  ).onsubmit = saveShifts;

  document.getElementById(
    'assignDrawerClose'
  ).onclick = closeAssignDrawer;

  els.assignBackdrop.onclick = closeAssignDrawer;
  els.assignSearch.oninput = renderPeopleChoices;
  els.assignButton.onclick = assignSelected;

  document.getElementById(
    'templateDrawerClose'
  ).onclick = closeTemplateDrawer;

  els.templateBackdrop.onclick = closeTemplateDrawer;

  document.getElementById(
    'templateSaveBtn'
  ).onclick = saveTemplate;

  document.getElementById(
    'templateApplyClose'
  ).onclick = () => {
    state.selectedTemplateId = '';
    els.templateApplyPanel.hidden = true;
  };

  document.getElementById(
    'templateApplyBtn'
  ).onclick = applyTemplate;

  document
    .querySelectorAll('[data-template-range]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        setTemplateRange(button.dataset.templateRange)
      )
    );

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;

    if (els.assignDrawer.classList.contains('open')) {
      closeAssignDrawer();
    } else if (
      els.templateDrawer.classList.contains('open')
    ) {
      closeTemplateDrawer();
    } else if (
      els.shiftDrawer.classList.contains('open')
    ) {
      closeShiftDrawer();
    }
  });

  if (!canEdit) {
    document.getElementById(
      'configureShiftsBtn'
    ).disabled = true;

    document.getElementById(
      'shiftTemplatesBtn'
    ).disabled = true;
  }

  safeLoad();
})();
