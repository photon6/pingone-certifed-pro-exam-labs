import { Router } from 'express';
import { cibaAppConfig, cibaMissingConfigMessage, isConfigured } from '../../config/pingone.js';
import { asyncHandler } from '../../middleware/error-handler.js';
import { initiateCiba, pollCibaAuthorizationOnce, createWorkerClient } from '../../lib/pingone-client.js';
import { getLab } from '../../lib/lab-meta.js';
import { summarizeTokenSet } from '../../lib/jwt-display.js';
import { bindingMessageHint, normalizeBindingMessage } from '../../lib/ciba.js';

const config = cibaAppConfig();
const lab = getLab('ciba');

const PINGONE_SETUP_STEPS = [
  'Create an <strong>OIDC Web App</strong> with Grant Type <strong>CIBA</strong> only (clear other grants/response types).',
  'On the app <strong>Policies</strong> tab → <strong>DaVinci Policies</strong>, assign your CIBA DaVinci flow policy (required — PingOne cannot run CIBA without a DaVinci P1/CIBA flow).',
  'In DaVinci: import/configure a CIBA flow (Ping Identity Marketplace sample), enable <strong>PingOne Flow</strong> + <strong>CIBA Flow</strong>, deploy, and create a <strong>PingOne Flow Policy</strong> pointing at that flow. Copy the flow policy ID into <code>CIBA_DAVINCI_POLICY_ID</code> in <code>.env</code> (sent as <code>acr_values</code>).',
  'Set <code>CIBA_DAVINCI_CONSOLE_URL</code> if your DaVinci admin URL differs from the default console link shown below.',
  'Copy Client ID and Secret (or configure Private Key JWT) into <code>.env</code>. Set <code>CIBA_TOKEN_AUTH_METHOD</code> to match the app\'s Token Endpoint Authentication Method.',
  '<code>binding_message</code> is optional but must be <strong>1–8 characters</strong>, alphanumeric plus <code>-</code> or <code>_</code> only (no spaces). Default in this lab: <code>PingLab</code>.',
];

const router = Router();

router.get('/', (req, res) => {
  const configured = isConfigured(config.clientId) && Boolean(config.davinciPolicyId);
  const ciba = req.session.ciba;
  res.render('ciba-lab', {
    lab,
    configured,
    configError: cibaMissingConfigMessage(config),
    tokenAuthMethod: config.tokenAuthMethod,
    davinciPolicyId: config.davinciPolicyId,
    davinciConsoleUrl: config.davinciConsoleUrl,
    defaultBindingMessage: config.defaultBindingMessage,
    bindingMessageHint: bindingMessageHint(),
    authRequest: ciba?.authRequest || null,
    tokens: ciba?.tokens ? summarizeTokenSet(ciba.tokens) : null,
    status: ciba?.status || null,
    error: ciba?.error || null,
    hideTryIt: true,
    pingoneSetupSteps: PINGONE_SETUP_STEPS,
  });
});

router.post('/initiate', asyncHandler(async (req, res) => {
  const { loginHint, bindingMessage, acrValues } = req.body;

  if (!loginHint?.trim()) {
    return res.status(400).render('error', {
      title: 'Missing login hint',
      message: 'Provide a login_hint (typically the user email or username in PingOne).',
      details: null,
    });
  }

  const policyId = (acrValues || config.davinciPolicyId || '').trim();
  if (!policyId) {
    return res.status(400).render('error', {
      title: 'Missing DaVinci policy',
      message: 'CIBA requires a DaVinci flow policy ID (acr_values). Set CIBA_DAVINCI_POLICY_ID in .env or enter it in the form.',
      details: null,
    });
  }

  let normalizedBinding;
  try {
    normalizedBinding = normalizeBindingMessage(bindingMessage, config.defaultBindingMessage);
  } catch (err) {
    return res.status(400).render('error', {
      title: 'Invalid binding message',
      message: err.message,
      details: bindingMessageHint(),
    });
  }

  const response = await initiateCiba({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    loginHint: loginHint.trim(),
    bindingMessage: normalizedBinding,
    acrValues: policyId,
    tokenAuthMethod: config.tokenAuthMethod,
  });

  req.session.ciba = {
    authRequest: {
      auth_req_id: response.auth_req_id,
      expires_in: response.expires_in,
      interval: response.interval,
      binding_message: normalizedBinding,
      login_hint: loginHint.trim(),
      acr_values: policyId,
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
