import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { pingoneConfig } from '../config/pingone.js';

let jwks;

function getJwks() {
  if (!jwks && pingoneConfig.issuer) {
    jwks = createRemoteJWKSet(new URL(`${pingoneConfig.issuer}/jwks`));
  }
  return jwks;
}

export async function validateBearerToken(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing_token', message: 'Authorization: Bearer <token> required' });
  }

  const token = header.slice(7);
  try {
    const jwtHeader = decodeProtectedHeader(token);
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: pingoneConfig.issuer,
    });
    req.jwtHeader = jwtHeader;
    req.tokenPayload = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'invalid_token', message: err.message });
  }
}
