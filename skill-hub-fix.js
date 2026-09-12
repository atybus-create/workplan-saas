(() => {
  'use strict';

  const duplicatedStatusControls = document.querySelectorAll('#skillActive');
  if (duplicatedStatusControls.length >= 2) {
    const summaryCounter = duplicatedStatusControls[0];
    const statusSelect = duplicatedStatusControls[1];
    const form = document.getElementById('skillForm');

    const syncFormToLegacyTarget = () => {
      summaryCounter.value = statusSelect.value;
    };

    const syncLegacyTargetToForm = () => {
      const value = String(summaryCounter.value || '');
      if (value === 'true' || value === 'false') statusSelect.value = value;
    };

    statusSelect.addEventListener('change', syncFormToLegacyTarget);
    form?.addEventListener('submit', syncFormToLegacyTarget, true);

    document.addEventListener('click', (event) => {
      if (event.target.closest('#addSkillBtn, .open-skill, tr[data-skill-id]')) {
        setTimeout(syncLegacyTargetToForm, 0);
      }
    });
  }

  const deleteNote = document.querySelector('#deleteSkillModal .delete-note');
  if (deleteNote) {
    deleteNote.innerHTML = 'Usunięcie jest trwałe. Skill zostanie usunięty z katalogu oraz ze wszystkich przypisań pracowników. Jeżeli chcesz zachować historię i tylko wycofać kompetencję, ustaw status <strong>Nieaktywny</strong>.';
  }
})();
