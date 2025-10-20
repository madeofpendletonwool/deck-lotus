import api from '../services/api.js';
import { getGravatarUrl, getUserInitials, getUserColor } from '../utils/gravatar.js';

let currentUser = null;
let userStats = null;
let dropdownOpen = false;

export async function setupUserMenu() {
  const avatarBtn = document.getElementById('user-avatar-btn');
  const dropdown = document.getElementById('user-dropdown');
  const logoutBtn = document.getElementById('logout-btn');

  // Load user data
  await loadUserData();

  // Toggle dropdown on avatar click
  avatarBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown();
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (dropdownOpen && !dropdown.contains(e.target) && !avatarBtn.contains(e.target)) {
      closeDropdown();
    }
  });

  // Logout handler
  logoutBtn.addEventListener('click', () => {
    api.logout();
    window.location.reload();
  });

  // Update on page changes
  window.addEventListener('page:change', loadUserData);
}

async function loadUserData() {
  try {
    // Load user profile
    const profileResult = await api.getProfile();
    currentUser = profileResult.user;

    // Load user stats
    const statsResult = await api.getUserStats();
    userStats = statsResult.stats;

    // Update UI
    await updateAvatar();
    updateDropdownContent();
  } catch (error) {
    console.error('Failed to load user data:', error);
  }
}

async function updateAvatar() {
  if (!currentUser) return;

  // Elements for nav avatar
  const avatarImg = document.getElementById('user-avatar-img');
  const avatarInitials = document.getElementById('user-avatar-initials');

  // Elements for dropdown avatar
  const dropdownAvatarImg = document.getElementById('dropdown-avatar-img');
  const dropdownAvatarInitials = document.getElementById('dropdown-avatar-initials');

  // Try to load Gravatar
  const gravatarUrl = getGravatarUrl(currentUser.email, 80);

  // Set background color for initials
  const userColor = getUserColor(currentUser.username);
  avatarInitials.style.background = userColor;
  dropdownAvatarInitials.style.background = userColor;

  // Set initials
  const initials = getUserInitials(currentUser.username);
  avatarInitials.textContent = initials;
  dropdownAvatarInitials.textContent = initials;

  // Try to load Gravatar image
  if (gravatarUrl) {
    const img = new Image();
    img.onload = () => {
      // Gravatar loaded successfully
      avatarImg.src = gravatarUrl;
      avatarImg.classList.remove('hidden');
      avatarInitials.style.display = 'none';

      dropdownAvatarImg.src = gravatarUrl;
      dropdownAvatarImg.classList.remove('hidden');
      dropdownAvatarInitials.style.display = 'none';
    };
    img.onerror = () => {
      // Gravatar failed, use initials
      avatarImg.classList.add('hidden');
      avatarInitials.style.display = 'flex';

      dropdownAvatarImg.classList.add('hidden');
      dropdownAvatarInitials.style.display = 'flex';
    };
    img.src = gravatarUrl;
  } else {
    // No email or Gravatar URL, use initials
    avatarImg.classList.add('hidden');
    avatarInitials.style.display = 'flex';

    dropdownAvatarImg.classList.add('hidden');
    dropdownAvatarInitials.style.display = 'flex';
  }
}

function updateDropdownContent() {
  if (!currentUser || !userStats) return;

  // Update user info
  document.getElementById('dropdown-username').textContent = currentUser.username;
  document.getElementById('dropdown-email').textContent = currentUser.email;

  // Update stats
  document.getElementById('stat-decks').textContent = userStats.deckCount;
  document.getElementById('stat-cards').textContent = userStats.cardCount;
  document.getElementById('stat-api-keys').textContent = userStats.apiKeyCount;
  document.getElementById('stat-shared').textContent = userStats.sharedDeckCount;
}

function toggleDropdown() {
  const dropdown = document.getElementById('user-dropdown');

  if (dropdownOpen) {
    closeDropdown();
  } else {
    openDropdown();
  }
}

function openDropdown() {
  const dropdown = document.getElementById('user-dropdown');
  dropdown.classList.remove('hidden');
  dropdownOpen = true;

  // Reload stats when opening
  loadUserData();
}

function closeDropdown() {
  const dropdown = document.getElementById('user-dropdown');
  dropdown.classList.add('hidden');
  dropdownOpen = false;
}
