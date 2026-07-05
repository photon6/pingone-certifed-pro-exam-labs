import { summarizeAccessToken } from '/js/jwt-display.js';

const TOKEN_KEY = 'api_access_bearer_token';
const app = document.getElementById('api-access-app');
const baseUrl = app.dataset.baseUrl;
const m2mConfigured = app.dataset.m2mConfigured === 'true';

const tokenStatus = document.getElementById('token-status');
const tokenPreview = document.getElementById('token-preview');
const tokenPreviewBody = document.getElementById('token-preview-body');
const bearerInput = document.getElementById('bearer-token');

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || bearerInput.value.trim();
}

function setToken(token, source) {
  sessionStorage.setItem(TOKEN_KEY, token);
  bearerInput.value = token;
  showTokenStatus(`Token saved (${source}).`, 'info');
  showTokenPreview(token);
}

function showTokenStatus(message, type = 'info') {
  tokenStatus.textContent = message;
  tokenStatus.className = `alert ${type}`;
  tokenStatus.classList.remove('hidden');
}

function showTokenPreview(token) {
  const decoded = summarizeAccessToken(token);
  tokenPreviewBody.textContent = JSON.stringify({
    token_preview: `${token.slice(0, 24)}...${token.slice(-12)}`,
    ...decoded,
  }, null, 2);
  tokenPreview.classList.remove('hidden');
}

function showResponse(elementId, status, body) {
  const el = document.getElementById(elementId);
  el.textContent = JSON.stringify({ http_status: status, ...body }, null, 2);
  el.classList.remove('hidden');
}

async function callApi(path, responseId, needsAuth = false) {
  const headers = { Accept: 'application/json' };
  if (needsAuth) {
    const token = getToken();
    if (!token) {
      showResponse(responseId, 0, {
        error: 'missing_token',
        message: 'Obtain or paste a bearer token in Step 1 first.',
      });
      return;
    }
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const res = await fetch(`${baseUrl}/labs/api-access${path}`, { headers });
    let body;
    try {
      body = await res.json();
    } catch {
      body = { error: 'invalid_json', message: await res.text() };
    }
    showResponse(responseId, res.status, body);
  } catch (err) {
    showResponse(responseId, 0, { error: 'network_error', message: err.message });
  }
}

async function getM2mToken() {
  const scope = document.getElementById('m2m-scope').value.trim() || 'openid';
  showTokenStatus('Requesting client credentials token...', 'info');
  const res = await fetch(`${baseUrl}/labs/api-access/demo-token/m2m`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ scope }),
  });
  const data = await res.json();
  if (!res.ok) {
    showTokenStatus(data.message || 'Failed to get M2M token', 'error');
    return;
  }
  setToken(data.access_token, `M2M / client_credentials (scope: ${data.scope || scope})`);
}

async function importSessionToken() {
  showTokenStatus('Importing token from server session...', 'info');
  const res = await fetch(`${baseUrl}/labs/api-access/demo-token/session`, {
    headers: { Accept: 'application/json' },
  });
  const data = await res.json();
  if (!res.ok) {
    showTokenStatus(data.message || 'No session token available', 'warn');
    return;
  }
  setToken(data.access_token, `session / ${data.source}`);
}

document.getElementById('btn-save-token')?.addEventListener('click', () => {
  const token = bearerInput.value.trim();
  if (!token) {
    showTokenStatus('Paste an access_token first.', 'warn');
    return;
  }
  setToken(token, 'manual paste');
});

document.getElementById('btn-get-m2m-token')?.addEventListener('click', () => {
  getM2mToken().catch((err) => showTokenStatus(err.message, 'error'));
});

document.getElementById('btn-session-token')?.addEventListener('click', () => {
  importSessionToken().catch((err) => showTokenStatus(err.message, 'error'));
});

document.querySelectorAll('[data-api-call]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const kind = btn.dataset.apiCall;
    if (kind === 'public') callApi('/api/public', 'response-public', false);
    if (kind === 'protected') callApi('/api/protected', 'response-protected', true);
    if (kind === 'scoped') callApi('/api/scoped', 'response-scoped', true);
  });
});

const stored = sessionStorage.getItem(TOKEN_KEY);
if (stored) {
  bearerInput.value = stored;
  showTokenPreview(stored);
  showTokenStatus('Restored bearer token from browser session.', 'info');
} else if (app.dataset.autoImport === 'true') {
  importSessionToken().catch(() => {});
} else if (app.dataset.sessionTokenSource) {
  showTokenStatus(`Tip: a token is available from the ${app.dataset.sessionTokenSource} lab — click Import Session Token.`, 'info');
}
