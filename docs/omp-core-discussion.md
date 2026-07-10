### Request

Please **!vouch @ART1KZ** so I can open a PR. I am not in `.github/VOUCHED.td` yet; CONTRIBUTING says unvouched PRs are auto-closed, so I am starting here instead of opening a PR that would be closed on sight.

### Problem (tracked by #4945)

Current core path `xai-oauth/*` (including the bundled model `xai-oauth/grok-build`) talks to **`https://api.x.ai/v1`** (SuperGrok / API quota surface).

Official **Grok Build CLI** traffic goes to:

- endpoint: `https://cli-chat-proxy.grok.com/v1/responses`
- auth family: OAuth token with `grok-cli:access`
- required CLI fingerprint headers (from official `grok-pager` HAR / community reverse-engineering, e.g. decolua/9router):
  - `X-XAI-Token-Auth: xai-grok-cli`
  - `x-grok-client-identifier: grok-pager`
  - `x-grok-client-version`
  - `x-authenticateresponse: authenticate-response`
  - `x-grok-session-id` / `x-grok-conv-id` (same id on main chat)
  - `x-grok-req-id` (new uuid each request)
  - `x-grok-turn-idx`
  - `x-grok-model-override`

Without that route + fingerprint, users burn **API quota** even when they have **Grok Build** subscription quota (exactly #4945).

### What already exists in core

- Provider `xai-oauth` + curated model `grok-build` on `api.x.ai`
- Compat already sets `promptCacheSessionHeader: "x-grok-conv-id"` for `xai-oauth`
- OAuth client id / device flow already match the public Grok CLI client
- Scope already includes `grok-cli:access`

Missing piece is the **CLI proxy product path**, not the login ceremony alone.

### Proposed design (separate provider, not a silent fallback)

Add a first-class provider **`grok-build`** (catalog + registry), distinct from `xai` / `xai-oauth`:

| Concern | Proposal |
|---|---|
| Provider id | `grok-build` |
| Base URL | `https://cli-chat-proxy.grok.com/v1` |
| Wire API | `openai-responses` |
| Auth | device-code OAuth (reuse xAI OAuth flow; store under `grok-build`) |
| Env fallback | **none** / no `XAI_API_KEY` fallback (prevent silent API-quota burn) |
| Models | seed + live `/v1/models` (at least `grok-4.5`, `grok-build`, `grok-composer-2.5-fast`) |
| Headers | CLI fingerprint + per-request ids |
| Logout | `/logout` → `grok-build` removes only this provider credential |
| SuperGrok path | unchanged (`xai-oauth` stays on `api.x.ai`) |

Why separate provider (answers roboomp open questions on #4945):

1. **Quota selection is endpoint/header product path**, not just token presence.
2. Observable proof: upstream model id becomes `*-build` (e.g. `grok-4.5-build`) and Build dashboard/quota moves; API key path does not.
3. Reject API-key-only auth on this provider so users cannot accidentally burn API quota.

### Working prototype (extension)

I already shipped a portable extension that proves the path end-to-end:

- repo: https://github.com/ART1KZ/omp-grok-build
- install: `omp plugin install github:ART1KZ/omp-grok-build`
- live checks on my machine:
  - direct POST `cli-chat-proxy.grok.com/v1/responses` → **HTTP 200**, model `grok-4.5-build`
  - `omp -p --model grok-build/grok-4.5` → successful reply
  - auth via OAuth credential stored as provider `grok-build` (logout works when no `models.yml` apiKey override)

### Core PR scope (after vouch)

Following `docs/adding-a-provider.md`:

1. Catalog entry in `CATALOG_PROVIDERS` + model manager options for CLI proxy
2. `packages/ai/src/registry/grok-build.ts` + OAuth thunk (reuse `registry/oauth/xai-oauth` flow, store as `grok-build`)
3. Register in `registry.ts` ALL list
4. CLI fingerprint headers + session/req/turn identity on Responses requests
5. Tests: auth registration, no API-key fallback, header injection, model seed
6. CHANGELOG entries for `ai` / `catalog` / `coding-agent` as needed
7. Docs note: SuperGrok vs Grok Build paths

Non-goals for v1:

- Emulating closed-source `grok.exe` side-jobs (`recap-*` jobs)
- Replacing / breaking existing `xai-oauth` SuperGrok users

### Related

- Fixes / implements: #4945
- Related open work: Grok 4.5 catalog PRs (#4897 etc.) — orthogonal (model ids on SuperGrok path)
- Note: @metaphorics commented on #4945 “Will work on this.” Happy to coordinate or hand over the extension design if preferred.

### Ask

1. `!vouch @ART1KZ`
2. Confirm design choice: **separate `grok-build` provider** (recommended) vs only rewiring `xai-oauth/grok-build` baseUrl/headers
3. After vouch + design ACK, I will open the PR against `main` with full template + tests
