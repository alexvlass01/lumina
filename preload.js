'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (patch) => ipcRenderer.invoke('set-config', patch),
  getVersion: () => ipcRenderer.invoke('get-version'),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  pickImage: () => ipcRenderer.invoke('pick-image'),
  applyNow: (which) => ipcRenderer.invoke('apply-now', which),
  setAutostart: (v) => ipcRenderer.invoke('set-autostart', v),
  fileUrl: (p) => ipcRenderer.invoke('file-url', p),
  quitApp: () => ipcRenderer.invoke('quit-app'),

  onTheme: (cb) => ipcRenderer.on('theme-changed', (_e, t) => cb(t)),
  onConfig: (cb) => ipcRenderer.on('config-changed', (_e, c) => cb(c)),
});
