# Maintenance Mode

This extension is in **low-maintenance mode** as of 2026-05-26.

## What this means

- No new features.
- Security patches only.
- Marketplace listing stays published (free distribution; ~321 installs/month).

## BYOK-only

The flowcraft-api backend no longer accepts FlowCraft-issued (`fc_live_*`) keys. Users must paste their own OpenAI / Anthropic / Google API key in Settings.

`src/extension.ts` `humanizeError()` detects the "FlowCraft-issued keys are no longer accepted" response and surfaces a clear toast with an "Open Settings" action.

## Do not

- Remove `ensureProviderApiKey` or bypass the InputBox flow — that's how users get a working key into the extension now.
- Add new generation commands that hardcode a FlowCraft key.
- Release a new version that defaults `flowcraft.api.provider` to `flowcraft` — the `flowcraft` provider value is effectively dead.
