import api from '../services/api.js';
import { showLoading, hideLoading, showModal, showToast } from '../utils/ui.js';

export function setupSettings() {
  const generateApiKeyBtn = document.getElementById('generate-api-key-btn');
  const refreshDbBtn = document.getElementById('refresh-db-btn');
  const backupDataBtn = document.getElementById('backup-data-btn');
  const restoreDataBtn = document.getElementById('restore-data-btn');
  const restoreFileInput = document.getElementById('restore-file-input');

  // Backup data
  backupDataBtn.addEventListener('click', async () => {
    try {
      showLoading();
      const backup = await api.createBackup();
      hideLoading();

      // Create a download link
      const dataStr = JSON.stringify(backup, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `deck-lotus-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showToast('Backup created successfully!', 'success');
    } catch (error) {
      hideLoading();
      showToast('Failed to create backup: ' + error.message, 'error');
    }
  });

  // Restore data
  restoreDataBtn.addEventListener('click', () => {
    restoreFileInput.click();
  });

  restoreFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.json')) {
      showToast('Please select a valid JSON backup file', 'error');
      return;
    }

    const overwrite = confirm(
      'Do you want to overwrite existing data?\n\n' +
      'YES: Replace all your current data with the backup\n' +
      'NO: Merge the backup with your existing data (may create duplicates)'
    );

    try {
      showLoading();
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const backup = JSON.parse(event.target.result);
          const result = await api.restoreBackup(backup, overwrite);
          hideLoading();

          showModal('Backup Restored', `
            <p>Successfully restored backup!</p>
            <ul style="text-align: left; margin: 1rem 0;">
              <li>Users: ${result.results.users}</li>
              <li>Owned Cards: ${result.results.owned_cards || 0}</li>
              <li>Decks: ${result.results.decks}</li>
              <li>Deck Cards: ${result.results.deck_cards}</li>
              <li>API Keys: ${result.results.api_keys}</li>
              <li>Deck Shares: ${result.results.deck_shares}</li>
            </ul>
            ${result.results.errors.length > 0 ? `
              <p style="color: var(--danger); margin-top: 1rem;">Errors: ${result.results.errors.length}</p>
              <details style="margin-top: 0.5rem;">
                <summary>Show errors</summary>
                <pre style="font-size: 0.75rem; max-height: 200px; overflow-y: auto;">${result.results.errors.join('\n')}</pre>
              </details>
            ` : ''}
            <p style="margin-top: 1rem;">Refreshing page...</p>
          `);

          // Refresh the page after 2 seconds
          setTimeout(() => {
            window.location.reload();
          }, 2000);
        } catch (error) {
          hideLoading();
          showToast('Invalid backup file: ' + error.message, 'error');
        }
      };
      reader.readAsText(file);
    } catch (error) {
      hideLoading();
      showToast('Failed to restore backup: ' + error.message, 'error');
    } finally {
      // Clear the file input so the same file can be selected again
      restoreFileInput.value = '';
    }
  });

  generateApiKeyBtn.addEventListener('click', async () => {
    const keyName = prompt('Enter a name for this API key:');
    if (!keyName) return;

    try {
      showLoading();
      const result = await api.createApiKey(keyName);
      hideLoading();

      showModal('API Key Generated', `
        <p><strong>Important:</strong> Save this key now. It will not be shown again.</p>
        <div class="api-key-code">${result.apiKey}</div>
        <p style="margin-top: 1rem; color: var(--text-secondary); font-size: 0.875rem;">
          Use this key in your API requests by adding the header:<br>
          <code>X-API-Key: ${result.apiKey}</code>
        </p>
      `);

      await loadApiKeys();
    } catch (error) {
      hideLoading();
      showToast('Failed to generate API key: ' + error.message, 'error');
    }
  });

  // Refresh database
  refreshDbBtn.addEventListener('click', async () => {
    if (!confirm('This will update all card data, prices, and sets. It may take several minutes. Continue?')) {
      return;
    }

    try {
      refreshDbBtn.disabled = true;
      refreshDbBtn.textContent = 'Syncing...';
      showLoading();

      await api.syncDatabase();

      hideLoading();
      showToast('Database refreshed successfully!', 'success');
      await loadSyncStatus();
    } catch (error) {
      hideLoading();
      showToast('Failed to refresh database: ' + error.message, 'error');
    } finally {
      refreshDbBtn.disabled = false;
      refreshDbBtn.textContent = 'Refresh Database Now';
    }
  });

  window.addEventListener('page:settings', async () => {
    await loadApiKeys();
    await loadSyncStatus();
    await checkAdminAndLoadUsers();
  });
}

async function checkAdminAndLoadUsers() {
  try {
    const profile = await api.getProfile();
    const userManagementSection = document.getElementById('user-management-section');
    const backupSection = document.getElementById('backup-section');
    const databaseSection = document.getElementById('database-section');

    // Backup section is available to all users (they can backup their own data)
    if (backupSection) backupSection.style.display = 'block';

    if (profile.user.is_admin) {
      // User is an admin, show admin-only sections
      if (userManagementSection) userManagementSection.style.display = 'block';
      if (databaseSection) databaseSection.style.display = 'block';
      await loadUsers();
    } else {
      // Hide admin-only sections for non-admins
      if (userManagementSection) userManagementSection.style.display = 'none';
      if (databaseSection) databaseSection.style.display = 'none';
    }
  } catch (error) {
    console.error('Failed to check admin status:', error);
  }
}

async function loadUsers() {
  try {
    showLoading();
    const result = await api.getAllUsers();
    renderUsers(result.users);
    hideLoading();
  } catch (error) {
    hideLoading();
    console.error('Failed to load users:', error);
    showToast('Failed to load users: ' + error.message, 'error');
  }
}

function renderUsers(users) {
  const usersList = document.getElementById('users-list');

  if (users.length === 0) {
    usersList.innerHTML = '<p style="color: var(--text-secondary);">No users yet</p>';
    return;
  }

  usersList.innerHTML = users.map(user => `
    <div class="user-item" style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: var(--bg-tertiary); border-radius: 8px; margin-bottom: 0.5rem;">
      <div style="flex: 1;">
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <strong>${user.username}</strong>
          ${user.is_admin ? '<span class="badge" style="background: var(--primary); color: white; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem;">Admin</span>' : ''}
        </div>
        <div style="font-size: 0.875rem; color: var(--text-secondary); margin-top: 0.25rem;">
          ${user.email}<br>
          Created: ${new Date(user.created_at).toLocaleDateString()}
        </div>
      </div>
      <div style="display: flex; gap: 0.5rem;">
        ${user.is_admin ?
          `<button class="btn btn-secondary btn-sm" onclick="toggleAdminStatus(${user.id}, false)">Remove Admin</button>` :
          `<button class="btn btn-secondary btn-sm" onclick="toggleAdminStatus(${user.id}, true)">Make Admin</button>`
        }
        <button class="btn btn-danger btn-sm" onclick="deleteUserConfirm(${user.id}, '${user.username}')">Delete</button>
      </div>
    </div>
  `).join('');
}

window.toggleAdminStatus = async function(userId, makeAdmin) {
  const action = makeAdmin ? 'promote to admin' : 'remove admin status from';
  if (!confirm(`Are you sure you want to ${action} this user?`)) {
    return;
  }

  try {
    showLoading();
    await api.updateUser(userId, { is_admin: makeAdmin ? 1 : 0 });
    await loadUsers();
    hideLoading();
    showToast(makeAdmin ? 'User promoted to admin' : 'Admin status removed', 'success');
  } catch (error) {
    hideLoading();
    showToast('Failed to update user: ' + error.message, 'error');
  }
};

window.deleteUserConfirm = async function(userId, username) {
  if (!confirm(`Are you sure you want to delete user "${username}"? This action cannot be undone and will delete all their decks and data.`)) {
    return;
  }

  try {
    showLoading();
    await api.deleteUser(userId);
    await loadUsers();
    hideLoading();
    showToast('User deleted successfully', 'success');
  } catch (error) {
    hideLoading();
    showToast('Failed to delete user: ' + error.message, 'error');
  }
};

async function loadSyncStatus() {
  try {
    const status = await api.getSyncStatus();
    const statusEl = document.getElementById('sync-status');

    if (status.isRunning) {
      statusEl.innerHTML = '🔄 Sync in progress...';
    } else if (status.lastRun) {
      const date = new Date(status.lastRun);
      statusEl.innerHTML = `Last synced: ${date.toLocaleString()}`;
    } else {
      statusEl.innerHTML = 'Never synced';
    }
  } catch (error) {
    console.error('Failed to load sync status:', error);
  }
}

async function loadApiKeys() {
  try {
    showLoading();
    const result = await api.getApiKeys();
    renderApiKeys(result.apiKeys);
    hideLoading();
  } catch (error) {
    hideLoading();
    console.error('Failed to load API keys:', error);
  }
}

function renderApiKeys(apiKeys) {
  const apiKeysList = document.getElementById('api-keys-list');

  if (apiKeys.length === 0) {
    apiKeysList.innerHTML = '<p style="color: var(--text-secondary);">No API keys yet</p>';
    return;
  }

  apiKeysList.innerHTML = apiKeys.map(key => `
    <div class="api-key-item">
      <div>
        <strong>${key.name}</strong>
        <div style="font-size: 0.875rem; color: var(--text-secondary); margin-top: 0.25rem;">
          Created: ${new Date(key.created_at).toLocaleDateString()}<br>
          Last used: ${key.last_used ? new Date(key.last_used).toLocaleDateString() : 'Never'}
        </div>
      </div>
      <button class="btn btn-danger btn-sm" onclick="revokeApiKey(${key.id})">Revoke</button>
    </div>
  `).join('');
}

// Make this global so the onclick handler can access it
window.revokeApiKey = async function(keyId) {
  if (!confirm('Are you sure you want to revoke this API key? This action cannot be undone.')) {
    return;
  }

  try {
    showLoading();
    await api.request(`/auth/api-keys/${keyId}`, { method: 'DELETE' });
    await loadApiKeys();
    hideLoading();
    showToast('API key revoked', 'success');
  } catch (error) {
    hideLoading();
    showToast('Failed to revoke API key: ' + error.message, 'error');
  }
};
