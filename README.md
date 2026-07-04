# PingOne Certified Pro Exam Labs

Hands-on lab utilities for studying PingOne OAuth 2.0 and OpenID Connect integration patterns. Each lab maps to a **PingOne application type** and grant flow you will encounter on the Certified Professional exam.

## Quick start

```bash
cp .env.example .env
# Edit .env with your PingOne environment ID and client credentials

npm install
npm start
npm stop   # graceful shutdown; force-kills if needed after 10s
```

Open [http://localhost:3000](http://localhost:3000) for the study dashboard. Select **OIDC/OAuth Exam Labs** from the menu to access the integration labs.

## Labs

| Lab | PingOne App Type | Grant / Pattern |
|-----|------------------|-----------------|
| [User Authentication](/labs/web-auth) | Web App (OIDC) | Authorization Code (confidential) |
| [Mobile Support](/labs/mobile) | Native App | Authorization Code + PKCE |
| [Single Page Application](/labs/spa) | Single Page App | Authorization Code + PKCE (browser) |
| [API Access](/labs/api-access) | Worker / Resource Server | Bearer JWT validation |
| [Long-Running Sessions](/labs/long-session) | Web App (OIDC) | Authorization Code + Refresh Token |
| [Machine-to-Machine](/labs/m2m) | Worker App | Client Credentials |
| [Device Flow](/labs/device-flow) | Device App | RFC 8628 Device Authorization |
| [CIBA](/labs/ciba) | Web App with CIBA | Client Initiated Backchannel Authentication |
| [Token Exchange](/labs/token-exchange) | Worker App | RFC 8693 Token Exchange |
| [Enhanced Security](/labs/enhanced-security) | Web App (OIDC) | PAR, PKCE, step-up (`acr_values`) |

## PingOne setup (per lab)

1. Sign in to the [PingOne admin console](https://admin.pingone.com).
2. For each lab, create an application using the **PingOne App Type** shown on the lab page.
3. Configure the **redirect URI** exactly as shown (where applicable).
4. Enable the required **grant type** and scopes.
5. Copy the Client ID (and Client Secret for confidential clients) into your `.env` file.

### Environment variables

| Variable | Description |
|----------|-------------|
| `PINGONE_ENVIRONMENT_ID` | Your PingOne environment UUID |
| `PINGONE_REGION` | `NA`, `EU`, `AP`, or `CA` |
| `BASE_URL` | Public URL of this app (default `http://localhost:3000`) |
| `WEB_AUTH_CLIENT_ID` / `SECRET` | User authentication lab |
| `MOBILE_CLIENT_ID` | Mobile / native app lab |
| `SPA_CLIENT_ID` | SPA lab |
| `API_ACCESS_CLIENT_ID` / `SECRET` | API access lab |
| `LONG_SESSION_CLIENT_ID` / `SECRET` | Long-running sessions lab |
| `M2M_CLIENT_ID` / `SECRET` | Machine-to-machine lab |
| `DEVICE_FLOW_CLIENT_ID` | Device flow lab |
| `CIBA_CLIENT_ID` / `SECRET` | CIBA lab |
| `TOKEN_EXCHANGE_CLIENT_ID` / `SECRET` | Token exchange lab |
| `ENHANCED_SECURITY_CLIENT_ID` / `SECRET` | Enhanced security lab |
| `PINGONE_TOKEN_AUTH_METHOD` | Global default: `client_secret_basic`, `client_secret_post`, or `private_key_jwt` |
| `WEB_AUTH_TOKEN_AUTH_METHOD` | Per-lab override (same options) |
| JWKS | Auto-generated in `.keys/lab-jwks.json`; served at `/jwks` — see `/jwks/setup` |

See `.env.example` for the full list.

### JWKS (Private Key JWT & signed requests)

For **Private Key JWT** token endpoint auth or **RS256/384/512 signed request objects**:

1. Run `npm run generate-jwks` (or start the server — keys auto-generate on first use).
2. In PingOne, set **JSON Web Key Set Method** to either:
   - **JWKS URL**: `{BASE_URL}/jwks` (PingOne requires HTTPS in production; use inline JWKS locally)
   - **JWKS**: paste the public key JSON from the lab page or `/jwks/setup`
3. Set `PINGONE_TOKEN_AUTH_METHOD=private_key_jwt` (or per-lab, e.g. `WEB_AUTH_TOKEN_AUTH_METHOD=private_key_jwt`).

## Architecture

```
src/
├── server.js              # Express host
├── config/pingone.js      # Environment & app config
├── lib/
│   ├── pingone-client.js  # openid-client wrappers
│   └── lab-meta.js        # Lab definitions & exam topics
└── apps/                  # One module per integration pattern
    ├── web-auth/
    ├── mobile/
    ├── spa/
    └── ...
```

Each lab is a self-contained Express router mounted at `/labs/<name>`. Shared OIDC logic lives in `src/lib/pingone-client.js` using [openid-client](https://github.com/panva/openid-client).

## Exam study tips

- **Confidential vs public clients**: Web and worker apps use a client secret; native, SPA, and device apps use PKCE instead.
- **Token types**: ID tokens prove user identity; access tokens authorize API calls; refresh tokens extend sessions.
- **Grant selection**: Match the grant to the client capability — no browser means client credentials or device flow; user present means authorization code.
- **Security controls**: PAR pushes auth parameters server-side; PKCE prevents authorization code interception; `acr_values` requests step-up authentication.

## License

GPL-3.0-or-later — see [LICENSE](LICENSE).
