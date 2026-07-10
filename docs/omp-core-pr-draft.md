## What

Add a first-class **`grok-build`** provider that uses the official Grok Build CLI proxy (`https://cli-chat-proxy.grok.com/v1`) with CLI fingerprint headers and dedicated OAuth credentials.

This is separate from existing:

- `xai` → API key → `api.x.ai`
- `xai-oauth` → SuperGrok OAuth → `api.x.ai` (including bundled model id `grok-build` on that surface)

## Why

Fixes [#4945](https://github.com/can1357/oh-my-pi/issues/4945): when users select Grok Build, OMP currently burns **API/SuperGrok quota** instead of **Grok Build subscription quota**.

Root cause: product path mismatch.

| Path | Endpoint | Quota |
|---|---|---|
| Today `xai-oauth/grok-build` | `api.x.ai/v1` | API / SuperGrok |
| Official Grok Build CLI | `cli-chat-proxy.grok.com/v1` + CLI headers | Grok Build |

Observable proof from live CLI-proxy traffic: upstream model resolves as `grok-4.5-build` (Build surface), not plain SuperGrok routing.

## Design

Follows `docs/adding-a-provider.md`:

1. **Catalog half**: `CATALOG_PROVIDERS` entry `grok-build`
2. **Auth half**: registry provider with device-code OAuth (reuse xAI OAuth flow), credentials stored under `grok-build`
3. **No `XAI_API_KEY` fallback** on this provider (prevent silent API-quota burn)
4. **Wire**: `openai-responses`
5. **Headers**: official CLI fingerprint + per-request session/conv/req/turn ids
6. **Logout**: `/logout` → Grok Build removes only `grok-build` OAuth rows
7. **Non-goal**: do not break existing SuperGrok users on `xai-oauth`

## Existing PRs / issues

- Implements: #4945
- Related catalog work (orthogonal SuperGrok model ids): #4897, #4888, #4859
- Prototype extension proving the path: https://github.com/ART1KZ/omp-grok-build

## Testing

- [ ] `bun check` passes
- [ ] Unit tests for provider registration / no API-key fallback / header injection
- [ ] Local interactive: `/login` → Grok Build, `/model grok-build/grok-4.5`
- [ ] Local logout: `/logout` → Grok Build removes auth; model calls fail until re-login
- [ ] Live request returns Build model id (`*-build`) when available
- [ ] SuperGrok `xai-oauth` path unchanged

## Environment

| Item | Value |
|---|---|
| Author | @ART1KZ |
| Prototype | omp-grok-build extension (live-tested) |
| Harness used for prototype | Oh My Pi + agent tooling |

## Notes for reviewers

- Prefer separate provider over silently rewiring `xai-oauth` so SuperGrok and Build remain explicit.
- Do not put `providers.grok-build.apiKey` in user `models.yml` examples; config apiKey overrides OAuth and breaks `/logout`.
