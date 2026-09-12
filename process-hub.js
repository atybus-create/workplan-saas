(() => {
  'use strict';

  const API_BASE = 'https://n8n-pi.taild8d05f.ts.net/webhook';
  const LIST_URL = `${API_BASE}/workplan-processes`;
  const CREATE_URL = `${API_BASE}/workplan-process-create`;
  const UPDATE_URL = `${API_BASE}/workplan-process-update`;
  const DELETE_URL = `${API_BASE}/workplan-process-delete`;
  const STORAGE_KEY = 'workplan_user';

  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

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
    processes: [],
    status: 'all',
    selected: null,
    mode: 'edit',
    sort: { column: 'name', direction: 'asc' },
    filters: {
      name: null,
      status: null,
      currentAssigned: null,
      history: null,
      sortOrder: null
    },
    filterPopoverColumn: null
  };

  const columnLabels = {
    name: 'Proces',
    status: 'Status',
    currentAssigned: 'Pracownicy teraz',
    history: 'Historia planu',
    sortOrder: 'Kolejność'
  };

  const loading = document.getElementById('processLoading');
  const errorBox = document.getElementById('processError');
  const tableWrap = document.getElementById('processTableWrap');
  const rows = document.getElementById('processRows');
  const search = document.getElementById('processSearch');
  const addBtn = document.getElementById('addProcessBtn');
  const drawer = document.getElementById('processDrawer');
  const backdrop = document.getElementById('processBackdrop');
  const form = document.getElementById('processForm');
  const message = document.getElementById('processFormMessage');
  const deleteBtn = document.getElementById('deleteProcessBtn');
  const deleteModal = document.getElementById('deleteProcessModal');
  const deleteBackdrop = document.getElementById('deleteProcessBackdrop');
  const deleteMessage = document.getElementById('deleteProcessMessage');
  const popover = document.getElementById('processColumnFilterPopover');

  if (!isAdmin) addBtn.hidden = true;

  function updateSummary(summary = {}) {
    document.getElementById('processTotal').textContent = summary.total ?? state.processes.length;
    document.getElementById('processActive').textContent = summary.active ?? state.processes.filter((p) => p.active).length;
    document.getElementById('processInactive').textContent = summary.inactive ?? state.processes.filter((p) => !p.active).length;
    document.getElementById('processAssignments').textContent = summary.currentAssignments ?? state.processes.reduce((sum, p) => sum + Number(p.currentAssignedCount || 0), 0);
  }

  function valueFor(process, column) {
    if (column === 'name') return String(process.name || 'Brak nazwy');
    if (column === 'status') return process.active ? 'Aktywny' : 'Nieaktywny';
    if (column === 'currentAssigned') return String(Math.max(0, Number(process.currentAssignedCount || 0)));
    if (column === 'history') return String(Math.max(0, Number(process.historyCount || 0)));
    if (column === 'sortOrder') return String(Math.max(0, Number(process.sortOrder || 0)));
    return '';
  }

  function displayFilterValue(column, value) {
    if (column === 'currentAssigned') return `${value} ${Number(value) === 1 ? 'pracownik' : 'pracowników'}`;
    if (column === 'history') return `${value} ${Number(value) === 1 ? 'wpis' : 'wpisów'}`;
    if (column === 'sortOrder') return `Pozycja ${value}`;
    return value;
  }

  function uniqueValues(column) {
    const set = new Set(state.processes.map((process) => valueFor(process, column)));
    const values = [...set];
    if (['currentAssigned', 'history', 'sortOrder'].includes(column)) return values.sort((a, b) => Number(a) - Number(b));
    return values.sort((a, b) => a.localeCompare(b, 'pl', { numeric: true, sensitivity: 'base' }));
  }

  function filteredProcesses() {
    const q = search.value.trim().toLowerCase();
    const filtered = state.processes.filter((process) => {
      if (state.status === 'active' && !process.active) return false;
      if (state.status === 'inactive' && process.active) return false;
      if (q && !`${process.name || ''} ${process.description || ''}`.toLowerCase().includes(q)) return false;
      return Object.entries(state.filters).every(([column, selected]) => {
        if (selected === null) return true;
        if (!selected.size) return false;
        return selected.has(valueFor(process, column));
      });
    });

    const numeric = ['currentAssigned', 'history', 'sortOrder'].includes(state.sort.column);
    const multiplier = state.sort.direction === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      const av = valueFor(a, state.sort.column);
      const bv = valueFor(b, state.sort.column);
      if (numeric) return multiplier * (Number(av) - Number(bv));
      return multiplier * av.localeCompare(bv, 'pl', { numeric: true, sensitivity: 'base' });
    });
  }

  function updateHeaderState() {
    document.querySelectorAll('.process-table th.filterable-th').forEach((th) => {
      const column = th.dataset.column;
      const filter = state.filters[column];
      const sortActive = state.sort.column === column;
      th.classList.toggle('sort-active', sortActive);
      th.classList.toggle('filter-active', filter !== null);
      const indicator = th.querySelector('.sort-indicator');
      if (indicator) indicator.textContent = sortActive ? (state.sort.direction === 'asc' ? '↑' : '↓') : '↕';
      const count = th.querySelector('.filter-count');
      if (count) {
        count.hidden = filter === null;
        count.textContent = filter === null ? '' : String(filter.size);
      }
    });
  }

  function render() {
    const list = filteredProcesses();
    rows.innerHTML = list.length ? list.map((process) => `
      <tr data-process-id="${esc(process.processId)}">
        <td><div class="process-name-cell"><strong>${esc(process.name)}</strong><span>${esc(process.description || 'Brak opisu')}</span></div></td>
        <td><span class="catalog-status ${process.active ? 'active' : 'inactive'}">${process.active ? 'Aktywny' : 'Nieaktywny'}</span></td>
        <td><span class="process-count">${Number(process.currentAssignedCount || 0)}</span></td>
        <td><span class="history-count">${Number(process.historyCount || 0)}</span></td>
        <td><span class="sort-order">${Number(process.sortOrder || 0)}</span></td>
        <td><button class="open-process" type="button">Edytuj →</button></td>
      </tr>`).join('') : '<tr class="process-filter-empty"><td colspan="6"><div><strong>Brak wyników</strong><span>Zmień filtry w nagłówkach albo wyszukiwanie.</span></div></td></tr>';

    rows.querySelectorAll('tr[data-process-id]').forEach((row) => {
      row.addEventListener('click', (event) => {
        if (event.target.closest('button')) return;
        openEdit(row.dataset.processId);
      });
      row.querySelector('.open-process')?.addEventListener('click', () => openEdit(row.dataset.processId));
    });
    updateHeaderState();
  }

  function toggleSort(column) {
    state.sort = state.sort.column === column
      ? { column, direction: state.sort.direction === 'asc' ? 'desc' : 'asc' }
      : { column, direction: 'asc' };
    render();
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
    const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
    popover.style.left = `${left}px`;
    const height = Math.min(popover.scrollHeight, Math.max(280, window.innerHeight - 24));
    const below = rect.bottom + 8;
    popover.style.top = `${below + height <= window.innerHeight - 12 ? below : Math.max(12, rect.top - height - 8)}px`;
  }

  function openFilterPopover(column, anchor) {
    state.filterPopoverColumn = column;
    const values = uniqueValues(column);
    const active = state.filters[column];
    const initial = active === null ? new Set(values) : new Set(active);

    popover.innerHTML = `<div class="filter-popover-head">
        <div><span>Filtr kolumny</span><strong>${esc(columnLabels[column])}</strong></div>
        <button class="filter-close" type="button" aria-label="Zamknij">×</button>
      </div>
      <div class="filter-sort-row">
        <button type="button" data-sort="asc"><span>↑</span> Rosnąco</button>
        <button type="button" data-sort="desc"><span>↓</span> Malejąco</button>
      </div>
      <label class="filter-search"><span>⌕</span><input type="search" placeholder="Szukaj na liście" autocomplete="off"></label>
      <label class="filter-select-all"><input id="processFilterSelectAll" type="checkbox"><span>Zaznacz wszystko</span><small>${values.length}</small></label>
      <div class="filter-values">${values.map((value, index) => `<label class="filter-value" data-value-index="${index}"><input type="checkbox"${initial.has(value) ? ' checked' : ''}><span>${esc(displayFilterValue(column, value))}</span></label>`).join('')}</div>
      <div class="filter-popover-footer"><button class="filter-clear" type="button">Wyczyść filtr</button><button class="filter-apply" type="button">Zastosuj <span>→</span></button></div>`;

    positionFilterPopover(anchor);
    const valueRows = [...popover.querySelectorAll('.filter-value')];
    const selectAllBox = popover.querySelector('#processFilterSelectAll');
    const sync = () => {
      const visible = valueRows.filter((row) => !row.hidden);
      const checked = visible.filter((row) => row.querySelector('input').checked).length;
      selectAllBox.checked = visible.length > 0 && checked === visible.length;
      selectAllBox.indeterminate = checked > 0 && checked < visible.length;
    };
    sync();

    popover.querySelector('.filter-close').addEventListener('click', closeFilterPopover);
    popover.querySelector('[data-sort="asc"]').addEventListener('click', () => { state.sort = { column, direction: 'asc' }; render(); closeFilterPopover(); });
    popover.querySelector('[data-sort="desc"]').addEventListener('click', () => { state.sort = { column, direction: 'desc' }; render(); closeFilterPopover(); });
    popover.querySelector('.filter-search input').addEventListener('input', (event) => {
      const query = event.target.value.trim().toLowerCase();
      valueRows.forEach((row) => {
        const value = values[Number(row.dataset.valueIndex)] || '';
        row.hidden = !!query && !displayFilterValue(column, value).toLowerCase().includes(query);
      });
      sync();
    });
    selectAllBox.addEventListener('change', () => {
      valueRows.filter((row) => !row.hidden).forEach((row) => { row.querySelector('input').checked = selectAllBox.checked; });
      sync();
    });
    valueRows.forEach((row) => row.querySelector('input').addEventListener('change', sync));
    popover.querySelector('.filter-clear').addEventListener('click', () => { state.filters[column] = null; render(); closeFilterPopover(); });
    popover.querySelector('.filter-apply').addEventListener('click', () => {
      const selected = new Set(valueRows.filter((row) => row.querySelector('input').checked).map((row) => values[Number(row.dataset.valueIndex)]));
      state.filters[column] = selected.size === values.length ? null : selected;
      render();
      closeFilterPopover();
    });
  }

  function setDrawer(open) {
    backdrop.hidden = !open;
    drawer.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
  }

  function openCreate() {
    if (!isAdmin) return;
    state.mode = 'create';
    state.selected = null;
    form.reset();
    document.getElementById('processId').value = '';
    document.getElementById('drawerModeLabel').textContent = 'Nowy proces';
    document.getElementById('processDrawerTitle').textContent = 'Dodaj proces';
    document.getElementById('processDrawerMeta').textContent = 'Nowy proces będzie od razu dostępny w planowaniu.';
    document.getElementById('processStatus').value = 'true';
    document.getElementById('processSortOrder').value = '0';
    deleteBtn.hidden = true;
    message.textContent = '';
    message.classList.remove('success');
    setDrawer(true);
    setTimeout(() => document.getElementById('processName').focus(), 40);
  }

  function openEdit(processId) {
    const process = state.processes.find((p) => p.processId === processId);
    if (!process) return;
    state.mode = 'edit';
    state.selected = process;
    document.getElementById('processId').value = process.processId;
    document.getElementById('drawerModeLabel').textContent = 'Edycja procesu';
    document.getElementById('processDrawerTitle').textContent = process.name;
    document.getElementById('processDrawerMeta').textContent = `${Number(process.currentAssignedCount || 0)} pracowników teraz · ${process.active ? 'aktywny' : 'nieaktywny'}`;
    document.getElementById('processName').value = process.name || '';
    document.getElementById('processStatus').value = process.active ? 'true' : 'false';
    document.getElementById('processDescription').value = process.description || '';
    document.getElementById('processSortOrder').value = String(process.sortOrder || 0);
    deleteBtn.hidden = !isAdmin;
    message.textContent = '';
    message.classList.remove('success');
    setDrawer(true);
  }

  function closeDrawer() {
    setDrawer(false);
    state.selected = null;
  }

  async function load() {
    loading.hidden = false;
    errorBox.hidden = true;
    try {
      const response = await fetch(LIST_URL, { cache: 'no-store', credentials: 'omit' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok || !Array.isArray(data.processes)) throw new Error(data.message || 'Nie udało się pobrać katalogu procesów.');
      state.processes = data.processes;
      updateSummary(data.summary || {});
      render();
      tableWrap.hidden = false;
    } catch (error) {
      errorBox.textContent = error.message || 'Nie udało się pobrać katalogu procesów.';
      errorBox.hidden = false;
    } finally {
      loading.hidden = true;
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!isAdmin) {
      message.textContent = 'Tylko administrator może edytować katalog procesów.';
      return;
    }
    const submit = document.getElementById('saveProcessBtn');
    submit.disabled = true;
    message.textContent = '';
    message.classList.remove('success');
    const body = new URLSearchParams({
      processId: document.getElementById('processId').value,
      name: document.getElementById('processName').value.trim(),
      active: document.getElementById('processStatus').value,
      description: document.getElementById('processDescription').value.trim(),
      sortOrder: document.getElementById('processSortOrder').value,
      requestedBy: user.userId
    });
    try {
      const creating = state.mode === 'create';
      const response = await fetch(creating ? CREATE_URL : UPDATE_URL, { method: 'POST', body, cache: 'no-store', credentials: 'omit' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.message || 'Nie udało się zapisać procesu.');
      const id = data.process?.processId || document.getElementById('processId').value;
      await load();
      if (id) openEdit(id); else closeDrawer();
      message.textContent = creating ? 'Proces utworzony.' : 'Proces zapisany.';
      message.classList.add('success');
    } catch (error) {
      message.textContent = error.message || 'Nie udało się zapisać procesu.';
    } finally {
      submit.disabled = false;
    }
  });

  function openDeleteModal() {
    if (!isAdmin || !state.selected) return;
    document.getElementById('deleteProcessText').textContent = `Proces „${state.selected.name}” zostanie trwale usunięty, jeżeli nie ma historii użycia.`;
    deleteMessage.textContent = '';
    deleteBackdrop.hidden = false;
    deleteModal.classList.add('open');
    deleteModal.setAttribute('aria-hidden', 'false');
  }

  function closeDeleteModal() {
    deleteBackdrop.hidden = true;
    deleteModal.classList.remove('open');
    deleteModal.setAttribute('aria-hidden', 'true');
  }

  async function deleteProcess() {
    if (!isAdmin || !state.selected) return;
    const button = document.getElementById('deleteProcessConfirm');
    button.disabled = true;
    deleteMessage.textContent = '';
    try {
      const body = new URLSearchParams({ processId: state.selected.processId, requestedBy: user.userId });
      const response = await fetch(DELETE_URL, { method: 'POST', body, cache: 'no-store', credentials: 'omit' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.message || 'Nie udało się usunąć procesu.');
      closeDeleteModal();
      closeDrawer();
      await load();
    } catch (error) {
      deleteMessage.textContent = error.message || 'Nie udało się usunąć procesu.';
    } finally {
      button.disabled = false;
    }
  }

  document.querySelector('.process-table thead').addEventListener('click', (event) => {
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

  search.addEventListener('input', render);
  document.querySelectorAll('[data-status]').forEach((button) => {
    button.addEventListener('click', () => {
      state.status = button.dataset.status;
      document.querySelectorAll('[data-status]').forEach((b) => b.classList.toggle('active', b === button));
      render();
    });
  });
  addBtn.addEventListener('click', openCreate);
  document.getElementById('processDrawerClose').addEventListener('click', closeDrawer);
  document.getElementById('cancelProcessBtn').addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);
  deleteBtn.addEventListener('click', openDeleteModal);
  document.getElementById('deleteProcessCancel').addEventListener('click', closeDeleteModal);
  document.getElementById('deleteProcessConfirm').addEventListener('click', deleteProcess);
  deleteBackdrop.addEventListener('click', closeDeleteModal);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!popover.hidden) closeFilterPopover();
    else if (deleteModal.classList.contains('open')) closeDeleteModal();
    else if (drawer.classList.contains('open')) closeDrawer();
  });

  load();
})();
