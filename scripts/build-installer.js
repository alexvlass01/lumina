'use strict';

// Builds a Windows installer (Setup.exe) with Squirrel via electron-winstaller.
// We use Squirrel because electron-builder's NSIS target can't be built on this
// machine (winCodeSign extraction needs Developer Mode/admin for macOS symlinks).
//
// Prereq: build the app first ->
//   node node_modules/@electron/packager/bin/electron-packager.mjs . "Lumina" \
//     --platform=win32 --arch=x64 --icon=assets/icon.ico --out=dist --overwrite --app-version=<v>
//
// Output: dist/installer/Lumina-Setup.exe (+ .nupkg + RELEASES for auto-update).

const path = require('path');
const electronInstaller = require('electron-winstaller');

const root = path.resolve(__dirname, '..');

electronInstaller
  .createWindowsInstaller({
    appDirectory: path.join(root, 'dist', 'Lumina-win32-x64'),
    outputDirectory: path.join(root, 'dist', 'installer'),
    exe: 'Lumina.exe',
    name: 'Lumina',
    title: 'Lumina',
    authors: 'alexv',
    setupExe: 'Lumina-Setup.exe',
    setupIcon: path.join(root, 'assets', 'icon.ico'),
    noMsi: true,
  })
  .then(() => console.log('Installer built: dist/installer/Lumina-Setup.exe'))
  .catch((e) => {
    console.error('Installer build failed:', e.message || e);
    process.exit(1);
  });
