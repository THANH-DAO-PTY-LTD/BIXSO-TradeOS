'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FLOW_CATALOG } = require('../src/catalog');
const { MemoryWorkflowRepository } = require('../src/memoryRepository');
const { WorkflowService } = require('../src/service');
const { FIELDS, PREREQUISITES } = require('../src/inputContract');

async function createFixture(service, identity, input, key) {
  const payload = Object.fromEntries((FIELDS[Number(input.flowId)] || []).map((field) => [field, ['quantity', 'price', 'capacity'].includes(field) ? 10 : field === 'inviteeEmail' ? 'seller@example.test' : field === 'invitedRole' ? 'seller' : `fixture-${field}`]));
  if ('sourceRecordId' in payload) {
    payload.sourceRecordId = `SOURCE-${input.id}`;
    const source = { id: payload.sourceRecordId, tenantId: identity.tenantId, flowId: String(PREREQUISITES[Number(input.flowId)] || 3).padStart(2, '0'), state: 'completed', payload: {}, version: 1, createdBy: 'fixture-maker', updatedAt: '2026-09-01T00:00:00Z' };
    await service.repo.create(source, `fixture-source-${input.id}`);
  }
  return service.create(identity, { ...input, payload: { ...payload, ...input.payload } }, key);
}

const ctx = (role = 'buyer', actorId = 'user-1', tenantId = 'org-1') => ({ role, actorId, tenantId, requestId: 'req-1' });

test('catalog exposes exactly the Finalised Flow 01-19 inventory', () => {
  assert.equal(FLOW_CATALOG.length, 19);
  assert.deepEqual(FLOW_CATALOG.map((f) => f.id), Array.from({ length: 19 }, (_, i) => String(i + 1).padStart(2, '0')));
  assert.equal(FLOW_CATALOG.at(-1).code, 'TRU-01');
});

test('every flow is executable and creates a tenant-scoped initial record', async () => {
  const service = new WorkflowService(new MemoryWorkflowRepository());
  for (const flow of FLOW_CATALOG) {
    const result = await createFixture(service,ctx(), { id: `R-${flow.id}`, flowId: flow.id }, `create-${flow.id}`);
    assert.equal(result.record.flowId, flow.id);
    assert.equal(result.record.state, flow.initialState);
    assert.equal(result.record.trust.value, 0);
  }
});

test('create and transition are idempotent', async () => {
  const service = new WorkflowService(new MemoryWorkflowRepository());
  const first = await createFixture(service,ctx(), { id: 'D-1', flowId: '03' }, 'idem-create');
  const duplicate = await createFixture(service,ctx(), { id: 'D-1', flowId: '03' }, 'idem-create');
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.record.id, first.record.id);
  const moved = await service.transition(ctx(), 'D-1', { action: 'submit_demand', expectedVersion: 1 }, 'idem-transition');
  const replay = await service.transition(ctx(), 'D-1', { action: 'submit_demand', expectedVersion: 1 }, 'idem-transition');
  assert.equal(moved.record.state, 'pending_approval');
  assert.equal(replay.duplicate, true);
  assert.equal(replay.record.version, 2);
});

test('tenant isolation is fail-closed', async () => {
  const service = new WorkflowService(new MemoryWorkflowRepository());
  await createFixture(service,ctx(), { id: 'PRIVATE', flowId: '03' }, 'private-create');
  await assert.rejects(() => service.get(ctx('buyer', 'other', 'org-2'), 'PRIVATE'), (err) => err.code === 'RECORD_NOT_FOUND');
  assert.deepEqual(await service.list(ctx('buyer', 'other', 'org-2'), {}), []);
});

test('optimistic concurrency prevents stale writes', async () => {
  const service = new WorkflowService(new MemoryWorkflowRepository());
  await createFixture(service,ctx(), { id: 'D-2', flowId: '03' }, 'd2-create');
  await service.transition(ctx(), 'D-2', { action: 'submit_demand', expectedVersion: 1 }, 'd2-submit');
  await assert.rejects(
    () => service.transition(ctx('checker', 'checker-1'), 'D-2', { action: 'approve_demand', expectedVersion: 1 }, 'd2-approve-stale'),
    (err) => err.code === 'VERSION_CONFLICT'
  );
});

