# CLAUDE.md — Lumina

Контекст проекта для будущих сессий Claude Code. Читай это перед работой.

## Что это

**Lumina** — десктоп-приложение для **Windows** на **Electron**, которое автоматически
меняет обои рабочего стола при переключении светлой/тёмной темы Windows. Стиль интерфейса —
GNOME Adwaita (как в свежей Fedora), со светлой и тёмной палитрой.

> Раньше называлось «Adwaita Wallpaper», переименовано в Lumina.

## Жёсткие ограничения (важно!)

- **Никаких тяжёлых тулчейнов.** Пользователь против установки Visual Studio / Build Tools,
  Android SDK, JDK и прочих многогигабайтных SDK. Стек выбран именно потому, что Electron
  ставится одним `npm install` поверх уже имеющегося Node. Не предлагай Flutter/нативное.
- **Платформа — только Windows.** Android отложен (и упирается в ограничение выше).
- На машине есть: `git`, `node`, `npm`, `winget`, `gh` (GitHub CLI). НЕТ: Visual Studio, JDK.

## Архитектура

Три слоя, общение через безопасный IPC-мост (contextIsolation включён):

```
main.js        — главный процесс Electron. Вся системная логика:
                 трей, отслеживание темы (nativeTheme), смена обоев,
                 автозапуск, окно, IPC-обработчики, хранение конфига.
preload.js     — мост window.api (contextBridge). Renderer НЕ имеет доступа к Node
                 напрямую — только к методам, явно проброшенным здесь.
renderer/      — интерфейс (обычный HTML/CSS/JS, без фреймворков):
  index.html   — разметка
  styles.css   — стили Adwaita (CSS-переменные :root и html.dark)
  renderer.js  — логика UI, общается с системой только через window.api
assets/        — иконки (icon.png, icon.ico, tray.png), сгенерированы PowerShell+System.Drawing
```

### Ключевые механизмы (в main.js)

- **Смена обоев:** `setWallpaper()` запускает PowerShell-скрипт (`set-wallpaper.ps1`,
  пишется в userData при старте), который через P/Invoke зовёт WinAPI `SystemParametersInfo`.
  Сторонних бинарников нет.
- **Отслеживание темы:** `nativeTheme.on('updated')` → при включённой автосмене зовёт
  `applyForTheme()`. На Windows это реагирует на «Параметры → Персонализация → Цвета → Режим».
- **Конфиг:** `%APPDATA%\lumina\config.json` (имя папки = поле `name` в package.json).
  Поля: `lightWallpaper`, `darkWallpaper`, `autoSwitch`, `style`, `autostart`.
- **Обои хранятся самодостаточно:** при выборе картинка КОПИРУЕТСЯ в `%APPDATA%\lumina\wallpapers\`
  (`importWallpaper()`), конфиг ссылается на копию. Это чтобы превью/обои не слетали при
  обновлении приложения или перемещении оригинала.
- **Трей и фон:** окно по close прячется в трей (`app.isQuitting` гасит это при настоящем выходе).
  `window-all-closed` намеренно ничего не делает — приложение живёт в трее.
- **Автозапуск:** `setLoginItemSettings({ openAtLogin, path: process.execPath, args:['--hidden'] })`.
  Флаг `--hidden` стартует свёрнутым в трей. Поэтому ВАЖНО собирать настоящий exe (см. ниже):
  в dev-режиме execPath = electron.exe и автозапуск указывал бы не туда.
- **Титулбар:** кастомный (`titleBarStyle:'hidden'` + `titleBarOverlay`), нативные кнопки окна
  накладываются справа; цвета оверлея обновляются при смене темы. Стандартное меню убрано
  (`Menu.setApplicationMenu(null)`); действия — в меню-бутерброде на титулбаре.

### UX-договорённость

Настройки применяются **мгновенно, без кнопок «Сохранить»/«Применить»** (как в GNOME):
выбрал обои — применилось; сменил расположение — переприменилось; тумблеры — сразу.

## Команды

```powershell
npm install            # зависимости (только dev: electron, electron-builder, @electron/packager)
npm start              # запуск из исходников (dev; автозапуск тут указывает на electron.exe — это норм для дебага)

# Сборка портативного exe (НЕ electron-builder — см. ниже):
node node_modules/@electron/packager/bin/electron-packager.mjs . "Lumina" --platform=win32 --arch=x64 --icon=assets/icon.ico --out=dist --overwrite --app-version=<версия> --ignore="dist" --ignore="\.claude"
# → dist/Lumina-win32-x64/Lumina.exe
```

**Почему @electron/packager, а не electron-builder:** electron-builder на этой машине падает
при распаковке `winCodeSign` (macOS-симлинки .dylib требуют режима разработчика/админ-прав).
Системные настройки не трогаем. Портативная папка из packager — рабочий и достаточный деливери.

### Превью UI без запуска Electron

Есть `.claude/launch.json` (Python http.server отдаёт `renderer/`). renderer.js при отсутствии
`window.api` подставляет мок (см. начало файла), так что страница рисуется и в обычном браузере.
Это для быстрой проверки вёрстки; системные функции там не работают.

## Релиз / версии

1. Версия — поле `version` в package.json (и `--app-version` при сборке).
2. После правок: `git add -A && git commit -m "..."`, затем `git push`.
3. Репозиторий: https://github.com/alexvlass01/lumina
4. Каждый коммит = точка возврата. Откат файлов: `git checkout <хеш> -- .`.

## Как добавлять фичи (точки расширения)

- **Новая настройка:** добавь поле в `DEFAULT_CONFIG` (main.js) → проброс через `set-config` →
  элемент в index.html → обработчик в renderer.js (применяй живо). Конфиг сам сохранится.
- **Новое системное действие:** добавь `ipcMain.handle('...')` в main.js, метод в preload.js,
  вызов в renderer.js. Не давай renderer прямой доступ к Node.
- **Пункт меню-бутерброда:** `.menu-item[data-action]` в index.html + ветка в обработчике меню renderer.js.
- При росте main.js — выноси логику в модули (`src/wallpaper.js`, `src/tray.js`, `src/config.js`)
  и require'и их из main.js. Renderer можно разнести на компоненты, но без тяжёлых фреймворков
  (договорённость про лёгкий стек).

## Известные нюансы

- Сборка портативная: если перенести папку `dist/Lumina-win32-x64`, нужно переключить автозапуск
  (он запоминает путь к exe).
- Имя папки конфига завязано на `name` в package.json — НЕ переименовывай его без миграции,
  иначе настройки «потеряются» (именно так однажды слетели превью).
