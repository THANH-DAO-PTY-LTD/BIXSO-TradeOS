'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { WorkflowService, FileWorkflowRepository } = require('../src');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sourcing-os-'));
const buyer = { tenantId: 'acme-cafe', actorId: 'mai', role: 'buyer' };

test('file repository survives a restart with records, history and idempotency', async () => {
  const file = path.join(tmp(), 'data.json');
  const first = new WorkflowService(new FileWorkflowRepository(file));
  await first.create(buyer, { id: 'D-1', flowCode: 'BUY-01', payload: { product: 'Beans', quantity: 5, unit: 'kg', destination: 'Melbourne' } }, 'k1');
  await first.transition(buyer, 'D-1', { action: 'submit_demand', expectedVersion: 1 }, 'k2');

  const reopened = new WorkflowService(new FileWorkflowRepository(file));
  const record = await reopened.get(buyer, 'D-1');
  assert.equal(record.state, 'pending_approval');
  assert.equal((await reopened.history(buyer, 'D-1')).receipts.length, 1);
  const replay = await reopened.transition(buyer, 'D-1', { action: 'submit_demand', expectedVersion: 1 }, 'k2');
  assert.equal(replay.duplicate, true);
});

test('file repository refuses an unknown data format', () => {
  const file = path.join(tmp(), 'data.json');
  fs.writeFileSync(file, JSON.stringify({ format: 'something-else' }));
  assert.throws(() => new FileWorkflowRepository(file), /Unsupported data file format/);
});

test('CLI walks a demand through maker-checker approval', () => {
  const dir = tmp();
  const env = { ...process.env, SOURCINGOS_DATA: path.join(dir, 'data.json') };
  const cli = (...args) => execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'sourcingos.js'), ...args], { env, encoding: 'utf8' });
  assert.match(cli('flows'), /TRU-01/);
  cli('new', 'BUY-01', '--as', 'buyer:mai@acme-cafe', '--id', 'D-9', '--set', 'product=Beans', '--set', 'quantity=12', '--set', 'unit=kg', '--set', 'destination=Melbourne');
  assert.match(cli('act', 'D-9', 'submit_demand', '--as', 'buyer:mai@acme-cafe'), /pending_approval/);
  assert.throws(() => cli('act', 'D-9', 'approve_demand', '--as', 'checker:mai@acme-cafe'), (e) => /MAKER_CHECKER_VIOLATION/.test(e.stderr));
  assert.match(cli('act', 'D-9', 'approve_demand', '--as', 'checker:linh@acme-cafe'), /completed/);
  assert.match(cli('history', 'D-9', '--as', 'buyer:mai@acme-cafe'), /approve_demand/);
  assert.throws(() => cli('show', 'D-9', '--as', 'buyer:tom@other-org'), (e) => /RECORD_NOT_FOUND/.test(e.stderr));
  assert.throws(() => cli('new', 'BUY-01', '--as', 'system:bot@acme-cafe'), (e) => /reserved/.test(e.stderr));
});
