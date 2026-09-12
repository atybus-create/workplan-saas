(() => {
  'use strict';

  const API_BASE = 'https://n8n-pi.taild8d05f.ts.net/webhook';
  const AUTH_API_URL = `${API_BASE}/workplan-auth-login`;
  const EMPLOYEES_API_URL = `${API_BASE}/workplan-employees`;
  const AVAILABILITY_API_URL = `${API_BASE}/workplan-availability-set`;
  const BULK_ACTION_API_URL = `${API_BASE}/workplan-employees-bulk-action`;
  const STORAGE_KEY = 'workplan_user';

  function parseUser(raw) {
    if (!raw) return null;
    try {
      const user = JSON.parse(raw);
      if (!user || typeof user !== 'object' || !user.userId || !user.login) return null;
      return user;
    } catch (_) {
      return null;
    }
  }

  function getStoredUser() {
    return parseUser(sessionStorage.getItem(STORAGE_KEY)) || parseUser(localStorage.getItem(STORAGE_KEY));
  }

  function storeUser(user, remember) {
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    (remember ? localStorage : sessionStorage).setItem(STORAGE_KEY, JSON.stringify(user));
  }

  function clearUser() {
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function formatDate(value) {
    if (!value) return 'Brak danych';
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('pl-PL', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }

  function todayIso() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' });
  }

  function initCommonApp(user) {
    const display = user.displayName || user.login || 'Użytkownik';
    const firstName = display.trim().split(/\s+/)[0] || 'Użytkowniku';
    const initial = display.trim().charAt(0).toUpperCase() || 'U';

    const userName = document.getElementById('userName');
    const userDisplay = document.getElementById('userDisplay');
    const userAvatar = document.getElementById('userAvatar');
    if (userName) userName.textContent = firstName;
    if (userDisplay) userDisplay.textContent = display;
    if (userAvatar) userAvatar.textContent = initial;

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        clearUser();
        location.replace('index.html');
      });
    }

    const menuToggle = document.getElementById('menuToggle');
    if (menuToggle) menuToggle.addEventListener('click', () => document.body.classList.toggle('nav-open'));
  }

  function initLogin() {
    if (getStoredUser()) {
      location.replace('start.html');
      return;
    }

    const form = document.getElementById('loginForm');
    const button = document.getElementById('submitBtn');
    const message = document.getElementById('message');
    const loginInput = document.getElementById('login');
    const passwordInput = document.getElementById('password');
    const rememberInput = document.getElementById('rememberMe');
    const toggle = document.getElementById('togglePassword');

    toggle.addEventListener('click', () => {
      const show = passwordInput.type === 'password';
      passwordInput.type = show ? 'text' : 'password';
      toggle.textContent = show ? 'Ukryj' : 'Pokaż';
      toggle.setAttribute('aria-label', show ? 'Ukryj hasło' : 'Pokaż hasło');
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      message.textContent = '';
      message.classList.remove('success');

      const login = loginInput.value.trim();
      const password = passwordInput.value;
      if (!login || !password) {
        message.textContent = 'Wpisz login i hasło.';
        return;
      }

      button.disabled = true;
      button.querySelector('span').textContent = 'Logowanie…';

      try {
        const body = new URLSearchParams({ login, password });
        const response = await fetch(AUTH_API_URL, { method: 'POST', body, cache: 'no-store', credentials: 'omit' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok || !data.user) throw new Error(data.message || 'Nieprawidłowy login lub hasło.');
        storeUser(data.user, rememberInput.checked);
        location.replace('start.html');
      } catch (error) {
        message.textContent = error instanceof TypeError
          ? 'Nie udało się połączyć z serwerem. Spróbuj ponownie.'
          : (error.message || 'Nie udało się zalogować.');
      } finally {
        button.disabled = false;
        button.querySelector('span').textContent = 'Zaloguj się';
      }
    });
  }

  function initStart() {
    const user = getStoredUser();
    if (!user) {
      location.replace('index.html');
      return;
    }
    initCommonApp(user);
  }

  function initEmployees() {
    const user = getStoredUser();
    if (!user) {
      location.replace('index.html');
      return;
    }
    initCommonApp(user);

    const state = { employees: [], skills: [], processes: [], selected: null, selectedIds: new Set(), bulkMode: 'process' };
    const rows = document.getElementById('employeeRows');
    const loading = document.getElementById('employeeLoading');
    const errorBox = document.getElementById('employeeError');
    const empty = document.getElementById('employeeEmpty');
    const tableWrap = document.getElementById('employeeTableWrap');
    const search = document.getElementById('employeeSearch');
    const skillFilter = document.getElementById('skillFilter');
    const employeeSort = document.getElementById('employeeSort');
    const selectAll = document.getElementById('selectAllEmployees');
    const bulkBar = document.getElementById('bulkBar');
    const selectedCount = document.getElementById('selectedCount');
    const drawer = document.getElementById('employeeDrawer');
    const backdrop = document.getElementById('employeeBackdrop');
    const closeBtn = document.getElementById('employeeDrawerClose');
    const availabilityForm = document.getElementById('availabilityForm');
    const availabilityMessage = document.getElementById('availabilityMessage');
    const availabilitySave = document.getElementById('availabilitySave');
    const modal = document.getElementById('actionModal');
    const modalBackdrop = document.getElementById('actionModalBackdrop');
    const modalClose = document.getElementById('actionModalClose');
    const bulkForm = document.getElementById('bulkActionForm');
    const bulkMessage = document.getElementById('bulkActionMessage');
    const bulkSave = document.getElementById('bulkActionSave');
    const processFields = document.getElementById('processFields');
    const availabilityFields = document.getElementById('availabilityFields');
    const bulkProcessSelect = document.getElementById('bulkProcessSelect');

    function updateSummary() {
      document.getElementById('employeeCount').textContent = state.employees.length;
      document.getElementById('availableCount').textContent = state.employees.filter(e => e.available && e.accountActive).length;
      document.getElementById('unavailableCount').textContent = state.employees.filter(e => !e.available || !e.accountActive).length;
      document.getElementById('noSkillsCount').textContent = state.employees.filter(e => !Array.isArray(e.skills) || e.skills.length === 0).length;
    }

    function availabilityChip(employee) {
      if (!employee.accountActive) return '<span class="status-chip inactive">Konto wyłączone</span>';
      return employee.available
        ? '<span class="status-chip">Dostępny</span>'
        : '<span class="status-chip unavailable">Niedostępny</span>';
    }

    function filteredEmployees() {
      const query = search.value.trim().toLowerCase();
      const wantedSkill = skillFilter.value;
      const list = state.employees.filter(employee => {
        const matchesText = !query || `${employee.displayName || ''} ${employee.login || ''}`.toLowerCase().includes(query);
        const skills = Array.isArray(employee.skills) ? employee.skills : [];
        const matchesSkill = !wantedSkill || skills.some(skill => skill.skillId === wantedSkill);
        return matchesText && matchesSkill;
      });
      const mode = employeeSort.value;
      return list.sort((a, b) => {
        if (mode === 'skills') {
          const aa = (a.skills || []).map(s => s.name).sort((x, y) => x.localeCompare(y, 'pl', { numeric: true }))[0] || 'zzzz';
          const bb = (b.skills || []).map(s => s.name).sort((x, y) => x.localeCompare(y, 'pl', { numeric: true }))[0] || 'zzzz';
          return aa.localeCompare(bb, 'pl', { numeric: true });
        }
        if (mode === 'skillCount') return (b.skills || []).length - (a.skills || []).length || String(a.displayName).localeCompare(String(b.displayName), 'pl', { numeric: true });
        if (mode === 'hireDate') return String(a.hireDate || '9999').localeCompare(String(b.hireDate || '9999'));
        if (mode === 'availability') return Number(b.available) - Number(a.available) || String(a.displayName).localeCompare(String(b.displayName), 'pl', { numeric: true });
        return String(a.displayName || a.login).localeCompare(String(b.displayName || b.login), 'pl', { numeric: true });
      });
    }

    function updateBulkBar() {
      selectedCount.textContent = state.selectedIds.size;
      bulkBar.hidden = state.selectedIds.size === 0;
    }

    function renderEmployees() {
      const filtered = filteredEmployees();
      rows.innerHTML = filtered.map(employee => {
        const skills = Array.isArray(employee.skills) ? employee.skills : [];
        const skillPreview = skills.length
          ? skills.map(skill => `<span class="skill-tag">${escapeHtml(skill.name)}</span>`).join('')
          : '<span class="table-muted">Brak przypisanych</span>';
        const displayName = employee.displayName || employee.login;
        const initial = String(displayName || 'U').trim().charAt(0).toUpperCase() || 'U';
        const process = employee.currentProcess?.name || 'Brak';
        const checked = state.selectedIds.has(employee.userId) ? ' checked' : '';
        return `<tr data-user-id="${escapeHtml(employee.userId)}" tabindex="0" class="${checked ? 'selected-row' : ''}">
          <td class="check-col"><input class="employee-checkbox" type="checkbox" aria-label="Zaznacz ${escapeHtml(displayName)}"${checked}></td>
          <td><div class="employee-person"><span class="mini-avatar">${escapeHtml(initial)}</span><div><strong>${escapeHtml(displayName)}</strong><span>${escapeHtml(employee.role || 'pracownik')}</span></div></div></td>
          <td>${escapeHtml(employee.login)}</td>
          <td>${availabilityChip(employee)}</td>
          <td><div class="skill-preview all-skills">${skillPreview}</div></td>
          <td><span class="process-chip">${escapeHtml(process)}</span></td>
          <td>${escapeHtml(formatDate(employee.hireDate))}</td>
          <td><button class="row-process-button" type="button" data-action="process">Przydziel proces</button></td>
        </tr>`;
      }).join('');

      tableWrap.hidden = filtered.length === 0;
      empty.hidden = filtered.length !== 0;
      const visibleIds = new Set(filtered.map(e => e.userId));
      const selectedVisible = filtered.filter(e => state.selectedIds.has(e.userId)).length;
      selectAll.checked = filtered.length > 0 && selectedVisible === filtered.length;
      selectAll.indeterminate = selectedVisible > 0 && selectedVisible < filtered.length;

      rows.querySelectorAll('tr').forEach(row => {
        const employeeId = row.dataset.userId;
        const checkbox = row.querySelector('.employee-checkbox');
        const processButton = row.querySelector('[data-action="process"]');
        checkbox.addEventListener('click', event => {
          event.stopPropagation();
          checkbox.checked ? state.selectedIds.add(employeeId) : state.selectedIds.delete(employeeId);
          updateBulkBar();
          renderEmployees();
        });
        processButton.addEventListener('click', event => {
          event.stopPropagation();
          openBulkModal('process', [employeeId]);
        });
        const open = event => {
          if (event?.target?.closest('button,input')) return;
          openEmployee(employeeId);
        };
        row.addEventListener('click', open);
        row.addEventListener('keydown', event => {
          if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button,input')) {
            event.preventDefault();
            openEmployee(employeeId);
          }
        });
      });
      for (const id of [...state.selectedIds]) if (!state.employees.some(e => e.userId === id)) state.selectedIds.delete(id);
      updateBulkBar();
    }

    function renderCatalogs() {
      skillFilter.innerHTML = '<option value="">Wszystkie skille</option>' + state.skills.map(skill => `<option value="${escapeHtml(skill.skillId)}">${escapeHtml(skill.name)}</option>`).join('');
      bulkProcessSelect.innerHTML = state.processes.length
        ? state.processes.map(process => `<option value="${escapeHtml(process.processId)}">${escapeHtml(process.name)}</option>`).join('')
        : '<option value="">Brak procesów</option>';
    }

    function openEmployee(userId) {
      const employee = state.employees.find(item => item.userId === userId);
      if (!employee) return;
      state.selected = employee;
      const skills = Array.isArray(employee.skills) ? employee.skills : [];

      document.getElementById('employeeDrawerTitle').textContent = employee.displayName || employee.login;
      document.getElementById('employeeDrawerLogin').textContent = `@${employee.login}`;
      document.getElementById('detailLogin').textContent = employee.login;
      document.getElementById('detailRole').textContent = employee.role || '—';
      document.getElementById('detailHireDate').textContent = formatDate(employee.hireDate);
      document.getElementById('detailAccount').textContent = employee.accountActive ? 'Aktywne' : 'Wyłączone';
      document.getElementById('detailProcess').textContent = employee.currentProcess
        ? `${employee.currentProcess.name} · ${formatDate(employee.currentProcess.dateFrom)}–${formatDate(employee.currentProcess.dateTo)}`
        : 'Brak przydzielonego procesu';

      const detailAvailability = document.getElementById('detailAvailability');
      detailAvailability.textContent = employee.available ? 'Dostępny' : 'Niedostępny';
      detailAvailability.className = `status-chip${employee.available ? '' : ' unavailable'}`;

      const rule = employee.availabilityRule;
      document.getElementById('availabilityFrom').value = rule?.dateFrom || todayIso();
      document.getElementById('availabilityTo').value = rule?.dateTo || todayIso();
      document.getElementById('availabilityNote').value = rule?.note || '';
      const radio = availabilityForm.querySelector(`input[name="availabilityState"][value="${employee.available ? 'true' : 'false'}"]`);
      if (radio) radio.checked = true;
      availabilityMessage.textContent = '';
      availabilityMessage.classList.remove('success');

      document.getElementById('detailSkills').innerHTML = skills.length
        ? skills.map(skill => `<span class="skill-tag">${escapeHtml(skill.name)}</span>`).join('')
        : '<div class="skills-empty">Ten pracownik nie ma jeszcze przypisanych skilli.</div>';

      backdrop.hidden = false;
      drawer.classList.add('open');
      drawer.setAttribute('aria-hidden', 'false');
    }

    function closeDrawer() {
      state.selected = null;
      drawer.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');
      backdrop.hidden = true;
    }

    function openBulkModal(mode, explicitIds = null) {
      state.bulkMode = mode;
      const ids = explicitIds || [...state.selectedIds];
      if (!ids.length) return;
      modal.dataset.userIds = ids.join(',');
      const count = ids.length;
      document.getElementById('actionModalTitle').textContent = mode === 'process' ? 'Przydziel / zmień proces' : 'Zmień dostępność';
      document.getElementById('actionModalSubtitle').textContent = `Zmiana obejmie ${count} ${count === 1 ? 'pracownika' : 'pracowników'}.`;
      processFields.hidden = mode !== 'process';
      availabilityFields.hidden = mode !== 'availability';
      bulkProcessSelect.required = mode === 'process';
      document.getElementById('bulkDateFrom').value = todayIso();
      document.getElementById('bulkDateTo').value = todayIso();
      document.getElementById('bulkNote').value = '';
      bulkMessage.textContent = '';
      modalBackdrop.hidden = false;
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
    }

    function closeBulkModal() {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      modalBackdrop.hidden = true;
      modal.dataset.userIds = '';
    }

    async function loadEmployees() {
      loading.hidden = false;
      errorBox.hidden = true;
      empty.hidden = true;
      tableWrap.hidden = true;
      try {
        const response = await fetch(EMPLOYEES_API_URL, { method: 'GET', cache: 'no-store', credentials: 'omit' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok || !Array.isArray(data.employees)) throw new Error(data.message || 'Nie udało się pobrać listy pracowników.');
        state.employees = data.employees;
        state.skills = Array.isArray(data.skills) ? data.skills : [];
        state.processes = Array.isArray(data.processes) ? data.processes : [];
        renderCatalogs();
        updateSummary();
        renderEmployees();
      } catch (error) {
        errorBox.textContent = error instanceof TypeError ? 'Nie udało się połączyć z serwerem.' : (error.message || 'Nie udało się pobrać listy pracowników.');
        errorBox.hidden = false;
      } finally {
        loading.hidden = true;
      }
    }

    search.addEventListener('input', renderEmployees);
    skillFilter.addEventListener('change', renderEmployees);
    employeeSort.addEventListener('change', renderEmployees);
    selectAll.addEventListener('change', () => {
      const visible = filteredEmployees();
      visible.forEach(employee => selectAll.checked ? state.selectedIds.add(employee.userId) : state.selectedIds.delete(employee.userId));
      renderEmployees();
    });
    document.getElementById('clearSelectionBtn').addEventListener('click', () => { state.selectedIds.clear(); renderEmployees(); });
    document.getElementById('bulkProcessBtn').addEventListener('click', () => openBulkModal('process'));
    document.getElementById('bulkAvailabilityBtn').addEventListener('click', () => openBulkModal('availability'));
    document.getElementById('drawerProcessBtn').addEventListener('click', () => state.selected && openBulkModal('process', [state.selected.userId]));

    closeBtn.addEventListener('click', closeDrawer);
    backdrop.addEventListener('click', closeDrawer);
    modalClose.addEventListener('click', closeBulkModal);
    modalBackdrop.addEventListener('click', closeBulkModal);
    document.getElementById('bulkActionCancel').addEventListener('click', closeBulkModal);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && drawer.classList.contains('open')) closeDrawer();
      if (event.key === 'Escape' && modal.classList.contains('open')) closeBulkModal();
    });

    availabilityForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (!state.selected) return;
      availabilityMessage.textContent = '';
      availabilityMessage.classList.remove('success');
      availabilitySave.disabled = true;
      availabilitySave.querySelector('span').textContent = 'Zapisywanie…';
      const selectedId = state.selected.userId;
      try {
        const payload = new URLSearchParams({
          userId: selectedId,
          dateFrom: document.getElementById('availabilityFrom').value,
          dateTo: document.getElementById('availabilityTo').value,
          available: availabilityForm.querySelector('input[name="availabilityState"]:checked').value,
          note: document.getElementById('availabilityNote').value.trim(),
          createdBy: user.userId
        });
        const response = await fetch(AVAILABILITY_API_URL, { method: 'POST', body: payload, cache: 'no-store', credentials: 'omit' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.message || 'Nie udało się zapisać dostępności.');
        await loadEmployees();
        openEmployee(selectedId);
        availabilityMessage.textContent = 'Dostępność zapisana.';
        availabilityMessage.classList.add('success');
      } catch (error) {
        availabilityMessage.textContent = error instanceof TypeError ? 'Nie udało się połączyć z serwerem.' : (error.message || 'Nie udało się zapisać dostępności.');
      } finally {
        availabilitySave.disabled = false;
        availabilitySave.querySelector('span').textContent = 'Zapisz dostępność';
      }
    });

    bulkForm.addEventListener('submit', async event => {
      event.preventDefault();
      const ids = String(modal.dataset.userIds || '').split(',').filter(Boolean);
      if (!ids.length) return;
      bulkMessage.textContent = '';
      bulkMessage.classList.remove('success');
      bulkSave.disabled = true;
      bulkSave.querySelector('span').textContent = 'Zapisywanie…';
      try {
        const payload = new URLSearchParams({
          action: state.bulkMode,
          userIds: ids.join(','),
          processId: state.bulkMode === 'process' ? bulkProcessSelect.value : '',
          available: state.bulkMode === 'availability' ? bulkForm.querySelector('input[name="bulkAvailabilityState"]:checked').value : '',
          dateFrom: document.getElementById('bulkDateFrom').value,
          dateTo: document.getElementById('bulkDateTo').value,
          note: document.getElementById('bulkNote').value.trim(),
          createdBy: user.userId
        });
        const response = await fetch(BULK_ACTION_API_URL, { method: 'POST', body: payload, cache: 'no-store', credentials: 'omit' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.message || 'Nie udało się zapisać zmiany grupowej.');
        bulkMessage.textContent = data.message || 'Zmiana zapisana.';
        bulkMessage.classList.add('success');
        await loadEmployees();
        setTimeout(() => {
          closeBulkModal();
          state.selectedIds.clear();
          renderEmployees();
        }, 450);
      } catch (error) {
        bulkMessage.textContent = error instanceof TypeError ? 'Nie udało się połączyć z serwerem.' : (error.message || 'Nie udało się zapisać zmiany grupowej.');
      } finally {
        bulkSave.disabled = false;
        bulkSave.querySelector('span').textContent = 'Zapisz dla zaznaczonych';
      }
    });

    loadEmployees();
  }

  const page = document.body.dataset.page;
  if (page === 'login') initLogin();
  if (page === 'start') initStart();
  if (page === 'employees') initEmployees();
})();
