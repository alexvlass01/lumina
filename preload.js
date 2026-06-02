'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (patch) => ipcRenderer.invoke('set-config', patch),
  getVersion: () => ipcRenderer.invoke('get-version'),
  getI18n: () => ipcRenderer.invoke('get-i18n'),
  getMonitors: () => ipcRenderer.invoke('get-monitors'),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  pickImage: (which, monitorId) => ipcRenderer.invoke('pick-image', which, monitorId),
  setMonitorWallpaper: (monitorId, which, path) => ipcRenderer.invoke('set-monitor-wallpaper', monitorId, which, path),
  applyNow: (which) => ipcRenderer.invoke('apply-now', which),
  setAutostart: (v) => ipcRenderer.invoke('set-autostart', v),
  fileUrl: (p) => ipcRenderer.invoke('file-url', p),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  createShortcuts: (which) => ipcRenderer.invoke('create-shortcuts', which),
  shortcutsStatus: () => ipcRenderer.invoke('shortcuts-status'),

  onTheme: (cb) => ipcRenderer.on('theme-changed', (_e, t) => cb(t)),
  onConfig: (cb) => ipcRenderer.on('config-changed', (_e, c) => cb(c)),
  onMonitors: (cb) => ipcRenderer.on('monitors-changed', (_e, d) => cb(d)),
});
