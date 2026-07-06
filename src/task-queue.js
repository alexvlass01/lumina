'use strict';

function createTaskQueue(limit) {
  const max = Math.max(1, Math.floor(Number(limit) || 1));
  const queue = [];
  let active = 0;

  const pump = () => {
    while (active < max && queue.length) {
      const job = queue.shift();
      active += 1;
      Promise.resolve()
        .then(job.fn)
        .then(job.resolve, job.reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };

  return function enqueue(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      pump();
    });
  };
}

module.exports = { createTaskQueue };
