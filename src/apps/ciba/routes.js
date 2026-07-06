import { Router } from 'express';
import { appConfig, isConfigured, missingConfigMessage } from '../../config/pingone.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { initiateCiba, pollCibaAuthorizationOnce, createWorkerClient } from '../../lib/pingone-client.js';
import { getLab } from '../../lib/lab-meta.js';
import { summarizeTokenSet } from '../../lib/jwt-display.js';

const config = appConfig('CIBA');
const lab = getLab('ciba');

const router = Router();

router.get('/', (req, res) => {
  const configured = isConfigured(config.clientId);
  const ciba = req.session.ciba;
  res.render('ciba-lab', {
    lab,
    configured,
    configError: missingConfigMessage('ciba', config.clientId, config.tokenAuthMethod),
    tokenAuthMethod: config.tokenAuthMethod,
    authRequest: ciba?.authRequest || null,
    tokens: ciba?.tokens ? summarizeTokenSet(ciba.tokens) : null,
    status: ciba?.status || null,
    error: ciba?.error || null,
    hideTryIt: true,
  });
});

router.post('/initiate', asyncHandler(async (req, res) => {
  const { loginHint, bindingMessage } = req.body;
  if (!loginHint) {
    return res.status(400).render('error', {
      title: 'Missing login hint',
      message: 'Provide a login_hint (typically the user email or username in PingOne).',
      details: null,
    });
  }

  const response = await initiateCiba({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    loginHint,
    bindingMessage: bindingMessage || 'PingOne CIBA Lab',
    tokenAuthMethod: config.tokenAuthMethod,
  });

  req.session.ciba = {
    authRequest: {
      auth_req_id: response.auth_req_id,
      expires_in: response.expires_in,
      interval: response.interval,
      binding_message: bindingMessage,
      login_hint: loginHint,
    },
    status: 'pending',
  };
  res.redirect('/labs/ciba');
}));

router.post('/poll', asyncHandler(async (req, res) => {
  const ciba = req.session.ciba;
  if (!ciba?.authRequest?.auth_req_id) {
    return res.redirect('/labs/ciba');
  }

  const oauthClient = await createWorkerClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    tokenAuthMethod: config.tokenAuthMethod,
  });

  try {
    const result = await pollCibaAuthorizationOnce(oauthClient, ciba.authRequest.auth_req_id);
    if (result.status === 'complete') {
      req.session.ciba.tokens = result.tokens;
      req.session.ciba.status = 'complete';
      req.session.ciba.error = null;
    } else if (result.status === 'pending') {
      req.session.ciba.status = 'pending';
      if (result.slowDown) {
        req.session.ciba.authRequest.interval = Math.min((ciba.authRequest.interval || 2) + 2, 15);
      }
    } else {
      req.session.ciba.status = 'error';
      req.session.ciba.error = result.error;
    }
  } catch (err) {
    req.session.ciba.status = 'error';
    req.session.ciba.error = err.message;
  }
  res.redirect('/labs/ciba');
}));

router.post('/clear', (req, res) => {
  delete req.session.ciba;
  res.redirect('/labs/ciba');
});

export default router;
