import api from '../services/api.js';
import { showToast, debounce } from '../utils/ui.js';

const CONDITIONS = { any: 'Any', nm: 'NM', lp: 'LP', mp: 'MP', hp: 'HP', dm: 'DM' };

function formatPrice(v) {
  return v != null ? `$${parseFloat(v).toFixed(2)}` : '—';
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function statusBadge(watch) {
  if (!watch.is_active) return '<span style="font-size:0.75rem;padding:0.2rem 0.5rem;border-radius:4px;background:#71717a;color:#fff;">Inactive</span>';
  if (watch.expires_at && new Date(watch.expires_at) < new Date()) return '<span style="font-size:0.75rem;padding:0.2rem 0.5rem;border-radius:4px;background:#71717a;color:#fff;">Expired</span>';
  const price = watch.latest_price ?? watch.last_price;
  if (watch.max_price != null) {
    if (price != null && price <= watch.max_price) {
      return '<span style="font-size:0.75rem;padding:0.2rem 0.5rem;border-radius:4px;background:#16a34a;color:#fff;">Price Hit!</span>';
    }
  }
  return '<span style="font-size:0.75rem;padding:0.2rem 0.5rem;border-radius:4px;background:var(--bg-tertiary);color:var(--text-secondary);">Watching</span>';
}

function renderWatches(watches) {
  const list = document.getElementById('pm-watches-list');
  const empty = document.getElementById('pm-empty');

  if (!watches.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  list.innerHTML = watches.map(w => {
    const price = w.latest_price ?? w.last_price;
    const hitTarget = w.max_price != null && price != null && price <= w.max_price;
    const priceColor = hitTarget ? '#16a34a' : 'var(--text-primary)';
    const targetLabel = w.max_price != null
      ? `Target: <strong style="color: var(--text-primary);">${formatPrice(w.max_price)}</strong>`
      : `Mode: <strong style="color: var(--text-primary);">New Low Alert</strong>`;
    const printingLabel = w.set_code ? `${w.set_code.toUpperCase()}${w.set_name ? ` — ${w.set_name}` : ''}` : 'Any printing';
    const thumbnail = w.image_url
      ? `<img src="${w.image_url}" alt="${w.card_name}" style="width:44px;height:62px;border-radius:4px;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'">`
      : `<div style="width:44px;height:62px;border-radius:4px;background:var(--bg-tertiary);flex-shrink:0;display:flex;align-items:center;justify-content:center;"><i class="ph ph-cards" style="font-size:1.25rem;color:var(--text-secondary);"></i></div>`;
    return `
      <div class="settings-section" style="padding: 1rem; display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap;">
        <div style="display:flex;gap:0.75rem;flex:1;min-width:200px;align-items:flex-start;">
          ${thumbnail}
          <div style="flex:1;">
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem; flex-wrap:wrap;">
              <strong style="font-size: 1rem;">${w.card_name}</strong>
              <a href="https://manapool.com/search?q=${encodeURIComponent(w.card_name)}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" title="View on Mana Pool" style="padding:0.15rem 0.4rem;"><i class="ph ph-arrow-square-out"></i></a>
              ${statusBadge(w)}
            </div>
            <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.2rem;">
              <i class="ph ph-stack"></i> ${printingLabel}
            </div>
            <div style="font-size: 0.875rem; color: var(--text-secondary); display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 0.25rem;">
              <span>${targetLabel}</span>
              <span>Cond: <strong style="color: var(--text-primary);">${CONDITIONS[w.condition] || w.condition}</strong></span>
              <span>Current: <strong style="color: ${priceColor};">${formatPrice(price)}</strong></span>
              ${w.expires_at ? `<span>Expires: <strong style="color:var(--text-primary);">${w.expires_at.slice(0,10)}</strong></span>` : ''}
            </div>
            ${w.notes ? `<div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.25rem; font-style: italic;">${w.notes}</div>` : ''}
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">Last checked: ${w.last_checked ? formatDate(w.last_checked) : 'Never'}</div>
          </div>
        </div>
        <div style="display: flex; gap: 0.5rem; flex-shrink: 0;">
          <button class="btn btn-secondary btn-sm pm-history-btn" data-id="${w.id}" data-name="${w.card_name}" title="View history">
            <i class="ph ph-chart-line"></i>
          </button>
          <button class="btn btn-secondary btn-sm pm-edit-btn" data-id="${w.id}" title="Edit">
            <i class="ph ph-pencil"></i>
          </button>
          <button class="btn ${w.is_active ? 'btn-secondary' : 'btn-primary'} btn-sm pm-toggle-btn" data-id="${w.id}" data-active="${w.is_active}" title="${w.is_active ? 'Pause' : 'Resume'}">
            <i class="ph ph-${w.is_active ? 'pause' : 'play'}"></i>
          </button>
          <button class="btn btn-danger btn-sm pm-delete-btn" data-id="${w.id}" data-name="${w.card_name}" title="Delete">
            <i class="ph ph-trash"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function setPrintingFields({ cardId = '', scryfallId = '', imageUrl = '', setCode = '', setName = '' } = {}) {
  document.getElementById('pm-card-id').value = cardId;
  document.getElementById('pm-scryfall-id').value = scryfallId;
  document.getElementById('pm-image-url').value = imageUrl;
  document.getElementById('pm-set-code').value = setCode;
  document.getElementById('pm-set-name').value = setName;
  const label = setCode ? `${setCode.toUpperCase()}${setName ? ` — ${setName}` : ''}` : 'Any printing';
  document.getElementById('pm-printing-label').textContent = label;
  if (imageUrl) {
    document.getElementById('pm-printing-label').innerHTML =
      `<img src="${imageUrl}" style="width:24px;height:34px;border-radius:3px;object-fit:cover;vertical-align:middle;margin-right:6px;" onerror="this.remove()"> ${label}`;
  }
}

function openWatchModal(watch = null) {
  document.getElementById('pm-watch-modal-title').textContent = watch ? 'Edit Price Watch' : 'Add Price Watch';
  document.getElementById('pm-watch-id').value = watch?.id ?? '';
  document.getElementById('pm-card-name').value = watch?.card_name ?? '';
  document.getElementById('pm-card-name').disabled = !!watch;
  document.getElementById('pm-max-price').value = watch?.max_price != null ? watch.max_price : '';
  document.getElementById('pm-condition').value = watch?.condition ?? 'any';
  document.getElementById('pm-expires-at').value = watch?.expires_at?.slice(0, 10) ?? '';
  document.getElementById('pm-notes').value = watch?.notes ?? '';

  setPrintingFields({
    cardId: watch?.card_id ?? '',
    scryfallId: watch?.scryfall_id ?? '',
    imageUrl: watch?.image_url ?? '',
    setCode: watch?.set_code ?? '',
    setName: watch?.set_name ?? '',
  });

  const section = document.getElementById('pm-printing-section');
  const grid = document.getElementById('pm-printing-grid');
  if (watch?.card_id) {
    section.style.display = '';
    grid.classList.add('hidden');
    grid.innerHTML = '';
  } else {
    section.style.display = 'none';
    grid.classList.add('hidden');
    grid.innerHTML = '';
  }

  document.getElementById('pm-watch-modal').classList.remove('hidden');
}

function closeWatchModal() {
  document.getElementById('pm-watch-modal').classList.add('hidden');
  document.getElementById('pm-watch-form').reset();
  document.getElementById('pm-card-name').disabled = false;
  const r = document.getElementById('pm-card-search-results');
  if (r) { r.classList.add('hidden'); r.innerHTML = ''; }
  document.getElementById('pm-printing-section').style.display = 'none';
  document.getElementById('pm-printing-grid').classList.add('hidden');
  document.getElementById('pm-printing-grid').innerHTML = '';
  setPrintingFields();
}

function renderPrintingGrid(grid, printings, cardId) {
  grid.classList.remove('hidden');
  if (!printings.length) {
    grid.innerHTML = '<div style="color:var(--text-secondary);font-size:0.8rem;">No printings found.</div>';
    return;
  }
  grid.innerHTML = `
    <div class="pm-printing-opt" data-card-id="${cardId}" data-scryfall-id="" data-image-url="" data-set-code="" data-set-name=""
         style="cursor:pointer;padding:0.5rem;background:var(--bg-tertiary);border-radius:6px;border:2px solid var(--primary);text-align:center;font-size:0.8rem;display:flex;align-items:center;justify-content:center;min-height:40px;">
      Any printing
    </div>
    ${printings.map(p => `
      <div class="pm-printing-opt" data-card-id="${cardId}" data-scryfall-id="${p.scryfall_id ?? ''}" data-image-url="${p.image_url ?? ''}" data-set-code="${p.set_code ?? ''}" data-set-name="${p.set_name ?? ''}"
           style="cursor:pointer;padding:0.4rem;background:var(--bg-tertiary);border-radius:6px;border:2px solid transparent;text-align:center;font-size:0.75rem;">
        <img src="${p.image_url ?? ''}" alt="${p.set_code ?? ''}" style="width:100%;border-radius:4px;margin-bottom:0.25rem;" onerror="this.style.display='none'">
        <div style="font-weight:600;">${(p.set_code ?? '').toUpperCase()}</div>
        <div style="color:var(--text-secondary);font-size:0.7rem;">${p.set_name ?? ''}</div>
      </div>
    `).join('')}
  `;
  grid.querySelectorAll('.pm-printing-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      grid.querySelectorAll('.pm-printing-opt').forEach(o => o.style.borderColor = 'transparent');
      opt.style.borderColor = 'var(--primary)';
      setPrintingFields({
        cardId: opt.dataset.cardId,
        scryfallId: opt.dataset.scryfallId,
        imageUrl: opt.dataset.imageUrl,
        setCode: opt.dataset.setCode,
        setName: opt.dataset.setName,
      });
    });
  });
}

async function loadWatches() {
  try {
    const watches = await api.getPriceWatches();
    renderWatches(watches);
  } catch (err) {
    showToast('Failed to load price watches', 'error');
  }
}

async function showStatus() {
  try {
    const status = await api.getPriceMonitoringStatus();
    const banner = document.getElementById('pm-status-banner');
    const warnings = [];
    if (!status.manapool && !status.tcgplayer) warnings.push('No price source configured — set MANAPOOL_API_TOKEN (preferred) or TCGPlayer credentials');
    if (!status.ntfy) warnings.push('ntfy not configured (NTFY_TOPIC missing) — no push notifications will be sent');

    if (warnings.length) {
      banner.innerHTML = `<i class="ph ph-warning"></i> ${warnings.join(' &bull; ')}`;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  } catch {}
}

let priceHistoryChart = null;

function renderHistoryChart(history, cardName, maxPrice) {
  const wrap = document.getElementById('pm-history-chart-wrap');
  const canvas = document.getElementById('pm-history-chart');

  if (!window.Chart || !history.length) {
    wrap.classList.add('hidden');
    return;
  }

  wrap.classList.remove('hidden');

  // Destroy previous chart instance
  if (priceHistoryChart) {
    priceHistoryChart.destroy();
    priceHistoryChart = null;
  }

  const sorted = [...history].reverse(); // oldest first
  const labels = sorted.map(r => {
    const d = new Date(r.checked_at);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  });
  const prices = sorted.map(r => r.found_price);
  const pointColors = sorted.map(r =>
    r.notified ? '#16a34a' : 'rgba(99,102,241,0.9)'
  );

  const datasets = [{
    label: 'Found Price',
    data: prices,
    borderColor: 'rgba(99,102,241,0.9)',
    backgroundColor: 'rgba(99,102,241,0.08)',
    pointBackgroundColor: pointColors,
    pointRadius: 5,
    pointHoverRadius: 7,
    tension: 0.3,
    fill: true,
    spanGaps: true,
  }];

  if (maxPrice != null) {
    datasets.push({
      label: 'Target Price',
      data: sorted.map(() => maxPrice),
      borderColor: '#f59e0b',
      borderDash: [6, 4],
      borderWidth: 2,
      pointRadius: 0,
      fill: false,
    });
  }

  priceHistoryChart = new window.Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: 'rgba(255,255,255,0.7)', boxWidth: 14, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: ctx => ctx.dataset.label + ': $' + (ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) : '—'),
          },
        },
      },
      scales: {
        x: { ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: {
          ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 10 }, callback: v => '$' + v.toFixed(2) },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
      },
    },
  });
}

