(() => {
  'use strict';

  const API_BASE = 'https://n8n-pi.taild8d05f.ts.net/webhook';
  const AUTH_API_URL = `${API_BASE}/workplan-auth-login`;
  const EMPLOYEES_API_URL = `${API_BASE}/workplan-employees`;
  const AVAILABILITY_API_URL = `${API_BASE}/workplan-availability-set`;
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

    const state = { employees: [], selected: null };
    const rows = document.getElementById('employeeRows');
    const loading = document.getElementById('employeeLoading');
    const errorBox = document.getElementById('employeeError');
    const empty = document.getElementById('employeeEmpty');
    const tableWrap = document.getElementById('employeeTableWrap');
    const search = document.getElementById('employeeSearch');
    const drawer = document.getElementById('employeeDrawer');
    const backdrop = document.getElementById('employeeBackdrop');
    const closeBtn = document.getElementById('employeeDrawerClose');
    const availabilityForm = document.getElementById('availabilityForm');
    const availabilityMessage = document.getElementById('availabilityMessage');
    const availabilitySave = document.getElementById('availabilitySave');

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

    function renderEmployees() {
      const query = search.value.trim().toLowerCase();
      const filtered = state.employees.filter(employee => {
        if (!query) return true;
        return `${employee.displayName || ''} ${employee.login || ''}`.toLowerCase().includes(query);
      });

      rows.innerHTML = filtered.map(employee => {
        const skills = Array.isArray(employee.skills) ? employee.skills : [];
        const skillPreview = skills.length
          ? skills.slice(0, 3).map(skill => `<span class="skill-tag">${escapeHtml(skill.name)}</span>`).join('') + (skills.length > 3 ? `<span class="skill-tag more">+${skills.length - 3}</span>` : '')
          : '<span class="table-muted">Brak przypisanych</span>';
        const displayName = employee.displayName || employee.login;
        const initial = String(displayName || 'U').trim().charAt(0).toUpperCase() || 'U';
        return `<tr data-user-id="${escapeHtml(employee.userId)}" tabindex="0">
          <td><div class="employee-person"><span class="mini-avatar">${escapeHtml(initial)}</span><div><strong>${escapeHtml(displayName)}</strong><span>${escapeHtml(employee.role || 'pracownik')}</span></div></div></td>
          <td>${escapeHtml(employee.login)}</td>
          <td>${availabilityChip(employee)}</td>
          <td><div class="skill-preview">${skillPreview}</div></td>
          <td>${escapeHtml(formatDate(employee.hireDate))}</td>
          <td><span class="row-arrow">›</span></td>
        </tr>`;
      }).join('');

      tableWrap.hidden = filtered.length === 0;
      empty.hidden = filtered.length !== 0;

      rows.querySelectorAll('tr').forEach(row => {
        const open = () => openEmployee(row.dataset.userId);
        row.addEventListener('click', open);
        row.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
          }
        });
      });
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

      const detailAvailability = document.getElementById('detailAvailability');
      detailAvailability.textContent = employee.available ? 'Dostępny' : 'Niedostępny';
      detailAvailability.className = `status-chip${employee.available ? '' : ' unavailable'}`;

      const rule = employee.availabilityRule;
      document.getElementById('availabilityFrom').value = rule?.dateFrom || new Date().toISOString().slice(0, 10);
      document.getElementById('availabilityTo').value = rule?.dateTo || new Date().toISOString().slice(0, 10);
      document.getElementById('availabilityNote').value = rule?.note || '';
      const radio = availabilityForm.querySelector(`input[name="availabilityState"][value="${employee.available ? 'true' : 'false'}"]`);
      if (radio) radio.checked = true;
      availabilityMessage.textContent = '';
      availabilityMessage.classList.remove('success');

      document.getElementById('detailSkills').innerHTML = skills.length
        ? skills.map(skill => `<span class="skill-tag">${escapeHtml(skill.name)}</span>`).join('')
        : '<div class="skills-empty">Ten pracownik nie ma jeszcze przypisanych skilli. Konfigurację katalogu skilli zbudujemy jako osobny ekran.</div>';

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
    closeBtn.addEventListener('click', closeDrawer);
    backdrop.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && drawer.classList.contains('open')) closeDrawer();
    });

    availabilityForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (!state.selected) return;
      availabilityMessage.textContent = '';
      availabilityMessage.classList.remove('success');
      availabilitySave.disabled = true;
      availabilitySave.querySelector('span').textContent = 'Zapisywanie…';

      try {
        const payload = new URLSearchParams({
          userId: state.selected.userId,
          dateFrom: document.getElementById('availabilityFrom').value,
          dateTo: document.getElementById('availabilityTo').value,
          available: availabilityForm.querySelector('input[name="availabilityState"]:checked').value,
          note: document.getElementById('availabilityNote').value.trim(),
          createdBy: user.userId
        });
        const response = await fetch(AVAILABILITY_API_URL, { method: 'POST', body: payload, cache: 'no-store', credentials: 'omit' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.message || 'Nie udało się zapisać dostępności.');
        availabilityMessage.textContent = 'Dostępność zapisana.';
        availabilityMessage.classList.add('success');
        await loadEmployees();
        openEmployee(state.selected?.userId || data.availability?.userId);
      } catch (error) {
        availabilityMessage.textContent = error instanceof TypeError ? 'Nie udało się połączyć z serwerem.' : (error.message || 'Nie udało się zapisać dostępności.');
      } finally {
        availabilitySave.disabled = false;
        availabilitySave.querySelector('span').textContent = 'Zapisz dostępność';
      }
    });

    loadEmployees();
  }

  const page = document.body.dataset.page;
  if (page === 'login') initLogin();
  if (page === 'start') initStart();
  if (page === 'employees') initEmployees();
})();
