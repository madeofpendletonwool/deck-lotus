import api from '../services/api.js';
import { showToast, confirmDialog } from '../utils/ui.js';
import { formatDuration, stepDetail, formatTimeLeft, formatTimeAgo, lostCopies } from '../utils/syncFormat.js';

const POLL_MS = 1000;
const POLL_RETRY_MS = 3000;
const FAILED_POLLS_BEFORE_WARNING = 3;

let refreshButton = null;
let pollTimer = null;
let tickTimer = null;
let failedPolls = 0;
let wasRunning = false;
let renderedRunStart = null; // The run the progress view was built for
let highestPercent = 0;
let lastRun = null;
let lastRunReceivedAt = 0;

const STEP_ICONS = {
  pending: '<i class="ph ph-circle"></i>',
  active: '<span class="sync-spinner"></span>',
  done: '<i class="ph-fill ph-check-circle"></i>',
  skipped: '<i class="ph ph-minus-circle"></i>',
  failed: '<i class="ph-fill ph-x-circle"></i>',
};

const panel = () => document.getElementById('sync-panel');

function setButtonRunning(running) {
  refreshButton.disabled = running;
  refreshButton.classList.toggle('is-syncing', running);
  refreshButton.querySelector('span').textContent = running ? 'Refreshing…' : 'Refresh now';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

function formatDateTime(timestamp) {
  return new Date(timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// The progress view is built once and then patched. Replacing it every second would restart the
// spinner and bar animations, which is its own kind of jank.
function buildProgressView(run) {
  panel().innerHTML = `
    <div class="sync-progress-head">
      <span class="sync-percent" data-sync="percent">0%</span>
      <span class="sync-timing" data-sync="timing"></span>
    </div>
    <div class="sync-bar" role="progressbar" aria-label="Card data refresh" aria-valuemin="0" aria-valuemax="100" data-sync="bar">
      <div class="sync-bar-fill" data-sync="fill"></div>
    </div>
    <div class="sync-paused hidden" data-sync="paused">
      <i class="ph ph-pause-circle"></i>
      <span>The site is still up, but changes to decks and collections are paused while the new data is swapped in.</span>
    </div>
    <div class="sync-connection hidden" data-sync="connection">Lost contact with the server. Still trying…</div>
    <ol class="sync-steps">
      ${run.steps.map((step) => `
        <li class="sync-step" data-step="${step.id}">
          <span class="sync-step-icon"></span>
          <div>
            <div class="sync-step-label">${escapeHtml(step.label)}</div>
            <div class="sync-step-detail"></div>
          </div>
          <span class="sync-step-time"></span>
        </li>
      `).join('')}
    </ol>
  `;
  renderedRunStart = run.startedAt;
  highestPercent = 0;
}

const field = (name) => panel().querySelector(`[data-sync="${name}"]`);

function updateProgressView(run) {
  // The percentage is partly an estimate, so never let it visibly go backwards
  highestPercent = Math.max(highestPercent, run.percent);
  field('percent').textContent = `${highestPercent}%`;
  field('fill').style.width = `${highestPercent}%`;
  field('bar').setAttribute('aria-valuenow', highestPercent);
  field('paused').classList.toggle('hidden', !run.databaseLocked);

  run.steps.forEach((step) => {
    const row = panel().querySelector(`[data-step="${step.id}"]`);
    if (row.dataset.status !== step.status) {
      row.dataset.status = step.status;
      row.className = `sync-step is-${step.status}`;
      row.querySelector('.sync-step-icon').innerHTML = STEP_ICONS[step.status];
      if (step.status === 'active') row.setAttribute('aria-current', 'step');
      else row.removeAttribute('aria-current');
    }
    row.querySelector('.sync-step-detail').textContent = step.status === 'active' ? stepDetail(step) : '';
    row.querySelector('.sync-step-time').textContent =
      step.status === 'done' ? formatDuration(step.finishedAt - step.startedAt) : '';
  });

  updateTiming();
}

// Runs every second between polls, so the clock keeps moving smoothly
function updateTiming() {
  const timing = field('timing');
  if (!timing || !lastRun) return;
  const elapsed = lastRun.elapsedMs + (Date.now() - lastRunReceivedAt);
  const timeLeft = formatTimeLeft(elapsed, highestPercent);
  timing.textContent = [formatDuration(elapsed), timeLeft].filter(Boolean).join(' · ');
}

function renderStats(summary) {
  const stats = [
    ['Cards', summary.cards],
    ['Printings', summary.printings],
    ['Sets', summary.sets],
    ['Prices', summary.prices],
    ['Deck cards kept', summary.deckCardsRestored],
  ].filter(([, value]) => value != null);

  if (stats.length === 0) return '';
  return `<dl class="sync-stats">${stats.map(([label, value]) => `
    <div class="sync-stat"><dt>${label}</dt><dd>${value.toLocaleString()}</dd></div>
  `).join('')}</dl>`;
}

function renderSucceeded(run) {
  const lost = lostCopies(run.summary);
  panel().innerHTML = `
    <div class="sync-result is-success">
      <i class="ph-fill ph-check-circle"></i>
      <div>
        <div class="sync-result-title">Card data is up to date</div>
        <div class="sync-result-meta" title="${formatDateTime(run.finishedAt)}">
          Updated ${formatTimeAgo(run.finishedAt)} · took ${formatDuration(run.finishedAt - run.startedAt)}
        </div>
      </div>
    </div>
    ${renderStats(run.summary ?? {})}
    ${lost > 0 ? `
      <div class="sync-warning">
        <i class="ph ph-warning"></i>
        <span>${lost} ${lost === 1 ? 'copy' : 'copies'} in decks or collections couldn't be kept because MTGJSON no longer lists that printing.
        ${run.summary.safetyBackup ? `The previous list is saved in ${escapeHtml(run.summary.safetyBackup)}.` : ''}</span>
      </div>
    ` : ''}
  `;
}

function renderFailed(run, lastSuccessAt) {
  const reassurance = run.committed
    ? 'The new card data was saved. Only the final cleanup failed.'
    : `Nothing changed, and the site is still using the previous data${lastSuccessAt ? ` from ${formatDateTime(lastSuccessAt)}` : ''}.`;

  panel().innerHTML = `
    <div class="sync-result is-failed">
      <i class="ph-fill ph-x-circle"></i>
      <div>
        <div class="sync-result-title">Refresh failed${run.failedStep ? ` while ${escapeHtml(run.failedStep.toLowerCase())}` : ''}</div>
        <div class="sync-result-meta">${formatDateTime(run.finishedAt)} · after ${formatDuration(run.finishedAt - run.startedAt)}</div>
        <div class="sync-error">${escapeHtml(run.error)}</div>
        <div class="sync-reassure">${escapeHtml(reassurance)}</div>
      </div>
    </div>
  `;
}

function stopTimers() {
  clearTimeout(pollTimer);
  clearInterval(tickTimer);
  pollTimer = null;
  tickTimer = null;
}

function applyStatus(status) {
  failedPolls = 0;
  const { isRunning, run, lastSuccessAt } = status;
  setButtonRunning(isRunning);

  if (isRunning) {
    lastRun = run;
    lastRunReceivedAt = Date.now();
    if (renderedRunStart !== run.startedAt) buildProgressView(run);
    field('connection').classList.add('hidden');
    updateProgressView(run);
    if (!tickTimer) tickTimer = setInterval(updateTiming, 1000);
    clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, POLL_MS);
  } else {
    stopTimers();
    renderedRunStart = null;
    if (!run) panel().innerHTML = '';
    else if (run.status === 'failed') renderFailed(run, lastSuccessAt);
    else renderSucceeded(run);

    // Polling carries on if you leave Settings, so this tells you wherever you are
    if (wasRunning && run) {
      if (run.status === 'failed') showToast('Card data refresh failed', 'error');
      else showToast('Card data is up to date', 'success');
    }
  }
  wasRunning = isRunning;
}

async function poll() {
  try {
    applyStatus(await api.getSyncStatus());
  } catch (error) {
    failedPolls++;
    console.error('Failed to load sync status:', error);
    if (wasRunning && failedPolls >= FAILED_POLLS_BEFORE_WARNING) {
      field('connection')?.classList.remove('hidden');
    }
    if (wasRunning) pollTimer = setTimeout(poll, POLL_RETRY_MS);
  }
}

export function loadSyncStatus() {
  clearTimeout(pollTimer);
  return poll();
}

export function setupSyncPanel(button) {
  refreshButton = button;

  button.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Refresh card data?',
      message: 'This downloads the latest cards, prices, and sets, and takes a few minutes. The site stays up, and your decks and collection are kept.',
      confirmText: 'Refresh',
    });
    if (!ok) return;

    try {
      setButtonRunning(true);
      applyStatus(await api.syncDatabase());
    } catch (error) {
      setButtonRunning(false);
      showToast('Could not start the refresh: ' + error.message, 'error');
      loadSyncStatus();
    }
  });
}
