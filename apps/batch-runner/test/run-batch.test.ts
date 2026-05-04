import { expect, test } from 'vitest';
import { runBatch } from '../src';

const rows = [
  { sku: '10001', newTitle: 'A' },
  { sku: '10002', newTitle: 'B' }
];

test('dry-run does not call the script function', async () => {
  let called = false;
  const results = await runBatch({
    rows,
    dryRun: true,
    maxRows: 1,
    scriptFunction: async () => {
      called = true;
    }
  });

  expect(called).toBe(false);
  expect(results).toHaveLength(1);
  expect(results[0].status).toBe('dry-run');
});

test('continues after a row failure by default', async () => {
  const results = await runBatch({
    rows,
    scriptFunction: async (_page, row) => {
      if (row.sku === '10001') throw new Error('first row failed');
    }
  });

  expect(results.map((result) => result.status)).toEqual(['failed', 'success']);
});

test('stops on first failure when failFast is enabled', async () => {
  const results = await runBatch({
    rows,
    failFast: true,
    scriptFunction: async () => {
      throw new Error('stop');
    }
  });

  expect(results).toHaveLength(1);
  expect(results[0].status).toBe('failed');
});
