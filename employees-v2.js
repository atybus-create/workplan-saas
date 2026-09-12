(() => {
  'use strict';

  const API_BASE = 'https://n8n-pi.taild8d05f.ts.net/webhook';
  const EMPLOYEES_API_URL = `${API_BASE}/workplan-employees`;
  const AVAILABILITY_API_URL = `${API_BASE}/workplan-availability-set`;
  const BULK_ACTION_API_URL = `${API_BASE}/workplan-employees-bulk-action`;
  const EMPLOYEE_SKILL_API_URL = `${API_BASE}/workplan-employee-skill`;
  const STORAGE_KEY = 'workplan_user';

  const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const todayIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' });
  const formatDate = value => {
    if (!value) return 'Brak danych';
    const d = new Date(`${value}T00:00:00`);
    return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat('pl-PL',{year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
  };
  const parseUser = raw => { try { const u = JSON.parse(raw || 'null'); return u?.userId && u?.login ? u : null; } catch { return null; } };
  const getUser = () => parseUser(sessionStorage.getItem(STORAGE_KEY)) || parseUser(localStorage.getItem(STORAGE_KEY));

  const user = getUser();
  if (!user) { location.replace('index.html'); return; }

  const display = user.displayName || user.login || 'Użytkownik';
  document.getElementById('userDisplay').textContent = display;
  document.getElementById('userAvatar').textContent = display.trim().charAt(0).toUpperCase() || 'U';
  document.getElementById('logoutBtn').addEventListener('click', () => { sessionStorage.removeItem(STORAGE_KEY); localStorage.removeItem(STORAGE_KEY); location.replace('index.html'); });
  document.getElementById('menuToggle')?.addEventListener('click', () => document.body.classList.toggle('nav-open'));

  const state = {
    employees: [], skills: [], processes: [], selected: null, selectedIds: new Set(), bulkMode: 'process',
    sort: { column: 'name', direction: 'asc' },
    filters: { name:new Set(), login:new Set(), availability:new Set(), skills:new Set(), process:new Set(), hireDate:new Set() },
    openFilter: null
  };

  const rows = document.getElementById('employeeRows');
  const loading = document.getElementById('employeeLoading');
  const errorBox = document.getElementById('employeeError');
  const empty = document.getElementById('employeeEmpty');
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
  const modal = document.getElementById('actionModal');
  const modalBackdrop = document.getElementById('actionModalBackdrop');
  const bulkForm = document.getElementById('bulkActionForm');
  const bulkMessage = document.getElementById('bulkActionMessage');
  const bulkProcessSelect = document.getElementById('bulkProcessSelect');
  const skillMessage = document.getElementById('skillMessage');
  const skillAddSelect = document.getElementById('skillAddSelect');

  function updateSummary() {
    document.getElementById('employeeCount').textContent = state.employees.length;
    document.getElementById('availableCount').textContent = state.employees.filter(e => e.available && e.accountActive).length;
    document.getElementById('unavailableCount').textContent = state.employees.filter(e => !e.available || !e.accountActive).length;
    document.getElementById('noSkillsCount').textContent = state.employees.filter(e => !(e.skills || []).length).length;
  }

  function availabilityLabel(e) {
    if (!e.accountActive) return 'Konto wyłączone';
    return e.available ? 'Dostępny' : 'Niedostępny';
  }

  function availabilityChip(e) {
    if (!e.accountActive) return '<span class="status-chip inactive">Konto wyłączone</span>';
    return e.available ? '<span class="status-chip">Dostępny</span>' : '<span class="status-chip unavailable">Niedostępny</span>';
  }

  function valuesFor(column) {
    const values = new Set();
    state.employees.forEach(e => {
      if (column === 'name') values.add(e.displayName || e.login || '—');
      if (column === 'login') values.add(e.login || '—');
      if (column === 'availability') values.add(availabilityLabel(e));
      if (column === 'process') values.add(e.currentProcess?.name || 'Brak');
      if (column === 'hireDate') values.add(e.hireDate || 'Brak danych');
      if (column === 'skills') (e.skills || []).forEach(s => values.add(s.name));
    });
    if (column === 'skills' && state.employees.some(e => !(e.skills || []).length)) values.add('Brak przypisanych');
    return [...values].sort((a,b) => String(a).localeCompare(String(b),'pl',{numeric:true}));
  }

  function employeeValues(e, column) {
    if (column === 'name') return [e.displayName || e.login || '—'];
    if (column === 'login') return [e.login || '—'];
    if (column === 'availability') return [availabilityLabel(e)];
    if (column === 'process') return [e.currentProcess?.name || 'Brak'];
    if (column === 'hireDate') return [e.hireDate || 'Brak danych'];
    if (column === 'skills') return (e.skills || []).length ? (e.skills || []).map(s => s.name) : ['Brak przypisanych'];
    return [];
  }

  function filteredEmployees() {
    const q = search.value.trim().toLowerCase();
    const list = state.employees.filter(e => {
      if (q && !`${e.displayName || ''} ${e.login || ''}`.toLowerCase().includes(q)) return false;
      return Object.entries(state.filters).every(([column, selected]) => {
        if (!selected.size) return true;
        return employeeValues(e, column).some(v => selected.has(v));
      });
    });

    const c = state.sort.column;
    const dir = state.sort.direction === 'asc' ? 1 : -1;
    return list.sort((a,b) => {
      const first = e => {
        const vals = employeeValues(e,c);
        return vals.slice().sort((x,y)=>String(x).localeCompare(String(y),'pl',{numeric:true}))[0] || '';
      };
      return dir * String(first(a)).localeCompare(String(first(b)),'pl',{numeric:true});
    });
  }

  function refreshFilterButtons() {
    document.querySelectorAll('.column-filter-button').forEach(btn => {
      const col = btn.dataset.column;
      const active = state.filters[col]?.size || state.sort.column === col;
      btn.classList.toggle('active', !!active);
      const mark = btn.querySelector('span');
      if (mark) mark.textContent = state.sort.column === col ? (state.sort.direction === 'asc' ? '↑' : '↓') : '⌄';
    });
  }

  function updateBulkBar() {
    selectedCount.textContent = state.selectedIds.size;
    bulkBar.hidden = state.selectedIds.size === 0;
  }

  function renderEmployees() {
    const list = filteredEmployees();
    rows.innerHTML = list.map(e => {
      const name = e.displayName || e.login;
      const skills = (e.skills || []).length ? (e.skills || []).map(s => `<span class="skill-tag">${esc(s.name)}</span>`).join('') : '<span class="table-muted">Brak przypisanych</span>';
      const checked = state.selectedIds.has(e.userId) ? ' checked' : '';
      return `<tr data-user-id="${esc(e.userId)}" tabindex="0" class="${checked ? 'selected-row' : ''}">
        <td class="check-col"><input class="employee-checkbox" type="checkbox"${checked}></td>
        <td><div class="employee-person"><span class="mini-avatar">${esc(String(name).charAt(0).toUpperCase())}</span><div><strong>${esc(name)}</strong><span>${esc(e.role || 'pracownik')}</span></div></div></td>
        <td>${esc(e.login)}</td><td>${availabilityChip(e)}</td><td><div class="skill-preview all-skills">${skills}</div></td>
        <td><span class="process-chip">${esc(e.currentProcess?.name || 'Brak')}</span></td><td>${esc(formatDate(e.hireDate))}</td>
        <td><button class="row-process-button" type="button" data-action="process">Przydziel proces</button></td></tr>`;
    }).join('');

    tableWrap.hidden = list.length === 0;
    empty.hidden = list.length !== 0;
    const selectedVisible = list.filter(e => state.selectedIds.has(e.userId)).length;
    selectAll.checked = list.length > 0 && selectedVisible === list.length;
    selectAll.indeterminate = selectedVisible > 0 && selectedVisible < list.length;

    rows.querySelectorAll('tr').forEach(row => {
      const id = row.dataset.userId;
      const cb = row.querySelector('.employee-checkbox');
      cb.addEventListener('click', ev => { ev.stopPropagation(); cb.checked ? state.selectedIds.add(id) : state.selectedIds.delete(id); renderEmployees(); updateBulkBar(); });
      row.querySelector('[data-action="process"]').addEventListener('click', ev => { ev.stopPropagation(); openBulkModal('process',[id]); });
      row.addEventListener('click', ev => { if (!ev.target.closest('button,input')) openEmployee(id); });
    });
    refreshFilterButtons(); updateBulkBar();
  }

  function openColumnFilter(column, button) {
    state.openFilter = column;
    const values = valuesFor(column);
    const selected = state.filters[column];
    const labels = {name:'Pracownik',login:'Login',availability:'Dostępność',skills:'Skille',process:'Proces',hireDate:'Data zatrudnienia'};
    popover.innerHTML = `<div class="filter-title">${labels[column]}</div>
      <div class="filter-sort"><button data-sort="asc" type="button">Sortuj rosnąco</button><button data-sort="desc" type="button">Sortuj malejąco</button></div>
      <label class="filter-search"><input type="search" placeholder="Szukaj wartości"></label>
      <div class="filter-actions"><button data-action="all" type="button">Zaznacz wszystko</button><button data-action="none" type="button">Wyczyść</button></div>
      <div class="filter-values">${values.map(v => `<label data-filter-value="${esc(v)}"><input type="checkbox" value="${esc(v)}"${selected.has(v)?' checked':''}><span>${esc(column==='hireDate' && v!=='Brak danych' ? formatDate(v) : v)}</span></label>`).join('')}</div>
      <div class="filter-footer"><button data-action="cancel" class="ghost-button" type="button">Anuluj</button><button data-action="apply" class="primary-button compact" type="button"><span>Zastosuj</span><span>→</span></button></div>`;
    const r = button.getBoundingClientRect();
    popover.hidden = false;
    const width = Math.min(330, window.innerWidth - 24);
    popover.style.width = `${width}px`;
    popover.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - width - 12))}px`;
    popover.style.top = `${Math.min(window.innerHeight - 420, r.bottom + 8)}px`;

    popover.querySelector('[data-sort="asc"]').onclick = () => { state.sort={column,direction:'asc'}; renderEmployees(); closeFilter(); };
    popover.querySelector('[data-sort="desc"]').onclick = () => { state.sort={column,direction:'desc'}; renderEmployees(); closeFilter(); };
    const valueLabels = [...popover.querySelectorAll('[data-filter-value]')];
    popover.querySelector('.filter-search input').addEventListener('input', ev => { const q=ev.target.value.toLowerCase(); valueLabels.forEach(l => l.hidden=!l.dataset.filterValue.toLowerCase().includes(q)); });
    popover.querySelector('[data-action="all"]').onclick = () => valueLabels.forEach(l => { if (!l.hidden) l.querySelector('input').checked=true; });
    popover.querySelector('[data-action="none"]').onclick = () => valueLabels.forEach(l => l.querySelector('input').checked=false);
    popover.querySelector('[data-action="cancel"]').onclick = closeFilter;
    popover.querySelector('[data-action="apply"]').onclick = () => {
      state.filters[column] = new Set(valueLabels.filter(l => l.querySelector('input').checked).map(l => l.dataset.filterValue));
      if (state.filters[column].size === values.length) state.filters[column].clear();
      closeFilter(); renderEmployees();
    };
  }

  function closeFilter() { popover.hidden = true; popover.innerHTML=''; state.openFilter=null; }

  function renderCatalogs() {
    bulkProcessSelect.innerHTML = state.processes.length ? state.processes.map(p=>`<option value="${esc(p.processId)}">${esc(p.name)}</option>`).join('') : '<option value="">Brak procesów</option>';
  }

  function renderSkillEditor(employee) {
    const assigned = employee.skills || [];
    const assignedIds = new Set(assigned.map(s=>s.skillId));
    document.getElementById('detailSkills').innerHTML = assigned.length ? assigned.map(s => `<span class="skill-tag editable">${esc(s.name)}<button type="button" data-remove-skill="${esc(s.skillId)}" aria-label="Usuń ${esc(s.name)}">×</button></span>`).join('') : '<div class="skills-empty">Ten pracownik nie ma jeszcze przypisanych skilli.</div>';
    const available = state.skills.filter(s=>!assignedIds.has(s.skillId));
    skillAddSelect.innerHTML = available.length ? available.map(s=>`<option value="${esc(s.skillId)}">${esc(s.name)}</option>`).join('') : '<option value="">Brak kolejnych skilli</option>';
    skillAddSelect.disabled = !available.length;
    document.getElementById('skillAddBtn').disabled = !available.length;
    document.querySelectorAll('[data-remove-skill]').forEach(btn => btn.onclick = () => changeSkill('remove', btn.dataset.removeSkill));
  }

  function openEmployee(id) {
    const e = state.employees.find(x=>x.userId===id); if (!e) return;
    state.selected=e; skillMessage.textContent='';
    document.getElementById('employeeDrawerTitle').textContent=e.displayName||e.login;
    document.getElementById('employeeDrawerLogin').textContent=`@${e.login}`;
    document.getElementById('detailLogin').textContent=e.login;
    document.getElementById('detailRole').textContent=e.role||'—';
    document.getElementById('detailHireDate').textContent=formatDate(e.hireDate);
    document.getElementById('detailAccount').textContent=e.accountActive?'Aktywne':'Wyłączone';
    document.getElementById('detailProcess').textContent=e.currentProcess?`${e.currentProcess.name} · ${formatDate(e.currentProcess.dateFrom)}–${formatDate(e.currentProcess.dateTo)}`:'Brak przydzielonego procesu';
    const da=document.getElementById('detailAvailability'); da.textContent=e.available?'Dostępny':'Niedostępny'; da.className=`status-chip${e.available?'':' unavailable'}`;
    const rule=e.availabilityRule; document.getElementById('availabilityFrom').value=rule?.dateFrom||todayIso(); document.getElementById('availabilityTo').value=rule?.dateTo||todayIso(); document.getElementById('availabilityNote').value=rule?.note||'';
    const radio=availabilityForm.querySelector(`input[name="availabilityState"][value="${e.available?'true':'false'}"]`); if(radio) radio.checked=true;
    renderSkillEditor(e);
    backdrop.hidden=false; drawer.classList.add('open'); drawer.setAttribute('aria-hidden','false');
  }

  function closeDrawer(){ state.selected=null; drawer.classList.remove('open'); drawer.setAttribute('aria-hidden','true'); backdrop.hidden=true; }

  async function changeSkill(action, skillId) {
    if (!state.selected || !skillId) return;
    const employeeId=state.selected.userId; skillMessage.textContent='Zapisywanie…';
    try {
      const payload=new URLSearchParams({action,userId:employeeId,skillId,changedBy:user.userId});
      const response=await fetch(EMPLOYEE_SKILL_API_URL,{method:'POST',body:payload,cache:'no-store',credentials:'omit'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.ok) throw new Error(data.message||'Nie udało się zmienić skilla.');
      await loadEmployees(false); openEmployee(employeeId); skillMessage.textContent=action==='add'?'Skill dodany.':'Skill usunięty.'; skillMessage.classList.add('success');
    } catch(err) { skillMessage.classList.remove('success'); skillMessage.textContent=err instanceof TypeError?'Nie udało się połączyć z serwerem.':(err.message||'Nie udało się zmienić skilla.'); }
  }

  function openBulkModal(mode, explicitIds=null) {
    state.bulkMode=mode; const ids=explicitIds||[...state.selectedIds]; if(!ids.length)return;
    modal.dataset.userIds=ids.join(','); document.getElementById('actionModalTitle').textContent=mode==='process'?'Przydziel / zmień proces':'Zmień dostępność';
    document.getElementById('actionModalSubtitle').textContent=`Zmiana obejmie ${ids.length} ${ids.length===1?'pracownika':'pracowników'}.`;
    document.getElementById('processFields').hidden=mode!=='process'; document.getElementById('availabilityFields').hidden=mode!=='availability'; bulkProcessSelect.required=mode==='process';
    document.getElementById('bulkDateFrom').value=todayIso(); document.getElementById('bulkDateTo').value=todayIso(); document.getElementById('bulkNote').value=''; bulkMessage.textContent='';
    modalBackdrop.hidden=false; modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
  }
  function closeBulkModal(){ modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); modalBackdrop.hidden=true; modal.dataset.userIds=''; }

  async function loadEmployees(showLoading=true) {
    if(showLoading) loading.hidden=false; errorBox.hidden=true;
    try {
      const response=await fetch(EMPLOYEES_API_URL,{method:'GET',cache:'no-store',credentials:'omit'}); const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.ok||!Array.isArray(data.employees)) throw new Error(data.message||'Nie udało się pobrać listy pracowników.');
      state.employees=data.employees; state.skills=Array.isArray(data.skills)?data.skills:[]; state.processes=Array.isArray(data.processes)?data.processes:[];
      renderCatalogs(); updateSummary(); renderEmployees();
    } catch(err){ errorBox.textContent=err instanceof TypeError?'Nie udało się połączyć z serwerem.':(err.message||'Nie udało się pobrać listy pracowników.'); errorBox.hidden=false; }
    finally { loading.hidden=true; }
  }

  document.querySelectorAll('.column-filter-button').forEach(btn => btn.addEventListener('click', ev => { ev.stopPropagation(); openColumnFilter(btn.dataset.column,btn); }));
  document.addEventListener('click', ev => { if(!popover.hidden && !popover.contains(ev.target) && !ev.target.closest('.column-filter-button')) closeFilter(); });
  window.addEventListener('resize', closeFilter); search.addEventListener('input',renderEmployees);
  selectAll.addEventListener('change',()=>{ filteredEmployees().forEach(e=>selectAll.checked?state.selectedIds.add(e.userId):state.selectedIds.delete(e.userId)); renderEmployees(); });
  document.getElementById('clearSelectionBtn').onclick=()=>{state.selectedIds.clear();renderEmployees();};
  document.getElementById('bulkProcessBtn').onclick=()=>openBulkModal('process'); document.getElementById('bulkAvailabilityBtn').onclick=()=>openBulkModal('availability');
  document.getElementById('drawerProcessBtn').onclick=()=>state.selected&&openBulkModal('process',[state.selected.userId]);
  document.getElementById('employeeDrawerClose').onclick=closeDrawer; backdrop.onclick=closeDrawer;
  document.getElementById('actionModalClose').onclick=closeBulkModal; modalBackdrop.onclick=closeBulkModal; document.getElementById('bulkActionCancel').onclick=closeBulkModal;
  document.getElementById('skillAddBtn').onclick=()=>changeSkill('add',skillAddSelect.value);

  availabilityForm.addEventListener('submit',async ev=>{ ev.preventDefault(); if(!state.selected)return; const id=state.selected.userId; availabilityMessage.textContent='Zapisywanie…'; try{const payload=new URLSearchParams({userId:id,dateFrom:document.getElementById('availabilityFrom').value,dateTo:document.getElementById('availabilityTo').value,available:availabilityForm.querySelector('input[name="availabilityState"]:checked').value,note:document.getElementById('availabilityNote').value.trim(),createdBy:user.userId});const r=await fetch(AVAILABILITY_API_URL,{method:'POST',body:payload,cache:'no-store',credentials:'omit'});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.message||'Nie udało się zapisać dostępności.');await loadEmployees(false);openEmployee(id);availabilityMessage.textContent='Dostępność zapisana.';availabilityMessage.classList.add('success');}catch(err){availabilityMessage.classList.remove('success');availabilityMessage.textContent=err.message||'Nie udało się zapisać dostępności.';}});

  bulkForm.addEventListener('submit',async ev=>{ev.preventDefault();const ids=String(modal.dataset.userIds||'').split(',').filter(Boolean);if(!ids.length)return;bulkMessage.textContent='Zapisywanie…';try{const payload=new URLSearchParams({action:state.bulkMode,userIds:ids.join(','),processId:state.bulkMode==='process'?bulkProcessSelect.value:'',available:state.bulkMode==='availability'?bulkForm.querySelector('input[name="bulkAvailabilityState"]:checked').value:'',dateFrom:document.getElementById('bulkDateFrom').value,dateTo:document.getElementById('bulkDateTo').value,note:document.getElementById('bulkNote').value.trim(),createdBy:user.userId});const r=await fetch(BULK_ACTION_API_URL,{method:'POST',body:payload,cache:'no-store',credentials:'omit'});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.message||'Nie udało się zapisać zmiany grupowej.');await loadEmployees(false);bulkMessage.textContent=d.message||'Zmiana zapisana.';bulkMessage.classList.add('success');setTimeout(()=>{closeBulkModal();state.selectedIds.clear();renderEmployees();},350);}catch(err){bulkMessage.classList.remove('success');bulkMessage.textContent=err.message||'Nie udało się zapisać zmiany grupowej.';}});

  document.addEventListener('keydown',ev=>{if(ev.key==='Escape'){if(!popover.hidden)closeFilter();else if(modal.classList.contains('open'))closeBulkModal();else if(drawer.classList.contains('open'))closeDrawer();}});
  loadEmployees();
})();
