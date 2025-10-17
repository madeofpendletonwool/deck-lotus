import api from '../services/api.js';
import { showLoading, hideLoading, showModal, showToast } from '../utils/ui.js';

export function setupSettings() {
  const generateApiKeyBtn = document.getElementById('generate-api-key-btn');
  const refreshDbBtn = document.getElementById('refresh-db-btn');

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
  });
}

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