test('Maker-Checker blocks self approval and accepts an independent checker', async () => {
  const service = new WorkflowService(new MemoryWorkflowRepository());
  await createFixture(service,ctx(), { id: 'D-3', flowId: '03' }, 'd3-create');
  await service.transition(ctx(), 'D-3', { action: 'submit_demand', expectedVersion: 1 }, 'd3-submit');
  await assert.rejects(
    () => service.transition(ctx('checker', 'user-1'), 'D-3', { action: 'approve_demand', expectedVersion: 2 }, 'd3-self'),
    (err) => err.code === 'MAKER_CHECKER_VIOLATION'
  );
  const approved = await service.transition(ctx('checker', 'checker-2'), 'D-3', { action: 'approve_demand', expectedVersion: 2 }, 'd3-approve');
  assert.equal(approved.record.state, 'completed');
  assert.match(approved.receipt.hash, /^[a-f0-9]{64}$/);
});

test('append-only history carries transition and immutable receipt', async () => {
  const service = new WorkflowService(new MemoryWorkflowRepository());
  await createFixture(service,ctx(), { id: 'RFQ-1', flowId: '13' }, 'rfq-create');
  await service.transition(ctx(), 'RFQ-1', { action: 'submit_rfq', expectedVersion: 1 }, 'rfq-submit');
  const history = await service.history(ctx(), 'RFQ-1');
  assert.equal(history.events.length, 1);
  assert.equal(history.receipts.length, 1);
  assert.equal(history.events[0].action, 'submit_rfq');
  assert.equal(history.receipts[0].version, 2);
});

test('Trust remains fail-closed without five-part receipt eligibility', async () => {
  const service = new WorkflowService(new MemoryWorkflowRepository());
  await createFixture(service,ctx(), { id: 'TRUST-1', flowId: '19' }, 'trust-create');
  await assert.rejects(
    () => service.transition({ ...ctx('system', 'trust-engine'), systemVerified: true }, 'TRUST-1', { action: 'seal_receipts', expectedVersion: 1, receipts: [{ sourceType: 'carrier' }] }, 'trust-bad'),
    (err) => err.code === 'TRUST_VERIFIER_UNAVAILABLE'
  );
  assert.equal((await service.get(ctx(), 'TRUST-1')).trust.value, 0);
});

test('Trust commits only server-verified independent evidence and server policy output', async () => {
  const receipt = { sourceType: 'carrier', sourceRef: 'C-1', subjectRef: 'O-1', observedAt: '2026-09-01T00:00:00Z', evidenceHash: 'a'.repeat(64), verified: true, independent: true, tenantId: 'org-1' };
  const service = new WorkflowService(new MemoryWorkflowRepository(), { trustedReceiptResolver: async () => receipt, trustPolicy: async () => ({ value: 82, policyVersion: 'test-policy-v1' }) });
  const engine = { ...ctx('system', 'engine'), systemVerified: true };
  await createFixture(service,ctx(), { id: 'TRUST-2', flowId: '19', payload: { subjectRef: 'O-1' } }, 'trust2-create');
  await assert.rejects(() => service.transition(ctx('system', 'engine'), 'TRUST-2', { action: 'seal_receipts', expectedVersion: 1, receiptIds: ['R1'] }, 'fake-engine'), (e) => e.code === 'SYSTEM_IDENTITY_REQUIRED');
  await service.transition(engine, 'TRUST-2', { action: 'seal_receipts', expectedVersion: 1, receiptIds: ['R1'] }, 'trust2-seal');
  await service.transition(ctx('checker', 'checker-2'), 'TRUST-2', { action: 'approve_eligibility', expectedVersion: 2 }, 'trust2-approve');
  await service.transition(engine, 'TRUST-2', { action: 'compute_trust', expectedVersion: 3 }, 'trust2-compute');
  await assert.rejects(() => service.transition(engine, 'TRUST-2', { action: 'commit_trust', expectedVersion: 4, policyVersion: 'client', value: 999999 }, 'trust2-forge'), (e) => e.code === 'TRUST_CLIENT_COMPUTATION_FORBIDDEN');
  const committed = await service.transition(engine, 'TRUST-2', { action: 'commit_trust', expectedVersion: 4 }, 'trust2-commit');
  assert.equal(committed.record.trust.value, 82);
  assert.equal(committed.record.trust.policyVersion, 'test-policy-v1');
  assert.equal(committed.record.state, 'completed');
});

