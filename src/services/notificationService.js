// ntfy.sh push notification integration
// Requires NTFY_TOPIC env var. NTFY_URL defaults to https://ntfy.sh

function getNtfyUrl() {
  const base = (process.env.NTFY_URL || 'https://ntfy.sh').replace(/\/$/, '');
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return null;
  return `${base}/${topic}`;
}

export function isConfigured() {
  return !!process.env.NTFY_TOPIC;
}

export async function sendPriceAlert({ cardName, foundPrice, threshold, condition }) {
  const url = getNtfyUrl();
  if (!url) {
    console.warn('ntfy not configured (NTFY_TOPIC missing), skipping notification');
    return;
  }

  const condLabel = { nm: 'NM', lp: 'LP', mp: 'MP', hp: 'HP', dm: 'DM', any: 'Any' }[condition] || condition.toUpperCase();
  const title = `Price Alert: ${cardName}`;
  const message = threshold != null
    ? `${cardName} (${condLabel}) is now $${foundPrice.toFixed(2)} — below your $${threshold.toFixed(2)} threshold!`
    : `${cardName} (${condLabel}) hit a new low: $${foundPrice.toFixed(2)}!`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Title: title,
      Priority: 'default',
      Tags: 'moneybag,card_index',
      'Content-Type': 'text/plain',
    },
    body: message,
  });

  if (!res.ok) {
    throw new Error(`ntfy notification failed: ${res.status}`);
  }
}
