'use strict';

const crypto = require('crypto');
const { WorkflowError } = require('./errors');

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function safeId(value) { return String(value).replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 500); }
function idemId(tenantId, key) { return crypto.createHash('sha256').update(`${tenantId}:${key}`).digest('hex'); }
function accessible(row, tenantId) { return row.tenantId === tenantId || (row.aclVersion === 1 && (row.aclTenantIds || []).includes(tenantId)); }
function sortedRows(rows, filters = {}) {
  return rows.filter((r) => !filters.flowId || r.flowId === filters.flowId)
    .filter((r) => !filters.state || r.state === filters.state)
    .filter((r) => !filters.tradeId || r.payload?.tradeId === filters.tradeId)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || String(a.id).localeCompare(String(b.id)))
    .filter((r) => !filters.cursor || r.updatedAt < filters.cursor.updatedAt || (r.updatedAt === filters.cursor.updatedAt && r.id > filters.cursor.id))
    .slice(0, filters.limit || 50).map(clone);
}
function uniqueAccessible(rows, tenantId) {
  const matches = rows.filter((r) => accessible(r, tenantId));
  if (matches.length > 1) throw new WorkflowError(409, 'AMBIGUOUS_RECORD_ID', 'Record ID is not unique for this organization');
  return matches[0] ? clone(matches[0]) : null;
}
function isExpired(value) {
  if (!value) return false;
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime() <= Date.now();
}

class MemoryWorkflowRepository {
  constructor() {
    this.backend = 'memory';
    this.records = new Map();
    this.events = new Map();
    this.receipts = new Map();
    this.idempotency = new Map();
    this.rooms = new Map();
    this.messages = new Map();
  }

  async create(record, idempotencyKey) {
    const idem = `${record.tenantId}:${idempotencyKey}`;
    if (this.idempotency.has(idem)) return { duplicate: true, ...clone(this.idempotency.get(idem)) };
    const key = `${record.tenantId}:${record.id}`;
    if (this.records.has(key)) throw new WorkflowError(409, 'RECORD_EXISTS', 'Record already exists');
    this.records.set(key, clone(record));
    this.events.set(key, []);
    this.receipts.set(key, []);
    const result = { record: clone(record) };
    this.idempotency.set(idem, result);
    return result;
  }

  async getIdempotent(tenantId, idempotencyKey) {
    const result = this.idempotency.get(`${tenantId}:${idempotencyKey}`);
    return result ? { duplicate: true, ...clone(result) } : null;
  }

  async get(tenantId, recordId) {
    const row = this.records.get(`${tenantId}:${recordId}`);
    return row ? clone(row) : null;
  }

  async getAccessible(tenantId, recordId) {
    const owned = await this.get(tenantId, recordId);
    if (owned) return owned;
    return uniqueAccessible([...this.records.values()].filter((r) => r.id === recordId), tenantId);
  }

  async list(tenantId, filters = {}) {
    return sortedRows([...this.records.values()].filter((r) => accessible(r, tenantId)), filters);
  }

  async listAll(limit = 100) {
    return [...this.records.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, limit).map(clone);
  }

  async transition({ tenantId, recordId, expectedVersion, idempotencyKey, nextRecord, event, receipt }) {
    const idem = `${tenantId}:${idempotencyKey}`;
    if (this.idempotency.has(idem)) return { duplicate: true, ...clone(this.idempotency.get(idem)) };
    const key = `${tenantId}:${recordId}`;
    const current = this.records.get(key);
    if (!current) throw new WorkflowError(404, 'RECORD_NOT_FOUND', 'Workflow record not found');
    if (current.version !== expectedVersion) {
      throw new WorkflowError(409, 'VERSION_CONFLICT', 'Record changed; reload before retrying', { currentVersion: current.version });
    }
    this.records.set(key, clone(nextRecord));
    this.events.get(key).push(clone(event));
    this.receipts.get(key).push(clone(receipt));
    const result = { record: clone(nextRecord), event: clone(event), receipt: clone(receipt) };
    this.idempotency.set(idem, result);
    return result;
  }

  async history(tenantId, recordId) {
    const key = `${tenantId}:${recordId}`;
    if (!this.records.has(key)) throw new WorkflowError(404, 'RECORD_NOT_FOUND', 'Workflow record not found');
    return { events: clone(this.events.get(key)), receipts: clone(this.receipts.get(key)) };
  }

  async saveRoom(tenantId, room, { createOnly = false, expectedVersion } = {}) {
    if (createOnly && this.rooms.has(`${tenantId}:${room.id}`)) throw new WorkflowError(409, 'ROOM_EXISTS', 'Room already exists');
    if (expectedVersion !== undefined && (this.rooms.get(`${tenantId}:${room.id}`)?.version || 1) !== expectedVersion) throw new WorkflowError(409, 'ROOM_VERSION_CONFLICT', 'Room changed; reload before retrying');
    this.rooms.set(`${tenantId}:${room.id}`, clone(room));
    return clone(room);
  }

  async getRoom(tenantId, roomId) {
    const room = this.rooms.get(`${tenantId}:${roomId}`);
    return room ? clone(room) : null;
  }

  async getAccessibleRoom(tenantId, roomId) {
    const owned = await this.getRoom(tenantId, roomId);
    if (owned) return owned;
    return uniqueAccessible([...this.rooms.values()].filter((r) => r.id === roomId), tenantId);
  }

  async appendMessage(tenantId, roomId, message) {
    const key = `${tenantId}:${roomId}`;
    if (!this.rooms.has(key)) throw new WorkflowError(404, 'ROOM_NOT_FOUND', 'Negotiation room not found');
    const list = this.messages.get(key) || [];
    list.push(clone(message));
    this.messages.set(key, list);
    return clone(message);
  }

  async listMessages(tenantId, roomId, limit = 100) {
    const key = `${tenantId}:${roomId}`;
    if (!this.rooms.has(key)) throw new WorkflowError(404, 'ROOM_NOT_FOUND', 'Negotiation room not found');
    return clone((this.messages.get(key) || []).slice(-limit));
  }
}

module.exports = { MemoryWorkflowRepository };
