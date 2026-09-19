# PullApps (IPA Downloader)

macOS GUI поверх [`ipatool`](https://github.com/majd/ipatool) — вход в App Store
по Apple ID, поиск и скачивание `.ipa` для приложений, привязанных к вашему
аккаунту, а также список приложений с подключённого по USB iPhone с автопривязкой
их App Store ID (работает даже для удалённых из App Store приложений).

Собран на [Wails v2](https://wails.io/) (Go + небольшой vanilla-JS фронтенд).

## Что умеет

- **Поиск** в App Store с показом bundle ID, версии и цены прямо в списке.
- **Вход по Apple ID** прямо в приложении, с 2FA во втором шаге.
- **Скачивание `.ipa`** в выбранную папку — строка результата сама становится
  прогресс-баром по мере скачивания.
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

## Требования

- macOS (Apple Silicon — для Intel достаточно поправить пути Homebrew)
- [`ipatool`](https://github.com/majd/ipatool) — вход и скачивание:
  ```bash
  brew install ipatool
  ```
- [`libimobiledevice`](https://libimobiledevice.org/) — интеграция с iPhone
  (`ideviceinstaller` + `idevice_id`):
  ```bash
  brew install libimobiledevice ideviceinstaller
  ```
- Apple ID, у которого есть хотя бы одно приложение в истории покупок
  (бесплатные приложения подходят)

Если интеграция с iPhone не нужна, libimobiledevice можно не ставить — кнопка
**From iPhone** просто сообщит, что инструмент не найден.

> Важно: используйте свежую версию `ipatool` (2.6.0+). Старые версии ломаются
> из-за смены эндпоинта авторизации Apple в июне 2026 (ошибка
> `something went wrong`, HTTP 403). Подробнее — см. «Особенности входа».

## Сборка из исходников

Нужны:

- Go 1.23+
- Node.js 18+
- Wails CLI:
  ```bash
  go install github.com/wailsapp/wails/v2/cmd/wails@latest
  ```

Сборка:

```bash
git clone https://github.com/ВАШ_ЛОГИН/PullApps.git
cd PullApps
./scripts/build-app.sh
open build/bin/ipatool-gui.app
```

Локальная разработка с горячей перезагрузкой:

```bash
wails dev
```

## Обновление ipatool (запасной вариант)

Приложение ищет бинарник в порядке:

1. `~/Library/Application Support/ipatool-gui/bin/ipatool`
2. `Contents/Resources/bin/ipatool` внутри `.app`
3. `/opt/homebrew/bin/ipatool`

Чтобы «переопределить» версию (например, после `brew upgrade ipatool`):

```bash
mkdir -p ~/Library/Application\ Support/ipatool-gui/bin
cp /opt/homebrew/bin/ipatool ~/Library/Application\ Support/ipatool-gui/bin/ipatool
chmod +x ~/Library/Application\ Support/ipatool-gui/bin/ipatool
```

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
patches/               — патч для ipatool (см. «Особенности входа»)
docs/                  — документация на русском
.github/workflows/     — сборка универсального macOS .app в GitHub Actions
```

## Особенности входа (временный патч)

В июне 2026 Apple сменила эндпоинт авторизации App Store. Релизная версия
`ipatool` в Homebrew (2.3.x) всё ещё обращается к старому эндпоинту и вход
падает с пустым ответом `something went wrong` — это ломает и скачивание.
Исправление — upstream PR, который ещё не вышел в релиз. В этом репозитории
изменение заведено как патч (`patches/ipatool-auth-endpoint.patch`),
`scripts/build-ipatool.sh` применяет его к зафиксированному коммиту и собирает
рабочий бинарник.

Когда исправление попадёт в Homebrew-релиз `ipatool`, патч и шаг его сборки можно
будет выпилить и вернуться к обычному `brew install ipatool`.

## Лицензия

MIT. Оригинал форка — [jowtron/ipa-downloader](https://github.com/jowtron/ipa-downloader).

## Что это НЕ

- Это не инструмент для пиратства: он скачивает только приложения, на которые у
  вашего подписанного Apple ID есть лицензия. `ipatool` не обходит ограничения.
- Не подписано Developer ID. При раздаче на другие Mac первый запуск — через
  правый клик → «Открыть».
- Не iOS: это macOS-приложение, которое общается с iPhone по USB через
  libimobiledevice; на iOS оно не запускается.