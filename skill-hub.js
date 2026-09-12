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
    mode: 'edit'
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
    document.getElementById('skillActive').textContent = summary.active ?? state.skills.filter((s) => s.active).length;
    document.getElementById('skillInactive').textContent = summary.inactive ?? state.skills.filter((s) => !s.active).length;
    document.getElementById('skillAssignments').textContent = summary.assignments ?? state.skills.reduce((sum, s) => sum + Number(s.assignedCount || 0), 0);
  }

  function filteredSkills() {
    const q = search.value.trim().toLowerCase();
    return state.skills.filter((skill) => {
      if (state.status === 'active' && !skill.active) return false;
      if (state.status === 'inactive' && skill.active) return false;
      if (!q) return true;
      return `${skill.name || ''} ${skill.description || ''} ${skill.onboarding || ''} ${skill.category || ''}`.toLowerCase().includes(q);
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
        <td>${skill.category ? `<span class="category-chip">${esc(skill.category)}</span>` : '<span class="table-muted">—</span>'}</td>
        <td><button class="open-skill" type="button">Edytuj →</button></td>
      </tr>`).join('') : '<tr><td colspan="7"><div class="skill-empty"><strong>Brak skilli</strong><span>Zmień filtr albo dodaj pierwszy skill.</span></div></td></tr>';

    rows.querySelectorAll('tr[data-skill-id]').forEach((row) => {
      row.addEventListener('click', (event) => {
        if (event.target.closest('button')) return;
        openEdit(row.dataset.skillId);
      });
      row.querySelector('.open-skill')?.addEventListener('click', () => openEdit(row.dataset.skillId));
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
    submit.disabled = true;
    message.textContent = '';
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
      const response = await fetch(state.mode === 'create' ? CREATE_URL : UPDATE_URL, { method: 'POST', body, cache: 'no-store', credentials: 'omit' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.message || 'Nie udało się zapisać skilla.');
      await load();
      const id = data.skill?.skillId || document.getElementById('skillId').value;
      if (id) openEdit(id); else closeDrawer();
      message.textContent = state.mode === 'create' ? 'Skill utworzony.' : 'Skill zapisany.';
      message.classList.add('success');
    } catch (error) {
      message.classList.remove('success');
      message.textContent = error.message || 'Nie udało się zapisać skilla.';
    } finally {
      submit.disabled = false;
    }
  });

  function openDeleteModal() {
    if (!isAdmin || !state.selected) return;
    document.getElementById('deleteSkillText').textContent = `Skill „${state.selected.name}” zostanie trwale usunięty z katalogu.`;
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
    if (deleteModal.classList.contains('open')) closeDeleteModal();
    else if (drawer.classList.contains('open')) closeDrawer();
  });

  load();
})();
