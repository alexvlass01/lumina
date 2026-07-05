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

- 🌗 **Separate wallpapers for day and night** — one for the light theme, another for dark.
- 🖥 **A different wallpaper per monitor**, with a visual monitor map.
- ⚡ **Automatic** — the wallpaper changes the moment Windows switches theme.
- 📚 **Wallpaper library** — keep all your wallpapers in one place: mark favourites, add tags, and browse folders. Open a folder to see what's inside, step into sub-folders, and find your way back with breadcrumbs.
- 🗂 **Live folders** — connect a folder and Lumina will pick up new wallpapers you add there.
- 🔀 **Slideshow** — let a set of wallpapers rotate on a timer instead of showing just one picture.
- 🌐 **Online wallpapers** — search by tags and download fresh wallpapers right inside the app.
- 🖱 **Drag & drop** — drop an image straight onto the app to add it.
- 🌓 **Can switch the Windows theme itself** on a schedule — by fixed time or by sunrise/sunset for your location. A built-in replacement for "Auto Dark Mode".
- ⌨️ **Global hotkey** — jump to the next wallpaper with a keyboard shortcut.
- 🎮 **Game Mode** — pauses wallpaper and theme changes while you play games or use full-screen apps.
- 🥷 **Quiet switching** — when a full-screen window is open, Lumina waits and changes the wallpaper without interrupting you.
- 🎚 **Fit modes:** fill, fit, stretch, center, tile, or span across monitors.
- 📌 **Tray app** that runs in the background; 🚀 optional **autostart** with Windows.
- 🌍 **30 languages** (or just follow your system language).
- 🎨 Clean **Adwaita-style** interface with light and dark palettes.

## How it works

- Lumina watches the Windows light/dark setting (*Settings → Personalization → Colors → Mode*) and reacts instantly.
- It sets a separate wallpaper on each monitor using built-in Windows features — no extra software or drivers.
- Individual wallpapers you pick are copied into the app's own folder, so they don't disappear after an update or if you move the original. Connected live folders stay linked to their original location.

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
