import { Router } from 'express';
import { appConfig, isConfigured, missingConfigMessage } from '../../config/pingone.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { initiateCiba, pollCibaToken, createConfidentialClient } from '../../lib/pingone-client.js';
import { getLab } from '../../lib/lab-meta.js';

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
    tokens: ciba?.tokens ? summarizeTokens(ciba.tokens) : null,
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

  const oauthClient = await createConfidentialClient({
    ...config,
    redirectUri: `${config.redirectUri || 'http://localhost'}/labs/ciba/callback`,
  });

  try {
    const tokenSet = await pollCibaToken(
      oauthClient,
      ciba.authRequest.auth_req_id,
      ciba.authRequest.interval || 2,
    );
    req.session.ciba.tokens = tokenSet;
    req.session.ciba.status = 'complete';
    req.session.ciba.error = null;
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
