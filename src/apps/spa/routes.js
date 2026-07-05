import { Router } from 'express';
import { appConfig, isConfigured, missingConfigMessage, pingoneConfig } from '../../config/pingone.js';
import { getLab } from '../../lib/lab-meta.js';

const config = appConfig('SPA', { path: '/labs/spa' });
const lab = getLab('spa');

const router = Router();

function renderSpaLab(req, res) {
  const configured = isConfigured(config.clientId);
  res.render('spa-lab', {
    lab,
    configured,
    configError: missingConfigMessage('SPA', config.clientId),
    redirectUri: config.redirectUri,
    clientId: config.clientId,
    issuer: pingoneConfig.issuer,
    authHost: pingoneConfig.authHost,
    environmentId: pingoneConfig.environmentId,
    hideTryIt: true,
  });
}

router.get('/', renderSpaLab);
router.get('/callback', renderSpaLab);

export default router;
