# ⚡ omp-grok-build

<div align="center">

**Полноценный провайдер [Grok Build](https://grok.com) CLI для [Oh My Pi](https://github.com/can1357/oh-my-pi)**

Нативный `/login` · отдельные credentials · биллинг CLI proxy · без форка omp

<br/>

[![Oh My Pi](https://img.shields.io/badge/Oh%20My%20Pi-extension-7c3aed?style=for-the-badge)](https://github.com/can1357/oh-my-pi)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge)](./LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-ART1KZ%2Fomp--grok--build-111827?style=for-the-badge&logo=github)](https://github.com/ART1KZ/omp-grok-build)

<br/>

**Языки:** [English](./README.md) · **Русский**

</div>

---

## ✨ Зачем это нужно

Люди путают **две разные product surface**:

| | 🟣 SuperGrok path | 🟢 Grok Build path |
|---|---|---|
| **провайдер в omp** | `xai-oauth` *(встроенный)* | `grok-build` *(это extension)* |
| **endpoint** | `https://api.x.ai/v1` | `https://cli-chat-proxy.grok.com/v1` |
| **auth store** | `xai-oauth` | `grok-build` |
| **headers** | обычный API bearer | `X-XAI-Token-Auth: xai-grok-cli` + model override |
| **биллинг** | квота SuperGrok / X Premium+ | окно Build / CLI usage |
| **пример модели** | `xai-oauth/grok-build` | `grok-build/grok-4.5` |

> ⚠️ Выбор model id `grok-build` внутри `xai-oauth` — **это не Grok Build**.  
> Это всё ещё SuperGrok auth + SuperGrok billing.

Этот extension подключает **настоящий CLI surface** официального бинарника `grok` — как portable plugin для omp.

---

## 🚀 Быстрый старт

### 1️⃣ Установка

```bash
omp plugin install github:ART1KZ/omp-grok-build
```

<details>
<summary>Альтернативные способы</summary>

**Локальный clone (dev)**

```bash
git clone https://github.com/ART1KZ/omp-grok-build.git
omp plugin link ./omp-grok-build
```

**Drop-in путь extension**

```yaml
# ~/.omp/agent/config.yml
extensions:
  - ~/code/omp-grok-build/src/index.ts
```

> Marketplace install **не** грузит extension modules.  
> Нужны: `omp plugin install` / `plugin link` / `extensions:` / `~/.omp/agent/extensions`.

</details>

### 2️⃣ Логин в omp

```text
/login
→ Grok Build (CLI proxy)
```

### 3️⃣ Выбор модели

```text
/model grok-build/grok-4.5
```

Всё. Без форка. Без token-скриптов. Без ручного `models.yml`.

---

## 🎯 Возможности

- ✅ **Настоящий provider**, не glue через `models.yml`
- ✅ Нативный **`/login`** (xAI device-code OAuth)
- ✅ Credentials хранятся как **`grok-build`** (отдельно от SuperGrok)
- ✅ Авто **refresh** токена через omp AuthStorage
- ✅ Гибридный каталог моделей: **static seed + live `/v1/models`**
- ✅ Правильные CLI headers (`X-XAI-Token-Auth`, model override, client surface)
- ✅ Работает на **любой машине** одной командой
- ✅ Переживает update omp (plugin живёт отдельно от binary)

---

## 🧭 Использование

| Действие | Команда |
|---|---|
| Логин | `/login` → **Grok Build (CLI proxy)** |
| Выбор модели | `/model grok-build/grok-4.5` |
| Справка | `/grok-build-help` |
| Принудительный refresh моделей | `omp models refresh` |

### Рекомендуемый config

```yaml
# ~/.omp/agent/config.yml
disabledProviders:
  - xai-oauth          # чтобы случайно не уйти в SuperGrok
modelProviderOrder:
  - grok-build
modelRoles:
  default: grok-build/grok-4.5
  plan: grok-build/grok-4.5
  slow: grok-build/grok-4.5
```

Если остался старый custom `providers.grok-build` в `models.yml` — лучше удалить, чтобы не было двойного определения.

---

## 🧠 Каталог моделей (hybrid)

| Состояние | Откуда берутся модели |
|---|---|
| 🔒 без login | static seed (`grok-4.5`, `grok-build`, `grok-composer-2.5-fast`) |
| 🔓 после `/login` | live `GET /v1/models` + curated overlays + seed backfill |
| 💾 следующие сессии | cache omp `models.db` (~**24 часа**) |
| 🔄 force refresh | `omp models refresh` |

**После первого login модели не «замораживаются навсегда».**  
Они держатся в cache ~24h, потом обновляются.  
Какие модели видны — зависит ещё и от tier / product surface аккаунта.

> В extension API `models` и `fetchDynamicModels` взаимоисключающие.  
> Здесь используется только `fetchDynamicModels`: без auth возвращается seed.

---

## 🔐 Auth

| Параметр | Значение |
|---|---|
| Issuer | `https://auth.x.ai` |
| Client | публичный CLI client `b1a00492-…` |
| Flow | RFC 8628 device code |
| Scopes | включая `grok-cli:access`, `api:access` |
| Storage | omp `agent.db` под provider `grok-build` |
| Refresh | автоматически через AuthStorage |

OAuth client family та же, что у SuperGrok — **маршрутизация product другая** из‑за:

1. endpoint (`cli-chat-proxy.grok.com`)
2. CLI headers
3. отдельного provider id credentials

Бинарник `grok` **не обязателен**.

---

## 🖥️ Несколько машин

```bash
# на любой новой машине
omp plugin install github:ART1KZ/omp-grok-build
omp
# дальше в omp:
# /login → Grok Build (CLI proxy)
# /model grok-build/grok-4.5
```

Без форка omp. Без копирования скриптов. Без ручного auth.json glue.

---

## 🧩 Что регистрируется

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
  fetchDynamicModels: async (apiKey) => /* seed или live merge */,
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

### Это то же самое, что `/model xai-oauth/grok-build`?
**Нет.** Там всё ещё SuperGrok auth/billing.  
Этот extension — CLI proxy surface.

### Можно обновить модели, не ждать 24 часа?
Да:

```bash
omp models refresh
```

Так же, как у других провайдеров omp (Antigravity, xAI OAuth, local engines и т.д.).

### Update omp удалит plugin?
Обычно **нет**. Plugins живут отдельно от binary.  
Сломаться может только если omp поменяет extension / `registerProvider` API.

### Почему не полный fork omp?
Потому что это один provider, а не целый distro.  
Forks гниют. Extensions — правильный portable путь.

---

## 🗑️ Удаление

```bash
omp plugin uninstall omp-grok-build
```

Потом `/logout` и при желании удали credentials `grok-build`.

---

## 📁 Структура

```text
omp-grok-build/
├── src/
│   ├── index.ts             # entry extension
│   ├── models.ts            # hybrid catalog (seed + live)
│   ├── constants.ts         # provider id / baseUrl / headers
│   └── xai-device-oauth.ts  # device-code login + refresh
├── README.md                # English
├── README.ru.md             # Русский
├── package.json             # omp.extensions manifest
└── LICENSE
```

---

## 📄 Лицензия

MIT © [ART1KZ](https://github.com/ART1KZ)

---

<div align="center">

Для тех, кому нужен **Grok Build в omp**, а не SuperGrok с другим model id.

⭐ Если это спасло тебя от форка — поставь звезду.

</div>