test('Negotiation Room supports schedule, lifecycle, chat and consent-gated AI notes', async () => {
  const service = new WorkflowService(new MemoryWorkflowRepository());
  await createFixture(service,ctx(), { id: 'NEG-1', flowId: '15', partyTenantIds: ['org-2'] }, 'neg-create');
  const room = await service.createRoom(ctx(), { recordId: 'NEG-1', scheduledFor: '2026-09-03T05:00:00Z', mediaMode: 'video' });
  assert.equal(room.status, 'scheduled');
  assert.deepEqual(room.participantTenantIds, ['org-1', 'org-2']);
  const live = await service.updateRoom(ctx(), room.id, { status: 'live', aiNotesEnabled: true, recordingConsent: false });
  assert.equal(live.aiNotesEnabled, false);
  const consented = await service.updateRoom(ctx(), room.id, { status: 'live', aiNotesEnabled: true, recordingConsent: true });
  assert.equal(consented.aiNotesEnabled, false);
  const bilateralConsent = await service.updateRoom(ctx('seller', 'seller-1', 'org-2'), room.id, { status: 'live', aiNotesEnabled: true, recordingConsent: true });
  assert.equal(bilateralConsent.aiNotesEnabled, true);
  await assert.rejects(() => service.updateRoom(ctx(), room.id, { status: 'closed' }), (e) => e.code === 'ROOM_TRANSITION_INVALID');
  await service.sendMessage(ctx(), room.id, { text: 'Confirm Incoterms and inspection scope.' });
  assert.equal((await service.messages(ctx(), room.id, 10)).length, 1);
});

test('admin projection masks commercial payload and identities', async () => {
  const service = new WorkflowService(new MemoryWorkflowRepository());
  const created = await createFixture(service,ctx(), { id: 'Q-1', flowId: '14', payload: { unitPrice: 2000, privateMargin: 10 } }, 'q-create');
  const projection = service.adminProjection(created.record);
  assert.equal(projection.payload, undefined);
  assert.equal(projection.createdBy, undefined);
  assert.equal(projection.flowCode, 'QUO-01');
});


test('invited organization shares canonical record, history and room messages without expanding ACL', async () => {
  const service = new WorkflowService(new MemoryWorkflowRepository());
  const buyer = ctx(); const seller = ctx('seller', 'seller-1', 'org-2'); const stranger = ctx('seller', 'stranger', 'org-3');
  await createFixture(service,buyer, { id: 'SHARED', flowId: '15', partyTenantIds: ['org-2'] }, 'shared-create');
  assert.equal((await service.get(seller, 'SHARED')).tenantId, 'org-1');
  assert.equal((await service.list(seller, {})).length, 1);
  await assert.rejects(() => service.createRoom(seller, { recordId: 'SHARED', participantTenantIds: ['org-3'] }), (e) => e.code === 'ROOM_PARTICIPANT_FORBIDDEN');
  const room = await service.createRoom(buyer, { id: 'ROOM-SHARED', recordId: 'SHARED', scheduledFor: '2026-10-02T00:00:00Z' });
  await service.sendMessage(seller, room.id, { text: 'Seller confirms scope' });
  assert.equal((await service.messages(buyer, room.id, 10))[0].actorTenantId, 'org-2');
  await service.updateRoom(seller, room.id, { status: 'live' });
  assert.equal((await service.room(buyer, room.id)).status, 'live');
  await assert.rejects(() => service.messages(stranger, room.id, 10), (e) => e.code === 'ROOM_NOT_FOUND');
  await assert.rejects(() => service.inviteParties(seller, 'SHARED', { expectedVersion: 1, partyTenantIds: ['org-3'] }, 'escalate'), (e) => e.code === 'PARTY_INVITE_FORBIDDEN');
  await assert.rejects(() => service.createRoom(seller, { id: room.id, recordId: 'SHARED' }), (e) => e.code === 'ROOM_EXISTS');
});

