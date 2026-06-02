# Lumina

**Lumina** automatically changes your Windows desktop wallpaper when you switch between
**light and dark mode** — a different wallpaper for day and night, and a separate one for
each monitor. It lives quietly in the system tray and runs in the background. The interface
is styled after GNOME's Adwaita, with light and dark themes.

> **Windows only.**

## ⬇️ Download

**[Download the latest version »](https://github.com/alexvlass01/lumina/releases/latest)**

1. On the release page, download **`Lumina-Setup.exe`**.
2. Double-click it — Lumina installs and opens automatically (no setup wizard, like Discord or VS Code).
3. A short welcome screen helps you choose a language, turn on automatic switching and autostart, and create shortcuts.

That's it. The app keeps running in the **system tray** after you close the window — you **don't** need to run the installer again to "turn it on".

*Prefer not to install?* Download the **portable** `.zip` from the same release, unzip it anywhere, and run `Lumina.exe`.

## Features

- 🌗 **Separate wallpapers for day and night** — light theme gets one, dark theme another.
- 🖥 **A different wallpaper per monitor**, with a visual monitor map.
- ⚡ **Automatic** — the wallpaper changes the moment Windows switches theme.
- 🌓 **Can switch the Windows theme itself** on a schedule — by fixed time or by sunrise/sunset (your coordinates). A built-in replacement for "Auto Dark Mode".
- 🎚 **Fit modes:** fill, fit, stretch, center, tile, span across monitors.
- 📌 **Tray app** that runs in the background; 🚀 optional **autostart** with Windows.
- 🌍 **Languages:** English, Українська, Русский (or follow the system language).
- 🎨 Clean **Adwaita-style** interface with light and dark palettes.

## How it works

- Watches the Windows theme via Electron's `nativeTheme` (reacts to *Settings → Personalization → Colors → Mode*).
- Sets a per-monitor wallpaper through the Windows `IDesktopWallpaper` COM API — no third-party binaries.
- Images you pick are copied into the app's data folder, so they don't disappear after an update or if you move the original.

## Build from source (for developers)

```powershell
npm install
npm start            # run from source
npm run package      # portable build  -> dist/Lumina-win32-x64/
npm run installer    # installer        -> dist/installer/Lumina-Setup.exe
```

Built with Electron + plain HTML/CSS/JS — no heavy toolchains, just `npm install` over Node.

## License

MIT
