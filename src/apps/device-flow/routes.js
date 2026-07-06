import { Router } from 'express';
import { appConfig, isConfigured, missingConfigMessage, pingoneConfig } from '../../config/pingone.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import {
  createDeviceFlowClient,
  deviceAuthorization,
  pollDeviceAuthorizationOnce,
} from '../../lib/pingone-client.js';
import { getLab } from '../../lib/lab-meta.js';
import { summarizeTokenSet } from '../../lib/jwt-display.js';

const config = appConfig('DEVICE_FLOW', {
  path: '/labs/device-flow',
  defaultTokenAuthMethod: 'none',
});
const lab = getLab('device-flow');
const SCOPE = 'openid profile';

const PINGONE_SETUP_STEPS = [
  'Go to <strong>Applications → Applications</strong> and click <strong>+</strong>. Name the app and choose type <strong>Device Authorization</strong>. That single step creates the app <em>and</em> enables the Device Authorization grant — you do not enable the grant separately.',
  'On the <strong>Configuration</strong> tab, set Token Endpoint Authentication Method to <strong>None</strong> (recommended for this lab). If you use Private Key JWT instead, register the lab JWKS in PingOne and set <code>DEVICE_FLOW_TOKEN_AUTH_METHOD=private_key_jwt</code> in <code>.env</code>. The PingOne setting and <code>.env</code> must match.',
  'On the <strong>Resources</strong> tab, select scopes <code>openid</code> and <code>profile</code> (Resources → pencil icon → check scopes → Save).',
  'Enable the application (blue toggle at the top of the details panel).',
  'Copy the <strong>Client ID</strong> from the Configuration tab into <code>DEVICE_FLOW_CLIENT_ID</code> in your <code>.env</code> file. No client secret is needed.',
  '<strong>Only if “Device Authorization” is missing from the type list:</strong> create a <strong>Native App</strong>, open Configuration, and under Grant Type enable <strong>Device Authorization</strong> (this is the manual “enable grant” step). Set Token Endpoint Authentication Method to <strong>None</strong>.',
];

const router = Router();

function emptyDeviceFlow() {
  return {
    authorization: null,
    status: null,
    pollCount: 0,
    currentInterval: 5,
    pollLog: [],
    tokens: null,
    userinfo: null,
    error: null,
  };
}

function getDeviceFlowSession(req) {
  if (!req.session.deviceFlow) {
    req.session.deviceFlow = emptyDeviceFlow();
  }
  return req.session.deviceFlow;
}

function isExpired(authorization) {
  if (!authorization?.expires_at) return false;
  return Math.floor(Date.now() / 1000) >= authorization.expires_at;
}

function publicDeviceState(deviceFlow) {
  const authorization = deviceFlow.authorization
    ? {
        ...deviceFlow.authorization,
        expires_in: Math.max(0, deviceFlow.authorization.expires_at - Math.floor(Date.now() / 1000)),
      }
    : null;

  return {
    authorization,
    status: deviceFlow.status,
    pollCount: deviceFlow.pollCount,
    currentInterval: deviceFlow.currentInterval,
    pollLog: deviceFlow.pollLog,
    tokens: deviceFlow.tokens ? summarizeTokenSet(deviceFlow.tokens) : null,
    userinfo: deviceFlow.userinfo,
    error: deviceFlow.error,
    scope: SCOPE,
    clientId: config.clientId,
    issuer: pingoneConfig.issuer,
  };
}

function formatApiError(err) {
  if (err.error_description) {
    return `${err.error}: ${err.error_description}`;
  }
  if (err.error) {
    return String(err.error);
  }
  return err.message || 'An unexpected error occurred';
}

function apiAsyncHandler(fn) {
  return asyncHandler(async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      console.error(err);
      res.status(err.status || 500).json({ error: formatApiError(err) });
    }
  });
}

async function startDeviceFlow(req) {
  const response = await deviceAuthorization({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    scope: SCOPE,
    tokenAuthMethod: config.tokenAuthMethod,
  });

  req.session.deviceFlow = {
    ...emptyDeviceFlow(),
    authorization: response,
    status: 'awaiting_user',
    currentInterval: response.interval || 5,
    pollLog: [{ at: new Date().toISOString(), event: 'device_authorization', detail: 'Device codes issued' }],
  };

  return req.session.deviceFlow;
}

