(() => {
  'use strict';

  const API_BASE = 'https://n8n-pi.taild8d05f.ts.net/webhook';
  const SAVE_URL = `${API_BASE}/workplan-time-plan-save`;
  const TEMPLATE_MANAGE_URL = `${API_BASE}/workplan-shift-template-manage`;
  const STORAGE_KEY = 'workplan_user';

  const parse = (raw) => {
    try { return JSON.parse(raw || 'null'); }
    catch { return null; }
  };

  const currentUser =
    parse(sessionStorage.getItem(STORAGE_KEY)) ||
    parse(localStorage.getItem(STORAGE_KEY));

  function setPageMessage(text, error = false) {
    const node = document.getElementById('pageMessage');
    if (!node) return;
    node.textContent = text || '';
    node.style.color = error ? '#ff9aa4' : '';
  }

  async function postForm(url, payload) {
    const body = new URLSearchParams(payload);
    const response = await fetch(url, {
      method: 'POST',
      body,
      cache: 'no-store',
      credentials: 'omit'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Nie udało się wykonać operacji.');
    }
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
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) finish(false);
    });
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
    const [startTime = '', endTime = ''] = range.split('–').map((value) => value.trim());
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
        action: 'plan',
        requestedBy: currentUser.userId,
        date,
        userId: plan.userId,
        processId: plan.processId,
        shiftNo: String(plan.shiftNo),
        startTime: plan.startTime,
        endTime: plan.endTime,
        status: 'cancelled'
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
      await postForm(TEMPLATE_MANAGE_URL, {
        action: 'delete',
        templateId,
        requestedBy: currentUser.userId
      });
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

  if (!document.querySelector('link[data-time-plan-demand]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'time-plan-demand.css?v=20260913.1';
    link.dataset.timePlanDemand = '1';
    document.head.appendChild(link);
  }

  if (!document.querySelector('script[data-time-plan-demand]')) {
    const script = document.createElement('script');
    script.src = 'time-plan-demand.js?v=20260913.1';
    script.defer = true;
    script.dataset.timePlanDemand = '1';
    document.body.appendChild(script);
  }
})();