test('legacy client party arrays grant no access until explicit owner invitation', async () => {
  const repo = new MemoryWorkflowRepository(); const service = new WorkflowService(repo);
  await createFixture(service,ctx(), { id: 'LEGACY', flowId: '15', partyTenantIds: ['org-2'] }, 'legacy');
  const old = repo.records.get('org-1:LEGACY'); delete old.aclVersion; delete old.aclTenantIds;
  await assert.rejects(() => service.get(ctx('seller', 'seller', 'org-2'), 'LEGACY'), (e) => e.code === 'RECORD_NOT_FOUND');
  await service.inviteParties(ctx(), 'LEGACY', { expectedVersion: 1, partyTenantIds: ['org-2'] }, 'explicit-invite');
  assert.equal((await service.get(ctx('seller', 'seller', 'org-2'), 'LEGACY')).version, 2);
});

test('list filters and stable cursor run before limits, including records past 500', async () => {
  const repo = new MemoryWorkflowRepository(); const service = new WorkflowService(repo);
  for (let i = 0; i < 510; i++) {
    const record = (await createFixture(service,ctx(), { id: `ORDER-${String(i).padStart(3, '0')}`, flowId: i >= 500 ? '15' : '03' }, `list-${i}`)).record;
    record.updatedAt = '2026-10-01T00:00:00.000Z'; repo.records.set(`org-1:${record.id}`, record);
  }
  const first = await service.list(ctx(), { flowId: '15', limit: 5 });
  const last = first.at(-1);
  const second = await service.list(ctx(), { flowId: '15', limit: 5, cursor: { updatedAt: last.updatedAt, id: last.id } });
  assert.deepEqual([...first, ...second].map((r) => r.id), Array.from({ length: 10 }, (_, i) => `ORDER-${500 + i}`));
});


test('maker-checker checks actual submitter and countersign requires the independent first-signer counterparty', async () => {
  const service = new WorkflowService(new MemoryWorkflowRepository());
  await createFixture(service,ctx('buyer', 'creator'), { id: 'CONTRACT', flowId: '17', partyTenantIds: ['org-2'] }, 'contract');
  await service.transition(ctx('buyer', 'submitter'), 'CONTRACT', { action: 'submit_contract', expectedVersion: 1 }, 'submit');
  await assert.rejects(() => service.transition(ctx('checker', 'submitter'), 'CONTRACT', { action: 'approve_contract', expectedVersion: 2 }, 'self-check'), (e) => e.code === 'MAKER_CHECKER_VIOLATION');
  await service.transition(ctx('checker', 'checker'), 'CONTRACT', { action: 'approve_contract', expectedVersion: 2 }, 'approve');
  await service.transition(ctx('seller', 'first-signer', 'org-2'), 'CONTRACT', { action: 'sign_contract', expectedVersion: 3 }, 'first-sign');
  await assert.rejects(() => service.transition(ctx('buyer', 'first-signer', 'org-2'), 'CONTRACT', { action: 'countersign_contract', expectedVersion: 4 }, 'same-signer'), (e) => e.code === 'COUNTERSIGN_INDEPENDENCE_REQUIRED');
  await assert.rejects(() => service.transition(ctx('buyer', 'another-signer', 'org-2'), 'CONTRACT', { action: 'countersign_contract', expectedVersion: 4 }, 'same-org'), (e) => e.code === 'COUNTERSIGN_INDEPENDENCE_REQUIRED');
  const signed = await service.transition(ctx('buyer', 'creator'), 'CONTRACT', { action: 'countersign_contract', expectedVersion: 4 }, 'second-sign');
  assert.equal(signed.record.counterSignature.actorId, 'creator');
});

test('all engine actions and provider events reject unverified callers', async () => {
  const service = new WorkflowService(new MemoryWorkflowRepository());
  await createFixture(service,ctx(), { id: 'ENGINE', flowId: '05' }, 'engine-create');
  await assert.rejects(() => service.transition(ctx('system', 'fake'), 'ENGINE', { action: 'start_discovery', expectedVersion: 1 }, 'fake-start'), (e) => e.code === 'SYSTEM_IDENTITY_REQUIRED');
  await assert.rejects(() => service.transition(ctx(), 'ENGINE', { action: 'start_discovery', expectedVersion: 1, providerEvent: { id: 'forged' } }, 'fake-provider'), (e) => e.code === 'PROVIDER_STATE_FORBIDDEN');
  await service.transition(ctx(), 'ENGINE', { action: 'start_discovery', expectedVersion: 1 }, 'buyer-start');
  await assert.rejects(() => service.transition(ctx('system', 'fake'), 'ENGINE', { action: 'qualify_candidates', expectedVersion: 2 }, 'fake-qualify'), (e) => e.code === 'SYSTEM_IDENTITY_REQUIRED');
});


