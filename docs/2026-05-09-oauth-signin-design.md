# VS Code Extension: Google / GitHub Sign-In

**Date:** 2026-05-09
**Status:** Approved design; ready for implementation plan
**Scope:** Spans `FlowCraft-VsCode-Extension/`, `FlowCraft/`, and `flowcraft-api/`

## Goal

Let users sign into their FlowCraft account from inside the VS Code extension via Google or GitHub OAuth, so diagram generation can be backed by their FlowCraft subscription instead of a pasted provider API key. BYOK remains a parallel, fully-supported path; sign-in is additive.

## Non-Goals

- Email/password sign-in inside the extension.
- A hybrid auth mode that mixes BYOK + signed-in quota in a single request.
- Telemetry around sign-in events.
- Account creation flows specific to the extension (the existing web sign-up is reused).

## Approach

Approach A — VS Code's `AuthenticationProvider` API plus a `vscode://` URI handler, with the OAuth dance happening in the user's normal browser through the existing FlowCraft web app:

1. Extension generates a single-use `state` nonce and opens `https://flowcraft.app/vscode/auth/start?provider=google|github&state=<nonce>` via `vscode.env.openExternal`.
2. The web app drops a short-lived cookie marking the session as a VS Code flow, then dispatches into the existing Supabase OAuth flow (`/api/auth/google` or `/api/auth/github`).
3. After the Supabase callback hits `/auth/confirm`, the route inspects the cookie. If the VS Code flag is set, instead of redirecting to the dashboard it redirects to `vscode://FlowCraft.flowcraft/auth/callback?access_token=…&refresh_token=…&expires_at=…&state=<nonce>`.
4. The extension's registered URI handler validates `state`, persists the tokens to `context.secrets`, and fires `onDidChangeSessions`.
5. Subsequent API calls send `Authorization: Bearer <jwt>` to `flowcraft-api`, which validates against Supabase via the existing `supabase_auth.py` and treats the request as subscription-backed (using FlowCraft-managed LLM keys, not the user's BYOK key).

Rejected alternatives:
- **PKCE direct from extension with a loopback HTTP server** — fragile (firewalls, port collisions), needs `http://localhost:*` registered as a Supabase redirect URL.
- **Device code flow** — Supabase has no native support, worse UX, only useful in headless contexts.

## Components

### Web app (`FlowCraft/`)

**New route: `GET /vscode/auth/start`**
- Path: `src/app/vscode/auth/start/route.ts`
- Query: `provider` (`google` | `github`), `state` (string, required, 16+ chars).
- Behavior: validates inputs, sets a `flowcraft_vscode_oauth` cookie containing `{ state, provider }` with `httpOnly`, `secure`, `sameSite: "lax"`, `maxAge: 600` (10 minutes), then redirects (302) to the existing OAuth initiator. The existing `/api/auth/{google,github}` POST routes call `supabase.auth.signInWithOAuth(...)` and return a JSON body with `url`. For the redirect-style flow we will either (a) extract the same logic into a helper and call it server-side here, or (b) reproduce the `signInWithOAuth` call directly in this handler. Plan should pick (a) to avoid duplication.
- Reject if `state` is missing/short, or `provider` is not in the allowed set.

**Modify: `/auth/confirm`** (existing Supabase callback)
- After the session is established, check for the `flowcraft_vscode_oauth` cookie.
- If present:
  - Read the current Supabase session (`access_token`, `refresh_token`, `expires_at`, user email).
  - Clear the cookie.
  - Redirect (302) to `vscode://FlowCraft.flowcraft/auth/callback?access_token=…&refresh_token=…&expires_at=…&email=…&state=<state-from-cookie>`.
- If absent: existing dashboard redirect (unchanged).
- Note: tokens are passed through the OS URI handler. Acceptable because (a) the redirect happens only on the user's machine, (b) the URI handler is registered to a specific extension publisher/id, (c) the tokens are short-lived and a refresh token rotation can be done immediately on receipt. Document this tradeoff in the plan.

### Extension (`FlowCraft-VsCode-Extension/`)

**`package.json` additions**
- New commands:
  - `flowcraft.signIn` — "FlowCraft: Sign In"
  - `flowcraft.signOut` — "FlowCraft: Sign Out"
- No new configuration setting. Auth mode is implicit: `AuthResolver` returns Bearer if a valid signed-in session exists, otherwise falls back to BYOK provider key.

**New file: `src/services/auth-service.ts`**
- Wraps `context.secrets` for the four keys: `flowcraft.auth.accessToken`, `flowcraft.auth.refreshToken`, `flowcraft.auth.expiresAt`, `flowcraft.auth.userEmail`.
- API:
  - `storeSession({accessToken, refreshToken, expiresAt, email})`
  - `getSession(): Promise<Session | null>`
  - `clearSession()`
  - `getValidAccessToken(): Promise<string | null>` — returns the current access token, refreshing it via Supabase `/auth/v1/token?grant_type=refresh_token` if `expiresAt - now < 30s`. Rotates and persists the new tokens. Returns `null` if not signed in or refresh fails.
  - `signOutRemote()` — best-effort POST to Supabase `/auth/v1/logout` with the access token to revoke the refresh token.
- Emits a `onDidChangeSession` event consumed by the auth provider and settings webview.

**New file: `src/auth/flowcraft-auth-provider.ts`**
- Implements `vscode.AuthenticationProvider` with id `"flowcraft"` and label `"FlowCraft"`.
- `getSessions()` returns a single session built from `AuthService.getSession()` if present, else `[]`.
- `createSession(scopes)` triggers the sign-in flow:
  1. Ask the user (QuickPick) which provider: Google or GitHub.
  2. Generate a UUID `state`, register it in an in-memory `pendingStates: Map<state, {createdAt, resolver}>` with a 5-minute timeout.
  3. `vscode.env.openExternal(...)` to the start URL.
  4. Return a Promise that resolves when the URI handler matches `state`, rejects on timeout / cancellation.
- `removeSession(id)` calls `AuthService.clearSession()` and `signOutRemote()`.

**Modify `src/extension.ts`**
- Construct `AuthService(context)`.
- Register `FlowCraftAuthProvider` via `vscode.authentication.registerAuthenticationProvider(...)`.
- Register a URI handler via `vscode.window.registerUriHandler({ handleUri })` that:
  - Accepts `vscode://FlowCraft.flowcraft/auth/callback`.
  - Parses query params, validates `state` against pending nonces.
  - On success: persists tokens via `AuthService`, resolves the matching pending Promise, shows `Signed in as <email>` toast.
  - On failure (state mismatch, missing tokens, error param): shows an error toast and rejects the pending Promise (if any).
- Register `flowcraft.signIn` (calls `vscode.authentication.getSession("flowcraft", [], { createIfNone: true })`).
- Register `flowcraft.signOut` (calls `AuthService.clearSession()` + `signOutRemote()`).

**New file: `src/api/auth-resolver.ts`**
- Single chokepoint for every outgoing API request.
- Resolution order:
  1. If `AuthService.getValidAccessToken()` returns a token, return `{ headerName: "Authorization", headerValue: "Bearer <token>" }`.
  2. Otherwise fall back to `ensureProviderApiKey(...)` and return `{ headerName: "X-api-key", headerValue: <provider key> }`.
  3. If neither yields credentials, throw `NoCredentialsError`.

**Settings webview (`src/webview/settings/`, `src/views/settings-view.ts`)**
- Add an "Account" section above the existing "API Keys" section:
  - When signed in: show `Signed in as <email>` and a "Sign out" button.
  - When signed out: show "Sign in with Google" and "Sign in with GitHub" buttons.
- No mode toggle. The Account section's presence (signed-in vs signed-out) makes the active mode obvious, and the BYOK API-key UI remains visible as the fallback.

### API (`flowcraft-api/`)

**`src/multi_auth.py`**
- Today: resolves a per-request provider key from `X-api-key`.
- Add: also accept `Authorization: Bearer <jwt>`. When present, validate the JWT against Supabase (use `supabase_auth.py`'s existing helpers; add one if needed). On success, mark the request as `auth_mode = "subscription"` and skip BYOK key resolution.
- For `auth_mode = "subscription"` requests:
  - Look up the user's subscription tier via Supabase.
  - Reject (HTTP 402 with a structured error) if the user has no active subscription or has exceeded their quota.
  - Otherwise route the LLM call using the FlowCraft-managed environment keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.) and decrement the user's quota counter.
- For `auth_mode = "byok"`: existing behavior — pass the user's key to LiteLLM, no quota tracking.

**Endpoints touched**
- `/v2/diagrams/generate`, `/v2/diagram`, `/v2/infographic`, `/v2/illustration` — all already route through `multi_auth`. No per-endpoint changes if the resolver is updated centrally.

## Token / Refresh Lifecycle

- Access token: short-lived (Supabase default 1h). Persisted to `context.secrets`.
- Refresh token: long-lived. Persisted to `context.secrets`.
- Before each API call, `AuthResolver` calls `getValidAccessToken()`. If `expiresAt - now < 30s`, the service refreshes by POSTing to Supabase `/auth/v1/token?grant_type=refresh_token`, persists the rotated pair, and returns the new access token.
- Refresh failure → clear stored session, fire `onDidChangeSessions`, surface `NotSignedInError` to the caller, which shows a "Sign in again" toast.

## Security

- The `state` nonce is required, single-use, time-bounded (5 minutes), and validated on the URI callback to prevent CSRF / cross-window injection.
- Tokens are only stored in `context.secrets` (OS keychain via VS Code's `SecretStorage`), never written to settings, logs, or telemetry.
- The URI handler rejects callbacks where `state` is missing or unknown.
- The web app's `flowcraft_vscode_oauth` cookie is `httpOnly`, `secure`, `sameSite: "lax"`, with a 10-minute lifetime.
- Tokens transit through a `vscode://` URI on the local OS only; no third party sees them.
- Sign-out best-effort revokes the refresh token via Supabase `/auth/v1/logout`.

## Testing

**Unit (extension)**
- `AuthResolver` prefers Bearer when signed in, falls back to BYOK when not, and throws `NoCredentialsError` when neither is available.
- `AuthService.getValidAccessToken()` refreshes when within the 30s window, rotates persisted tokens, returns null on refresh failure.
- URI handler rejects unknown / expired `state` values and resolves the matching pending promise on a valid callback.

**Manual (extension dev host, F5)**
- Sign in with Google → succeeds → email shown in settings.
- Sign in with GitHub → succeeds.
- Generate a diagram in `signin` mode → request carries `Authorization: Bearer …` and succeeds.
- Generate a diagram in `byok` mode → unchanged behavior, request carries `X-api-key`.
- Sign out → settings shows signed-out state, next request in `signin` mode prompts to sign in.
- Force-expire the access token (set `expiresAt` to a past value) → next call refreshes silently.

**API**
- `multi_auth` accepts a valid Supabase JWT and rejects an invalid one.
- Subscription-backed request decrements quota; over-quota returns 402.
- BYOK request path is unchanged.

## Open Questions for the Plan

- Whether `/auth/confirm` is a Next.js route handler or a server action — the plan needs to read the existing file and decide where the cookie check lives.
- Exact subscription/quota schema in Supabase — the plan should locate it before implementing the API side.
- Whether the existing `supabase_auth.py` already exposes a JWT-validation helper or needs one added.
