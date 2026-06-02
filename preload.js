'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (patch) => ipcRenderer.invoke('set-config', patch),
  getVersion: () => ipcRenderer.invoke('get-version'),
  getI18n: () => ipcRenderer.invoke('get-i18n'),
  getMonitors: () => ipcRenderer.invoke('get-monitors'),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  addSlotImages: (monitorId, which) => ipcRenderer.invoke('add-slot-images', monitorId, which),
  addSlotFolder: (monitorId, which) => ipcRenderer.invoke('add-slot-folder', monitorId, which),
  addSlotPaths: (monitorId, which, filePaths) => ipcRenderer.invoke('add-slot-paths', monitorId, which, filePaths),
  removeSlotItem: (monitorId, which, index) => ipcRenderer.invoke('remove-slot-item', monitorId, which, index),
  clearSlot: (monitorId, which) => ipcRenderer.invoke('clear-slot', monitorId, which),
  currentImage: (monitorId, which) => ipcRenderer.invoke('current-image', monitorId, which),
  setSlideshow: (patch) => ipcRenderer.invoke('set-slideshow', patch),
  setSlideshowIndex: (monitorId, which, index) => ipcRenderer.invoke('set-slideshow-index', monitorId, which, index),
  applyNow: (which) => ipcRenderer.invoke('apply-now', which),
  setAutostart: (v) => ipcRenderer.invoke('set-autostart', v),
  setStartMinimized: (v) => ipcRenderer.invoke('set-start-minimized', v),
  fileUrl: (p) => ipcRenderer.invoke('file-url', p),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  createShortcuts: (which) => ipcRenderer.invoke('create-shortcuts', which),
  shortcutsStatus: () => ipcRenderer.invoke('shortcuts-status'),

  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  openReleases: () => ipcRenderer.invoke('open-releases'),
  openWebsite: () => ipcRenderer.invoke('open-website'),
  detectLocation: () => ipcRenderer.invoke('detect-location'),
  getUpdateState: () => ipcRenderer.invoke('get-update-state'),

  onTheme: (cb) => ipcRenderer.on('theme-changed', (_e, t) => cb(t)),
  onConfig: (cb) => ipcRenderer.on('config-changed', (_e, c) => cb(c)),
  onMonitors: (cb) => ipcRenderer.on('monitors-changed', (_e, d) => cb(d)),
  onUpdate: (cb) => ipcRenderer.on('update-status', (_e, st) => cb(st)),
});
