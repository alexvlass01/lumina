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
const fs = require('fs');
const electronInstaller = require('electron-winstaller');

const root = path.resolve(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;

// update.electronjs.org (наш фид автообновления) переписывает в абсолютную
// GitHub-ссылку ТОЛЬКО ПЕРВУЮ строку RELEASES (src/updates.ts: matches[0]).
// electron-winstaller же копит RELEASES в несколько строк (baseline-full + delta
// + новый full), и первой идёт СТАРЫЙ baseline → реальные пакеты остаются «голыми»
// именами, Squirrel качает их с прокси, получает JSON вместо .nupkg и падает с
// "Checksummed file size doesn't match". Поэтому оставляем в публикуемом RELEASES
// РОВНО ОДНУ строку — full-пакет текущей версии. Минус — обновление всегда полное
// (~весь .nupkg, без delta), но это единственный надёжный путь для этого фида.
function trimReleasesToCurrentFull() {
  const releasesPath = path.join(root, 'dist', 'installer', 'RELEASES');
  const fullName = `Lumina-${version}-full.nupkg`;
  const raw = fs.readFileSync(releasesPath, 'utf8').replace(/^﻿/, '');
  const line = raw.split(/\r?\n/).find((l) => l.includes(fullName));
  if (!line) throw new Error(`RELEASES: не найдена строка для ${fullName}`);
  fs.writeFileSync(releasesPath, line, { encoding: 'utf8' }); // utf8, без BOM
  console.log(`RELEASES обрезан до одной строки: ${fullName}`);
}

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
  .then(() => {
    trimReleasesToCurrentFull();
    console.log('Installer built: dist/installer/Lumina-Setup.exe');
  })
  .catch((e) => {
    console.error('Installer build failed:', e.message || e);
    process.exit(1);
  });
