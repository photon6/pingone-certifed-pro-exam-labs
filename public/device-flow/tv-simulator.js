const API_BASE = '/labs/device-flow/api';

let pollTimer = null;
let countdownTimer = null;
let lastPollInterval = null;
let state = null;

const els = {
  app: null,
  screen: null,
  statusLine: null,
  userCode: null,
  verificationUri: null,
  countdown: null,
  pollStatus: null,
  inspector: null,
  pollLog: null,
  tokenOutput: null,
  userOutput: null,
  errorBox: null,
  startBtn: null,
  resetBtn: null,
};

function $(id) {
  return document.getElementById(id);
}

function formatUserCode(code) {
  if (!code) return '— — — —';
  const clean = code.replace(/-/g, '');
  return clean.match(/.{1,4}/g)?.join(' ') || code;
}

function setScreen(name) {
  els.screen.dataset.screen = name;
}

function renderInspector() {
  if (!state || !els.inspector) return;

  const auth = state.authorization;
  const rows = [
    ['PingOne app type', 'Device Authorization (public client)'],
    ['Grant type', 'urn:ietf:params:oauth:grant-type:device_code'],
    ['Client ID', state.clientId || '—'],
    ['Scope', state.scope || '—'],
    ['Issuer', state.issuer || '—'],
    ['Device code', auth?.device_code ? `${auth.device_code.slice(0, 12)}…` : '—'],
    ['User code', auth?.user_code || '—'],
    ['Verification URI', auth?.verification_uri || '—'],
    ['Polling interval', `${state.currentInterval || 5}s`],
    ['Poll attempts', String(state.pollCount || 0)],
    ['Flow status', state.status || 'idle'],
  ];

  els.inspector.innerHTML = rows.map(([label, value]) => `
    <div class="inspector-row">
      <dt>${label}</dt>
      <dd>${label.includes('URI') || label === 'Issuer'
    ? `<code class="inspector-code">${value}</code>`
    : value}</dd>
    </div>
  `).join('');
}

function renderPollLog() {
  if (!els.pollLog) return;
  const entries = state?.pollLog || [];
  if (!entries.length) {
    els.pollLog.innerHTML = '<p class="hint">Token endpoint polls will appear here.</p>';
    return;
  }
  els.pollLog.innerHTML = entries.map((entry) => `
    <div class="poll-log-entry poll-log-${entry.event}">
      <span class="poll-log-time">${entry.at}</span>
      <span class="poll-log-event">${entry.event}</span>
      ${entry.detail ? `<span class="poll-log-detail">${entry.detail}</span>` : ''}
    </div>
  `).join('');
}

function updateCountdown() {
  if (!state?.authorization?.expires_at) {
    els.countdown.textContent = '';
    return;
  }
  const remaining = Math.max(0, state.authorization.expires_at - Math.floor(Date.now() / 1000));
  const mins = String(Math.floor(remaining / 60)).padStart(2, '0');
  const secs = String(remaining % 60).padStart(2, '0');
  els.countdown.textContent = `Code expires in ${mins}:${secs}`;

  if (remaining === 0 && state.status !== 'complete') {
    state.status = 'expired';
    state.error = 'Device code expired. Press OK on the remote to try again.';
    stopPolling();
    render();
  }
}

function renderTokens() {
  const show = state?.status === 'complete' && state.tokens;
  els.tokenOutput.closest('.device-flow-results')?.classList.toggle('hidden', !show);
  if (!show) return;
  els.tokenOutput.textContent = JSON.stringify(state.tokens, null, 2);
  els.userOutput.textContent = JSON.stringify(state.userinfo, null, 2);
}

