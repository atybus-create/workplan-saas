(() => {
  'use strict';

  const API_URL = 'https://n8n.atybuslab.com/webhook/workplan-auth-login';
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
        const response = await fetch(API_URL, {
          method: 'POST',
          body,
          cache: 'no-store',
          credentials: 'omit'
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok || !data.user) {
          throw new Error(data.message || 'Nieprawidłowy login lub hasło.');
        }

        storeUser(data.user, rememberInput.checked);
        location.replace('start.html');
      } catch (error) {
        const networkError = error instanceof TypeError;
        message.textContent = networkError
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

    const display = user.displayName || user.login || 'Użytkownik';
    const firstName = display.trim().split(/\s+/)[0] || 'Użytkowniku';
    const initial = display.trim().charAt(0).toUpperCase() || 'U';

    document.getElementById('userName').textContent = firstName;
    document.getElementById('userDisplay').textContent = display;
    document.getElementById('userAvatar').textContent = initial;

    document.getElementById('logoutBtn').addEventListener('click', () => {
      clearUser();
      location.replace('index.html');
    });

    const menuToggle = document.getElementById('menuToggle');
    menuToggle.addEventListener('click', () => document.body.classList.toggle('nav-open'));
  }

  const page = document.body.dataset.page;
  if (page === 'login') initLogin();
  if (page === 'start') initStart();
})();
