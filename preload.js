'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (patch) => ipcRenderer.invoke('set-config', patch),
  getVersion: () => ipcRenderer.invoke('get-version'),
  getI18n: () => ipcRenderer.invoke('get-i18n'),
  getMonitors: () => ipcRenderer.invoke('get-monitors'),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  addSlotImages: (monitorId, which) => ipcRenderer.invoke('add-slot-images', monitorId, which),
  addSlotFolder: (monitorId, which) => ipcRenderer.invoke('add-slot-folder', monitorId, which),
  removeSlotItem: (monitorId, which, index) => ipcRenderer.invoke('remove-slot-item', monitorId, which, index),
  clearSlot: (monitorId, which) => ipcRenderer.invoke('clear-slot', monitorId, which),
  currentImage: (monitorId, which) => ipcRenderer.invoke('current-image', monitorId, which),
  setSlideshow: (patch) => ipcRenderer.invoke('set-slideshow', patch),
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
  getUpdateState: () => ipcRenderer.invoke('get-update-state'),

  onTheme: (cb) => ipcRenderer.on('theme-changed', (_e, t) => cb(t)),
  onConfig: (cb) => ipcRenderer.on('config-changed', (_e, c) => cb(c)),
  onMonitors: (cb) => ipcRenderer.on('monitors-changed', (_e, d) => cb(d)),
  onUpdate: (cb) => ipcRenderer.on('update-status', (_e, st) => cb(st)),
});
