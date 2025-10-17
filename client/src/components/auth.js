import api from '../services/api.js';
import { showLoading, hideLoading, showError } from '../utils/ui.js';

export function setupAuth(onLoginSuccess) {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const loginFormElement = document.getElementById('login-form-element');
  const registerFormElement = document.getElementById('register-form-element');
  const showRegisterBtn = document.getElementById('show-register');
  const showLoginBtn = document.getElementById('show-login');

  // Toggle between login and register
  showRegisterBtn.addEventListener('click', (e) => {
    e.preventDefault();
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
    document.getElementById('auth-error').classList.add('hidden');
  });

  showLoginBtn.addEventListener('click', (e) => {
    e.preventDefault();
    registerForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    document.getElementById('auth-error').classList.add('hidden');
  });

  // Handle login
  loginFormElement.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    try {
      showLoading();
      const result = await api.login(username, password);
      hideLoading();

      if (onLoginSuccess) {
        onLoginSuccess(result.user);
      }
    } catch (error) {
      hideLoading();
      showError(error.message);
    }
  });

  // Handle register
  registerFormElement.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('register-username').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;

    try {
      showLoading();
      const result = await api.register(username, email, password);
      hideLoading();

      if (onLoginSuccess) {
        onLoginSuccess(result.user);
      }
    } catch (error) {
      hideLoading();
      showError(error.message);
    }
  });
}
