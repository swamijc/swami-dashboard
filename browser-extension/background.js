// Swami Dashboard — Photon Session Auto-Refresh
// Captures session cookies automatically when you visit either Photon site.

const TIMETRACKER_HOST  = 'timetracker.photon.com';
const PHOTONTRACK_HOST  = 'photontrack.photon.com';
const DASHBOARD_URL     = 'http://localhost:3001';
const DASHBOARD_LOGIN   = `${DASHBOARD_URL}/api/auth/login`;
const DASHBOARD_CREDS   = { username: 'admin', password: 'Admin@1234!' };

// Per-domain cooldown tracking (30 min)
const lastRefreshAt = {};
const REFRESH_COOLDOWN_MS = 30 * 60 * 1000;

function isAsset(url) {
  return ['.js','.css','.png','.ico','.woff','.svg'].some(ext => url.includes(ext));
}

// ── Listen on timetracker.photon.com ──
chrome.webRequest.onCompleted.addListener(
  async (details) => {
    if (details.statusCode !== 200 || isAsset(details.url)) return;
    const now = Date.now();
    if (now - (lastRefreshAt[TIMETRACKER_HOST] || 0) < REFRESH_COOLDOWN_MS) return;
    try { await refreshSession(TIMETRACKER_HOST, `${DASHBOARD_URL}/api/timesheet/photon/refresh-session`, 'Photon Timetracker'); }
    catch (err) { console.error('[Swami] timetracker refresh failed:', err.message); }
  },
  { urls: [`https://${TIMETRACKER_HOST}/*`] }
);

// ── Listen on photontrack.photon.com ──
chrome.webRequest.onCompleted.addListener(
  async (details) => {
    if (details.statusCode !== 200 || isAsset(details.url)) return;
    const now = Date.now();
    if (now - (lastRefreshAt[PHOTONTRACK_HOST] || 0) < REFRESH_COOLDOWN_MS) return;
    try { await refreshSession(PHOTONTRACK_HOST, `${DASHBOARD_URL}/api/tracking/refresh-session`, 'Photon Track'); }
    catch (err) { console.error('[Swami] photontrack refresh failed:', err.message); }
  },
  { urls: [`https://${PHOTONTRACK_HOST}/*`] }
);

async function refreshSession(host, apiUrl, label) {
  const cookies = await chrome.cookies.getAll({ domain: host });
  const hasMyCookie = cookies.some(c => c.name === 'myCookie');
  const hasShib     = cookies.some(c => c.name.startsWith('_shibsession_'));

  if (!hasMyCookie || !hasShib) {
    console.log(`[Swami] No valid session cookies on ${host} yet.`);
    return;
  }

  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  // Step 1: log in to get a dashboard session
  const loginResp = await fetch(DASHBOARD_LOGIN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(DASHBOARD_CREDS),
  });
  if (!loginResp.ok) { console.error(`[Swami] Dashboard login failed: ${loginResp.status}`); return; }

  const setCookie   = loginResp.headers.get('set-cookie') || '';
  const sidMatch    = setCookie.match(/connect\.sid=([^;]+)/);
  const sessionId   = sidMatch ? sidMatch[1] : '';

  // Step 2: save cookies to the correct backend service
  const saveResp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sessionId ? { Cookie: `connect.sid=${sessionId}` } : {}),
    },
    credentials: 'include',
    body: JSON.stringify({ cookie_header: cookieHeader }),
  });
  if (!saveResp.ok) { console.error(`[Swami] ${label} session save failed: ${saveResp.status}`); return; }

  lastRefreshAt[host] = Date.now();
  console.log(`[Swami] ✅ ${label} session refreshed`);

  chrome.notifications.create(`refresh-${host}`, {
    type: 'basic', iconUrl: 'icon48.png',
    title: 'Swami Dashboard',
    message: `${label} session refreshed ✅`,
  });
  setTimeout(() => chrome.notifications.clear(`refresh-${host}`), 4000);
}

// Listen for successful responses from timetracker.photon.com
chrome.webRequest.onCompleted.addListener(
  async (details) => {
    // Only process 200 responses to the main site (not static assets)
    if (details.statusCode !== 200) return;
    if (details.url.includes('.js') || details.url.includes('.css') ||
        details.url.includes('.png') || details.url.includes('.ico')) return;

    const now = Date.now();
    if (now - lastRefreshAt < REFRESH_COOLDOWN_MS) return;

    try {
      await refreshSession();
    } catch (err) {
      console.error('[Swami Extension] refresh failed:', err.message);
    }
  },
  { urls: [`https://${PHOTON_HOST}/*`] }
);

async function refreshSession() {
  // Read all cookies for the Photon domain
  const cookies = await chrome.cookies.getAll({ domain: PHOTON_HOST });

  const hasMyCookie = cookies.some(c => c.name === 'myCookie');
  const hasShib     = cookies.some(c => c.name.startsWith('_shibsession_'));

  if (!hasMyCookie || !hasShib) {
    console.log('[Swami Extension] No valid Photon session cookies yet — waiting for login.');
    return;
  }

  // Build the Cookie header string
  const cookieHeader = cookies
    .map(c => `${c.name}=${c.value}`)
    .join('; ');

  // Step 1: log into the dashboard to get a session cookie
  const loginResp = await fetch(DASHBOARD_LOGIN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(DASHBOARD_CREDS),
  });

  if (!loginResp.ok) {
    console.error('[Swami Extension] Dashboard login failed:', loginResp.status);
    return;
  }

  // Extract the session cookie from the login response
  const setCookie = loginResp.headers.get('set-cookie') || '';
  const sessionMatch = setCookie.match(/connect\.sid=([^;]+)/);
  const sessionId = sessionMatch ? sessionMatch[1] : '';

  // Step 2: save the Photon cookies to all three photon services
  const refreshResp = await fetch(DASHBOARD_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sessionId ? { Cookie: `connect.sid=${sessionId}` } : {}),
    },
    credentials: 'include',
    body: JSON.stringify({ cookie_header: cookieHeader }),
  });

  if (!refreshResp.ok) {
    console.error('[Swami Extension] Session refresh API failed:', refreshResp.status);
    return;
  }

  const result = await refreshResp.json();
  lastRefreshAt = Date.now();

  console.log(`[Swami Extension] ✅ Session refreshed for: ${result.services?.join(', ')}`);

  // Show a brief notification
  chrome.notifications.create('session-refresh', {
    type: 'basic',
    iconUrl: 'icon48.png',
    title: 'Swami Dashboard',
    message: `Photon session refreshed automatically ✅`,
  });

  // Auto-clear the notification after 4 seconds
  setTimeout(() => chrome.notifications.clear('session-refresh'), 4000);
}
