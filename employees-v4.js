(() => {
  'use strict';

  const API_BASE = 'https://n8n-pi.taild8d05f.ts.net/webhook';
  const EMPLOYEES_API_URL = `${API_BASE}/workplan-employees`;
  const AVAILABILITY_API_URL = `${API_BASE}/workplan-availability-set`;
  const BULK_ACTION_API_URL = `${API_BASE}/workplan-employees-bulk-action`;
  const EMPLOYEE_SKILL_API_URL = `${API_BASE}/workplan-employee-skill`;
  const EMPLOYEE_CREATE_API_URL = `${API_BASE}/workplan-employee-create`;
  const EMPLOYEE_DELETE_API_URL = `${API_BASE}/workplan-employee-delete`;
  const STORAGE_KEY = 'workplan_user';

  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const todayIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' });
  const formatDate = (value) => {
    if (!value) return 'Brak danych';
    const d = new Date(`${value}T00:00:00`);
    return Number.isNaN(d.getTime()) ? String(value) : new Intl.DateTimeFormat('pl-PL', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  };
  const roleLabel = (role) => String(role).toLowerCase() === 'leader' ? 'Lider' : 'Pracownik';

  const parseUser = (raw) => {
    try {
      const u = JSON.parse(raw || 'null');
      return u?.userId && u?.login ? u : null;
    } catch (_) {
      return null;
    }
  };

  const user = parseUser(sessionStorage.getItem(STORAGE_KEY)) || parseUser(localStorage.getItem(STORAGE_KEY));
  if (!user) {
    location.replace('index.html');
    return;
  }

  const isAdmin = String(user.role || '').toLowerCase() === 'admin';
  const display = user.displayName || user.login || 'Użytkownik';
  document.getElementById('userDisplay').textContent = display;
  document.getElementById('userAvatar').textContent = display.trim().charAt(0).toUpperCase() || 'U';
  document.getElementById('logoutBtn').addEventListener('click', () => {
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    location.replace('index.html');
  });
  document.getElementById('menuToggle')?.addEventListener('click', () => document.body.classList.toggle('nav-open'));

  const state = {
    employees: [], skills: [], processes: [], selected: null,
    selectedIds: new Set(), bulkMode: 'process',
    sort: { column: 'name', direction: 'asc' },
    filters: { name: null, login: null, role: null, availability: null, skills: null, process: null, hireDate: null },
    filterPopoverColumn: null
  };

  const rows = document.getElementById('employeeRows');
  const loading = document.getElementById('employeeLoading');
  const errorBox = document.getElementById('employeeError');
  const tableWrap = document.getElementById('employeeTableWrap');
  const search = document.getElementById('employeeSearch');
  const selectAll = document.getElementById('selectAllEmployees');
  const bulkBar = document.getElementById('bulkBar');
  const selectedCount = document.getElementById('selectedCount');
  const popover = document.getElementById('columnFilterPopover');
  const drawer = document.getElementById('employeeDrawer');
  const backdrop = document.getElementById('employeeBackdrop');
  const availabilityForm = document.getElementById('availabilityForm');
  const availabilityMessage = document.getElementById('availabilityMessage');
  const availabilitySave = document.getElementById('availabilitySave');
  const actionModal = document.getElementById('actionModal');
  const actionModalBackdrop = document.getElementById('actionModalBackdrop');
  const bulkForm = document.getElementById('bulkActionForm');
  const bulkMessage = document.getElementById('bulkActionMessage');
  const bulkSave = document.getElementById('bulkActionSave');
  const bulkProcessSelect = document.getElementById('bulkProcessSelect');
  const skillMessage = document.getElementById('skillMessage');
  const skillAddSelect = document.getElementById('skillAddSelect');
  const skillAddBtn = document.getElementById('skillAddBtn');
  const addEmployeeBtn = document.getElementById('addEmployeeBtn');
  const createModal = document.getElementById('createEmployeeModal');
  const createBackdrop = document.getElementById('createEmployeeBackdrop');
  const createForm = document.getElementById('createEmployeeForm');
  const createMessage = document.getElementById('createEmployeeMessage');
  const createSave = document.getElementById('createEmployeeSave');
  const deleteEmployeeBtn = document.getElementById('deleteEmployeeBtn');
  const deleteModal = document.getElementById('deleteEmployeeModal');
  const deleteBackdrop = document.getElementById('deleteEmployeeBackdrop');
  const deleteForm = document.getElementById('deleteEmployeeForm');
  const deleteMessage = document.getElementById('deleteEmployeeMessage');
  const deleteSave = document.getElementById('deleteEmployeeSave');

  if (!isAdmin) {
    addEmployeeBtn.hidden = true;
    deleteEmployeeBtn.hidden = true;
  }

  const columnLabels = {
    name: 'Pracownik', login: 'Login', role: 'Rola', availability: 'Dostępność',
    skills: 'Skille', process: 'Proces', hireDate: 'Data zatrudnienia'
  };

  const availabilityLabel = (e) => !e.accountActive ? 'Konto wyłączone' : (e.available ? 'Dostępny' : 'Niedostępny');
  const availabilityChip = (e) => !e.accountActive
    ? '<span class="status-chip inactive">Konto wyłączone</span>'
    : e.available ? '<span class="status-chip">Dostępny</span>' : '<span class="status-chip unavailable">Niedostępny</span>';

  function roleBadge(employee) {
    return String(employee.role).toLowerCase() === 'leader'
      ? '<span class="role-badge leader">Lider</span>'
      : '<span class="role-badge employee">Pracownik</span>';
  }

  function updateSummary() {
    document.getElementById('employeeCount').textContent = state.employees.length;
    document.getElementById('availableCount').textContent = state.employees.filter((e) => e.available && e.accountActive).length;
    document.getElementById('unavailableCount').textContent = state.employees.filter((e) => !e.available || !e.accountActive).length;
    document.getElementById('noSkillsCount').textContent = state.employees.filter((e) => !(e.skills || []).length).length;
  }

  function employeeValues(employee, column) {
    if (column === 'name') return [employee.displayName || employee.login || '—'];
    if (column === 'login') return [employee.login || '—'];
    if (column === 'role') return [roleLabel(employee.role)];
    if (column === 'availability') return [availabilityLabel(employee)];
    if (column === 'process') return [employee.currentProcess?.name || 'Brak'];
    if (column === 'hireDate') return [employee.hireDate || 'Brak danych'];
    if (column === 'skills') return (employee.skills || []).length ? employee.skills.map((s) => s.name) : ['Brak przypisanych'];
    return [];
  }

  function surnameSortValue(employee) {
    const full = String(employee.displayName || employee.login || '').trim();
    const parts = full.split(/\s+/).filter(Boolean);
    return parts.length < 2 ? full : `${parts.at(-1)} ${parts.slice(0, -1).join(' ')}`;
  }

  function uniqueValues(column) {
    const set = new Set();
    state.employees.forEach((e) => employeeValues(e, column).forEach((v) => set.add(String(v))));
    return [...set].sort((a, b) => a.localeCompare(b, 'pl', { numeric: true, sensitivity: 'base' }));
  }

  function sortValue(employee, column) {
    if (column === 'name') return surnameSortValue(employee);
    if (column === 'hireDate') return employee.hireDate || '9999-99-99';
    return employeeValues(employee, column).slice().sort((a, b) => String(a).localeCompare(String(b), 'pl', { numeric: true, sensitivity: 'base' }))[0] || '';
  }

  function filteredEmployees() {
    const query = search.value.trim().toLowerCase();
    const filtered = state.employees.filter((employee) => {
      if (String(employee.role || '').toLowerCase() === 'admin') return false;
      if (query && !`${employee.displayName || ''} ${employee.login || ''} ${employee.email || ''}`.toLowerCase().includes(query)) return false;
      return Object.entries(state.filters).every(([column, selected]) => {
        if (selected === null) return true;
        if (!selected.size) return false;
        return employeeValues(employee, column).some((value) => selected.has(String(value)));
      });
    });
    const mult = state.sort.direction === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => mult * String(sortValue(a, state.sort.column)).localeCompare(String(sortValue(b, state.sort.column)), 'pl', { numeric: true, sensitivity: 'base' }));
  }

  function updateHeaderState() {
    document.querySelectorAll('.filterable-th').forEach((th) => {
      const column = th.dataset.column;
      const activeSort = state.sort.column === column;
      const filter = state.filters[column];
      th.classList.toggle('sort-active', activeSort);
      th.classList.toggle('filter-active', filter !== null);
      const indicator = th.querySelector('.sort-indicator');
      if (indicator) indicator.textContent = activeSort ? (state.sort.direction === 'asc' ? '↑' : '↓') : '↕';
      const count = th.querySelector('.filter-count');
      if (count) {
        count.hidden = filter === null;
        count.textContent = filter === null ? '' : String(filter.size);
      }
    });
  }

  function updateBulkBar() {
    selectedCount.textContent = state.selectedIds.size;
    bulkBar.hidden = state.selectedIds.size === 0;
  }

  function renderEmployees() {
    const visible = filteredEmployees();
    if (!visible.length) {
      rows.innerHTML = '<tr class="filter-empty-row"><td colspan="9"><div><strong>Brak wyników</strong><span>Zmień filtry albo wyszukiwanie.</span></div></td></tr>';
    } else {
      rows.innerHTML = visible.map((employee) => {
        const name = employee.displayName || employee.login;
        const skills = (employee.skills || []).length
          ? employee.skills.map((s) => `<span class="skill-tag">${esc(s.name)}</span>`).join('')
          : '<span class="table-muted">Brak przypisanych</span>';
        const checked = state.selectedIds.has(employee.userId) ? ' checked' : '';
        return `<tr data-user-id="${esc(employee.userId)}" tabindex="0" class="${checked ? 'selected-row' : ''}">
          <td class="check-col"><input class="employee-checkbox" type="checkbox" aria-label="Zaznacz ${esc(name)}"${checked}></td>
          <td><div class="employee-person"><span class="mini-avatar">${esc(String(name).charAt(0).toUpperCase())}</span><div><strong>${esc(name)}</strong><span>${esc(employee.email || employee.login)}</span></div></div></td>
          <td>${esc(employee.login)}</td>
          <td>${roleBadge(employee)}</td>
          <td>${availabilityChip(employee)}</td>
          <td><div class="skill-preview all-skills">${skills}</div></td>
          <td><span class="process-chip">${esc(employee.currentProcess?.name || 'Brak')}</span></td>
          <td>${esc(formatDate(employee.hireDate))}</td>
          <td><button class="row-process-button" type="button" data-action="process">Przydziel proces</button></td>
        </tr>`;
      }).join('');
    }
    tableWrap.hidden = false;
    const selectedVisible = visible.filter((e) => state.selectedIds.has(e.userId)).length;
    selectAll.checked = visible.length > 0 && selectedVisible === visible.length;
    selectAll.indeterminate = selectedVisible > 0 && selectedVisible < visible.length;
    selectAll.disabled = visible.length === 0;

    rows.querySelectorAll('tr[data-user-id]').forEach((row) => {
      const id = row.dataset.userId;
      const checkbox = row.querySelector('.employee-checkbox');
      const processButton = row.querySelector('[data-action="process"]');
      checkbox.addEventListener('click', (event) => {
        event.stopPropagation();
        checkbox.checked ? state.selectedIds.add(id) : state.selectedIds.delete(id);
        renderEmployees();
      });
      processButton.addEventListener('click', (event) => {
        event.stopPropagation();
        openBulkModal('process', [id]);
      });
      row.addEventListener('click', (event) => {
        if (!event.target.closest('button,input')) openEmployee(id);
      });
      row.addEventListener('keydown', (event) => {
        if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button,input')) {
          event.preventDefault(); openEmployee(id);
        }
      });
    });
    updateHeaderState();
    updateBulkBar();
  }

  function toggleSort(column) {
    state.sort = state.sort.column === column
      ? { column, direction: state.sort.direction === 'asc' ? 'desc' : 'asc' }
      : { column, direction: 'asc' };
    renderEmployees();
  }

  function closeFilterPopover() {
    popover.hidden = true;
    popover.innerHTML = '';
    state.filterPopoverColumn = null;
  }

  function positionFilterPopover(anchor) {
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 24);
    popover.style.width = `${width}px`;
    popover.hidden = false;
    popover.style.left = `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`;
    popover.style.top = `${Math.min(rect.bottom + 8, Math.max(12, window.innerHeight - Math.min(popover.scrollHeight, 520) - 12))}px`;
  }

  function openFilterPopover(column, anchor) {
    state.filterPopoverColumn = column;
    const values = uniqueValues(column);
    const current = state.filters[column];
    const initial = current === null ? new Set(values) : new Set(current);
    popover.innerHTML = `<div class="filter-popover-head"><div><span>Filtr kolumny</span><strong>${esc(columnLabels[column])}</strong></div><button class="filter-close" type="button">×</button></div>
      <div class="filter-sort-row"><button type="button" data-sort="asc">↑ Rosnąco</button><button type="button" data-sort="desc">↓ Malejąco</button></div>
      <label class="filter-search"><span>⌕</span><input type="search" placeholder="Szukaj na liście"></label>
      <label class="filter-select-all"><input id="filterSelectAll" type="checkbox"><span>Zaznacz wszystko</span><small>${values.length}</small></label>
      <div class="filter-values">${values.map((value, i) => `<label class="filter-value" data-i="${i}"><input type="checkbox"${initial.has(value) ? ' checked' : ''}><span>${esc(column === 'hireDate' && value !== 'Brak danych' ? formatDate(value) : value)}</span></label>`).join('')}</div>
      <div class="filter-popover-footer"><button class="filter-clear" type="button">Wyczyść filtr</button><button class="filter-apply" type="button">Zastosuj →</button></div>`;
    positionFilterPopover(anchor);
    const valueRows = [...popover.querySelectorAll('.filter-value')];
    const selectAllBox = popover.querySelector('#filterSelectAll');
    const sync = () => {
      const visible = valueRows.filter((r) => !r.hidden);
      const checked = visible.filter((r) => r.querySelector('input').checked).length;
      selectAllBox.checked = visible.length > 0 && checked === visible.length;
      selectAllBox.indeterminate = checked > 0 && checked < visible.length;
    };
    sync();
    popover.querySelector('.filter-close').addEventListener('click', closeFilterPopover);
    popover.querySelector('[data-sort="asc"]').addEventListener('click', () => { state.sort = { column, direction: 'asc' }; renderEmployees(); closeFilterPopover(); });
    popover.querySelector('[data-sort="desc"]').addEventListener('click', () => { state.sort = { column, direction: 'desc' }; renderEmployees(); closeFilterPopover(); });
    popover.querySelector('.filter-search input').addEventListener('input', (event) => {
      const q = event.target.value.trim().toLowerCase();
      valueRows.forEach((r) => { r.hidden = q && !String(values[Number(r.dataset.i)]).toLowerCase().includes(q); });
      sync();
    });
    selectAllBox.addEventListener('change', () => { valueRows.filter((r) => !r.hidden).forEach((r) => r.querySelector('input').checked = selectAllBox.checked); sync(); });
    valueRows.forEach((r) => r.querySelector('input').addEventListener('change', sync));
    popover.querySelector('.filter-clear').addEventListener('click', () => { state.filters[column] = null; renderEmployees(); closeFilterPopover(); });
    popover.querySelector('.filter-apply').addEventListener('click', () => {
      const selected = new Set(valueRows.filter((r) => r.querySelector('input').checked).map((r) => values[Number(r.dataset.i)]));
      state.filters[column] = selected.size === values.length ? null : selected;
      renderEmployees(); closeFilterPopover();
    });
  }

  function renderCatalogs() {
    bulkProcessSelect.innerHTML = state.processes.length
      ? state.processes.map((p) => `<option value="${esc(p.processId)}">${esc(p.name)}</option>`).join('')
      : '<option value="">Brak procesów</option>';
  }

  function renderSkillEditor(employee) {
    const assigned = employee.skills || [];
    const assignedIds = new Set(assigned.map((s) => s.skillId));
    const box = document.getElementById('detailSkills');
    box.innerHTML = assigned.length
      ? assigned.map((s) => `<span class="skill-tag editable">${esc(s.name)}<button type="button" data-remove-skill="${esc(s.skillId)}">×</button></span>`).join('')
      : '<div class="skills-empty">Ten pracownik nie ma przypisanych skilli.</div>';
    const available = state.skills.filter((s) => !assignedIds.has(s.skillId));
    skillAddSelect.innerHTML = available.length ? available.map((s) => `<option value="${esc(s.skillId)}">${esc(s.name)}</option>`).join('') : '<option value="">Brak kolejnych skilli</option>';
    skillAddSelect.disabled = !available.length;
    skillAddBtn.disabled = !available.length;
    box.querySelectorAll('[data-remove-skill]').forEach((btn) => btn.addEventListener('click', () => changeSkill('remove', btn.dataset.removeSkill)));
  }

  function openEmployee(id) {
    const employee = state.employees.find((e) => e.userId === id);
    if (!employee) return;
    state.selected = employee;
    skillMessage.textContent = '';
    availabilityMessage.textContent = '';
    document.getElementById('employeeDrawerTitle').textContent = employee.displayName || employee.login;
    document.getElementById('employeeDrawerLogin').textContent = `@${employee.login}`;
    document.getElementById('detailLogin').textContent = employee.login;
    document.getElementById('detailEmail').textContent = employee.email || 'Brak danych';
    document.getElementById('detailRole').innerHTML = roleBadge(employee);
    document.getElementById('detailHireDate').textContent = formatDate(employee.hireDate);
    document.getElementById('detailAccount').textContent = employee.accountActive ? 'Aktywne' : 'Wyłączone';
    document.getElementById('detailProcess').textContent = employee.currentProcess
      ? `${employee.currentProcess.name} · ${formatDate(employee.currentProcess.dateFrom)}–${formatDate(employee.currentProcess.dateTo)}`
      : 'Brak przydzielonego procesu';
    const badge = document.getElementById('detailAvailability');
    badge.textContent = employee.available ? 'Dostępny' : 'Niedostępny';
    badge.className = `status-chip${employee.available ? '' : ' unavailable'}`;
    const rule = employee.availabilityRule;
    document.getElementById('availabilityFrom').value = rule?.dateFrom || todayIso();
    document.getElementById('availabilityTo').value = rule?.dateTo || todayIso();
    document.getElementById('availabilityNote').value = rule?.note || '';
    availabilityForm.querySelector(`input[name="availabilityState"][value="${employee.available ? 'true' : 'false'}"]`).checked = true;
    renderSkillEditor(employee);
    deleteEmployeeBtn.hidden = !isAdmin;
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

  async function changeSkill(action, skillId) {
    if (!state.selected || !skillId) return;
    const id = state.selected.userId;
    skillMessage.textContent = action === 'add' ? 'Dodawanie skilla…' : 'Usuwanie skilla…';
    try {
      const body = new URLSearchParams({ action, userId: id, skillId, changedBy: user.userId });
      const response = await fetch(EMPLOYEE_SKILL_API_URL, { method: 'POST', body, cache: 'no-store', credentials: 'omit' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.message || 'Nie udało się zmienić skilla.');
      await loadEmployees(false); openEmployee(id);
      skillMessage.textContent = action === 'add' ? 'Skill dodany.' : 'Skill usunięty.';
      skillMessage.classList.add('success');
    } catch (error) { skillMessage.textContent = error.message || 'Nie udało się zmienić skilla.'; }
  }

  function openBulkModal(mode, explicitIds = null) {
    state.bulkMode = mode;
    const ids = explicitIds || [...state.selectedIds];
    if (!ids.length) return;
    actionModal.dataset.userIds = ids.join(',');
    document.getElementById('actionModalTitle').textContent = mode === 'process' ? 'Przydziel / zmień proces' : 'Zmień dostępność';
    document.getElementById('actionModalSubtitle').textContent = `Zmiana obejmie ${ids.length} ${ids.length === 1 ? 'pracownika' : 'pracowników'}.`;
    document.getElementById('processFields').hidden = mode !== 'process';
    document.getElementById('availabilityFields').hidden = mode !== 'availability';
    bulkProcessSelect.required = mode === 'process';
    document.getElementById('bulkDateFrom').value = todayIso();
    document.getElementById('bulkDateTo').value = todayIso();
    document.getElementById('bulkNote').value = '';
    bulkMessage.textContent = '';
    actionModalBackdrop.hidden = false;
    actionModal.classList.add('open');
  }

  function closeBulkModal() { actionModal.classList.remove('open'); actionModalBackdrop.hidden = true; actionModal.dataset.userIds = ''; }

  function openCreateModal() {
    if (!isAdmin) return;
    createForm.reset();
    document.getElementById('createHireDate').value = todayIso();
    createMessage.textContent = '';
    createBackdrop.hidden = false;
    createModal.classList.add('open');
    setTimeout(() => document.getElementById('createDisplayName').focus(), 40);
  }
  function closeCreateModal() { createModal.classList.remove('open'); createBackdrop.hidden = true; }

  function openDeleteModal() {
    if (!isAdmin || !state.selected) return;
    document.getElementById('deleteEmployeeName').textContent = state.selected.displayName || state.selected.login;
    document.getElementById('deleteAdminPassword').value = '';
    deleteMessage.textContent = '';
    deleteBackdrop.hidden = false;
    deleteModal.classList.add('open');
    setTimeout(() => document.getElementById('deleteAdminPassword').focus(), 40);
  }
  function closeDeleteModal() { deleteModal.classList.remove('open'); deleteBackdrop.hidden = true; }

  async function loadEmployees(showLoading = true) {
    if (showLoading) loading.hidden = false;
    errorBox.hidden = true;
    try {
      const response = await fetch(EMPLOYEES_API_URL, { method: 'GET', cache: 'no-store', credentials: 'omit' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok || !Array.isArray(data.employees)) throw new Error(data.message || 'Nie udało się pobrać listy pracowników.');
      state.employees = data.employees.filter((e) => String(e.role || '').toLowerCase() !== 'admin');
      state.skills = Array.isArray(data.skills) ? data.skills : [];
      state.processes = Array.isArray(data.processes) ? data.processes : [];
      renderCatalogs(); updateSummary(); renderEmployees();
    } catch (error) {
      errorBox.textContent = error.message || 'Nie udało się pobrać listy pracowników.';
      errorBox.hidden = false;
    } finally { loading.hidden = true; }
  }

  document.querySelector('.employee-table thead').addEventListener('click', (event) => {
    const sortButton = event.target.closest('.column-sort-button');
    if (sortButton) { event.stopPropagation(); toggleSort(sortButton.dataset.column); return; }
    const filterButton = event.target.closest('.column-filter-button');
    if (filterButton) {
      event.stopPropagation();
      const column = filterButton.dataset.column;
      if (!popover.hidden && state.filterPopoverColumn === column) closeFilterPopover();
      else openFilterPopover(column, filterButton);
    }
  });
  document.addEventListener('click', (event) => { if (!popover.hidden && !popover.contains(event.target) && !event.target.closest('.column-filter-button')) closeFilterPopover(); });
  search.addEventListener('input', renderEmployees);
  selectAll.addEventListener('change', () => { filteredEmployees().forEach((e) => selectAll.checked ? state.selectedIds.add(e.userId) : state.selectedIds.delete(e.userId)); renderEmployees(); });
  document.getElementById('clearSelectionBtn').addEventListener('click', () => { state.selectedIds.clear(); renderEmployees(); });
  document.getElementById('bulkProcessBtn').addEventListener('click', () => openBulkModal('process'));
  document.getElementById('bulkAvailabilityBtn').addEventListener('click', () => openBulkModal('availability'));
  document.getElementById('drawerProcessBtn').addEventListener('click', () => state.selected && openBulkModal('process', [state.selected.userId]));
  document.getElementById('employeeDrawerClose').addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);
  document.getElementById('actionModalClose').addEventListener('click', closeBulkModal);
  document.getElementById('bulkActionCancel').addEventListener('click', closeBulkModal);
  actionModalBackdrop.addEventListener('click', closeBulkModal);
  skillAddBtn.addEventListener('click', () => changeSkill('add', skillAddSelect.value));
  addEmployeeBtn.addEventListener('click', openCreateModal);
  document.getElementById('createEmployeeClose').addEventListener('click', closeCreateModal);
  document.getElementById('createEmployeeCancel').addEventListener('click', closeCreateModal);
  createBackdrop.addEventListener('click', closeCreateModal);
  deleteEmployeeBtn.addEventListener('click', openDeleteModal);
  document.getElementById('deleteEmployeeClose').addEventListener('click', closeDeleteModal);
  document.getElementById('deleteEmployeeCancel').addEventListener('click', closeDeleteModal);
  deleteBackdrop.addEventListener('click', closeDeleteModal);

  availabilityForm.addEventListener('submit', async (event) => {
    event.preventDefault(); if (!state.selected) return;
    const id = state.selected.userId;
    availabilitySave.disabled = true; availabilityMessage.textContent = '';
    try {
      const body = new URLSearchParams({
        userId: id,
        dateFrom: document.getElementById('availabilityFrom').value,
        dateTo: document.getElementById('availabilityTo').value,
        available: availabilityForm.querySelector('input[name="availabilityState"]:checked').value,
        note: document.getElementById('availabilityNote').value.trim(), createdBy: user.userId
      });
      const response = await fetch(AVAILABILITY_API_URL, { method: 'POST', body, cache: 'no-store', credentials: 'omit' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.message || 'Nie udało się zapisać dostępności.');
      await loadEmployees(false); openEmployee(id); availabilityMessage.textContent = 'Dostępność zapisana.'; availabilityMessage.classList.add('success');
    } catch (error) { availabilityMessage.textContent = error.message || 'Nie udało się zapisać dostępności.'; }
    finally { availabilitySave.disabled = false; }
  });

  bulkForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const ids = String(actionModal.dataset.userIds || '').split(',').filter(Boolean);
    if (!ids.length) return;
    bulkSave.disabled = true; bulkMessage.textContent = '';
    try {
      const body = new URLSearchParams({
        action: state.bulkMode, userIds: ids.join(','),
        processId: state.bulkMode === 'process' ? bulkProcessSelect.value : '',
        available: state.bulkMode === 'availability' ? bulkForm.querySelector('input[name="bulkAvailabilityState"]:checked').value : '',
        dateFrom: document.getElementById('bulkDateFrom').value,
        dateTo: document.getElementById('bulkDateTo').value,
        note: document.getElementById('bulkNote').value.trim(), createdBy: user.userId
      });
      const response = await fetch(BULK_ACTION_API_URL, { method: 'POST', body, cache: 'no-store', credentials: 'omit' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.message || 'Nie udało się zapisać zmiany grupowej.');
      await loadEmployees(false); state.selectedIds.clear(); closeBulkModal(); renderEmployees();
    } catch (error) { bulkMessage.textContent = error.message || 'Nie udało się zapisać zmiany grupowej.'; }
    finally { bulkSave.disabled = false; }
  });

  createForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!isAdmin) return;
    const password = document.getElementById('createPassword').value;
    const confirmPassword = document.getElementById('createPasswordConfirm').value;
    createMessage.textContent = '';
    if (password !== confirmPassword) { createMessage.textContent = 'Hasła nie są identyczne.'; return; }
    createSave.disabled = true;
    try {
      const body = new URLSearchParams({
        displayName: document.getElementById('createDisplayName').value.trim(),
        login: document.getElementById('createLogin').value.trim(),
        email: document.getElementById('createEmail').value.trim(),
        role: document.getElementById('createRole').value,
        hireDate: document.getElementById('createHireDate').value,
        password,
        requestedBy: user.userId
      });
      const response = await fetch(EMPLOYEE_CREATE_API_URL, { method: 'POST', body, cache: 'no-store', credentials: 'omit' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.message || 'Nie udało się utworzyć pracownika.');
      await loadEmployees(false);
      closeCreateModal();
      if (data.user?.userId) openEmployee(data.user.userId);
    } catch (error) { createMessage.textContent = error.message || 'Nie udało się utworzyć pracownika.'; }
    finally { createSave.disabled = false; }
  });

  deleteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!isAdmin || !state.selected) return;
    const targetId = state.selected.userId;
    deleteMessage.textContent = '';
    deleteSave.disabled = true;
    try {
      const body = new URLSearchParams({ targetUserId: targetId, requestedBy: user.userId, adminPassword: document.getElementById('deleteAdminPassword').value });
      const response = await fetch(EMPLOYEE_DELETE_API_URL, { method: 'POST', body, cache: 'no-store', credentials: 'omit' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.message || 'Nie udało się usunąć pracownika.');
      closeDeleteModal(); closeDrawer(); state.selectedIds.delete(targetId); await loadEmployees(false);
    } catch (error) { deleteMessage.textContent = error.message || 'Nie udało się usunąć pracownika.'; }
    finally { deleteSave.disabled = false; }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!popover.hidden) closeFilterPopover();
    else if (deleteModal.classList.contains('open')) closeDeleteModal();
    else if (createModal.classList.contains('open')) closeCreateModal();
    else if (actionModal.classList.contains('open')) closeBulkModal();
    else if (drawer.classList.contains('open')) closeDrawer();
  });

  loadEmployees();
})();
