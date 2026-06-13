'use strict';

const path = require('path');
const fs = require('fs');

// Pure: builds the tray context-menu template (array of items) from state.
// No Electron dependency, so the conditional menu logic is unit-testable.
//   state:   { theme, updateState, slideshowEnabled, hasSlideshowItems }
//   t:       i18n function (key -> label)
//   actions: { onOpen, onApplyCurrent, onNextWallpaper, onInstallUpdate, onQuit }
function buildMenuTemplate(state, t, actions) {
  const items = [
    { label: t('tray.open'), click: actions.onOpen },
    { label: t('tray.applyCurrent'), click: actions.onApplyCurrent },
  ];
  if (state.slideshowEnabled || state.hasSlideshowItems) {
    items.push({ label: t('tray.nextWallpaper'), click: actions.onNextWallpaper });
  }
  if (state.updateState === 'ready') {
    items.push({ type: 'separator' }, { label: t('tray.installUpdate'), click: actions.onInstallUpdate });
  }
  items.push({ type: 'separator' }, { label: t('tray.quit'), click: actions.onQuit });
  return items;
}

// System-tray controller. Electron objects, i18n, state and actions are INJECTED
// so this module has no direct coupling to app state.
//   deps: { Tray, Menu, nativeImage, assetsDir, t, getState,
//           onOpen, onApplyCurrent, onNextWallpaper, onInstallUpdate, onQuit }
function createTrayController(deps) {
  const { Tray, Menu, nativeImage, assetsDir, t, getState } = deps;
  let tray = null;

  const refresh = () => {
    if (tray) tray.setContextMenu(Menu.buildFromTemplate(buildMenuTemplate(getState(), t, deps)));
  };

  const refreshIcon = () => {
    if (!tray) return;
    const name = getState().theme === 'dark' ? 'tray-dark.png' : 'tray-light.png';
    const p = path.join(assetsDir, name);
    const finalPath = fs.existsSync(p) ? p : path.join(assetsDir, 'tray.png');
    tray.setImage(nativeImage.createFromPath(finalPath));
  };

  const create = () => {
    tray = new Tray(nativeImage.createFromPath(path.join(assetsDir, 'tray.png')));
    tray.setToolTip(deps.appName || 'Lumina');
    refresh();
    refreshIcon();
    tray.on('click', deps.onOpen);
    tray.on('double-click', deps.onOpen);
    return tray;
  };

  const destroy = () => { if (tray) { try { tray.destroy(); } catch {} tray = null; } };

  return { create, refresh, refreshIcon, destroy };
}

module.exports = { createTrayController, buildMenuTemplate };
