# Инструкция: перенос банковских приложений на новый iPhone

Пример из жизни: СберБанк Онлайн (СБОЛ) и приложение банка MAX, которые больше не
доступны в App Store, но установлены на старом iPhone. Ниже — проверенный способ
перенести их на новый iPhone через Mac.

Дата проверки: 19 сентября 2026
Среда: Mac Apple Silicon (macOS 15.7.7), iPhone по USB.

## Схема целиком

```
ipatool (вход в Apple ID) → PullApps GUI (поиск + скачивание .ipa) → ideviceinstaller (установка на iPhone по USB)
```

Ключевые факты:

- Приложение нельзя перенести с iPhone на iPhone как файл — iOS проверяет подпись.
- Скачивать можно только приложения, у которых лицензия у вашего Apple ID.
- Установка через `ideviceinstaller` ставит оригинальный IPA так же, как это делает
  Xcode / Apple Configurator — подпись и авторизация проверяются iOS.
- Удалённые из App Store приложения (СБОЛ и т.п.) скачиваются по числовому
  App Store ID, если лицензия привязана к вашему Apple ID.

---

## Шаг 1. Установка инструментов

```bash
brew install go libimobiledevice ideviceinstaller ipatool
```

Важно: используйте совместимую версию `ipatool` — 2.6.0 и новее. Старые версии
(2.3.x) ходят на старый эндпоинт авторизации Apple (`MZFinance`) и вход падает
с ошибкой `something went wrong` (HTTP 403 от Apple). Версия 2.6.0 использует
новый протокол авторизации (SAP signing) — вход работает и доходит до кода 2FA.

GUI (этот проект) ищет бинарник `ipatool` по приоритету:

1. `~/Library/Application Support/ipatool-gui/bin/ipatool` — самое приоритетное (override);
2. внутри `.app`: `Contents/Resources/bin/ipatool`;
3. `/opt/homebrew/bin/ipatool`.

Поэтому можно «переопределить» бинарник свежей версией:

```bash
mkdir -p ~/Library/Application\ Support/ipatool-gui/bin
cp /opt/homebrew/bin/ipatool ~/Library/Application\ Support/ipatool-gui/bin/ipatool
chmod +x ~/Library/Application\ Support/ipatool-gui/bin/ipatool
```

После этого GUI нужно полностью закрыть (Cmd+Q) и открыть заново — только тогда
он перечитает путь к бинарнику.

---

## Шаг 2. Вход в Apple ID

### Вариант A — через терминал (надёжнее)

```bash
/opt/homebrew/bin/ipatool auth login -e ВАШ_APPLE_ID@icloud.com
```

- Команда сама запросит пароль (не отображается) и код 2FA.
- Внимательно проверяйте Apple ID — легко ошибиться (например, `icloude.com`
  вместо `icloud.com`).
- Пароль и код 2FA никому не передавайте и в файлы не записывайте.

### Вариант B — через GUI

1. Закрыть приложение (Cmd+Q) и открыть заново (после override бинарника).
2. Сверху плашка «not signed in» → нажать.
3. Ввести Apple ID, пароль, при необходимости код 2FA → Sign in.

### Проверка входа

```bash
/opt/homebrew/bin/ipatool auth info
```

---

## Шаг 3. Скачивание IPA

В GUI:

1. Сверху отображается ваш Apple ID.
2. Подключить старый iPhone по USB, разблокировать, нажать «Доверять».
3. Кнопка **From iPhone** → список приложений со старого iPhone (GUI сам считает
   App Store ID, работает даже для удалённых из App Store приложений).
4. Выбрать нужное приложение (СБОЛ, MAX) → **Download**.

Файл скачивается в папку, например `~/Downloads/СБОЛ.ipa`.

Полезные команды ipatool для проверки:

```bash
/opt/homebrew/bin/ipatool search "<название>"
/opt/homebrew/bin/ipatool auth info
```

---

## Шаг 4. Установка IPA на iPhone

Подключить новый iPhone по USB, разблокировать, нажать «Доверять».

В GUI: в секции **Install** нажать **Choose…**, выбрать скачанный `.ipa`,
затем **Install to iPhone**. GUI покажет прогресс установки.

### Проверка, что телефон виден (терминал)

```bash
idevice_id -l
# пример вывода: 0000AAAA-0BBB0C0D0E0F0000 (ваш UDID будет своим)

ideviceinstaller list
# показывает список приложений на телефоне
```

### Установка через терминал

```bash
ideviceinstaller install ~/Downloads/СБОЛ.ipa
```

Признак успеха — в конце вывода:

```
Install: Complete
```

### Проверка установки

```bash
ideviceinstaller list | grep -i "openbanking\|СБОЛ"
# пример: ru.oits.openbanking, "13.0.2", "СБОЛ"
```

Приложение появляется на главном экране iPhone.

---

## Шаг 5. Остальные приложения (повторить шаги 3–4)

1. Скачать `.ipa` через GUI (From iPhone → нужное приложение → Download).
2. Установить:

   ```bash
   ideviceinstaller install ~/Downloads/ИМЯ.ipa
   ```

3. Проверить:

   ```bash
   ideviceinstaller list | grep -i "имя"
   ```

---

## Ограничения и безопасность

- Инструмент скачивает ТОЛЬКО приложения, лицензированные вашему Apple ID.
- Если приложение за другим Apple ID — скачать/установить не получится; нужен
  вход в тот аккаунт (в GUI есть кнопка «Sign in as owner»).
- НЕ использовать IPA из Telegram/неизвестных сайтов и «сертификаты» сторонних
  установщиков — особенно для банковских приложений. `ideviceinstaller` ставит
  оригинальную подпись, и этот путь безопасен.