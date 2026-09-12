(() => {
  'use strict';

  const API_BASE = 'https://n8n-pi.taild8d05f.ts.net/webhook';
  const LIST_URL = `${API_BASE}/workplan-skills`;
  const CREATE_URL = `${API_BASE}/workplan-skill-create`;
  const UPDATE_URL = `${API_BASE}/workplan-skill-update`;
  const DELETE_URL = `${API_BASE}/workplan-skill-delete`;
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
    skills: [],
    status: 'all',
    selected: null,
    mode: 'edit',
    sort: { column: 'name', direction: 'asc' },
    filters: {
      name: null,
      status: null,
      difficulty: null,
      training: null,
      assignments: null,
      category: null
    },
    filterPopoverColumn: null
  };

  const columnLabels = {
    name: 'Skill',
    status: 'Status',
    difficulty: 'Trudność',
    training: 'Szkolenie',
    assignments: 'Przypisania',
    category: 'Kategoria'
  };

  const loading = document.getElementById('skillLoading');
  const errorBox = document.getElementById('skillError');
  const tableWrap = document.getElementById('skillTableWrap');
  const rows = document.getElementById('skillRows');
  const search = document.getElementById('skillSearch');
  const addBtn = document.getElementById('addSkillBtn');
  const drawer = document.getElementById('skillDrawer');
  const backdrop = document.getElementById('skillBackdrop');
  const form = document.getElementById('skillForm');
  const message = document.getElementById('skillFormMessage');
  const deleteBtn = document.getElementById('deleteSkillBtn');
  const deleteModal = document.getElementById('deleteSkillModal');
  const deleteBackdrop = document.getElementById('deleteSkillBackdrop');
  const deleteMessage = document.getElementById('deleteSkillMessage');
  const popover = document.getElementById('skillColumnFilterPopover');

  if (!isAdmin) addBtn.hidden = true;

  function formatTraining(minutes) {
    const m = Number(minutes || 0);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest ? `${h} h ${rest} min` : `${h} h`;
  }

  function difficultyMarkup(level) {
    const n = Math.max(1, Math.min(5, Number(level || 1)));
    return `<div class="difficulty"><span>${n}/5</span><div>${[1,2,3,4,5].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div></div>`;
  }

  function updateSummary(summary = {}) {
    document.getElementById('skillTotal').textContent = summary.total ?? state.skills.length;
    document.getElementById('skillActiveCount').textContent = summary.active ?? state.skills.filter((s) => s.active).length;
    document.getElementById('skillInactive').textContent = summary.inactive ?? state.skills.filter((s) => !s.active).length;
    document.getElementById('skillAssignments').textContent = summary.assignments ?? state.skills.reduce((sum, s) => sum + Number(s.assignedCount || 0), 0);
  }

  function valueFor(skill, column) {
    if (column === 'name') return String(skill.name || 'Brak nazwy');
    if (column === 'status') return skill.active ? 'Aktywny' : 'Nieaktywny';
    if (column === 'difficulty') return String(Math.max(1, Math.min(5, Number(skill.difficulty || 1))));
    if (column === 'training') return String(Math.max(0, Number(skill.trainingMinutes || 0)));
    if (column === 'assignments') return String(Math.max(0, Number(skill.assignedCount || 0)));
    if (column === 'category') return String(skill.category || 'Brak kategorii');
    return '';
  }

  function displayFilterValue(column, value) {
    if (column === 'difficulty') return `${value}/5`;
    if (column === 'training') return formatTraining(Number(value));
    if (column === 'assignments') return `${value} przypisań`;
    return value;
  }

  function uniqueValues(column) {
    const set = new Set(state.skills.map((skill) => valueFor(skill, column)));
    const values = [...set];
    if (['difficulty', 'training', 'assignments'].includes(column)) {
      return values.sort((a, b) => Number(a) - Number(b));
    }
    return values.sort((a, b) => a.localeCompare(b, 'pl', { numeric: true, sensitivity: 'base' }));
  }

  function filteredSkills() {
    const q = search.value.trim().toLowerCase();
    const filtered = state.skills.filter((skill) => {
      if (state.status === 'active' && !skill.active) return false;
      if (state.status === 'inactive' && skill.active) return false;
      if (q && !`${skill.name || ''} ${skill.description || ''} ${skill.onboarding || ''} ${skill.category || ''}`.toLowerCase().includes(q)) return false;

      return Object.entries(state.filters).every(([column, selected]) => {
        if (selected === null) return true;
        if (!selected.size) return false;
        return selected.has(valueFor(skill, column));
      });
    });

    const numeric = ['difficulty', 'training', 'assignments'].includes(state.sort.column);
    const multiplier = state.sort.direction === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      const av = valueFor(a, state.sort.column);
      const bv = valueFor(b, state.sort.column);
      if (numeric) return multiplier * (Number(av) - Number(bv));
      return multiplier * av.localeCompare(bv, 'pl', { numeric: true, sensitivity: 'base' });
    });
  }

  function updateHeaderState() {
    document.querySelectorAll('.skill-table th.filterable-th').forEach((th) => {
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
    const list = filteredSkills();
    rows.innerHTML = list.length ? list.map((skill) => `
      <tr data-skill-id="${esc(skill.skillId)}">
        <td><div class="skill-name-cell"><strong>${esc(skill.name)}</strong><span>${esc(skill.description || 'Brak opisu')}</span></div></td>
        <td><span class="catalog-status ${skill.active ? 'active' : 'inactive'}">${skill.active ? 'Aktywny' : 'Nieaktywny'}</span></td>
        <td>${difficultyMarkup(skill.difficulty)}</td>
        <td><span class="training-time">${esc(formatTraining(skill.trainingMinutes))}</span></td>
        <td><span class="assignment-count">${Number(skill.assignedCount || 0)}</span></td>
        <td>${skill.category ? `<span class="category-chip">${esc(skill.category)}</span>` : '<span class="table-muted">Brak kategorii</span>'}</td>
        <td><button class="open-skill" type="button">Edytuj →</button></td>
      </tr>`).join('') : '<tr class="skill-filter-empty"><td colspan="7"><div><strong>Brak wyników</strong><span>Zmień filtry w nagłówkach albo wyszukiwanie.</span></div></td></tr>';

    rows.querySelectorAll('tr[data-skill-id]').forEach((row) => {
      row.addEventListener('click', (event) => {
        if (event.target.closest('button')) return;
        openEdit(row.dataset.skillId);
      });
      row.querySelector('.open-skill')?.addEventListener('click', () => openEdit(row.dataset.skillId));
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
    const popoverHeight = Math.min(popover.scrollHeight, Math.max(280, window.innerHeight - 24));
    const below = rect.bottom + 8;
    const top = below + popoverHeight <= window.innerHeight - 12
      ? below
      : Math.max(12, rect.top - popoverHeight - 8);
    popover.style.top = `${top}px`;
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
      <label class="filter-select-all"><input id="skillFilterSelectAll" type="checkbox"><span>Zaznacz wszystko</span><small>${values.length}</small></label>
      <div class="filter-values">${values.map((value, index) => `<label class="filter-value" data-value-index="${index}"><input type="checkbox"${initial.has(value) ? ' checked' : ''}><span>${esc(displayFilterValue(column, value))}</span></label>`).join('')}</div>
      <div class="filter-popover-footer">
        <button class="filter-clear" data-action="clear" type="button">Wyczyść filtr</button>
        <button class="filter-apply" data-action="apply" type="button">Zastosuj <span>→</span></button>
      </div>`;

    positionFilterPopover(anchor);

    const valueRows = [...popover.querySelectorAll('.filter-value')];
    const selectAllBox = popover.querySelector('#skillFilterSelectAll');
    const syncSelectAll = () => {
      const visible = valueRows.filter((row) => !row.hidden);
      const checked = visible.filter((row) => row.querySelector('input').checked).length;
      selectAllBox.checked = visible.length > 0 && checked === visible.length;
      selectAllBox.indeterminate = checked > 0 && checked < visible.length;
    };
    syncSelectAll();

    popover.querySelector('.filter-close').addEventListener('click', closeFilterPopover);
    popover.querySelector('[data-sort="asc"]').addEventListener('click', () => {
      state.sort = { column, direction: 'asc' };
      render();
      closeFilterPopover();
    });
    popover.querySelector('[data-sort="desc"]').addEventListener('click', () => {
      state.sort = { column, direction: 'desc' };
      render();
      closeFilterPopover();
    });
    popover.querySelector('.filter-search input').addEventListener('input', (event) => {
      const query = event.target.value.trim().toLowerCase();
      valueRows.forEach((row) => {
        const value = values[Number(row.dataset.valueIndex)] || '';
        row.hidden = !!query && !displayFilterValue(column, value).toLowerCase().includes(query);
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
      render();
      closeFilterPopover();
    });
    popover.querySelector('[data-action="apply"]').addEventListener('click', () => {
      const selected = new Set(valueRows
        .filter((row) => row.querySelector('input').checked)
        .map((row) => values[Number(row.dataset.valueIndex)]));
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
    document.getElementById('skillId').value = '';
    document.getElementById('drawerModeLabel').textContent = 'Nowa kompetencja';
    document.getElementById('skillDrawerTitle').textContent = 'Dodaj skill';
    document.getElementById('skillDrawerMeta').textContent = 'Ustal standard jeszcze przed pierwszym przypisaniem.';
    document.getElementById('skillActive').value = 'true';
    document.getElementById('skillDifficulty').value = '1';
    document.getElementById('skillTrainingMinutes').value = '60';
    document.getElementById('skillSortOrder').value = '0';
    deleteBtn.hidden = true;
    message.textContent = '';
    setDrawer(true);
    setTimeout(() => document.getElementById('skillName').focus(), 40);
  }

  function openEdit(skillId) {
    const skill = state.skills.find((s) => s.skillId === skillId);
    if (!skill) return;
    state.mode = 'edit';
    state.selected = skill;
    document.getElementById('skillId').value = skill.skillId;
    document.getElementById('drawerModeLabel').textContent = 'Edycja skilla';
    document.getElementById('skillDrawerTitle').textContent = skill.name;
    document.getElementById('skillDrawerMeta').textContent = `${skill.assignedCount || 0} przypisań · ${skill.active ? 'aktywny' : 'nieaktywny'}`;
    document.getElementById('skillName').value = skill.name || '';
    document.getElementById('skillCategory').value = skill.category || '';
    document.getElementById('skillActive').value = skill.active ? 'true' : 'false';
    document.getElementById('skillDescription').value = skill.description || '';
    document.getElementById('skillOnboarding').value = skill.onboarding || '';
    document.getElementById('skillDifficulty').value = String(skill.difficulty || 1);
    document.getElementById('skillTrainingMinutes').value = String(skill.trainingMinutes || 0);
    document.getElementById('skillSortOrder').value = String(skill.sortOrder || 0);
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
      if (!response.ok || !data.ok || !Array.isArray(data.skills)) throw new Error(data.message || 'Nie udało się pobrać katalogu skilli.');
      state.skills = data.skills;
      updateSummary(data.summary || {});
      render();
      tableWrap.hidden = false;
    } catch (error) {
      errorBox.textContent = error.message || 'Nie udało się pobrać katalogu skilli.';
      errorBox.hidden = false;
    } finally {
      loading.hidden = true;
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!isAdmin) {
      message.textContent = 'Tylko administrator może edytować katalog skilli.';
      return;
    }
    const submit = document.getElementById('saveSkillBtn');
    const wasCreate = state.mode === 'create';
    submit.disabled = true;
    message.textContent = '';
    message.classList.remove('success');
    const body = new URLSearchParams({
      skillId: document.getElementById('skillId').value,
      name: document.getElementById('skillName').value.trim(),
      category: document.getElementById('skillCategory').value.trim(),
      active: document.getElementById('skillActive').value,
      description: document.getElementById('skillDescription').value.trim(),
      onboarding: document.getElementById('skillOnboarding').value.trim(),
      difficulty: document.getElementById('skillDifficulty').value,
      trainingMinutes: document.getElementById('skillTrainingMinutes').value,
      sortOrder: document.getElementById('skillSortOrder').value,
      requestedBy: user.userId
    });
    try {
      const response = await fetch(wasCreate ? CREATE_URL : UPDATE_URL, { method: 'POST', body, cache: 'no-store', credentials: 'omit' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.message || 'Nie udało się zapisać skilla.');
      const id = data.skill?.skillId || document.getElementById('skillId').value;
      await load();
      if (id) openEdit(id); else closeDrawer();
      message.textContent = wasCreate ? 'Skill utworzony.' : 'Skill zapisany.';
      message.classList.add('success');
    } catch (error) {
      message.textContent = error.message || 'Nie udało się zapisać skilla.';
    } finally {
      submit.disabled = false;
    }
  });

  function openDeleteModal() {
    if (!isAdmin || !state.selected) return;
    document.getElementById('deleteSkillText').textContent = `Skill „${state.selected.name}” zostanie trwale usunięty z katalogu i z przypisań pracowników.`;
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

  async function deleteSkill() {
    if (!isAdmin || !state.selected) return;
    const button = document.getElementById('deleteSkillConfirm');
    button.disabled = true;
    deleteMessage.textContent = '';
    try {
      const body = new URLSearchParams({ skillId: state.selected.skillId, requestedBy: user.userId });
      const response = await fetch(DELETE_URL, { method: 'POST', body, cache: 'no-store', credentials: 'omit' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.message || 'Nie udało się usunąć skilla.');
      closeDeleteModal();
      closeDrawer();
      await load();
    } catch (error) {
      deleteMessage.textContent = error.message || 'Nie udało się usunąć skilla.';
    } finally {
      button.disabled = false;
    }
  }

  document.querySelector('.skill-table thead').addEventListener('click', (event) => {
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
  document.getElementById('skillDrawerClose').addEventListener('click', closeDrawer);
  document.getElementById('cancelSkillBtn').addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);
  deleteBtn.addEventListener('click', openDeleteModal);
  document.getElementById('deleteSkillCancel').addEventListener('click', closeDeleteModal);
  document.getElementById('deleteSkillConfirm').addEventListener('click', deleteSkill);
  deleteBackdrop.addEventListener('click', closeDeleteModal);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!popover.hidden) closeFilterPopover();
    else if (deleteModal.classList.contains('open')) closeDeleteModal();
    else if (drawer.classList.contains('open')) closeDrawer();
  });

  load();
})();
