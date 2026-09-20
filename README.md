<p align="center">
  <img src="frontend/src/assets/images/logo-universal.png" width="128" alt="PullApps">
</p>

# PullApps

[![CI](https://github.com/Ch1kez/PullApps/actions/workflows/ci.yml/badge.svg)](https://github.com/Ch1kez/PullApps/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/Ch1kez/PullApps?display_name=tag)](https://github.com/Ch1kez/PullApps/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

macOS GUI поверх [`ipatool`](https://github.com/majd/ipatool) — вход в App Store
по Apple ID, поиск и скачивание `.ipa` для приложений, привязанных к вашему
аккаунту, а также список приложений с подключённого по USB iPhone с автопривязкой
их App Store ID (работает даже для удалённых из App Store приложений).

Собран на [Wails v2](https://wails.io/) (Go + небольшой vanilla-JS фронтенд).

> PullApps не обходит защиту Apple: скачать можно только приложение, лицензия
> на которое уже принадлежит вошедшему Apple ID. Проект не связан с Apple Inc.

## Быстрый старт

1. Скачайте `PullApps-…-macos-universal.zip` на странице
   [Releases](https://github.com/Ch1kez/PullApps/releases) и перенесите
   `PullApps.app` в `/Applications`.
2. Для работы с подключённым iPhone установите инструменты:

   ```bash
   brew install libimobiledevice ideviceinstaller
   ```

3. Откройте приложение. Пока сборка не подписана Developer ID и не
   нотарифицирована Apple, macOS покажет предупреждение о невозможности
   проверить приложение на вредоносное ПО. Это ожидаемо: разрешите запуск через
   **Системные настройки → Конфиденциальность и безопасность → Всё равно
   открыть**.

Подробная безопасная инструкция с проверкой SHA-256 и официальными ссылками
Apple: **[первый запуск PullApps на macOS](docs/первый-запуск-на-macos.md)**.

> Не отключайте Gatekeeper целиком и не вводите случайные команды `sudo` или
> `xattr` из интернета. macOS позволяет создать исключение только для PullApps.

Совместимый `ipatool` уже включён в релизную сборку. Установка `ipatool` через
Homebrew нужна только для самостоятельной диагностики или переопределения
встроенной версии.

## Что умеет

- **Поиск** в App Store с показом bundle ID, версии и цены прямо в списке.
- **Вход по Apple ID** прямо в приложении, с 2FA во втором шаге.
- **Переключатель Apple ID** — несколько аккаунтов хранятся в Keychain и
  переключаются в один клик из шапки; у новых аккаунтов запрашивается пароль
  только один раз.
- **Скачивание `.ipa`** в папку по умолчанию `~/Downloads/PullApps` (меняется
  кнопкой «Choose…») — строка результата сама становится прогресс-баром по мере
  скачивания.
- **Выбор старой версии** из выпадающего списка (последние 25 версий с датами).
- **Прямая загрузка по bundle ID, числовому App ID или вставленной ссылке App Store** —
  удобно для удалённых из App Store приложений.
- **From iPhone** — список всех приложений с подключённого iPhone, App Store ID
  автоматически извлекаются из `iTunesMetadata.plist` на устройстве. Кнопка
  подсвечивается, когда телефон подключён.
- **Иконки с учётом региона** — для каждой строки iPhone подтягивается настоящая
  иконка из App Store того региона, где приложение было куплено.
- **Учёт владельца аккаунта** — каждая строка с iPhone показывает DSID (номер
  аккаунта Apple), владеющего приложением, зелёным/красным цветом относительно
  вашего текущего входа. Если красный — кнопка **Sign in as owner** открывает
  панель входа и авто-возобновляет скачивание после повторного входа.
- **Живой фильтр** по списку с iPhone (Cmd+F, Esc — сброс).
- **Авто-восстановление при истечении токена** — если сессия ipatool истекла
  посреди скачивания, открывается панель входа, и скачивание возобновляется.
- **Установка `.ipa` на iPhone** — секция **Install**: выберите скачанный файл
  («Choose…») и установите его по USB через `ideviceinstaller` с живым прогрессом
  (работает и вручную, и автоматически — после скачивания путь подставляется сам).

Вся работа с App Store делегируется `ipatool`; это тонкий GUI поверх него плюс
прослойка libimobiledevice для интеграции с iPhone.

## Требования для готовой сборки

- macOS 13+ на Apple Silicon или Intel;
- [`libimobiledevice`](https://libimobiledevice.org/) — интеграция с iPhone
  (`ideviceinstaller` + `idevice_id`), только если нужны функции **From iPhone**
  и **Install**:
  ```bash
  brew install libimobiledevice ideviceinstaller
  ```
- Apple ID с нужным приложением в истории покупок (бесплатные приложения тоже
  создают лицензию).

Если интеграция с iPhone не нужна, libimobiledevice можно не ставить — кнопка
**From iPhone** просто сообщит, что инструмент не найден.

Без интеграции с iPhone приложение продолжает искать и скачивать IPA; недоступны
только функции чтения списка с устройства и установки по USB.

## Сборка из исходников

Нужны:

- Go 1.25+
- Node.js 22+
- Wails CLI:
  ```bash
  go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0
  ```

Сборка:

```bash
git clone https://github.com/Ch1kez/PullApps.git
cd PullApps
cd frontend && npm ci && cd ..
./scripts/build-app.sh
open build/bin/PullApps.app
```

Локальная разработка с горячей перезагрузкой:

```bash
wails dev
```

## Обновление ipatool (запасной вариант)

Приложение ищет бинарник в порядке:

1. `~/Library/Application Support/PullApps/bin/ipatool`
2. `Contents/Resources/bin/ipatool` внутри `.app`
3. `/opt/homebrew/bin/ipatool`

Чтобы «переопределить» версию (например, после `brew upgrade ipatool`):

```bash
mkdir -p ~/Library/Application\ Support/PullApps/bin
cp /opt/homebrew/bin/ipatool ~/Library/Application\ Support/PullApps/bin/ipatool
chmod +x ~/Library/Application\ Support/PullApps/bin/ipatool
```

> Ранние версии приложения использовали имя `ipatool-gui` — прежний
> путь `~/Library/Application Support/ipatool-gui/bin` по-прежнему
> распознаётся автоматически, ничего руками переносить не нужно.

Затем полностью закройте приложение (Cmd+Q) и откройте заново.

## Перенос приложений на новый iPhone

Пошаговая инструкция (проверено на СБОЛ и MAX, которые больше не в App Store) —
в [`docs/перенос-приложений-на-iphone.md`](docs/перенос-приложений-на-iphone.md).

## Структура репозитория

```
app.go                 — весь бэкенд (Wails-методы, обёртки инструментов)
frontend/src/          — фронтенд (main.js + style.css)
scripts/build-app.sh   — полная сборка .app (патченый ipatool + wails build)
scripts/build-ipatool.sh — сборка патченого ipatool для входа в App Store
patches/               — патч для ipatool (см. «Совместимость ipatool»)
docs/                  — документация на русском
.github/workflows/     — сборка универсального macOS .app в GitHub Actions
```

## Совместимость ipatool

Apple меняла протокол авторизации App Store, поэтому старые сборки `ipatool`
могут завершаться ошибкой `something went wrong` или HTTP 403. Релиз PullApps
собирает совместимую версию из зафиксированного upstream-коммита и применяет
проверяемый патч [`patches/ipatool-auth-endpoint.patch`](patches/ipatool-auth-endpoint.patch).
Это делает сборку воспроизводимой и не зависит от текущей версии Homebrew.

Когда эквивалентное исправление стабильно войдёт в upstream-релиз, временный
патч можно будет удалить.

## Приватность и безопасность

- У проекта нет сервера, аналитики и телеметрии.
- Пароль и код 2FA не записываются PullApps на диск. Они передаются локальному
  `ipatool`, а полученный токен хранится в macOS Keychain.
- Для нескольких аккаунтов токены остаются в Keychain; локальные cookie и
  метаданные сохраняются с правами только для текущего пользователя.
- Не публикуйте логи или скриншоты с Apple ID, DSID, UDID, cookie и токенами.
- Загружайте IPA только через свой Apple ID и не используйте файлы из
  неизвестных источников, особенно для банковских приложений.

Подробная модель хранения и способ приватно сообщить об уязвимости описаны в
[`SECURITY.md`](SECURITY.md).

## Лицензия

MIT. Оригинал форка — [jowtron/ipa-downloader](https://github.com/jowtron/ipa-downloader).

## Что это НЕ

- Это не инструмент для пиратства: он скачивает только приложения, на которые у
  вашего подписанного Apple ID есть лицензия. `ipatool` не обходит ограничения.
- Пока не подписано Developer ID. При раздаче на другие Mac первый запуск — через
  системный раздел «Конфиденциальность и безопасность»; см.
  [инструкцию](docs/первый-запуск-на-macos.md).
- Не iOS: это macOS-приложение, которое общается с iPhone по USB через
  libimobiledevice; на iOS оно не запускается.
