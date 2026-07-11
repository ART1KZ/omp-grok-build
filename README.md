# ⚡ omp-grok-build

<div align="center">

**Grok Build provider for [Oh My Pi](https://github.com/can1357/oh-my-pi)**

Native `/login` · CLI proxy route · higher Build limits

<br/>

[![Oh My Pi](https://img.shields.io/badge/Oh%20My%20Pi-extension-7c3aed?style=for-the-badge)](https://github.com/can1357/oh-my-pi)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge)](./LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-ART1KZ%2Fomp--grok--build-111827?style=for-the-badge&logo=github)](https://github.com/ART1KZ/omp-grok-build)

<br/>

**Languages:** **English** · [Русский](./README.ru.md)

</div>

---

## What it is

`omp-grok-build` adds a first-class **Grok Build** provider to Oh My Pi:

| | |
|---|---|
| **Provider** | `grok-build` |
| **Endpoint** | `https://cli-chat-proxy.grok.com/v1` |
| **Auth** | native `/login` (xAI device-code OAuth) |
| **Credentials** | stored as `grok-build` |
| **Models** | hybrid catalog (seed + live `/v1/models`) |

This is the same CLI product surface used by the official `grok` binary — not the stock SuperGrok API path.

---

## Why use it

Stock omp Grok support (`xai-oauth`) talks to `api.x.ai`.

On SuperGrok / SuperGrok Heavy that route often consumes the **shared weekly Grok quota like API usage**.

Grok Build CLI uses a different route and different limits:

- endpoint: `cli-chat-proxy.grok.com`
- CLI auth headers
- higher Build/CLI limits

So you keep coding in omp while using **Grok Build limits** instead of burning the weekly SuperGrok allowance.

| | SuperGrok API path | Grok Build path |
|---|---|---|
| Provider | `xai-oauth` | `grok-build` |
| Endpoint | `https://api.x.ai/v1` | `https://cli-chat-proxy.grok.com/v1` |
| Typical limit impact | weekly SuperGrok quota like API | Grok Build CLI limits |
| Example | `xai-oauth/grok-4.5` | `grok-build/grok-4.5` |

> `xai-oauth/grok-build` is still the SuperGrok API path.  
> A similar model name does not switch you onto Grok Build limits.

---

## Install

```bash
omp plugin install github:ART1KZ/omp-grok-build
```

<details>
<summary>Other install options</summary>

**Local clone**

```bash
git clone https://github.com/ART1KZ/omp-grok-build.git
omp plugin link ./omp-grok-build
```

**Config path**

```yaml
# ~/.omp/agent/config.yml
extensions:
  - ~/code/omp-grok-build/src/index.ts
```

Marketplace installs do not load extension modules. Use `omp plugin install`, `omp plugin link`, `extensions:`, or `~/.omp/agent/extensions`.

</details>

---

## Usage

```text
/login
→ Grok Build (CLI proxy)

/model grok-build/grok-4.5
```

| Action | Command |
|---|---|
| Sign in | `/login` → **Grok Build (CLI proxy)** |
| Sign out | `/logout` → **Grok Build** |
| Choose model | `/model grok-build/grok-4.5` |
| Quota | `/usage` (Grok Build section) |
| Help | `/grok-build-help` |
| Refresh model list | `omp models refresh` |




### Recommended config

```yaml
# ~/.omp/agent/config.yml
disabledProviders:
  - xai-oauth
modelProviderOrder:
  - grok-build
modelRoles:
  default: grok-build/grok-4.5
  plan: grok-build/grok-4.5
  slow: grok-build/grok-4.5
```

No hand-written `models.yml` is required. The extension registers the provider, models, headers, and login flow itself.

**Do not set `providers.grok-build.apiKey` in `models.yml`.** Config `apiKey` overrides OAuth and survives `/logout`, so Grok Build will still look logged in after logout.


---

## Features

- Native `/login` for Grok Build
- Separate credential store (`grok-build`)
- Automatic token refresh
- CLI proxy endpoint + required CLI headers
- Stock `/usage` shows **Grok Build** weekly credits + products
- Hybrid model catalog: offline seed + live discovery
- Force refresh with `omp models refresh`
- Portable install on any machine
### Usage vs core omp

| | This extension | Core omp |
|---|---|---|
| **Chat path** | `cli-chat-proxy` (Build product) | stock `xai-oauth` → `api.x.ai` |
| **Quota UI** | stock **`/usage`** (Grok Build section) | native `xai-oauth` usage via [#4874](https://github.com/can1357/oh-my-pi/pull/4874) when merged |
| **Issue** | Build routing [#4945](https://github.com/can1357/oh-my-pi/issues/4945) | missing Grok in usage [#5065](https://github.com/can1357/oh-my-pi/issues/5065) |

On session start the extension patches `AuthStorage.fetchUsageReports` so **`/usage`** lists **Grok Build** like Anthropic/Codex. If core already returns a report for that provider, we do not duplicate it.

Seeing a **GrokBuild %** line under SuperGrok usage is not the same as chat already using the Build route. This plugin is the Build **chat** path.


---

## Model catalog

| State | Source |
|---|---|
| Signed out | static seed |
| Signed in | live `GET /v1/models` + curated metadata |
| Later sessions | omp cache (~24h) |
| Force update | `omp models refresh` |

The list is not permanent after first login. It refreshes on cache expiry or manual refresh, and can change with account tier.

---

## Auth

| | |
|---|---|
| Issuer | `https://auth.x.ai` |
| Flow | device-code OAuth |
| Client | public Grok CLI client |
| Storage | omp `agent.db` under `grok-build` |
| Login | `/login` → Grok Build |
| Logout | `/logout` → Grok Build (removes `agent.db` OAuth only) |
| Refresh | automatic |

The official `grok` binary is optional. Login works inside omp.

`/logout` does **not** delete `~/.grok/auth.json` (official CLI login file). That is a separate client.

Interactive `/login` shows the provider after the extension loads. Headless `omp auth-broker list` only enumerates built-in providers.

---

## Multi-machine

```bash
omp plugin install github:ART1KZ/omp-grok-build
omp
```

Then:

```text
/login → Grok Build (CLI proxy)
/model grok-build/grok-4.5
```

---

## Uninstall

```bash
omp plugin uninstall omp-grok-build
```

Optionally `/logout` and remove stored `grok-build` credentials.

---

## Project layout

```text
src/
  index.ts             extension entry
  models.ts            hybrid model catalog
  constants.ts         provider id / baseUrl / headers
  xai-device-oauth.ts  device-code login + refresh
README.md
README.ru.md
package.json
LICENSE
```

---

## License

MIT © [ART1KZ](https://github.com/ART1KZ)
