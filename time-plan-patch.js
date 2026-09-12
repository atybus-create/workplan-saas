(() => {
  'use strict';

  const API_BASE = 'https://n8n-pi.taild8d05f.ts.net/webhook';
  const SAVE_URL = `${API_BASE}/workplan-time-plan-save`;
  const TEMPLATE_MANAGE_URL = `${API_BASE}/workplan-shift-template-manage`;
  const STORAGE_KEY = 'workplan_user';
  const parse = (raw) => { try { return JSON.parse(raw || 'null'); } catch { return null; } };
  const currentUser = parse(sessionStorage.getItem(STORAGE_KEY)) || parse(localStorage.getItem(STORAGE_KEY));
  const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
  const fmt = (n) => Number(n || 0).toLocaleString('pl-PL', { maximumFractionDigits: 2 });

  function setPageMessage(text, error = false) {
    const node = document.getElementById('pageMessage');
    if (!node) return;
    node.textContent = text || '';
    node.style.color = error ? '#ff9aa4' : '';
  }

  async function postForm(url, payload) {
    const body = new URLSearchParams(payload);
    const response = await fetch(url, { method: 'POST', body, cache: 'no-store', credentials: 'omit' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.message || 'Nie udało się wykonać operacji.');
    return data;
  }

  let confirmResolver = null;
  function ensureConfirmModal() {
    let backdrop = document.getElementById('workplanConfirmBackdrop');
    if (backdrop) return backdrop;
    backdrop = document.createElement('div');
    backdrop.id = 'workplanConfirmBackdrop';
    backdrop.className = 'wp-confirm-backdrop';
    backdrop.hidden = true;
    backdrop.innerHTML = `
      <section class="wp-confirm-card" role="dialog" aria-modal="true" aria-labelledby="workplanConfirmTitle">
        <div class="wp-confirm-icon">!</div>
        <h3 id="workplanConfirmTitle">Potwierdź operację</h3>
        <p id="workplanConfirmText"></p>
        <div class="wp-confirm-actions">
          <button class="wp-confirm-cancel" type="button">Anuluj</button>
          <button class="wp-confirm-ok" type="button">Usuń</button>
        </div>
      </section>`;
    document.body.appendChild(backdrop);
    const finish = (value) => {
      backdrop.hidden = true;
      const resolve = confirmResolver;
      confirmResolver = null;
      if (resolve) resolve(value);
    };
    backdrop.querySelector('.wp-confirm-cancel').addEventListener('click', () => finish(false));
    backdrop.querySelector('.wp-confirm-ok').addEventListener('click', () => finish(true));
    backdrop.addEventListener('click', (event) => { if (event.target === backdrop) finish(false); });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !backdrop.hidden) finish(false);
    });
    return backdrop;
  }

  function appConfirm({ title, message, confirmText = 'Usuń' }) {
    const backdrop = ensureConfirmModal();
    if (confirmResolver) confirmResolver(false);
    backdrop.querySelector('#workplanConfirmTitle').textContent = title;
    backdrop.querySelector('#workplanConfirmText').textContent = message;
    backdrop.querySelector('.wp-confirm-ok').textContent = confirmText;
    backdrop.hidden = false;
    setTimeout(() => backdrop.querySelector('.wp-confirm-cancel').focus(), 20);
    return new Promise((resolve) => { confirmResolver = resolve; });
  }

  function parseAssignedPlan(button) {
    const pill = button.closest('.assigned-pill');
    const card = button.closest('.demand-card');
    const shiftText = pill?.querySelector('em')?.textContent || '';
    const range = pill?.querySelector('span')?.textContent || '';
    const [startTime = '', endTime = ''] = range.split('–').map((v) => v.trim());
    return {
      userId: button.dataset.unassignUser || '',
      name: pill?.querySelector('b')?.textContent?.trim() || 'pracownika',
      processId: card?.dataset.process || '',
      shiftNo: Number(shiftText.replace(/\D/g, '')) || 0,
      startTime,
      endTime
    };
  }

  async function removeAssignedPerson(button) {
    if (!currentUser?.userId) return;
    const plan = parseAssignedPlan(button);
    if (!plan.userId || !plan.processId || !plan.shiftNo || !plan.startTime || !plan.endTime) {
      setPageMessage('Nie udało się odczytać danych przypisania.', true);
      return;
    }
    const date = document.getElementById('planDate')?.value || '';
    const accepted = await appConfirm({
      title: 'Usunąć osobę z planu?',
      message: `${plan.name} zostanie usunięty z planu na ${date}. Poprzednia wersja pozostanie w historii zmian.`,
      confirmText: 'Usuń z planu'
    });
    if (!accepted) return;
    try {
      setPageMessage('Usuwanie przypisania…');
      await postForm(SAVE_URL, {
        action: 'plan', requestedBy: currentUser.userId, date,
        userId: plan.userId, processId: plan.processId, shiftNo: String(plan.shiftNo),
        startTime: plan.startTime, endTime: plan.endTime, status: 'cancelled'
      });
      setPageMessage('Pracownik został usunięty z planu.');
      document.getElementById('planDate')?.dispatchEvent(new Event('change'));
    } catch (error) {
      setPageMessage(error.message || 'Nie udało się usunąć przypisania.', true);
    }
  }

  async function removeTemplate(button) {
    if (!currentUser?.userId) return;
    const item = button.closest('.template-item');
    const name = item?.querySelector('.template-item-info strong')?.textContent?.trim() || 'ten szablon';
    const templateId = button.dataset.templateDelete || '';
    if (!templateId) return;
    const accepted = await appConfirm({
      title: 'Usunąć szablon zmian?',
      message: `Szablon „${name}” zostanie usunięty. Istniejące plany i konfiguracje dni nie zostaną zmienione.`,
      confirmText: 'Usuń szablon'
    });
    if (!accepted) return;
    try {
      await postForm(TEMPLATE_MANAGE_URL, { action: 'delete', templateId, requestedBy: currentUser.userId });
      item?.remove();
      const count = document.getElementById('templateCount');
      if (count) count.textContent = String(Math.max(0, Number(count.textContent || 0) - 1));
      const message = document.getElementById('templateMessage');
      if (message) message.textContent = 'Szablon usunięty.';
    } catch (error) {
      const message = document.getElementById('templateMessage');
      if (message) message.textContent = error.message || 'Nie udało się usunąć szablonu.';
    }
  }

  document.addEventListener('click', (event) => {
    const unassign = event.target.closest?.('[data-unassign-user]');
    if (unassign) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      removeAssignedPerson(unassign);
      return;
    }
    const templateDelete = event.target.closest?.('[data-template-delete]');
    if (templateDelete) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      removeTemplate(templateDelete);
    }
  }, true);

  function updateDemandCard(card) {
    const totalInput = card.querySelector('[data-total-hours]');
    const personHoursInput = card.querySelector('[data-person-hours]');
    const shiftInputs = [...card.querySelectorAll('[data-shift-hours]')];
    const status = card.querySelector('.daily-demand-block');
    if (!totalInput || !status) return;

    const total = Math.max(0, Number(totalInput.value || 0));
    const distributed = round2(shiftInputs.reduce((sum, input) => sum + Math.max(0, Number(input.value || 0)), 0));
    const diff = round2(total - distributed);
    const assigned = Number(card.dataset.assigned || 0);
    const hpp = Math.max(.25, Number(personHoursInput?.value || 8));
    const balanced = Math.abs(diff) <= .02;

    status.classList.toggle('ok', balanced);
    status.classList.toggle('pending', !balanced);
    const summary = status.querySelector('[data-distribution-summary]');
    const detail = status.querySelector('[data-distribution-detail]');
    if (summary) summary.textContent = balanced ? `Rozdzielono ${fmt(distributed)} / ${fmt(total)} h` : `Rozdzielono ${fmt(distributed)} / ${fmt(total)} h`;
    if (detail) {
      detail.textContent = balanced
        ? 'Całe zapotrzebowanie dnia jest rozdzielone na zmiany.'
        : diff > 0
          ? `Pozostało ${fmt(diff)} h do rozdzielenia między zmiany.`
          : `Przekroczono zapotrzebowanie dnia o ${fmt(Math.abs(diff))} h.`;
    }

    const save = card.querySelector('[data-save-demand]');
    if (save) {
      save.disabled = !balanced;
      save.title = balanced ? '' : 'Suma godzin na zmianach musi być równa zapotrzebowaniu dnia.';
    }

    const people = card.querySelector('[data-required-people]');
    if (people) people.textContent = total > 0 ? String(Math.ceil(total / hpp)) : '0';
    const totalLabel = card.querySelector('[data-required-total]');
    if (totalLabel) totalLabel.textContent = fmt(total);
    const hppLabel = card.querySelector('[data-person-hours-label]');
    if (hppLabel) hppLabel.textContent = fmt(hpp);
    const coverage = card.querySelector('.coverage');
    const coverageText = card.querySelector('[data-coverage-text]');
    const covered = assigned >= total;
    card.classList.toggle('covered', covered);
    coverage?.classList.toggle('ok', covered);
    coverage?.classList.toggle('shortage', !covered);
    if (coverageText) coverageText.textContent = covered ? `Pokryte · +${fmt(Math.max(0, assigned - total))} h` : `Brakuje ${fmt(total - assigned)} h`;

    card.querySelectorAll('[data-shift-cell]').forEach((cell) => {
      const input = cell.querySelector('[data-shift-hours]');
      const required = Math.max(0, Number(input?.value || 0));
      const assignedText = cell.querySelector('[data-shift-assigned]')?.textContent || '0';
      const assignedShift = Number(assignedText.replace(/\s/g, '').replace(',', '.')) || 0;
      const requiredLabel = cell.querySelector('[data-shift-required-label]');
      if (requiredLabel) requiredLabel.textContent = fmt(required);
      const ok = assignedShift >= required;
      cell.classList.toggle('ok', ok);
      cell.classList.toggle('shortage', !ok);
      const bar = cell.querySelector('.shift-coverage-line span');
      if (bar) bar.style.width = `${required > 0 ? Math.min(100, Math.round((assignedShift / required) * 100)) : (assignedShift > 0 ? 100 : 0)}%`;
    });
  }

  function enhanceDemandCard(card) {
    if (card.dataset.dailyDemandPatched === '1') return;
    card.dataset.dailyDemandPatched = '1';
    const totalInput = card.querySelector('[data-total-hours]');
    const totalBox = totalInput?.closest('.metric-input');
    const shiftRail = card.querySelector('.shift-demand-rail');
    if (!totalInput || !totalBox || !shiftRail) return;

    totalBox.classList.add('daily-demand');
    const label = totalBox.querySelector('label');
    if (label) label.textContent = 'Zapotrzebowanie dzień';
    totalInput.removeAttribute('readonly');
    totalInput.setAttribute('min', '0');
    totalInput.setAttribute('step', '0.25');

    const status = document.createElement('div');
    status.className = 'daily-demand-block';
    status.innerHTML = '<div><strong>Podział zapotrzebowania na zmiany</strong><small data-distribution-detail></small></div><span data-distribution-summary></span>';
    shiftRail.before(status);

    const oldShiftInputs = [...card.querySelectorAll('[data-shift-hours]')];
    oldShiftInputs.forEach((oldInput) => {
      const clone = oldInput.cloneNode(true);
      oldInput.replaceWith(clone);
      clone.addEventListener('input', () => updateDemandCard(card));
      clone.addEventListener('change', () => updateDemandCard(card));
    });
    totalInput.addEventListener('input', () => updateDemandCard(card));
    totalInput.addEventListener('change', () => updateDemandCard(card));
    card.querySelector('[data-person-hours]')?.addEventListener('input', () => updateDemandCard(card));
    updateDemandCard(card);
  }

  function enhanceAllDemandCards() {
    document.querySelectorAll('.demand-card').forEach(enhanceDemandCard);
  }

  const demandGrid = document.getElementById('demandGrid');
  if (demandGrid) {
    const observer = new MutationObserver(() => enhanceAllDemandCards());
    observer.observe(demandGrid, { childList: true, subtree: false });
  }
  enhanceAllDemandCards();
})();
