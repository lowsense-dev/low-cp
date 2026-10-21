# low-cp

LLM-прокси с ротацией аккаунтов и встроенной веб-панелью. Форк [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI): ядро, OAuth и трансляция форматов — апстримные, сверху — панель и то, чего в апстриме нет.

Клиенты ходят в один эндпоинт в любом формате (`/v1/chat/completions`, `/v1/responses`, `/v1/messages`, `/v1beta/...`), прокси раскидывает запросы по OAuth-аккаунтам (Codex, Claude, Antigravity, xAI, Kimi…) и API-ключам кастомных провайдеров.

## Что добавлено поверх апстрима

- **Панель** на `/panel/`: аккаунты, провайдеры, модели, ключи доступа, маршрутизация, статистика, журнал запросов, домен, сырой конфиг. RU/EN, светлая/тёмная тема.
- **Ротация `while-no-limit`**: держится за один аккаунт, пока он отвечает; на 4xx/5xx переключается на следующий и остаётся на нём. Статусы без ротации настраиваются (`routing.no-rotate-statuses`, по умолчанию 400, 404, 413, 422).
- **Политики клиентских ключей** (`access.key-policies`): название, список разрешённых моделей (с `*`-масками), лимит токенов всего и в день, срок действия. Чтение из кеша в лимит не идёт.
- **`GET /v1/key`** — клиент со своим ключом видит свои лимиты и расход.
- **Статистика** по провайдерам, аккаунтам, ключам и моделям (`low-cp-usage.json` рядом с конфигом) и **журнал запросов** (IP, модель, токены, код, время, текст ошибки).
- **Импорт аккаунтов** из `~/.codex/auth.json`, `~/.claude/.credentials.json`, экспортов Antigravity.
- **Квоты** Codex, Claude и Antigravity прямо из панели.
- **Префиксы OAuth-провайдеров** (`oauth.provider-prefixes`, например `cx/`, `cc/`, `agy/`), выключение моделей (`routing.disabled-models`) и провайдеров, загрузка списка моделей с апстрима.
- **Привязка домена** через Caddy с автоматическим HTTPS.

## Сборка

Нужны Go (версия из `go.mod`), Node 22+ и pnpm.

```sh
make build        # панель + бинарь ./low-cp
```

Собранная панель лежит в `internal/panel/dist` и вшивается в бинарь, так что `go build ./cmd/server` работает и без Node.

Готовые бинари под Linux x64 собирает GitHub Actions: артефакт на каждый пуш в `main`, релиз — на тег `v*`.

## Запуск

```sh
./low-cp -config config.yaml
```

Минимальный конфиг (полный пример — `config.example.yaml`):

```yaml
server:
  host: "127.0.0.1"
  port: 8317
management:
  secret-key: "сменить"      # ключ входа в панель; при старте хешируется bcrypt
oauth:
  auth-dir: "~/.cli-proxy-api"
access:
  api-keys:
    - "sk-client-key"
routing:
  strategy: "while-no-limit"
```

Панель: `http://127.0.0.1:8317/panel/`. За реверс-прокси добавьте его в `server.trusted-proxies` и включите `management.allow-remote: true`, иначе в журнале будут адреса прокси, а не клиентов.

Пример systemd user-юнита:

```ini
[Service]
ExecStart=%h/.local/bin/low-cp -config %h/.config/low-cp/config.yaml
Restart=on-failure
```

Не запускайте два экземпляра на одной `auth-dir`: refresh-токены Codex одноразовые, параллельный refresh убивает аккаунты.

## Лицензия

MIT, как у апстрима — см. `LICENSE`.
