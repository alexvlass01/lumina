'use strict';

(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JustifiedLayout = api;
})(typeof window !== 'undefined' ? window : null, function createApi() {
  function finite(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // Card dimensions are serialized to two CSS decimals by renderer.js. Rounding every
  // item independently can make a mathematically exact row 0.01px wider than its
  // container, which makes flex-wrap push the last card onto the next line. Quantize
  // inside the layout and give the final item the remaining width so the row geometry
  // used by virtualization always matches the browser's physical rows.
  function roundCssPx(value) {
    return Math.round(value * 100) / 100;
  }

  function floorCssPx(value) {
    return Math.floor(value * 100 + 1e-7) / 100;
  }

  function normalizeAspect(value, minAspect = 0.5, maxAspect = 3) {
    const n = Number(value);
    return clamp(Number.isFinite(n) && n > 0 ? n : 1.6, minAspect, maxAspect);
  }

  function normalizedInputs(aspects, containerWidth, options) {
    const width = Math.max(1, finite(containerWidth, 1));
    const gap = Math.max(0, finite(options.gap, 12));
    const targetHeight = Math.max(1, finite(options.targetHeight, 160));
    const minAspect = Math.max(0.05, finite(options.minAspect, 0.5));
    const maxAspect = Math.max(minAspect, finite(options.maxAspect, 3));
    const safeAspects = (Array.isArray(aspects) ? aspects : [])
      .map((aspect) => normalizeAspect(aspect, minAspect, maxAspect));
    return { width, gap, targetHeight, safeAspects };
  }

  // Turn an already chosen row partition into CSS-safe box geometry. Canonical
  // layout and live-resize layout deliberately share this path: a 0.01px drift
  // between the two would let flex-wrap move the last card on its own.
  function layoutTopology(safeAspects, topology, width, gap, targetHeight) {
    const boxes = new Array(safeAspects.length);
    const rows = [];
    let top = 0;
    for (const template of topology) {
      const { start, end, fill } = template;
      const count = end - start;
      let rowSum = 0;
      for (let i = start; i < end; i++) rowSum += safeAspects[i];
      const available = Math.max(1, width - gap * (count - 1));
      const fittedHeight = available / rowSum;
      const height = fill ? fittedHeight : Math.min(targetHeight, fittedHeight);
      const cssHeight = roundCssPx(height);
      const cssAvailable = floorCssPx(available);
      let usedWidth = 0;
      for (let i = start; i < end; i++) {
        const isLast = i === end - 1;
        const rawWidth = safeAspects[i] * height;
        const cssWidth = fill && isLast
          ? floorCssPx(cssAvailable - usedWidth)
          : floorCssPx(rawWidth);
        boxes[i] = { width: Math.max(0.01, cssWidth), height: cssHeight };
        usedWidth += boxes[i].width;
      }
      rows.push({ start, end, top, height: cssHeight, fill });
      top += cssHeight + gap;
    }
    return {
      boxes,
      rows,
      totalHeight: rows.length ? top - gap : 0,
      gap,
    };
  }

  // Row-aware layout: one { width, height } box per aspect plus the row list
  // ({ start, end, top, height, fill }; end is exclusive) and total grid height.
  // Complete rows fill the container; the final incomplete row keeps the target
  // height and stays left-aligned instead of stretching.
  function layoutRows(aspects, containerWidth, options = {}) {
    const { width, gap, targetHeight, safeAspects } = normalizedInputs(aspects, containerWidth, options);
    const topology = [];
    let rowStart = 0;
    let rowSum = 0;

    function finish(end, fill) {
      const count = end - rowStart;
      if (count <= 0) return;
      topology.push({ start: rowStart, end, fill: !!fill });
      rowStart = end;
      rowSum = 0;
    }

    for (let i = 0; i < safeAspects.length; i++) {
      const aspect = safeAspects[i];
      rowSum += aspect;
      const count = i - rowStart + 1;
      const available = Math.max(1, width - gap * (count - 1));
      const height = available / rowSum;
      if (height <= targetHeight) {
        if (count > 1) {
          const previousAvailable = Math.max(1, width - gap * (count - 2));
          const previousHeight = previousAvailable / (rowSum - aspect);
          if (Math.abs(previousHeight - targetHeight) < Math.abs(height - targetHeight)) {
            rowSum -= aspect;
            finish(i, true);
            rowStart = i;
            rowSum = aspect;
            continue;
          }
        }
        finish(i + 1, true);
      }
    }
    finish(safeAspects.length, false);
    return layoutTopology(safeAspects, topology, width, gap, targetHeight);
  }

  // Capture only stable row-membership information needed during a native width
  // drag. Reject stale/partial partitions instead of guessing: if the item count
  // changed, renderer must do one normal canonical layout.
  function captureRowTopology(rows, itemCount) {
    const total = Number(itemCount);
    if (!Number.isInteger(total) || total < 0 || !Array.isArray(rows)) return null;
    if (total === 0) return rows.length === 0 ? [] : null;
    if (!rows.length) return null;
    const topology = [];
    let next = 0;
    for (const row of rows) {
      const start = Number(row && row.start);
      const end = Number(row && row.end);
      if (!Number.isInteger(start) || !Number.isInteger(end)
        || start !== next || end <= start || end > total
        || typeof row.fill !== 'boolean') return null;
      topology.push({ start, end, fill: row.fill });
      next = end;
    }
    return next === total ? topology : null;
  }

  // Refit the SAME cards inside the SAME rows at a new width. This is used only
  // while Windows is in a native manual-resize gesture; one canonical layout runs
  // after `resized`. Returns null when the saved membership became stale.
  function layoutRowsWithTopology(aspects, containerWidth, topology, options = {}) {
    const { width, gap, targetHeight, safeAspects } = normalizedInputs(aspects, containerWidth, options);
    const captured = captureRowTopology(topology, safeAspects.length);
    if (!captured) return null;
    return layoutTopology(safeAspects, captured, width, gap, targetHeight);
  }

  // Historic API; delegates to layoutRows so the two can never drift apart.
  function layout(aspects, containerWidth, options = {}) {
    return layoutRows(aspects, containerWidth, options).boxes;
  }

  return { normalizeAspect, layout, layoutRows, captureRowTopology, layoutRowsWithTopology };
});
