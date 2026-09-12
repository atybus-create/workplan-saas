const API_URL = 'https://n8n.atybuslab.com/webhook/workplan-auth-login';

const form = document.getElementById('loginForm');
const button = document.getElementById('submitBtn');
const message = document.getElementById('message');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '';

  const login = document.getElementById('login').value.trim();
  const password = document.getElementById('password').value;

  if (!login || !password) {
    message.textContent = 'Wpisz login i hasło.';
    return;
  }

  button.disabled = true;
  button.textContent = 'Logowanie…';

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Nieprawidłowy login lub hasło.');
    }

    sessionStorage.setItem('workplan_user', JSON.stringify(data.user));
    location.href = 'employees.html';
  } catch (error) {
    message.textContent = error.message || 'Nie udało się zalogować.';
  } finally {
    button.disabled = false;
    button.textContent = 'Zaloguj się';
  }
});
