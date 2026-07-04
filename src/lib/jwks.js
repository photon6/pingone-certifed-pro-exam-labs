import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateKeyPair, exportJWK, importJWK, importPKCS8, SignJWT } from 'jose';
import { pingoneConfig } from '../config/pingone.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_KEY_DIR = path.join(__dirname, '../../.keys');
const DEFAULT_KEY_FILE = path.join(DEFAULT_KEY_DIR, 'lab-jwks.json');
const SUPPORTED_ALGS = ['RS256', 'RS384', 'RS512'];

let keyMaterialPromise;

function resolveKeyFilePath() {
  return process.env.JWKS_KEY_FILE || DEFAULT_KEY_FILE;
}

function readPemFromEnv() {
  const pem = process.env.JWKS_PRIVATE_KEY_PEM;
  if (!pem) return null;
  return pem.replace(/\\n/g, '\n');
}

function readPemFromPath() {
  const keyPath = process.env.JWKS_PRIVATE_KEY_PATH;
  if (!keyPath) return null;
  const resolved = path.isAbsolute(keyPath) ? keyPath : path.join(process.cwd(), keyPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`JWKS private key file not found: ${resolved}`);
  }
  return fs.readFileSync(resolved, 'utf8');
}

async function buildKeyMaterialFromPem(pem) {
  const alg = (process.env.JWKS_SIGNING_ALG || 'RS256').toUpperCase();
  if (!SUPPORTED_ALGS.includes(alg)) {
    throw new Error(`Unsupported JWKS_SIGNING_ALG ${alg}. Use RS256, RS384, or RS512.`);
  }

  const privateKey = await importPKCS8(pem, alg);
  const publicKey = crypto.createPublicKey(pem);
  const privateJwk = await exportJWK(privateKey);
  const publicJwk = await exportJWK(publicKey);
  const kid = process.env.JWKS_KEY_ID || crypto.randomUUID();

  for (const jwk of [privateJwk, publicJwk]) {
    jwk.kid = kid;
    jwk.alg = alg;
    jwk.use = 'sig';
  }

  return { privateJwk, publicJwk, signingAlg: alg, kid, source: 'env' };
}

async function generateAndPersistKeyMaterial() {
  const alg = (process.env.JWKS_SIGNING_ALG || 'RS256').toUpperCase();
  const hash = alg === 'RS256' ? 'SHA-256' : alg === 'RS384' ? 'SHA-384' : 'SHA-512';
  const { publicKey, privateKey } = await generateKeyPair('RS256', {
    modulusLength: 2048,
    extractable: true,
  });

  const kid = process.env.JWKS_KEY_ID || crypto.randomUUID();
  const privateJwk = await exportJWK(privateKey);
  const publicJwk = await exportJWK(publicKey);

  for (const jwk of [privateJwk, publicJwk]) {
    jwk.kid = kid;
    jwk.alg = alg;
    jwk.use = 'sig';
  }

  const keyFile = resolveKeyFilePath();
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  fs.writeFileSync(keyFile, JSON.stringify({ privateJwk, publicJwk, signingAlg: alg, kid }, null, 2));

  return { privateJwk, publicJwk, signingAlg: alg, kid, source: keyFile };
}

async function loadKeyMaterial() {
  const pem = readPemFromEnv() || readPemFromPath();
  if (pem) {
    return buildKeyMaterialFromPem(pem);
  }

  const keyFile = resolveKeyFilePath();
  if (fs.existsSync(keyFile)) {
    const stored = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    return { ...stored, source: keyFile };
  }

  return generateAndPersistKeyMaterial();
}

export async function getKeyMaterial() {
  if (!keyMaterialPromise) {
    keyMaterialPromise = loadKeyMaterial().catch((err) => {
      keyMaterialPromise = null;
      throw err;
    });
  }
  return keyMaterialPromise;
}

export async function getPublicJwks() {
  const { publicJwk } = await getKeyMaterial();
  return { keys: [publicJwk] };
}

export async function getPrivateJwksForClient() {
  const { privateJwk } = await getKeyMaterial();
  return { keys: [privateJwk] };
}

export async function getJwksSetupInfo() {
  const { publicJwk, signingAlg, kid, source } = await getKeyMaterial();
  const publicJwks = { keys: [publicJwk] };
  const jwksUrl = `${pingoneConfig.baseUrl}/jwks`;
  const httpsRequired = !jwksUrl.startsWith('https://');

  return {
    configured: true,
    jwksUrl,
    jwksInline: JSON.stringify(publicJwks),
    jwksInlinePretty: JSON.stringify(publicJwks, null, 2),
    jwksInlineEscaped: JSON.stringify(JSON.stringify(publicJwks)),
    signingAlg,
    kid,
    supportedAlgs: SUPPORTED_ALGS,
    keySource: source,
    httpsRequiredForUrl: httpsRequired,
    pingoneNotes: [
      'Set Token Endpoint Authentication Method to Private Key JWT when using asymmetric client auth.',
      'Register the public key in PingOne using either JWKS URL or paste the JWKS JSON inline.',
      'The same JWKS validates RS256/RS384/RS512 signed request objects on the authorize endpoint.',
    ],
  };
}

export async function signRequestObject(params, clientId) {
  const { privateJwk, signingAlg } = await getKeyMaterial();
  const key = await importJWK(privateJwk, signingAlg);

  const claims = {
    ...params,
    iss: params.iss || clientId,
    aud: params.aud || pingoneConfig.issuer,
  };

  return new SignJWT(claims)
    .setProtectedHeader({ alg: signingAlg, kid: privateJwk.kid })
    .setIssuedAt()
    .setExpirationTime('5m')
    .setJti(crypto.randomUUID())
    .sign(key);
}

export function normalizeTokenAuthMethod(method) {
  const value = (method || 'client_secret_basic').toLowerCase().replace(/-/g, '_');
  const map = {
    client_secret_basic: 'client_secret_basic',
    basic: 'client_secret_basic',
    client_secret_post: 'client_secret_post',
    post: 'client_secret_post',
    private_key_jwt: 'private_key_jwt',
    privatekeyjwt: 'private_key_jwt',
    none: 'none',
  };
  return map[value] || 'client_secret_basic';
}

export function usesPrivateKeyJwt(method) {
  return normalizeTokenAuthMethod(method) === 'private_key_jwt';
}