async function pollDeviceFlow(req) {
  const deviceFlow = getDeviceFlowSession(req);
  const { authorization } = deviceFlow;

  if (!authorization?.device_code) {
    const err = new Error('No active device authorization session');
    err.status = 400;
    throw err;
  }

  if (isExpired(authorization)) {
    deviceFlow.status = 'expired';
    deviceFlow.error = 'Device code expired before the user completed authorization.';
    deviceFlow.pollLog.push({ at: new Date().toISOString(), event: 'expired' });
    return deviceFlow;
  }

  const oauthClient = await createDeviceFlowClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    tokenAuthMethod: config.tokenAuthMethod,
  });
  const result = await pollDeviceAuthorizationOnce(oauthClient, authorization.device_code);
  deviceFlow.pollCount += 1;

  if (result.slowDown) {
    deviceFlow.currentInterval = Math.min(deviceFlow.currentInterval + 5, 60);
    deviceFlow.pollLog.push({
      at: new Date().toISOString(),
      event: 'slow_down',
      detail: `Polling interval increased to ${deviceFlow.currentInterval}s`,
    });
    deviceFlow.status = 'polling';
    return deviceFlow;
  }

  if (result.status === 'pending') {
    deviceFlow.status = 'polling';
    deviceFlow.pollLog.push({
      at: new Date().toISOString(),
      event: 'authorization_pending',
      detail: `Poll #${deviceFlow.pollCount}`,
    });
    return deviceFlow;
  }

  if (result.status === 'expired') {
    deviceFlow.status = 'expired';
    deviceFlow.error = result.error;
    deviceFlow.pollLog.push({ at: new Date().toISOString(), event: 'expired', detail: result.error });
    return deviceFlow;
  }

  const userinfo = await oauthClient.userinfo(result.tokens.access_token);
  deviceFlow.tokens = result.tokens;
  deviceFlow.userinfo = userinfo;
  deviceFlow.status = 'complete';
  deviceFlow.error = null;
  deviceFlow.pollLog.push({
    at: new Date().toISOString(),
    event: 'token_response',
    detail: 'Access token received',
  });
  return deviceFlow;
}

router.get('/', (req, res) => {
  const configured = isConfigured(config.clientId);
  const deviceFlow = req.session.deviceFlow || emptyDeviceFlow();
  res.render('device-flow-lab', {
    lab,
    configured,
    configError: missingConfigMessage('DEVICE_FLOW', config.clientId, config.tokenAuthMethod),
    clientId: config.clientId,
    issuer: pingoneConfig.issuer,
    authHost: pingoneConfig.authHost,
    environmentId: pingoneConfig.environmentId,
    deviceState: publicDeviceState(deviceFlow),
    hideTryIt: true,
    tokenAuthMethod: config.tokenAuthMethod,
    pingoneSetupSteps: PINGONE_SETUP_STEPS,
  });
});

router.post('/start', asyncHandler(async (req, res) => {
  await startDeviceFlow(req);
  res.redirect('/labs/device-flow');
}));

router.post('/poll', asyncHandler(async (req, res) => {
  await pollDeviceFlow(req);
  res.redirect('/labs/device-flow');
}));

router.post('/clear', (req, res) => {
  delete req.session.deviceFlow;
  res.redirect('/labs/device-flow');
});

router.post('/api/start', apiAsyncHandler(async (req, res) => {
  if (!isConfigured(config.clientId)) {
    return res.status(400).json({ error: missingConfigMessage('DEVICE_FLOW', config.clientId, config.tokenAuthMethod) });
  }
  const deviceFlow = await startDeviceFlow(req);
  res.json(publicDeviceState(deviceFlow));
}));

router.post('/api/poll', apiAsyncHandler(async (req, res) => {
  const deviceFlow = await pollDeviceFlow(req);
  res.json(publicDeviceState(deviceFlow));
}));

router.get('/api/status', (req, res) => {
  const deviceFlow = req.session.deviceFlow || emptyDeviceFlow();
  if (deviceFlow.authorization && isExpired(deviceFlow.authorization) && deviceFlow.status !== 'complete') {
    deviceFlow.status = 'expired';
    deviceFlow.error = 'Device code expired before the user completed authorization.';
  }
  res.json(publicDeviceState(deviceFlow));
});

router.post('/api/reset', (req, res) => {
  delete req.session.deviceFlow;
  res.json(publicDeviceState(emptyDeviceFlow()));
});

export default router;
