'use strict';

const crypto = require('crypto');
const { FLOW_CATALOG, getFlow } = require('./catalog');
const { WorkflowError } = require('./errors');
const { validateWorkflowInput } = require('./inputContract');

const RECEIPT_REQUIRED = ['sourceType', 'sourceRef', 'subjectRef', 'observedAt', 'evidenceHash'];

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`; }
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function asArray(value) { return Array.isArray(value) ? value : [value]; }
function cleanObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }

class WorkflowService {
  constructor(repository, { trustedReceiptResolver, trustPolicy } = {}) {
    this.repo = repository;
    this.trustedReceiptResolver = trustedReceiptResolver;
    this.trustPolicy = trustPolicy;
  }

  capabilities() { return { trust: { receiptVerification: !!this.trustedReceiptResolver, policyComputation: !!this.trustPolicy } }; }

  catalog() {
    return FLOW_CATALOG.map((flow) => ({ ...flow, transitionCount: flow.transitions.length }));
  }

  async create(ctx, input, idempotencyKey) {
    if (!idempotencyKey) throw new WorkflowError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    if (Object.keys(cleanObject(input.providerState)).length && !ctx.systemVerified) throw new WorkflowError(403, 'PROVIDER_STATE_FORBIDDEN', 'Provider state may only be supplied by a verified server');
    const definition = getFlow(input.flowId || input.flowCode);
    if (!definition) throw new WorkflowError(400, 'FLOW_UNKNOWN', 'Unknown workflow');
    const parties = [...new Set([ctx.tenantId, ...asArray(input.partyTenantIds || []).map(String)])];
    if (parties.some((party) => !/^[a-zA-Z0-9_.-]{1,200}$/.test(party)) || (input.id && !/^[a-zA-Z0-9_.-]{1,200}$/.test(String(input.id)))) throw new WorkflowError(422, 'RECORD_IDENTIFIER_INVALID', 'Record and organization identifiers are invalid');
    const at = now();
    const record = {
      id: String(input.id || id('TR')),
      flowId: definition.id,
      flowCode: definition.code,
      title: String(input.title || definition.title).slice(0, 240),
      tenantId: ctx.tenantId,
      partyTenantIds: parties,
      aclVersion: 1,
      aclTenantIds: parties,
      state: definition.initialState,
      version: 1,
      createdBy: ctx.actorId,
      currentOwnerId: ctx.actorId,
      currentOwnerRole: ctx.role,
      payload: cleanObject(input.payload),
      providerState: cleanObject(input.providerState),
      trust: { value: 0, eligible: false, policyVersion: null },
      createdAt: at,
      updatedAt: at,
    };
    return this.repo.create(record, idempotencyKey);
  }

  async get(ctx, recordId) {
    const record = await this.repo.getAccessible(ctx.tenantId, recordId);
    if (!record) throw new WorkflowError(404, 'RECORD_NOT_FOUND', 'Workflow record not found');
    return record;
  }

  async list(ctx, filters) {
    return this.repo.list(ctx.tenantId, filters);
  }

  async inviteParties(ctx, recordId, input, idempotencyKey) {
    const current = await this.get(ctx, recordId);
    if (current.tenantId !== ctx.tenantId || (current.createdBy !== ctx.actorId && ctx.role !== 'company_admin')) throw new WorkflowError(403, 'PARTY_INVITE_FORBIDDEN', 'Only the record owner may invite organizations');
    if (!idempotencyKey) throw new WorkflowError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    const inviteKey = `invite:${ctx.actorId}:${idempotencyKey}`;
    const replay = await this.repo.getIdempotent(current.tenantId, inviteKey);
    if (replay) {
      if (replay.record.id !== recordId) throw new WorkflowError(409, 'IDEMPOTENCY_CONFLICT', 'Key was already used for a different record');
      return replay;
    }
    if (Number(input.expectedVersion) !== current.version) throw new WorkflowError(409, 'VERSION_CONFLICT', 'Expected version does not match current record');
    const parties = [...new Set([current.tenantId, ...(current.aclTenantIds || []), ...asArray(input.partyTenantIds || []).map(String)])];
    if (parties.some((party) => !/^[a-zA-Z0-9_.-]{1,200}$/.test(party))) throw new WorkflowError(422, 'PARTY_INVALID', 'Organization identifiers are invalid');
    const at = now();
    const nextRecord = { ...current, aclVersion: 1, aclTenantIds: parties, partyTenantIds: parties, version: current.version + 1, updatedAt: at };
    const event = { id: id('TREVT'), tenantId: current.tenantId, recordId, flowId: current.flowId, type: 'workflow.parties_invited', action: 'invite_parties', actor: { id: ctx.actorId, role: ctx.role }, at };
    const receiptBody = { tenantId: current.tenantId, recordId, action: 'invite_parties', partyTenantIds: parties, version: nextRecord.version, at };
    const receipt = { id: id('TRRCP'), ...receiptBody, hash: digest(receiptBody) };
    return this.repo.transition({ tenantId: current.tenantId, recordId, expectedVersion: current.version, idempotencyKey: inviteKey, nextRecord, event, receipt });
  }

  findTransition(definition, action, state) {
    return definition.transitions.find((item) => item.action === action && (item.from === '*' || asArray(item.from).includes(state)));
  }

  authorizeActor(ctx, current, rule) {
    if (!rule.roles.includes(ctx.role)) throw new WorkflowError(403, 'ROLE_FORBIDDEN', 'Active role cannot perform this action');
    if (ctx.role === 'system' && !ctx.systemVerified) throw new WorkflowError(403, 'SYSTEM_IDENTITY_REQUIRED', 'System transitions require a verified server identity');
    if (['checker', 'company_admin'].includes(ctx.role) && ctx.tenantId !== current.tenantId) throw new WorkflowError(403, 'CHECKER_ORGANIZATION_REQUIRED', 'Approval authority belongs to the owning organization');
    if (rule.makerChecker && rule.action !== 'countersign_contract' && (current.lastActionActorId || current.createdBy) === ctx.actorId) throw new WorkflowError(403, 'MAKER_CHECKER_VIOLATION', 'Maker cannot approve its own submission');
    if (rule.action === 'countersign_contract' && (!current.firstSignature || current.firstSignature.actorId === ctx.actorId || current.firstSignature.tenantId === ctx.tenantId || current.firstSignature.role === ctx.role)) throw new WorkflowError(403, 'COUNTERSIGN_INDEPENDENCE_REQUIRED', 'Counterparty signature requires a different actor, organization and role');
  }

  availableTransitions(ctx, current) {
    return getFlow(current.flowId).transitions.filter((rule) => {
      if (!(rule.from === '*' || asArray(rule.from).includes(current.state))) return false;
      try { this.authorizeActor(ctx, current, rule); return true; } catch (error) { if (error instanceof WorkflowError) return false; throw error; }
    });
  }

  async validateTrust(ctx, current, definition, transition, input) {
    if (definition.id !== '19') return null;
    if (input.patch && ['receipts', 'subjectRef'].some((key) => Object.hasOwn(input.patch, key))) throw new WorkflowError(422, 'TRUST_EVIDENCE_IMMUTABLE', 'Trust evidence and subject cannot be patched');
    if (['seal_receipts', 'compute_trust', 'commit_trust'].includes(transition.action) && !ctx.systemVerified) {
      throw new WorkflowError(403, 'TRUST_SYSTEM_REQUIRED', 'A verified server identity is required');
    }
    if (transition.action === 'seal_receipts') {
      const references = asArray(input.receiptIds || []);
      if (!this.trustedReceiptResolver) throw new WorkflowError(503, 'TRUST_VERIFIER_UNAVAILABLE', 'Trusted receipt verification is not configured');
      if (input.receipts || !references.length) throw new WorkflowError(422, 'TRUST_RECEIPTS_REQUIRED', 'Server-verifiable receipt IDs are required');
      const receipts = [];
      for (const reference of [...new Set(references.map(String))]) {
        const receipt = await this.trustedReceiptResolver(reference, { tenantId: current.tenantId, subjectRef: current.payload.subjectRef });
        const missing = RECEIPT_REQUIRED.filter((key) => !receipt || !receipt[key]);
        if (missing.length || receipt.verified !== true || receipt.independent !== true || receipt.tenantId !== current.tenantId || !current.payload.subjectRef || receipt.subjectRef !== current.payload.subjectRef || !/^[a-f0-9]{64}$/i.test(receipt.evidenceHash || '') || !Number.isFinite(Date.parse(receipt.observedAt))) {
          throw new WorkflowError(422, 'TRUST_RECEIPT_INELIGIBLE', 'Independent verified scoped receipt is required', { missing });
        }
        receipts.push({ ...receipt, id: reference });
      }
      return { receipts };
    }
    if (transition.action === 'compute_trust') {
      if (!this.trustPolicy) throw new WorkflowError(503, 'TRUST_POLICY_UNAVAILABLE', 'Server Trust policy is not configured');
      const receipts = current.payload.receipts;
      if (!current.trust.eligible || !Array.isArray(receipts) || !receipts.length || receipts.some((r) => r.verified !== true || r.independent !== true || r.tenantId !== current.tenantId || r.subjectRef !== current.payload.subjectRef)) throw new WorkflowError(422, 'TRUST_RECEIPT_INELIGIBLE', 'Verified sealed receipts are required');
      const computation = await this.trustPolicy({ receipts, tenantId: current.tenantId, subjectRef: current.payload.subjectRef });
      if (!computation || !Number.isFinite(computation.value) || computation.value < 0 || !computation.policyVersion) throw new WorkflowError(503, 'TRUST_POLICY_INVALID', 'Server Trust policy returned an invalid computation');
      return { computation: { value: computation.value, policyVersion: String(computation.policyVersion), evidenceHash: digest(receipts) } };
    }
    if (transition.action === 'commit_trust') {
      if (input.value !== undefined || input.policyVersion !== undefined) throw new WorkflowError(422, 'TRUST_CLIENT_COMPUTATION_FORBIDDEN', 'Trust is computed by the server');
      if (!current.trust.computation || current.trust.computation.evidenceHash !== digest(current.payload.receipts)) throw new WorkflowError(422, 'TRUST_COMPUTATION_REQUIRED', 'An unchanged server computation is required');
    }
    return null;
  }

  async transition(ctx, recordId, input, idempotencyKey) {
    if (!idempotencyKey) throw new WorkflowError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    const current = await this.get(ctx, recordId);
    const scopedKey = `${ctx.tenantId}:${ctx.actorId}:${idempotencyKey}`;
    const replay = await this.repo.getIdempotent(current.tenantId, scopedKey);
    if (replay) {
      if (replay.record.id !== recordId) throw new WorkflowError(409, 'IDEMPOTENCY_CONFLICT', 'Key was already used for a different record');
      return replay;
    }
    const definition = getFlow(current.flowId);
    const action = String(input.action || '');
    const rule = this.findTransition(definition, action, current.state);
    if (!rule) throw new WorkflowError(409, 'TRANSITION_INVALID', `Action ${action || '(empty)'} is not valid from ${current.state}`);
    this.authorizeActor(ctx, current, rule);
    if ((Object.keys(cleanObject(input.providerState)).length || Object.keys(cleanObject(input.providerEvent)).length) && !ctx.systemVerified) throw new WorkflowError(403, 'PROVIDER_STATE_FORBIDDEN', 'Provider events may only be supplied by a verified server');
    if (rule.reasonRequired && !String(input.reason || '').trim()) throw new WorkflowError(422, 'REASON_REQUIRED', 'A reason is required');
    if (Number(input.expectedVersion) !== current.version) throw new WorkflowError(409, 'VERSION_CONFLICT', 'Expected version does not match current record', { currentVersion: current.version });
    if (action !== 'cancel') {
      if (current.state !== definition.initialState && input.patch && Object.hasOwn(input.patch, 'sourceRecordId') && input.patch.sourceRecordId !== current.payload.sourceRecordId) throw new WorkflowError(422, 'WORKFLOW_SOURCE_IMMUTABLE', 'Submitted source lineage cannot be changed');
      await validateWorkflowInput(current.flowId, { ...current.payload, ...cleanObject(input.patch) }, (sourceId) => this.get(current.state === definition.initialState ? ctx : { ...ctx, tenantId: current.tenantId }, sourceId));
    }
    const trustResult = await this.validateTrust(ctx, current, definition, rule, input);

    const at = now();
    const event = {
      id: id('TREVT'), tenantId: current.tenantId, recordId, flowId: definition.id,
      type: 'workflow.transition', action, from: current.state, to: rule.to,
      actor: { id: ctx.actorId, role: ctx.role }, requestId: ctx.requestId || null,
      reason: input.reason || null, providerEvent: cleanObject(input.providerEvent), at,
    };
    const nextRecord = {
      ...current,
      state: rule.to,
      lastActionActorId: ctx.actorId,
      version: current.version + 1,
      currentOwnerId: String(input.nextOwnerId || ctx.actorId),
      currentOwnerRole: String(input.nextOwnerRole || ctx.role),
      payload: { ...current.payload, ...cleanObject(input.patch) },
      providerState: { ...current.providerState, ...cleanObject(input.providerState) },
      updatedAt: at,
    };

    if (action === 'sign_contract') nextRecord.firstSignature = { actorId: ctx.actorId, tenantId: ctx.tenantId, role: ctx.role, at };
    if (action === 'countersign_contract') nextRecord.counterSignature = { actorId: ctx.actorId, tenantId: ctx.tenantId, role: ctx.role, at };

    if (definition.id === '19' && action === 'seal_receipts') {
      nextRecord.payload.receipts = trustResult.receipts;
      nextRecord.trust = { ...nextRecord.trust, eligible: true };
    }
    if (definition.id === '19' && action === 'compute_trust') nextRecord.trust = { ...nextRecord.trust, computation: trustResult.computation };
    if (definition.id === '19' && action === 'commit_trust') {
      nextRecord.trust = { ...current.trust, value: current.trust.computation.value, eligible: true, policyVersion: current.trust.computation.policyVersion, committedAt: at };
    }

    const receiptBody = {
      tenantId: current.tenantId, recordId, flowId: definition.id, action,
      from: current.state, to: rule.to, version: nextRecord.version,
      actorRef: digest({ tenantId: ctx.tenantId, actorId: ctx.actorId }), at,
    };
    const receipt = { id: id('TRRCP'), ...receiptBody, hash: digest(receiptBody) };
    return this.repo.transition({
      tenantId: current.tenantId,
      recordId,
      expectedVersion: current.version,
      idempotencyKey: scopedKey,
      nextRecord,
      event,
      receipt,
    });
  }

  async history(ctx, recordId) { const record = await this.get(ctx, recordId); return this.repo.history(record.tenantId, recordId); }

  async createRoom(ctx, input) {
    const record = await this.get(ctx, input.recordId);
    if (input.scheduledFor && !Number.isFinite(Date.parse(input.scheduledFor))) throw new WorkflowError(422, 'ROOM_SCHEDULE_INVALID', 'A valid scheduled time is required');
    if (record.flowId !== '15') throw new WorkflowError(422, 'ROOM_FLOW_REQUIRED', 'Negotiation rooms belong to Flow 15');
    if (input.id && !/^[a-zA-Z0-9_.-]{1,200}$/.test(String(input.id))) throw new WorkflowError(422, 'ROOM_IDENTIFIER_INVALID', 'Room identifier is invalid');
    const requested = asArray(input.participantTenantIds || []).map(String);
    if (requested.some((tenant) => !(record.aclTenantIds || [record.tenantId]).includes(tenant))) throw new WorkflowError(403, 'ROOM_PARTICIPANT_FORBIDDEN', 'Only verified record parties may join the room');
    if (input.id && await this.repo.getAccessibleRoom(ctx.tenantId, String(input.id))) throw new WorkflowError(409, 'ROOM_EXISTS', 'Room already exists');
    const room = {
      id: String(input.id || id('TRROOM')),
      version: 1,
      tenantId: record.tenantId,
      aclVersion: 1,
      aclTenantIds: record.aclTenantIds || [record.tenantId],
      recordId: record.id,
      participantTenantIds: record.aclTenantIds || [record.tenantId],
      scheduledFor: input.scheduledFor || null,
      timezone: String(input.timezone || 'UTC'),
      status: input.scheduledFor ? 'scheduled' : 'scheduling',
      mediaMode: String(input.mediaMode || 'chat'),
      provider: String(input.provider || 'manual'),
      recordingConsent: false,
      recordingConsents: {},
      aiNotesEnabled: false,
      createdBy: ctx.actorId,
      createdAt: now(),
      updatedAt: now(),
    };
    return this.repo.saveRoom(record.tenantId, room, { createOnly: true });
  }

  async room(ctx, roomId) {
    const room = await this.repo.getAccessibleRoom(ctx.tenantId, roomId);
    if (!room) throw new WorkflowError(404, 'ROOM_NOT_FOUND', 'Negotiation room not found');
    const record = await this.get(ctx, room.recordId);
    if (record.tenantId !== room.tenantId) throw new WorkflowError(403, 'ROOM_RECORD_FORBIDDEN', 'Room owner does not match its governed record');
    return room;
  }

  async updateRoom(ctx, roomId, input) {
    const room = await this.room(ctx, roomId);
    const allowed = new Set(['scheduled', 'reminded', 'live', 'aligned', 'closed', 'cancelled']);
    const status = String(input.status || room.status);
    if (!allowed.has(status) && status !== 'scheduling') throw new WorkflowError(422, 'ROOM_STATUS_INVALID', 'Invalid room status');
    const successors = { scheduling: ['scheduled', 'cancelled'], scheduled: ['reminded', 'live', 'cancelled'], reminded: ['live', 'cancelled'], live: ['aligned', 'cancelled'], aligned: ['closed', 'cancelled'], closed: [], cancelled: [] };
    if (status !== room.status && !(successors[room.status] || []).includes(status)) throw new WorkflowError(409, 'ROOM_TRANSITION_INVALID', 'Room lifecycle transition is invalid');
    if (status === 'reminded' && room.status !== 'reminded' && !ctx.systemVerified) throw new WorkflowError(403, 'SYSTEM_IDENTITY_REQUIRED', 'A reminder requires a verified provider event');
    if (status === 'scheduled' && !Number.isFinite(Date.parse(input.scheduledFor || room.scheduledFor))) throw new WorkflowError(422, 'ROOM_SCHEDULE_INVALID', 'A valid scheduled time is required');
    const record = await this.get(ctx, room.recordId);
    const recordingConsents = { ...room.recordingConsents };
    if (Object.hasOwn(input, 'recordingConsent')) recordingConsents[ctx.tenantId] = input.recordingConsent === true;
    const parties = record.aclTenantIds || [record.tenantId];
    const allConsented = parties.every((tenant) => recordingConsents[tenant] === true);
    const next = {
      ...room,
      version: (room.version || 1) + 1,
      aclVersion: 1,
      aclTenantIds: record.aclTenantIds || [record.tenantId],
      participantTenantIds: record.aclTenantIds || [record.tenantId],
      status,
      scheduledFor: input.scheduledFor || room.scheduledFor,
      mediaMode: input.mediaMode || room.mediaMode,
      recordingConsents,
      recordingConsent: allConsented,
      aiNotesEnabled: input.aiNotesEnabled === true && allConsented,
      updatedAt: now(),
    };
    return this.repo.saveRoom(room.tenantId, next, { expectedVersion: room.version || 1 });
  }

  async sendMessage(ctx, roomId, input) {
    const room = await this.room(ctx, roomId);
    const text = String(input.text || '').trim();
    if (!text || text.length > 10000) throw new WorkflowError(422, 'MESSAGE_INVALID', 'Message must be 1 to 10000 characters');
    const message = {
      id: id('TRMSG'), tenantId: room.tenantId, actorTenantId: ctx.tenantId, roomId, senderId: ctx.actorId,
      senderRole: ctx.role, text, attachments: asArray(input.attachments || []).slice(0, 10),
      at: now(),
    };
    return this.repo.appendMessage(room.tenantId, roomId, message);
  }

  async messages(ctx, roomId, limit) { const room = await this.room(ctx, roomId); return this.repo.listMessages(room.tenantId, roomId, limit); }

  adminProjection(record) {
    return {
      id: record.id,
      flowId: record.flowId,
      flowCode: record.flowCode,
      state: record.state,
      version: record.version,
      providerState: record.providerState,
      trust: record.flowId === '19' ? { eligible: record.trust.eligible, committed: !!record.trust.committedAt } : undefined,
      updatedAt: record.updatedAt,
    };
  }

  async adminList(limit = 100) {
    const rows = await this.repo.listAll(Math.min(Number(limit) || 100, 250));
    return rows.map((record) => this.adminProjection(record));
  }
}

module.exports = { WorkflowService, RECEIPT_REQUIRED };
