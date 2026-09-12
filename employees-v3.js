(() => {
  'use strict';

  const API_BASE = 'https://n8n-pi.taild8d05f.ts.net/webhook';
  const EMPLOYEES_API_URL = `${API_BASE}/workplan-employees`;
  const AVAILABILITY_API_URL = `${API_BASE}/workplan-availability-set`;
  const BULK_ACTION_API_URL = `${API_BASE}/workplan-employees-bulk-action`;
  const EMPLOYEE_SKILL_API_URL = `${API_BASE}/workplan-employee-skill`;
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
    return Number.isNaN(d.getTime())
      ? String(value)
      : new Intl.DateTimeFormat('pl-PL', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  };

  const parseUser = (raw) => {
    try {
      const user = JSON.parse(raw || 'null');
      return user?.userId && user?.login ? user : null;
    } catch (_) {
      return null;
    }
  };

  const getUser = () => parseUser(sessionStorage.getItem(STORAGE_KEY)) || parseUser(localStorage.getItem(STORAGE_KEY));
  const user = getUser();
  if (!user) {
    location.replace('index.html');
    return;
  }

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
    employees: [],
    skills: [],
    processes: [],
    selected: null,
    selectedIds: new Set(),
    bulkMode: 'process',
    sort: { column: 'name', direction: 'asc' },
    filters: {
      name: null,
      login: null,
      availability: null,
      skills: null,
      process: null,
      hireDate: null
    },
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
  const modal = document.getElementById('actionModal');
  const modalBackdrop = document.getElementById('actionModalBackdrop');
  const bulkForm = document.getElementById('bulkActionForm');
  const bulkMessage = document.getElementById('bulkActionMessage');
  const bulkSave = document.getElementById('bulkActionSave');
  const bulkProcessSelect = document.getElementById('bulkProcessSelect');
  const skillMessage = document.getElementById('skillMessage');
  const skillAddSelect = document.getElementById('skillAddSelect');
  const skillAddBtn = document.getElementById('skillAddBtn');

  const columnLabels = {
    name: 'Pracownik',
    login: 'Login',
    availability: 'Dostępność',
    skills: 'Skille',
    process: 'Proces',
    hireDate: 'Data zatrudnienia'
  };

  function updateSummary() {
    document.getElementById('employeeCount').textContent = state.employees.length;
    document.getElementById('availableCount').textContent = state.employees.filter((e) => e.available && e.accountActive).length;
    document.getElementById('unavailableCount').textContent = state.employees.filter((e) => !e.available || !e.accountActive).length;
    document.getElementById('noSkillsCount').textContent = state.employees.filter((e) => !(e.skills || []).length).length;
  }

  function availabilityLabel(employee) {
    if (!employee.accountActive) return 'Konto wyłączone';
    return employee.available ? 'Dostępny' : 'Niedostępny';
  }

  function availabilityChip(employee) {
    if (!employee.accountActive) return '<span class="status-chip inactive">Konto wyłączone</span>';
    return employee.available
      ? '<span class="status-chip">Dostępny</span>'
      : '<span class="status-chip unavailable">Niedostępny</span>';
  }

  function surnameSortValue(employee) {
    const full = String(employee.displayName || employee.login || '').trim();
    const parts = full.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return full;
    return `${parts.at(-1)} ${parts.slice(0, -1).join(' ')}`;
  }

  function employeeValues(employee, column) {
    if (column === 'name') return [employee.displayName || employee.login || '—'];
    if (column === 'login') return [employee.login || '—'];
    if (column === 'availability') return [availabilityLabel(employee)];
    if (column === 'process') return [employee.currentProcess?.name || 'Brak'];
    if (column === 'hireDate') return [employee.hireDate || 'Brak danych'];
    if (column === 'skills') {
      return (employee.skills || []).length
        ? employee.skills.map((skill) => skill.name)
        : ['Brak przypisanych'];
    }
    return [];
  }

  function uniqueValues(column) {
    const values = new Set();
    state.employees.forEach((employee) => employeeValues(employee, column).forEach((value) => values.add(String(value))));
    return [...values].sort((a, b) => a.localeCompare(b, 'pl', { numeric: true, sensitivity: 'base' }));
  }

  function sortValue(employee, column) {
    if (column === 'name') return surnameSortValue(employee);
    if (column === 'hireDate') return employee.hireDate || '9999-99-99';
    const values = employeeValues(employee, column).slice().sort((a, b) => String(a).localeCompare(String(b), 'pl', { numeric: true, sensitivity: 'base' }));
    return values[0] || '';
  }

  function filteredEmployees() {
    const query = search.value.trim().toLowerCase();
    const filtered = state.employees.filter((employee) => {
      if (query && !`${employee.displayName || ''} ${employee.login || ''}`.toLowerCase().includes(query)) return false;
      return Object.entries(state.filters).every(([column, selected]) => {
        if (selected === null) return true;
        if (selected.size === 0) return false;
        return employeeValues(employee, column).some((value) => selected.has(String(value)));
      });
    });

    const multiplier = state.sort.direction === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => multiplier * String(sortValue(a, state.sort.column)).localeCompare(
      String(sortValue(b, state.sort.column)),
      'pl',
      { numeric: true, sensitivity: 'base' }
    ));
  }

  function updateHeaderState() {
    document.querySelectorAll('.filterable-th').forEach((th) => {
      const column = th.dataset.column;
      const sortButton = th.querySelector('.column-sort-button');
      const sortIndicator = th.querySelector('.sort-indicator');
      const filterButton = th.querySelector('.column-filter-button');
      const filterCount = th.querySelector('.filter-count');
      const filter = state.filters[column];
      const filterActive = filter !== null;
      const sortActive = state.sort.column === column;

      th.classList.toggle('sort-active', sortActive);
      th.classList.toggle('filter-active', filterActive);
      sortButton?.setAttribute('aria-pressed', sortActive ? 'true' : 'false');
      filterButton?.setAttribute('aria-pressed', filterActive ? 'true' : 'false');

      if (sortIndicator) sortIndicator.textContent = sortActive ? (state.sort.direction === 'asc' ? '↑' : '↓') : '↕';
      if (filterCount) {
        filterCount.hidden = !filterActive;
        filterCount.textContent = filterActive ? String(filter.size) : '';
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
      rows.innerHTML = '<tr class="filter-empty-row"><td colspan="8"><div><strong>Brak wyników</strong><span>Zmień filtry w nagłówkach albo wyczyść wyszukiwanie.</span></div></td></tr>';
    } else {
      rows.innerHTML = visible.map((employee) => {
        const name = employee.displayName || employee.login;
        const skills = (employee.skills || []).length
          ? employee.skills.map((skill) => `<span class="skill-tag">${esc(skill.name)}</span>`).join('')
          : '<span class="table-muted">Brak przypisanych</span>';
        const checked = state.selectedIds.has(employee.userId) ? ' checked' : '';
        return `<tr data-user-id="${esc(employee.userId)}" tabindex="0" class="${checked ? 'selected-row' : ''}">
          <td class="check-col"><input class="employee-checkbox" type="checkbox" aria-label="Zaznacz ${esc(name)}"${checked}></td>
          <td><div class="employee-person"><span class="mini-avatar">${esc(String(name).charAt(0).toUpperCase())}</span><div><strong>${esc(name)}</strong><span>${esc(employee.role || 'pracownik')}</span></div></div></td>
          <td>${esc(employee.login)}</td>
          <td>${availabilityChip(employee)}</td>
          <td><div class="skill-preview all-skills">${skills}</div></td>
          <td><span class="process-chip">${esc(employee.currentProcess?.name || 'Brak')}</span></td>
          <td>${esc(formatDate(employee.hireDate))}</td>
          <td><button class="row-process-button" type="button" data-action="process">Przydziel proces</button></td>
        </tr>`;
      }).join('');
    }

    tableWrap.hidden = false;
    const selectedVisible = visible.filter((employee) => state.selectedIds.has(employee.userId)).length;
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

      const open = (event) => {
        if (event.target.closest('button,input')) return;
        openEmployee(id);
      };
      row.addEventListener('click', open);
      row.addEventListener('keydown', (event) => {
        if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button,input')) {
          event.preventDefault();
          openEmployee(id);
        }
      });
    });

    for (const id of [...state.selectedIds]) {
      if (!state.employees.some((employee) => employee.userId === id)) state.selectedIds.delete(id);
    }

    updateHeaderState();
    updateBulkBar();
  }

  function toggleSort(column) {
    if (state.sort.column === column) {
      state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
    } else {
      state.sort = { column, direction: 'asc' };
    }
    renderEmployees();
  }

  function positionFilterPopover(anchor) {
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 24);
    popover.style.width = `${width}px`;
    const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
    popover.style.left = `${left}px`;
    popover.hidden = false;

    const popoverHeight = Math.min(popover.scrollHeight, Math.max(280, window.innerHeight - 24));
    const below = rect.bottom + 8;
    const fitsBelow = below + popoverHeight <= window.innerHeight - 12;
    const top = fitsBelow ? below : Math.max(12, rect.top - popoverHeight - 8);
    popover.style.top = `${top}px`;
  }

  function closeFilterPopover() {
    popover.hidden = true;
    popover.innerHTML = '';
    state.filterPopoverColumn = null;
  }

  function openFilterPopover(column, anchor) {
    state.filterPopoverColumn = column;
    const values = uniqueValues(column);
    const activeFilter = state.filters[column];
    const initialSelection = activeFilter === null ? new Set(values) : new Set(activeFilter);

    popover.innerHTML = `<div class="filter-popover-head">
        <div><span>Filtr kolumny</span><strong>${esc(columnLabels[column])}</strong></div>
        <button class="filter-close" type="button" aria-label="Zamknij">×</button>
      </div>
      <div class="filter-sort-row">
        <button type="button" data-sort="asc"><span>↑</span> Rosnąco</button>
        <button type="button" data-sort="desc"><span>↓</span> Malejąco</button>
      </div>
      <label class="filter-search"><span>⌕</span><input type="search" placeholder="Szukaj na liście" autocomplete="off"></label>
      <label class="filter-select-all"><input id="filterSelectAll" type="checkbox"><span>Zaznacz wszystko</span><small>${values.length}</small></label>
      <div class="filter-values">${values.map((value, index) => `<label class="filter-value" data-value-index="${index}"><input type="checkbox"${initialSelection.has(value) ? ' checked' : ''}><span>${esc(column === 'hireDate' && value !== 'Brak danych' ? formatDate(value) : value)}</span></label>`).join('')}</div>
      <div class="filter-popover-footer">
        <button class="filter-clear" data-action="clear" type="button">Wyczyść filtr</button>
        <button class="filter-apply" data-action="apply" type="button">Zastosuj <span>→</span></button>
      </div>`;

    positionFilterPopover(anchor);

    const valueRows = [...popover.querySelectorAll('.filter-value')];
    const selectAllBox = popover.querySelector('#filterSelectAll');

    const syncSelectAll = () => {
      const visibleRows = valueRows.filter((row) => !row.hidden);
      const checkedVisible = visibleRows.filter((row) => row.querySelector('input').checked).length;
      selectAllBox.checked = visibleRows.length > 0 && checkedVisible === visibleRows.length;
      selectAllBox.indeterminate = checkedVisible > 0 && checkedVisible < visibleRows.length;
    };

    syncSelectAll();

    popover.querySelector('.filter-close').addEventListener('click', closeFilterPopover);
    popover.querySelector('[data-sort="asc"]').addEventListener('click', () => {
      state.sort = { column, direction: 'asc' };
      renderEmployees();
      closeFilterPopover();
    });
    popover.querySelector('[data-sort="desc"]').addEventListener('click', () => {
      state.sort = { column, direction: 'desc' };
      renderEmployees();
      closeFilterPopover();
    });

    popover.querySelector('.filter-search input').addEventListener('input', (event) => {
      const query = event.target.value.trim().toLowerCase();
      valueRows.forEach((row) => {
        const value = values[Number(row.dataset.valueIndex)] || '';
        row.hidden = !!query && !String(value).toLowerCase().includes(query);
      });
      syncSelectAll();
    });

    selectAllBox.addEventListener('change', () => {
      valueRows.filter((row) => !row.hidden).forEach((row) => {
        row.querySelector('input').checked = selectAllBox.checked;
      });
      syncSelectAll();
    });

    valueRows.forEach((row) => row.querySelector('input').addEventListener('change', syncSelectAll));

    popover.querySelector('[data-action="clear"]').addEventListener('click', () => {
      state.filters[column] = null;
      renderEmployees();
      closeFilterPopover();
    });

    popover.querySelector('[data-action="apply"]').addEventListener('click', () => {
      const selected = new Set(
        valueRows
          .filter((row) => row.querySelector('input').checked)
          .map((row) => values[Number(row.dataset.valueIndex)])
      );
      state.filters[column] = selected.size === values.length ? null : selected;
      renderEmployees();
      closeFilterPopover();
    });
  }

  function renderCatalogs() {
    bulkProcessSelect.innerHTML = state.processes.length
      ? state.processes.map((process) => `<option value="${esc(process.processId)}">${esc(process.name)}</option>`).join('')
      : '<option value="">Brak procesów</option>';
  }

  function renderSkillEditor(employee) {
    const assigned = employee.skills || [];
    const assignedIds = new Set(assigned.map((skill) => skill.skillId));
    const detailSkills = document.getElementById('detailSkills');

    detailSkills.innerHTML = assigned.length
      ? assigned.map((skill) => `<span class="skill-tag editable">${esc(skill.name)}<button type="button" data-remove-skill="${esc(skill.skillId)}" aria-label="Usuń ${esc(skill.name)}">×</button></span>`).join('')
      : '<div class="skills-empty">Ten pracownik nie ma jeszcze przypisanych skilli.</div>';

    const available = state.skills.filter((skill) => !assignedIds.has(skill.skillId));
    skillAddSelect.innerHTML = available.length
      ? available.map((skill) => `<option value="${esc(skill.skillId)}">${esc(skill.name)}</option>`).join('')
      : '<option value="">Brak kolejnych skilli</option>';
    skillAddSelect.disabled = !available.length;
    skillAddBtn.disabled = !available.length;

    detailSkills.querySelectorAll('[data-remove-skill]').forEach((button) => {
      button.addEventListener('click', () => changeSkill('remove', button.dataset.removeSkill));
    });
  }

  function openEmployee(id) {
    const employee = state.employees.find((item) => item.userId === id);
    if (!employee) return;
    state.selected = employee;
    skillMessage.textContent = '';
    skillMessage.classList.remove('success');
    availabilityMessage.textContent = '';
    availabilityMessage.classList.remove('success');

    document.getElementById('employeeDrawerTitle').textContent = employee.displayName || employee.login;
    document.getElementById('employeeDrawerLogin').textContent = `@${employee.login}`;
    document.getElementById('detailLogin').textContent = employee.login;
    document.getElementById('detailRole').textContent = employee.role || '—';
    document.getElementById('detailHireDate').textContent = formatDate(employee.hireDate);
    document.getElementById('detailAccount').textContent = employee.accountActive ? 'Aktywne' : 'Wyłączone';
    document.getElementById('detailProcess').textContent = employee.currentProcess
      ? `${employee.currentProcess.name} · ${formatDate(employee.currentProcess.dateFrom)}–${formatDate(employee.currentProcess.dateTo)}`
      : 'Brak przydzielonego procesu';

    const availabilityBadge = document.getElementById('detailAvailability');
    availabilityBadge.textContent = employee.available ? 'Dostępny' : 'Niedostępny';
    availabilityBadge.className = `status-chip${employee.available ? '' : ' unavailable'}`;

    const rule = employee.availabilityRule;
    document.getElementById('availabilityFrom').value = rule?.dateFrom || todayIso();
    document.getElementById('availabilityTo').value = rule?.dateTo || todayIso();
    document.getElementById('availabilityNote').value = rule?.note || '';
    const radio = availabilityForm.querySelector(`input[name="availabilityState"][value="${employee.available ? 'true' : 'false'}"]`);
    if (radio) radio.checked = true;

    renderSkillEditor(employee);
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
    const employeeId = state.selected.userId;
    skillMessage.classList.remove('success');
    skillMessage.textContent = action === 'add' ? 'Dodawanie skilla…' : 'Usuwanie skilla…';
    skillAddBtn.disabled = true;

    try {
      const payload = new URLSearchParams({ action, userId: employeeId, skillId, changedBy: user.userId });
      const response = await fetch(EMPLOYEE_SKILL_API_URL, { method: 'POST', body: payload, cache: 'no-store', credentials: 'omit' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.message || 'Nie udało się zmienić skilla.');

      await loadEmployees(false);
      openEmployee(employeeId);
      skillMessage.textContent = action === 'add' ? 'Skill dodany.' : 'Skill usunięty.';
      skillMessage.classList.add('success');
    } catch (error) {
      skillMessage.textContent = error instanceof TypeError
        ? 'Nie udało się połączyć z serwerem.'
        : (error.message || 'Nie udało się zmienić skilla.');
    } finally {
      if (state.selected) renderSkillEditor(state.selected);
    }
  }

  function openBulkModal(mode, explicitIds = null) {
    state.bulkMode = mode;
    const ids = explicitIds || [...state.selectedIds];
    if (!ids.length) return;

    modal.dataset.userIds = ids.join(',');
    document.getElementById('actionModalTitle').textContent = mode === 'process' ? 'Przydziel / zmień proces' : 'Zmień dostępność';
    document.getElementById('actionModalSubtitle').textContent = `Zmiana obejmie ${ids.length} ${ids.length === 1 ? 'pracownika' : 'pracowników'}.`;
    document.getElementById('processFields').hidden = mode !== 'process';
    document.getElementById('availabilityFields').hidden = mode !== 'availability';
    bulkProcessSelect.required = mode === 'process';
    document.getElementById('bulkDateFrom').value = todayIso();
    document.getElementById('bulkDateTo').value = todayIso();
    document.getElementById('bulkNote').value = '';
    bulkMessage.textContent = '';
    bulkMessage.classList.remove('success');
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

  async function loadEmployees(showLoading = true) {
    if (showLoading) loading.hidden = false;
    errorBox.hidden = true;

    try {
      const response = await fetch(EMPLOYEES_API_URL, { method: 'GET', cache: 'no-store', credentials: 'omit' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok || !Array.isArray(data.employees)) {
        throw new Error(data.message || 'Nie udało się pobrać listy pracowników.');
      }

      state.employees = data.employees;
      state.skills = Array.isArray(data.skills) ? data.skills : [];
      state.processes = Array.isArray(data.processes) ? data.processes : [];
      renderCatalogs();
      updateSummary();
      renderEmployees();
    } catch (error) {
      errorBox.textContent = error instanceof TypeError
        ? 'Nie udało się połączyć z serwerem.'
        : (error.message || 'Nie udało się pobrać listy pracowników.');
      errorBox.hidden = false;
    } finally {
      loading.hidden = true;
    }
  }

  document.querySelector('.employee-table thead').addEventListener('click', (event) => {
    const sortButton = event.target.closest('.column-sort-button');
    if (sortButton) {
      event.stopPropagation();
      toggleSort(sortButton.dataset.column);
      return;
    }

    const filterButton = event.target.closest('.column-filter-button');
    if (filterButton) {
      event.stopPropagation();
      const column = filterButton.dataset.column;
      if (!popover.hidden && state.filterPopoverColumn === column) closeFilterPopover();
      else openFilterPopover(column, filterButton);
    }
  });

  document.addEventListener('click', (event) => {
    if (!popover.hidden && !popover.contains(event.target) && !event.target.closest('.column-filter-button')) closeFilterPopover();
  });
  window.addEventListener('resize', closeFilterPopover);
  window.addEventListener('scroll', closeFilterPopover, true);

  search.addEventListener('input', renderEmployees);
  selectAll.addEventListener('change', () => {
    filteredEmployees().forEach((employee) => {
      selectAll.checked ? state.selectedIds.add(employee.userId) : state.selectedIds.delete(employee.userId);
    });
    renderEmployees();
  });

  document.getElementById('clearSelectionBtn').addEventListener('click', () => {
    state.selectedIds.clear();
    renderEmployees();
  });
  document.getElementById('bulkProcessBtn').addEventListener('click', () => openBulkModal('process'));
  document.getElementById('bulkAvailabilityBtn').addEventListener('click', () => openBulkModal('availability'));
  document.getElementById('drawerProcessBtn').addEventListener('click', () => state.selected && openBulkModal('process', [state.selected.userId]));
  document.getElementById('employeeDrawerClose').addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);
  document.getElementById('actionModalClose').addEventListener('click', closeBulkModal);
  modalBackdrop.addEventListener('click', closeBulkModal);
  document.getElementById('bulkActionCancel').addEventListener('click', closeBulkModal);
  skillAddBtn.addEventListener('click', () => changeSkill('add', skillAddSelect.value));

  availabilityForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.selected) return;

    const employeeId = state.selected.userId;
    availabilityMessage.textContent = '';
    availabilityMessage.classList.remove('success');
    availabilitySave.disabled = true;
    availabilitySave.querySelector('span').textContent = 'Zapisywanie…';

    try {
      const payload = new URLSearchParams({
        userId: employeeId,
        dateFrom: document.getElementById('availabilityFrom').value,
        dateTo: document.getElementById('availabilityTo').value,
        available: availabilityForm.querySelector('input[name="availabilityState"]:checked').value,
        note: document.getElementById('availabilityNote').value.trim(),
        createdBy: user.userId
      });
      const response = await fetch(AVAILABILITY_API_URL, { method: 'POST', body: payload, cache: 'no-store', credentials: 'omit' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.message || 'Nie udało się zapisać dostępności.');

      await loadEmployees(false);
      openEmployee(employeeId);
      availabilityMessage.textContent = 'Dostępność zapisana.';
      availabilityMessage.classList.add('success');
    } catch (error) {
      availabilityMessage.textContent = error instanceof TypeError
        ? 'Nie udało się połączyć z serwerem.'
        : (error.message || 'Nie udało się zapisać dostępności.');
    } finally {
      availabilitySave.disabled = false;
      availabilitySave.querySelector('span').textContent = 'Zapisz dostępność';
    }
  });

  bulkForm.addEventListener('submit', async (event) => {
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
      await loadEmployees(false);
      setTimeout(() => {
        closeBulkModal();
        state.selectedIds.clear();
        renderEmployees();
      }, 350);
    } catch (error) {
      bulkMessage.textContent = error instanceof TypeError
        ? 'Nie udało się połączyć z serwerem.'
        : (error.message || 'Nie udało się zapisać zmiany grupowej.');
    } finally {
      bulkSave.disabled = false;
      bulkSave.querySelector('span').textContent = 'Zapisz dla zaznaczonych';
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!popover.hidden) closeFilterPopover();
    else if (modal.classList.contains('open')) closeBulkModal();
    else if (drawer.classList.contains('open')) closeDrawer();
  });

  loadEmployees();
})();