function render() {
  renderInspector();
  renderPollLog();
  renderTokens();

  els.errorBox.classList.add('hidden');
  els.errorBox.textContent = '';

  switch (state?.status) {
    case null:
    case undefined:
      setScreen('welcome');
      els.statusLine.textContent = 'Press OK on your remote to sign in';
      els.startBtn.classList.remove('hidden');
      els.resetBtn.classList.add('hidden');
      break;

    case 'awaiting_user':
      setScreen('code');
      els.statusLine.textContent = 'On your phone or computer, approve this device';
      els.userCode.textContent = formatUserCode(state.authorization.user_code);
      els.verificationUri.href = state.authorization.verification_uri_complete || state.authorization.verification_uri;
      els.verificationUri.textContent = state.authorization.verification_uri;
      els.startBtn.classList.add('hidden');
      els.resetBtn.classList.remove('hidden');
      break;

    case 'polling':
      setScreen('waiting');
      els.statusLine.textContent = 'Waiting for you to enter the code on another device…';
      els.userCode.textContent = formatUserCode(state.authorization.user_code);
      els.pollStatus.textContent = `Polling token endpoint every ${state.currentInterval}s (attempt ${state.pollCount})`;
      els.startBtn.classList.add('hidden');
      els.resetBtn.classList.remove('hidden');
      break;

    case 'complete':
      setScreen('success');
      els.statusLine.textContent = `Welcome, ${state.userinfo?.name || state.userinfo?.preferred_username || 'viewer'}!`;
      els.pollStatus.textContent = 'Signed in successfully';
      stopPolling();
      els.startBtn.classList.add('hidden');
      els.resetBtn.classList.remove('hidden');
      break;

    case 'expired':
    case 'error':
      setScreen('error');
      els.statusLine.textContent = 'Unable to sign in';
      els.errorBox.textContent = state.error || 'Something went wrong.';
      els.errorBox.classList.remove('hidden');
      stopPolling();
      els.startBtn.classList.add('hidden');
      els.resetBtn.classList.remove('hidden');
      break;

    default:
      break;
  }

  updateCountdown();
  syncPolling();
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  lastPollInterval = null;
}

function syncPolling() {
  if (state?.status !== 'awaiting_user' && state?.status !== 'polling') {
    stopPolling();
    return;
  }

  const interval = state.currentInterval || 5;
  if (pollTimer && lastPollInterval === interval) return;

  stopPolling();
  lastPollInterval = interval;
  pollTimer = setInterval(() => {
    pollOnce().catch(handlePollError);
  }, interval * 1000);
}

function handlePollError(err) {
  state = { ...state, status: 'error', error: err.message };
  render();
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text.replace(/<[^>]+>/g, ' ').trim().slice(0, 240) || `Request failed (${response.status})`);
  }
}

async function pollOnce() {
  const response = await fetch(`${API_BASE}/poll`, { method: 'POST' });
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(data.error || 'Poll failed');
  }
  state = data;
  render();
}

async function startFlow() {
  setScreen('loading');
  els.statusLine.textContent = 'Contacting PingOne device authorization endpoint…';
  els.startBtn.disabled = true;

  try {
    const response = await fetch(`${API_BASE}/start`, { method: 'POST' });
    const data = await readJson(response);
    if (!response.ok) {
      throw new Error(data.error || 'Failed to start device flow');
    }
    state = data;
    render();
    pollOnce().catch(handlePollError);
  } catch (err) {
    state = { status: 'error', error: err.message };
    render();
  } finally {
    els.startBtn.disabled = false;
  }
}

async function resetFlow() {
  stopPolling();
  await fetch(`${API_BASE}/reset`, { method: 'POST' });
  state = { status: null };
  render();
}

async function loadStatus() {
  const response = await fetch(`${API_BASE}/status`);
  state = await readJson(response);
  render();
}

function bindElements() {
  els.app = $('device-flow-app');
  els.screen = $('tv-screen');
  els.statusLine = $('tv-status-line');
  els.userCode = $('tv-user-code');
  els.verificationUri = $('tv-verification-uri');
  els.countdown = $('tv-countdown');
  els.pollStatus = $('tv-poll-status');
  els.inspector = $('oauth-inspector');
  els.pollLog = $('poll-log');
  els.tokenOutput = $('device-token-output');
  els.userOutput = $('device-user-output');
  els.errorBox = $('tv-error');
  els.startBtn = $('tv-start');
  els.resetBtn = $('tv-reset');
}

function init() {
  bindElements();
  if (!els.app) return;

  els.startBtn.addEventListener('click', startFlow);
  els.resetBtn.addEventListener('click', resetFlow);

  countdownTimer = setInterval(updateCountdown, 1000);
  loadStatus();
}

init();
