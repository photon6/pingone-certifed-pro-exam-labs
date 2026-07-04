function base64UrlEncode(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  let str = btoa(String.fromCharCode(...bytes));
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(length = 32) {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

async function sha256(input) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(hash);
}

const app = document.getElementById('spa-app');
const statusEl = document.getElementById('spa-status');
const actionsEl = document.getElementById('spa-actions');
const loginBtn = document.getElementById('spa-login');
const logoutBtn = document.getElementById('spa-logout');
const outputEl = document.getElementById('spa-output');

const clientId = app.dataset.clientId;
const redirectUri = app.dataset.redirectUri;
const issuer = app.dataset.issuer;

const PKCE_KEY = 'spa_pkce';
const TOKEN_KEY = 'spa_tokens';

function showStatus(message, type = 'info') {
  statusEl.className = `alert ${type}`;
  statusEl.textContent = message;
}

function showOutput(data) {
  outputEl.classList.remove('hidden');
  outputEl.textContent = JSON.stringify(data, null, 2);
}

async function discoverEndpoints() {
  const res = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error('Failed to discover OIDC configuration');
  return res.json();
}

async function startLogin() {
  const config = await discoverEndpoints();
  const state = randomString(16);
  const nonce = randomString(16);
  const codeVerifier = randomString(48);
  const codeChallenge = await sha256(codeVerifier);

  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ state, nonce, codeVerifier }));

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid profile',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  window.location.href = `${config.authorization_endpoint}?${params}`;
}

async function handleCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');

  if (error) {
    showStatus(`OAuth error: ${error} — ${params.get('error_description') || ''}`, 'error');
    actionsEl.classList.remove('hidden');
    return;
  }

  if (!code) return false;

  const stored = JSON.parse(sessionStorage.getItem(PKCE_KEY) || '{}');
  if (state !== stored.state) {
    showStatus('State mismatch — possible CSRF.', 'error');
    return true;
  }

  const config = await discoverEndpoints();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: stored.code_verifier,
  });

  const tokenRes = await fetch(config.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    showStatus(`Token exchange failed: ${err}`, 'error');
    return true;
  }

  const tokens = await tokenRes.json();
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
  sessionStorage.removeItem(PKCE_KEY);
  window.history.replaceState({}, '', window.location.pathname);

  renderLoggedIn(tokens);
  return true;
}

async function renderLoggedIn(tokens) {
  showStatus('Signed in via SPA PKCE flow.', 'info');
  actionsEl.classList.remove('hidden');
  loginBtn.classList.add('hidden');
  logoutBtn.classList.remove('hidden');

  const config = await discoverEndpoints();
  let userinfo = null;
  if (tokens.access_token) {
    const res = await fetch(config.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (res.ok) userinfo = await res.json();
  }

  showOutput({
    token_summary: {
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
      scope: tokens.scope,
      has_id_token: Boolean(tokens.id_token),
    },
    userinfo,
  });
}

function logout() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(PKCE_KEY);
  outputEl.classList.add('hidden');
  loginBtn.classList.remove('hidden');
  logoutBtn.classList.add('hidden');
  showStatus('Signed out. Tokens cleared from sessionStorage.', 'info');
}

async function init() {
  if (!clientId || !issuer) {
    showStatus('Configure SPA_CLIENT_ID and PINGONE_ENVIRONMENT_ID in .env', 'warn');
    return;
  }

  actionsEl.classList.remove('hidden');

  const handled = await handleCallback();
  if (handled) return;

  const stored = sessionStorage.getItem(TOKEN_KEY);
  if (stored) {
    await renderLoggedIn(JSON.parse(stored));
    return;
  }

  showStatus('Ready — click Sign in to start Authorization Code + PKCE in the browser.', 'info');
}

loginBtn.addEventListener('click', () => startLogin().catch((e) => showStatus(e.message, 'error')));
logoutBtn.addEventListener('click', logout);
init().catch((e) => showStatus(e.message, 'error'));