export function setupPriceMonitoring() {
  window.addEventListener('page:price-monitoring', async () => {
    await Promise.all([showStatus(), loadWatches()]);
  });

  document.getElementById('pm-add-watch-btn').addEventListener('click', () => openWatchModal());

  // Card name autocomplete
  const cardNameInput = document.getElementById('pm-card-name');
  const cardSearchResults = document.getElementById('pm-card-search-results');

  function hidePmCardResults() {
    cardSearchResults.classList.add('hidden');
    cardSearchResults.innerHTML = '';
  }

  const debouncedCardSearch = debounce(async (query) => {
    if (query.length < 2) { hidePmCardResults(); return; }
    try {
      const result = await api.searchCards(query, 10);
      if (!result.cards.length) { hidePmCardResults(); return; }
      cardSearchResults.innerHTML = result.cards.map(card => `
        <div class="pm-card-result" data-name="${card.name}" data-card-id="${card.id ?? ''}" data-image-url="${card.image_url ?? ''}" style="padding: 0.5rem 0.75rem; cursor: pointer; display: flex; align-items: center; gap: 0.75rem; border-bottom: 1px solid var(--border-color);">
          ${card.image_url ? `<img src="${card.image_url}" style="width: 30px; height: 42px; border-radius: 3px; object-fit: cover;" alt="">` : ''}
          <div>
            <div style="font-size: 0.9rem;">${card.name}</div>
            <div style="font-size: 0.75rem; color: var(--text-secondary);">${card.type_line || ''}</div>
          </div>
        </div>
      `).join('');
      cardSearchResults.classList.remove('hidden');

      cardSearchResults.querySelectorAll('.pm-card-result').forEach(item => {
        item.addEventListener('mousedown', async (e) => {
          e.preventDefault();
          cardNameInput.value = item.dataset.name;
          hidePmCardResults();

          // Fetch printings for this card and show the selector
          const cardId = item.dataset.cardId;
          if (!cardId) return;
          // Store card's default image even for "Any printing" so the thumbnail always shows
          setPrintingFields({ cardId, imageUrl: item.dataset.imageUrl });
          const section = document.getElementById('pm-printing-section');
          const grid = document.getElementById('pm-printing-grid');
          section.style.display = '';
          grid.classList.add('hidden');
          grid.innerHTML = '<div style="color:var(--text-secondary);font-size:0.8rem;padding:0.5rem;">Loading printings…</div>';
          try {
            const result = await api.getCardPrintings(cardId);
            const printings = result.printings ?? result ?? [];
            renderPrintingGrid(grid, printings, cardId);
          } catch {
            grid.innerHTML = '<div style="color:var(--text-secondary);font-size:0.8rem;padding:0.5rem;">Could not load printings.</div>';
          }
        });
      });
    } catch {}
  }, 200);

  cardNameInput.addEventListener('input', (e) => {
    if (!cardNameInput.disabled) debouncedCardSearch(e.target.value.trim());
  });

  cardNameInput.addEventListener('blur', () => {
    setTimeout(hidePmCardResults, 150);
  });

  document.getElementById('pm-change-printing-btn').addEventListener('click', () => {
    const grid = document.getElementById('pm-printing-grid');
    grid.classList.toggle('hidden');
  });

  document.getElementById('pm-check-now-btn').addEventListener('click', async () => {
    const btn = document.getElementById('pm-check-now-btn');
    btn.disabled = true;
    btn.querySelector('.btn-text').textContent = 'Checking...';
    try {
      const { results } = await api.runPriceChecksNow();
      const hits = results.filter(r => r.notified).length;
      showToast(`Checked ${results.length} watch(es) — ${hits} alert(s) sent`, 'success');
      await loadWatches();
    } catch (err) {
      showToast(err.message || 'Price check failed', 'error');
    } finally {
      btn.disabled = false;
      btn.querySelector('.btn-text').textContent = 'Check Now';
    }
  });

  document.getElementById('pm-watch-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const watchId = document.getElementById('pm-watch-id').value;
    const data = {
      card_name: document.getElementById('pm-card-name').value.trim(),
      max_price: document.getElementById('pm-max-price').value !== ''
        ? parseFloat(document.getElementById('pm-max-price').value)
        : null,
      condition: document.getElementById('pm-condition').value,
      expires_at: document.getElementById('pm-expires-at').value || null,
      notes: document.getElementById('pm-notes').value.trim() || null,
      card_id: document.getElementById('pm-card-id').value || null,
      scryfall_id: document.getElementById('pm-scryfall-id').value || null,
      image_url: document.getElementById('pm-image-url').value || null,
      set_code: document.getElementById('pm-set-code').value || null,
      set_name: document.getElementById('pm-set-name').value || null,
    };

    try {
      if (watchId) {
        await api.updatePriceWatch(parseInt(watchId), data);
        showToast('Watch updated', 'success');
      } else {
        await api.createPriceWatch(data);
        showToast('Watch added', 'success');
      }
      closeWatchModal();
      await loadWatches();
    } catch (err) {
      showToast(err.message || 'Failed to save watch', 'error');
    }
  });

  document.getElementById('pm-watch-cancel').addEventListener('click', closeWatchModal);
  document.getElementById('pm-watch-modal-close').addEventListener('click', closeWatchModal);
  document.getElementById('pm-history-modal-close').addEventListener('click', () => {
    document.getElementById('pm-history-modal').classList.add('hidden');
    if (priceHistoryChart) { priceHistoryChart.destroy(); priceHistoryChart = null; }
    document.getElementById('pm-history-chart-wrap').classList.add('hidden');
  });

  // Delegate clicks on the watches list
  document.getElementById('pm-watches-list').addEventListener('click', async (e) => {
    const editBtn = e.target.closest('.pm-edit-btn');
    const deleteBtn = e.target.closest('.pm-delete-btn');
    const toggleBtn = e.target.closest('.pm-toggle-btn');
    const historyBtn = e.target.closest('.pm-history-btn');

    if (editBtn) {
      const id = parseInt(editBtn.dataset.id);
      try {
        const watches = await api.getPriceWatches();
        const watch = watches.find(w => w.id === id);
        if (watch) openWatchModal(watch);
      } catch {}
    }

    if (deleteBtn) {
      const id = parseInt(deleteBtn.dataset.id);
      const name = deleteBtn.dataset.name;
      if (!confirm(`Delete price watch for "${name}"?`)) return;
      try {
        await api.deletePriceWatch(id);
        showToast('Watch deleted', 'success');
        await loadWatches();
      } catch (err) {
        showToast(err.message || 'Failed to delete', 'error');
      }
    }

    if (toggleBtn) {
      const id = parseInt(toggleBtn.dataset.id);
      const isActive = toggleBtn.dataset.active === '1';
      try {
        await api.updatePriceWatch(id, { is_active: !isActive });
        await loadWatches();
      } catch (err) {
        showToast(err.message || 'Failed to update', 'error');
      }
    }

    if (historyBtn) {
      const id = parseInt(historyBtn.dataset.id);
      const name = historyBtn.dataset.name;
      try {
        const [history, watches] = await Promise.all([
          api.getPriceWatchHistory(id),
          api.getPriceWatches(),
        ]);
        const thisWatch = watches.find(w => w.id === id);
        document.getElementById('pm-history-title').textContent = `Price History: ${name}`;
        const listEl = document.getElementById('pm-history-list');
        if (!history.length) {
          listEl.innerHTML = '<p style="text-align:center;color:var(--text-secondary);padding:2rem;">No checks recorded yet.</p>';
        } else {
          listEl.innerHTML = `
            <table style="width:100%;border-collapse:collapse;font-size:0.875rem;">
              <thead>
                <tr style="border-bottom:1px solid var(--border-color);">
                  <th style="text-align:left;padding:0.5rem;">Checked At</th>
                  <th style="text-align:right;padding:0.5rem;">Price</th>
                  <th style="text-align:center;padding:0.5rem;">Alerted</th>
                </tr>
              </thead>
              <tbody>
                ${history.map(row => `
                  <tr style="border-bottom:1px solid var(--border-color);">
                    <td style="padding:0.5rem;">${formatDate(row.checked_at)}</td>
                    <td style="text-align:right;padding:0.5rem;">${formatPrice(row.found_price)}</td>
                    <td style="text-align:center;padding:0.5rem;">${row.notified ? '<i class="ph ph-check-circle" style="color:#16a34a;"></i>' : '<i class="ph ph-minus" style="color:var(--text-secondary);"></i>'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `;
        }
        renderHistoryChart(history, name, thisWatch?.max_price);
        document.getElementById('pm-history-modal').classList.remove('hidden');
      } catch (err) {
        showToast('Failed to load history', 'error');
      }
    }
  });
}
