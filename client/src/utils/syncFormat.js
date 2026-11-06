/** "45s", "3m 12s" */
export function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

const formatMegabytes = (bytes) => (bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0);

/** What a running step is up to, like "Importing rulings" or "142 of 512 MB". */
export function stepDetail(step) {
  if (step.detail) return step.detail;
  if (step.done == null) return '';
  if (step.unit === 'bytes') {
    return step.total
      ? `${formatMegabytes(step.done)} of ${formatMegabytes(step.total)} MB`
      : `${formatMegabytes(step.done)} MB`;
  }
  return step.total
    ? `${step.done.toLocaleString('en-US')} of ${step.total.toLocaleString('en-US')} ${step.unit}`
    : `${step.done.toLocaleString('en-US')} ${step.unit}`;
}

/** A rough time remaining, or '' while there's too little to go on. Rounded so it doesn't jitter. */
export function formatTimeLeft(elapsedMs, percent) {
  if (percent < 10 || percent >= 100) return '';
  const leftMs = (elapsedMs / percent) * (100 - percent);
  if (leftMs < 60_000) return 'Under a minute left';
  return `About ${Math.ceil(leftMs / 60_000)} min left`;
}

/** "just now", "5 minutes ago", "3 days ago" */
export function formatTimeAgo(timestamp, now = Date.now()) {
  const minutes = Math.floor((now - timestamp) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** Copies a sync couldn't carry over because the printing no longer exists. */
export function lostCopies(summary) {
  return (summary?.deckCardsLost ?? 0) + (summary?.ownedCardsLost ?? 0) + (summary?.ownedPrintingsLost ?? 0);
}
