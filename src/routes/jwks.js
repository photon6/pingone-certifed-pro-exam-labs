import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler.js';
import { getPublicJwks, getJwksSetupInfo } from '../lib/jwks.js';

const router = Router();

router.get('/jwks', asyncHandler(async (req, res) => {
  const jwks = await getPublicJwks();
  res.set('Cache-Control', 'public, max-age=3600');
  res.json(jwks);
}));

router.get('/jwks/setup', asyncHandler(async (req, res) => {
  const jwksSetup = await getJwksSetupInfo();
  res.render('jwks-setup', {
    title: 'JWKS Setup',
    activeNav: 'oidc-labs',
    jwksSetup,
  });
}));

export default router;