test('Trust rejects scoped provenance failures and immutable subject/evidence patches', async () => {
  const engine = { ...ctx('system', 'engine'), systemVerified: true };
  const base = { sourceType: 'carrier', sourceRef: 'C1', subjectRef: 'O1', observedAt: '2026-09-01T00:00:00Z', evidenceHash: 'a'.repeat(64), verified: true, independent: true, tenantId: 'org-1' };
  for (const [name, mutation] of Object.entries({ unverified: { verified: false }, dependent: { independent: false }, wrongTenant: { tenantId: 'org-2' }, wrongSubject: { subjectRef: 'OTHER' }, invalidHash: { evidenceHash: 'fake' } })) {
    const service = new WorkflowService(new MemoryWorkflowRepository(), { trustedReceiptResolver: async () => ({ ...base, ...mutation }) });
    await createFixture(service,ctx(), { id: `TR-${name}`, flowId: '19', payload: { subjectRef: 'O1' } }, name);
    await assert.rejects(() => service.transition(engine, `TR-${name}`, { action: 'seal_receipts', expectedVersion: 1, receiptIds: ['R1'] }, `${name}-seal`), (e) => e.code === 'TRUST_RECEIPT_INELIGIBLE');
  }
  const service = new WorkflowService(new MemoryWorkflowRepository(), { trustedReceiptResolver: async () => base });
  await createFixture(service,ctx(), { id: 'TR-PATCH', flowId: '19', payload: { subjectRef: 'O1' } }, 'patch');
  await assert.rejects(() => service.transition(engine, 'TR-PATCH', { action: 'seal_receipts', expectedVersion: 1, receiptIds: ['R1'], patch: { subjectRef: 'OTHER' } }, 'patch-seal'), (e) => e.code === 'TRUST_EVIDENCE_IMMUTABLE');
});


test('direct workflows cannot submit blank data, invalid quantities, incomplete or cross-tenant prerequisites', async () => {
  const service = new WorkflowService(new MemoryWorkflowRepository());
  await service.create(ctx(), { id: 'BLANK', flowId: '03' }, 'blank');
  await assert.rejects(() => service.transition(ctx(), 'BLANK', { action: 'submit_demand', expectedVersion: 1 }, 'blank-submit'), (e) => e.code === 'WORKFLOW_FIELD_REQUIRED');
  await assert.rejects(() => service.transition(ctx(), 'BLANK', { action: 'submit_demand', expectedVersion: 1, patch: { product: 'Resin', quantity: -1, unit: 't', destination: 'Melbourne' } }, 'invalid-qty'), (e) => e.code === 'WORKFLOW_NUMBER_INVALID');
  await createFixture(service, ctx(), { id: 'DRAFT-SOURCE', flowId: '03' }, 'source-draft');
  await service.create(ctx(), { id: 'INVALID-RFQ', flowId: '13', payload: { sourceRecordId: 'DRAFT-SOURCE', deliveryTerms: 'FOB' } }, 'rfq-draft');
  await assert.rejects(() => service.transition(ctx(), 'INVALID-RFQ', { action: 'submit_rfq', expectedVersion: 1 }, 'rfq-submit'), (e) => e.code === 'PREREQUISITE_NOT_COMPLETE');
  await createFixture(service, ctx('buyer', 'private-user', 'org-private'), { id: 'PRIVATE-SOURCE', flowId: '03' }, 'private-source');
  await assert.rejects(() => service.transition(ctx(), 'INVALID-RFQ', { action: 'submit_rfq', expectedVersion: 1, patch: { sourceRecordId: 'PRIVATE-SOURCE' } }, 'cross-tenant-source'), (e) => e.code === 'RECORD_NOT_FOUND');
});
