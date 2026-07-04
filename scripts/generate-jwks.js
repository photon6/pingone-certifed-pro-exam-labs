import { getJwksSetupInfo, getPublicJwks } from '../src/lib/jwks.js';

const jwksSetup = await getJwksSetupInfo();
const publicJwks = await getPublicJwks();

console.log('JWKS generated/loaded successfully.\n');
console.log('JWKS URL (register in PingOne):');
console.log(jwksSetup.jwksUrl);
console.log('\nPublic JWKS (paste inline in PingOne):');
console.log(jwksSetup.jwksInlinePretty);
console.log('\nEscaped for PingOne API jwks property:');
console.log(jwksSetup.jwksInlineEscaped);
console.log('\nVerify keys array:');
console.log(JSON.stringify(publicJwks, null, 2));
