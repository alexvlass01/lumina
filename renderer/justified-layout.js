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

  function normalizeAspect(value, minAspect = 0.5, maxAspect = 3) {
    const n = Number(value);
    return clamp(Number.isFinite(n) && n > 0 ? n : 1.6, minAspect, maxAspect);
  }

  // Returns one { width, height } box per aspect. Complete rows fill the container;
  // the final row keeps the target height and stays left-aligned instead of stretching.
  function layout(aspects, containerWidth, options = {}) {
    const width = Math.max(1, finite(containerWidth, 1));
    const gap = Math.max(0, finite(options.gap, 12));
    const targetHeight = Math.max(1, finite(options.targetHeight, 160));
    const minAspect = Math.max(0.05, finite(options.minAspect, 0.5));
    const maxAspect = Math.max(minAspect, finite(options.maxAspect, 3));
    const safeAspects = (Array.isArray(aspects) ? aspects : [])
      .map((aspect) => normalizeAspect(aspect, minAspect, maxAspect));
    const boxes = new Array(safeAspects.length);
    let rowStart = 0;
    let rowSum = 0;

    function finish(end, fill) {
      const count = end - rowStart;
      if (count <= 0) return;
      const available = Math.max(1, width - gap * (count - 1));
      const fittedHeight = available / rowSum;
      const height = fill ? fittedHeight : Math.min(targetHeight, fittedHeight);
      for (let i = rowStart; i < end; i++) {
        boxes[i] = { width: safeAspects[i] * height, height };
      }
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
    return boxes;
  }

  return { normalizeAspect, layout };
});
