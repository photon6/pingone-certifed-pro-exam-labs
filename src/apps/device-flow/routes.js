import { Router } from 'express';
import { appConfig, isConfigured, missingConfigMessage } from '../../config/pingone.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { deviceAuthorization, pollDeviceToken, createPublicClient } from '../../lib/pingone-client.js';
import { getLab } from '../../lib/lab-meta.js';

const config = appConfig('DEVICE_FLOW');
const lab = getLab('device-flow');

const router = Router();

router.get('/', (req, res) => {
  const configured = isConfigured(config.clientId);
  const device = req.session.deviceFlow;
  res.render('device-flow-lab', {
    lab,
    configured,
    configError: missingConfigMessage('DEVICE_FLOW', config.clientId),
    device: device?.authorization || null,
    tokens: device?.tokens ? summarizeTokens(device.tokens) : null,
    status: device?.status || null,
    error: device?.error || null,
    hideTryIt: true,
  });
});

router.post('/start', asyncHandler(async (req, res) => {
  const response = await deviceAuthorization({
    clientId: config.clientId,
    scope: 'openid profile',
  });

  req.session.deviceFlow = {
    authorization: {
      device_code: response.device_code,
      user_code: response.user_code,
      verification_uri: response.verification_uri,
      verification_uri_complete: response.verification_uri_complete,
      expires_in: response.expires_in,
      interval: response.interval,
    },
    oauthClientConfig: { clientId: config.clientId },
    status: 'pending',
  };
  res.redirect('/labs/device-flow');
}));

router.post('/poll', asyncHandler(async (req, res) => {
  const device = req.session.deviceFlow;
  if (!device?.authorization?.device_code) {
    return res.redirect('/labs/device-flow');
  }

  const oauthClient = await createPublicClient({ clientId: config.clientId, redirectUri: 'urn:ietf:wg:oauth:2.0:oob' });

  try {
    const tokenSet = await pollDeviceToken(
      oauthClient,
      device.authorization.device_code,
      device.authorization.interval || 5,
    );
    req.session.deviceFlow.tokens = tokenSet;
    req.session.deviceFlow.status = 'complete';
    req.session.deviceFlow.error = null;
  } catch (err) {
    req.session.deviceFlow.status = 'error';
    req.session.deviceFlow.error = err.message;
  }
  res.redirect('/labs/device-flow');
}));

router.post('/clear', (req, res) => {
  delete req.session.deviceFlow;
  res.redirect('/labs/device-flow');
});

function summarizeTokens(tokens) {
  return {
    token_type: tokens.token_type,
    expires_in: tokens.expires_in,
    scope: tokens.scope,
    has_access_token: Boolean(tokens.access_token),
    has_id_token: Boolean(tokens.id_token),
  };
}

export default router;
