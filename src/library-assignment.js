'use strict';

// One synchronous transaction for the pool + slot mutation. Filesystem validation
// stays in main.js and must set allowCreate only after the path/type is confirmed.
// Therefore every failure returned here leaves both config.library and slots intact.

const library = require('./library');

function assignmentError(config, error) {
  return { config, ok: false, error, id: null, created: false };
}

function assignRecord(config, record, monitorId, which, options = {}) {
  if (!config || typeof config !== 'object' || !config.library || typeof config.library !== 'object'
      || !config.monitors || typeof config.monitors !== 'object'
      || !monitorId || !record || typeof record !== 'object') {
    return assignmentError(config, 'bad_request');
  }

  let item = record.id ? library.getItem(config.library, record.id) : null;
  if (!item && typeof record.path === 'string' && record.path) {
    item = library.getItem(config.library, library.idFor(record.path));
  }

  let created = false;
  if (!item) {
    if (!options.allowCreate || typeof record.path !== 'string' || !record.path) {
      return assignmentError(config, 'missing_item');
    }
    const type = record.type === 'folder' ? 'folder' : 'image';
    const id = library.addPath(config.library, type, record.path, options.extra);
    item = library.getItem(config.library, id);
    if (!item) return assignmentError(config, 'missing_item');
    created = true;
  }

  const theme = which === 'dark' ? 'dark' : 'light';
  if (!config.monitors[monitorId]) {
    config.monitors[monitorId] = { light: { itemIds: [] }, dark: { itemIds: [] } };
  }
  const monitor = config.monitors[monitorId];
  if (!monitor.light || !Array.isArray(monitor.light.itemIds)) monitor.light = { itemIds: [] };
  if (!monitor.dark || !Array.isArray(monitor.dark.itemIds)) monitor.dark = { itemIds: [] };
  const slot = monitor[theme];
  if (!slot.itemIds.includes(item.id)) slot.itemIds.push(item.id);
  library.clearSlotExplicitEmpty(slot);

  return { config, ok: true, error: null, id: item.id, created, item };
}

function assignRecords(config, preparedRecords, monitorId, which) {
  if (!config || typeof config !== 'object' || !config.library || typeof config.library !== 'object'
      || !config.monitors || typeof config.monitors !== 'object' || !monitorId
      || !Array.isArray(preparedRecords) || !preparedRecords.length) {
    return { config, ok: false, error: 'bad_request', assigned: 0, failed: 0, ids: [], createdIds: [], items: [] };
  }
  const ids = [];
  const createdIds = [];
  const items = [];
  let failed = 0;
  for (const prepared of preparedRecords) {
    const record = prepared && prepared.record;
    const options = (prepared && prepared.options) || {};
    if (!record || typeof record !== 'object') { failed += 1; continue; }
    let item = record.id ? library.getItem(config.library, record.id) : null;
    if (!item && typeof record.path === 'string' && record.path) {
      item = library.getItem(config.library, library.idFor(record.path));
    }
    if (!item && options.allowCreate && typeof record.path === 'string' && record.path) {
      const type = record.type === 'folder' ? 'folder' : 'image';
      const id = library.addPath(config.library, type, record.path, options.extra);
      item = library.getItem(config.library, id);
      if (item) createdIds.push(item.id);
    }
    if (!item) { failed += 1; continue; }
    ids.push(item.id);
    items.push(item);
  }
  if (ids.length) {
    const theme = which === 'dark' ? 'dark' : 'light';
    if (!config.monitors[monitorId]) {
      config.monitors[monitorId] = { light: { itemIds: [] }, dark: { itemIds: [] } };
    }
    const monitor = config.monitors[monitorId];
    if (!monitor.light || !Array.isArray(monitor.light.itemIds)) monitor.light = { itemIds: [] };
    if (!monitor.dark || !Array.isArray(monitor.dark.itemIds)) monitor.dark = { itemIds: [] };
    const slot = monitor[theme];
    const slotIds = new Set(slot.itemIds);
    for (const id of ids) {
      if (slotIds.has(id)) continue;
      slotIds.add(id);
      slot.itemIds.push(id);
    }
    library.clearSlotExplicitEmpty(slot);
  }
  return {
    config,
    ok: ids.length > 0,
    error: ids.length ? null : 'missing_item',
    assigned: ids.length,
    failed,
    ids,
    createdIds,
    items,
  };
}

module.exports = { assignRecord, assignRecords };
