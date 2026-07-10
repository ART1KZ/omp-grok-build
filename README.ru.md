# ⚡ omp-grok-build

<div align="center">

**Провайдер Grok Build для [Oh My Pi](https://github.com/can1357/oh-my-pi)**

Нативный `/login` · CLI proxy route · более высокие лимиты Build

<br/>

[![Oh My Pi](https://img.shields.io/badge/Oh%20My%20Pi-extension-7c3aed?style=for-the-badge)](https://github.com/can1357/oh-my-pi)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge)](./LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-ART1KZ%2Fomp--grok--build-111827?style=for-the-badge&logo=github)](https://github.com/ART1KZ/omp-grok-build)

<br/>

**Языки:** [English](./README.md) · **Русский**

</div>

---

## Что это

`omp-grok-build` добавляет в Oh My Pi полноценный провайдер **Grok Build**:

| | |
|---|---|
| **Provider** | `grok-build` |
| **Endpoint** | `https://cli-chat-proxy.grok.com/v1` |
| **Auth** | нативный `/login` (xAI device-code OAuth) |
| **Credentials** | хранятся как `grok-build` |
| **Models** | hybrid-каталог (seed + live `/v1/models`) |

Это тот же CLI product surface, что у официального бинарника `grok` — не stock SuperGrok API path.

---

## Зачем

Stock omp Grok (`xai-oauth`) ходит в `api.x.ai`.

На SuperGrok / SuperGrok Heavy этот route часто **тратит общую недельную квоту Grok как API-использование**.

Grok Build CLI использует другой route и другие лимиты:

- endpoint: `cli-chat-proxy.grok.com`
- CLI auth headers
- более высокие Build/CLI limits

В omp можно продолжать работу, но уже на **лимитах Grok Build**, а не сжигать недельную квоту SuperGrok.

| | SuperGrok API path | Grok Build path |
|---|---|---|
| Provider | `xai-oauth` | `grok-build` |
| Endpoint | `https://api.x.ai/v1` | `https://cli-chat-proxy.grok.com/v1` |
| Лимиты | недельная квота SuperGrok как API | лимиты Grok Build CLI |
| Пример | `xai-oauth/grok-4.5` | `grok-build/grok-4.5` |

> `xai-oauth/grok-build` — это всё ещё SuperGrok API path.  
> Похожее имя модели не переключает вас на лимиты Grok Build.

---

## Установка

```bash
omp plugin install github:ART1KZ/omp-grok-build
```

<details>
<summary>Другие варианты установки</summary>

**Локальный clone**

```bash
git clone https://github.com/ART1KZ/omp-grok-build.git
omp plugin link ./omp-grok-build
```

**Через config**

```yaml
# ~/.omp/agent/config.yml
extensions:
  - ~/code/omp-grok-build/src/index.ts
```

Marketplace install не загружает extension modules. Нужны `omp plugin install`, `omp plugin link`, `extensions:` или `~/.omp/agent/extensions`.

</details>

---

## Использование

```text
/login
→ Grok Build (CLI proxy)

/model grok-build/grok-4.5
```

| Действие | Команда |
|---|---|
| Войти | `/login` → **Grok Build (CLI proxy)** |
| Выйти | `/logout` → **Grok Build** |
| Выбрать модель | `/model grok-build/grok-4.5` |
| Справка | `/grok-build-help` |
| Обновить список моделей | `omp models refresh` |


### Рекомендуемый config

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

Ручной `models.yml` не нужен. Extension сам регистрирует provider, models, headers и login flow.

**Не ставь `providers.grok-build.apiKey` в `models.yml`.** Config `apiKey` перекрывает OAuth и переживает `/logout` — после logout Grok Build всё ещё выглядит залогиненным.


---

## Возможности

- Нативный `/login` для Grok Build
- Отдельное хранилище credentials (`grok-build`)
- Автообновление токена
- CLI proxy endpoint + нужные CLI headers
- Hybrid catalog: offline seed + live discovery
- Принудительный refresh: `omp models refresh`
- Перенос на другие машины

---

## Каталог моделей

| Состояние | Источник |
|---|---|
| Без login | static seed |
| После login | live `GET /v1/models` + curated metadata |
| Следующие сессии | cache omp (~24h) |
| Принудительное обновление | `omp models refresh` |

Список не фиксируется навсегда после первого входа. Он обновляется по TTL cache или вручную и может зависеть от tier аккаунта.

---

## Auth

| | |
|---|---|
| Issuer | `https://auth.x.ai` |
| Flow | device-code OAuth |
| Client | публичный Grok CLI client |
| Storage | omp `agent.db` под `grok-build` |
| Login | `/login` → Grok Build |
| Logout | `/logout` → Grok Build (только OAuth в `agent.db`) |
| Refresh | автоматически |

Бинарник `grok` не обязателен. Login работает внутри omp.

`/logout` **не** удаляет `~/.grok/auth.json` (логин official CLI). Это отдельный клиент.

В interactive `/login` провайдер появляется после загрузки extension. Headless `omp auth-broker list` показывает только built-in providers.

---

## Несколько машин

```bash
omp plugin install github:ART1KZ/omp-grok-build
omp
```

Дальше:

```text
/login → Grok Build (CLI proxy)
/model grok-build/grok-4.5
```

---

## Удаление

```bash
omp plugin uninstall omp-grok-build
```

При желании: `/logout` и удаление credentials `grok-build`.

---

## Структура

```text
src/
  index.ts             entry extension
  models.ts            hybrid catalog
  constants.ts         provider id / baseUrl / headers
  xai-device-oauth.ts  device-code login + refresh
README.md
README.ru.md
package.json
LICENSE
```

---

## Лицензия

MIT © [ART1KZ](https://github.com/ART1KZ)
