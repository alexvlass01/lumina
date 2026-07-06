'use strict';

const assert = require('assert');
const { createTaskQueue } = require('../src/task-queue');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  const run = createTaskQueue(2);
  let active = 0;
  let maxActive = 0;
  const tasks = Array.from({ length: 6 }, (_, index) => run(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await wait(10);
    active -= 1;
    return index;
  }));
  const result = await Promise.all(tasks);
  assert.deepStrictEqual(result, [0, 1, 2, 3, 4, 5]);
  assert.strictEqual(maxActive, 2);

  const single = createTaskQueue(0);
  let order = '';
  await Promise.all([
    single(async () => { await wait(5); order += 'a'; }),
    single(async () => { order += 'b'; }),
  ]);
  assert.strictEqual(order, 'ab');

  console.log('task-queue.test.js ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
