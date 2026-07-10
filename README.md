# omp-grok-build

Oh My Pi extension that adds a **first-class Grok Build CLI provider**:

- provider id: `grok-build`
- endpoint: `https://cli-chat-proxy.grok.com/v1`
- native `/login` (xAI device-code OAuth)
- credentials stored as `grok-build` (not SuperGrok `xai-oauth`)

This is the portable alternative to forking omp.

---

## Why this exists

People confuse two different things:

| | SuperGrok path | Grok Build path |
|---|---|---|
| omp provider | `xai-oauth` (built-in) | `grok-build` (this extension) |
| endpoint | `https://api.x.ai/v1` | `https://cli-chat-proxy.grok.com/v1` |
| auth store | `xai-oauth` | `grok-build` |
| headers | normal API bearer | `X-XAI-Token-Auth: xai-grok-cli` + model override |
| billing | SuperGrok / X Premium+ quota | Build/CLI usage window |
| example model | `xai-oauth/grok-build` | `grok-build/grok-4.5` |

Selecting model id `grok-build` under `xai-oauth` is **not** the Grok Build product.
It is still SuperGrok auth + SuperGrok billing.

This extension implements the real CLI product surface that the official `grok` binary uses.

---

## Install (any machine)

### A) From GitHub (recommended)

```bash
omp plugin install github:ART1KZ/omp-grok-build
```

Restart omp (or open a new session).

### B) Link a local clone (dev / private)

```bash
git clone https://github.com/ART1KZ/omp-grok-build.git
omp plugin link ./omp-grok-build
```

### C) Drop-in extension path

```bash
# user extensions dir
mkdir -p ~/.omp/agent/extensions
cp -r src ~/.omp/agent/extensions/omp-grok-build
# or point config at the entry file:
```

```yaml
# ~/.omp/agent/config.yml
extensions:
  - ~/code/omp-grok-build/src/index.ts
```

> Marketplace installs do **not** load extension modules. Use `omp plugin install` / `plugin link` / `extensions:` / `~/.omp/agent/extensions`.

---

## Use

```text
/login
→ Grok Build (CLI proxy)

/model grok-build/grok-4.5
```

Optional help command:

```text
/grok-build-help
```

### Recommended omp config

```yaml
# ~/.omp/agent/config.yml
disabledProviders:
  - xai-oauth          # prevent accidental SuperGrok usage
modelProviderOrder:
  - grok-build
modelRoles:
  default: grok-build/grok-4.5
  plan: grok-build/grok-4.5
  slow: grok-build/grok-4.5
```

You do **not** need a hand-written `models.yml` for this provider after the extension is installed.
The extension registers models + headers itself.

If you still have an old custom `providers.grok-build` block in `models.yml`, remove it to avoid double-definition confusion.

---

## What the extension registers

```ts
pi.registerProvider("grok-build", {
  baseUrl: "https://cli-chat-proxy.grok.com/v1",
  api: "openai-completions",
  authHeader: true,
  headers: {
    "X-XAI-Token-Auth": "xai-grok-cli",
    "x-grok-client-version": "0.2.93",
    "x-grok-client-surface": "grok-build",
  },
  models: [grok-4.5, grok-build, grok-composer-2.5-fast],
  oauth: {
    name: "Grok Build (CLI proxy)",
    login,          // device-code on auth.x.ai
    refreshToken,   // refresh_token grant
    getApiKey,      // access token → bearer
  },
});
```

Per-model header `x-grok-model-override` is set because the CLI proxy routes primarily by that header.

---

## Auth details

- Issuer: `https://auth.x.ai`
- Client id: `b1a00492-073a-47ea-816f-4c329264a828` (same public CLI client)
- Flow: RFC 8628 device code (`/login` opens URL + shows user code)
- Scopes include `grok-cli:access` and `api:access`
- Tokens live in omp `agent.db` under provider `grok-build`
- Refresh is automatic via omp AuthStorage

Same OAuth client family as SuperGrok, **different product routing** because of endpoint + CLI headers + separate credential provider id.

You can still use official `grok login` for the native CLI; this extension does not require the `grok` binary.

---

## Multi-machine workflow

1. Install stock omp on the new machine
2. `omp plugin install github:ART1KZ/omp-grok-build`
3. `/login` → Grok Build
4. `/model grok-build/grok-4.5`

No omp fork. No copying token scripts. No `models.yml` glue required.

---

## Why not a full omp fork?

- Grok Build support is one provider, not a whole distribution
- forks rot against `dev` quickly
- extensions/plugins are the intended portable path in omp
- upstream PR for a product-specific CLI proxy is unlikely to be accepted into core

If you ever want a custom binary distro, keep this extension as the feature and only package omp + plugin together.

---

## Uninstall

```bash
omp plugin uninstall omp-grok-build
# or unlink if linked:
# omp plugin uninstall <linked-name>
```

Then `/logout` and remove `grok-build` credentials if desired.

---

## Files

```text
src/index.ts            # extension entry: registerProvider + /login
src/xai-device-oauth.ts # device-code login + refresh
package.json            # omp.extensions manifest
README.md               # this file
```

---

## License

MIT
