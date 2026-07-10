# ⚡ omp-grok-build

<div align="center">

**Real [Grok Build](https://grok.com) CLI path for [Oh My Pi](https://github.com/can1357/oh-my-pi)**

Use Grok Build limits instead of burning SuperGrok weekly quota like API usage

<br/>

[![Oh My Pi](https://img.shields.io/badge/Oh%20My%20Pi-extension-7c3aed?style=for-the-badge)](https://github.com/can1357/oh-my-pi)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge)](./LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-ART1KZ%2Fomp--grok--build-111827?style=for-the-badge&logo=github)](https://github.com/ART1KZ/omp-grok-build)

<br/>

**Languages:** **English** · [Русский](./README.ru.md)

</div>

---

## ✨ Why this exists

In stock omp, Grok usually goes through **`xai-oauth` → `api.x.ai`**.

For SuperGrok / SuperGrok Heavy users that path often burns the **shared weekly Grok quota like API usage** — even if the model id is `grok-build`.

The official **Grok Build CLI** is different:
- same account / OAuth family
- **different route**: `cli-chat-proxy.grok.com`
- **different limits**: Grok Build CLI limits (usually much higher)
- so people can **save the weekly SuperGrok quota** instead of torching it in omp

| | 🟣 Stock omp SuperGrok path | 🟢 Real Grok Build path |
|---|---|---|
| **omp provider** | `xai-oauth` *(built-in)* | `grok-build` *(this extension)* |
| **endpoint** | `https://api.x.ai/v1` | `https://cli-chat-proxy.grok.com/v1` |
| **auth store** | `xai-oauth` | `grok-build` |
| **headers** | normal API bearer | `X-XAI-Token-Auth: xai-grok-cli` + model override |
| **limits / billing feel** | SuperGrok weekly quota burned like API | Grok Build CLI limits (higher) |
| **example model** | `xai-oauth/grok-build` | `grok-build/grok-4.5` |

> ⚠️ `/model xai-oauth/grok-build` is **not** real Grok Build.  
> Same-looking model name, SuperGrok route, SuperGrok weekly quota impact.

This extension gives omp the **real CLI route** used by the official `grok` binary — without forking omp.

---

## 🚀 Quick start

### 1️⃣ Install

```bash
omp plugin install github:ART1KZ/omp-grok-build
```

<details>
<summary>Alternative installs</summary>

**Link a local clone (dev)**

```bash
git clone https://github.com/ART1KZ/omp-grok-build.git
omp plugin link ./omp-grok-build
```

**Drop-in extension path**

```yaml
# ~/.omp/agent/config.yml
extensions:
  - ~/code/omp-grok-build/src/index.ts
```

> Marketplace installs do **not** load extension modules.  
> Use `omp plugin install` / `plugin link` / `extensions:` / `~/.omp/agent/extensions`.

</details>

### 2️⃣ Login inside omp

```text
/login
→ Grok Build (CLI proxy)
```

### 3️⃣ Pick a model

```text
/model grok-build/grok-4.5
```

That’s it. No fork. No token scripts. No hand-written `models.yml` required.

---

## 🎯 Features

- ✅ **Real provider**, not `models.yml` glue
- ✅ Native **`/login`** (xAI device-code OAuth)
- ✅ Credentials stored as **`grok-build`** (separate from SuperGrok)
- ✅ Auto token **refresh** via omp AuthStorage
- ✅ Hybrid model catalog: **static seed + live `/v1/models`**
- ✅ Correct CLI headers (`X-XAI-Token-Auth`, model override, client surface)
- ✅ Works on **any machine** with one install command
- ✅ Survives omp updates (plugin lives outside the binary)

---

## 🧭 Use

| Action | Command |
|---|---|
| Login | `/login` → **Grok Build (CLI proxy)** |
| Select model | `/model grok-build/grok-4.5` |
| Help | `/grok-build-help` |
| Force model refresh | `omp models refresh` |

### Recommended config

```yaml
# ~/.omp/agent/config.yml
disabledProviders:
  - xai-oauth          # avoid accidental SuperGrok usage
modelProviderOrder:
  - grok-build
modelRoles:
  default: grok-build/grok-4.5
  plan: grok-build/grok-4.5
  slow: grok-build/grok-4.5
```

If you still have an old custom `providers.grok-build` block in `models.yml`, remove it to avoid double definitions.

---

## 🧠 Model discovery (hybrid)

| State | Catalog source |
|---|---|
| 🔒 logged out | static seed (`grok-4.5`, `grok-build`, `grok-composer-2.5-fast`) |
| 🔓 after `/login` | live `GET /v1/models` + curated overlays + seed backfill |
| 💾 later sessions | omp `models.db` cache (~**24h** TTL) |
| 🔄 force refresh | `omp models refresh` |

**Models are not frozen forever after first login.**  
They stick for the cache window (~24h), then refresh.  
Account tier / product surface can change which models appear.

> Extension API treats `models` and `fetchDynamicModels` as exclusive.  
> This package uses only `fetchDynamicModels` and returns the seed when unauthenticated.

---

## 🔐 Auth details

| Item | Value |
|---|---|
| Issuer | `https://auth.x.ai` |
| Client | public CLI client `b1a00492-…` |
| Flow | RFC 8628 device code |
| Scopes | includes `grok-cli:access`, `api:access` |
| Storage | omp `agent.db` under provider `grok-build` |
| Refresh | automatic via AuthStorage |

Same OAuth client family as SuperGrok — **different product routing** because of:

1. endpoint (`cli-chat-proxy.grok.com`)
2. CLI headers
3. separate credential provider id

The official `grok` binary is **not required**.

---

## 🖥️ Multi-machine setup

```bash
# on any new machine
omp plugin install github:ART1KZ/omp-grok-build
omp
# then inside omp:
# /login → Grok Build (CLI proxy)
# /model grok-build/grok-4.5
```

No omp fork. No copying scripts. No manual auth.json plumbing.

---

## 🧩 What gets registered

```ts
pi.registerProvider("grok-build", {
  baseUrl: "https://cli-chat-proxy.grok.com/v1",
  api: "openai-responses",
  authHeader: true,
  headers: {
    "X-XAI-Token-Auth": "xai-grok-cli",
    "x-grok-client-version": "0.2.93",
    "x-grok-client-surface": "grok-build",
  },
  fetchDynamicModels: async (apiKey) => /* seed or live merge */,
  oauth: {
    name: "Grok Build (CLI proxy)",
    login,          // device-code
    refreshToken,   // refresh_token grant
    getApiKey,      // access → bearer
  },
});
```

---

## ❓ FAQ

### Is this the same as `/model xai-oauth/grok-build`?
**No.** That still goes through SuperGrok / `api.x.ai` and can burn the shared weekly quota like API usage.  
This extension uses the real Grok Build CLI proxy route with higher CLI limits.

### Can I force-update models without waiting 24h?
Yes:

```bash
omp models refresh
```

Same pattern as other omp providers (Antigravity, xAI OAuth, local engines, etc.).

### Will an omp update remove the plugin?
Usually **no**. Plugins live separately from the binary.  
It can only break if omp changes the extension/`registerProvider` API.

### Why not a full omp fork?
Because this is one provider, not a whole distribution.  
Forks rot. Extensions are the portable path.

---

## 🗑️ Uninstall

```bash
omp plugin uninstall omp-grok-build
```

Then `/logout` and remove `grok-build` credentials if desired.

---

## 📁 Project layout

```text
omp-grok-build/
├── src/
│   ├── index.ts             # extension entry
│   ├── models.ts            # hybrid catalog (seed + live)
│   ├── constants.ts         # provider id / baseUrl / headers
│   └── xai-device-oauth.ts  # device-code login + refresh
├── README.md                # English
├── README.ru.md             # Русский
├── package.json             # omp.extensions manifest
└── LICENSE
```

---

## 📄 License

MIT © [ART1KZ](https://github.com/ART1KZ)

---

<div align="center">
Made for SuperGrok users who want **real Grok Build limits in omp**, not SuperGrok weekly quota burned under a similar model name.

⭐ If this saves you a fork — star the repo.

</div>
