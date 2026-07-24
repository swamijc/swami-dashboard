// Swami Dashboard — Photon Session Auto-Refresh
// Captures session cookies automatically when you visit either Photon site.
// Install: Chrome → chrome://extensions → Developer mode ON → Load unpacked →
//   select the browser-extension/ folder. That's it — no more daily paste!

const TIMETRACKER_HOST  = 'timetracker.photon.com';
const PHOTONTRACK_HOST  = 'photontrack.photon.com';
const DASHBOARD_URL     = 'http://localhost:3001';
const DASHBOARD_LOGIN   = `${DASHBOARD_URL}/api/auth/login`;
const DASHBOARD_CREDS   = { username: 'admin', password: 'Admin@1234!' };

// Per-domain cooldown (30 min) — avoids hammering on every page request
const lastRefreshAt = {};
const REFRESH_COOLDOWN_MS = 30 * 60 * 1000;

function isAsset(url) {
  return ['.js','.css','.png','.ico','.woff','.svg','.woff2'].some(ext => url.includes(ext));
}

// ── Listen on timetracker.photon.com ──────────────────────────────────────
chrome.webRequest.onCompleted.addListener(
  async (details) => {
    if (details.statusCode !== 200 || isAsset(details.url)) return;
    const now = Date.now();
    if (now - (lastRefreshAt[TIMETRACKER_HOST] || 0) < REFRESH_COOLDOWN_MS) return;
    await refreshSession(TIMETRACKER_HOST, `${DASHBOARD_URL}/api/timesheet/photon/refresh-session`, 'Photon Timetracker');
  },
  { urls: [`https://${TIMETRACKER_HOST}/*`] }
);

// ── Listen on photontrack.photon.com ──────────────────────────────────────
chrome.webRequest.onCompleted.addListener(
  async (details) => {
    if (details.statusCode !== 200 || isAsset(details.url)) return;
    const now = Date.now();
    if (now - (lastRefreshAt[PHOTONTRACK_HOST] || 0) < REFRESH_COOLDOWN_MS) return;
    await refreshSession(PHOTONTRACK_HOST, `${DASHBOARD_URL}/api/tracking/refresh-session`, 'Photon Track');
  },
  { urls: [`https://${PHOTONTRACK_HOST}/*`] }
);

async function refreshSession(host, apiUrl, label) {
  try {
    const cookies = await chrome.cookies.getAll({ domain: host });
    const hasMyCookie = cookies.some(c => c.name === 'myCookie');
    const hasShib     = cookies.some(c => c.name.startsWith('_shibsession_'));

    if (!hasMyCookie || !hasShib) {
      console.log(`[Swami] No valid session cookies on ${host} yet — skipping.`);
      return;
    }

    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // Step 1: Login to get a dashboard session.
    // credentials:'include' makes the browser store and send connect.sid automatically.
    const loginResp = await fetch(DASHBOARD_LOGIN, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(DASHBOARD_CREDS),
    });
    if (!loginResp.ok) {
      console.error(`[Swami] Dashboard login failed (${loginResp.status}) — is the backend running?`);
      return;
    }

    // Step 2: Push Photon cookies to the backend.
    const saveResp = await fetch(apiUrl, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie_header: cookieHeader }),
    });
    if (!saveResp.ok) {
      console.error(`[Swami] ${label} save failed (${saveResp.status})`);
      return;
    }

    lastRefreshAt[host] = Date.now();
    console.log(`[Swami] ✅ ${label} session refreshed automatically`);

    chrome.notifications.create(`swami-refresh-${Date.now()}`, {
      type: 'basic', iconUrl: 'icon48.png',
      title: 'Swami Dashboard ✅',
      message: `${label} session refreshed — timesheets will submit automatically today.`,
    });

  } catch (err) {
    console.error(`[Swami] ${label} refresh error:`, err.message);
  }
}
