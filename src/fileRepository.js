'use strict';

// Persists the in-memory repository to one local JSON file after every write.
// Single-process, single-owner storage for trying TradeOS on one computer.
const fs = require('node:fs');
const path = require('node:path');
const { MemoryWorkflowRepository } = require('./memoryRepository');

const STORES = ['records', 'events', 'receipts', 'idempotency', 'rooms', 'messages'];
const WRITES = ['create', 'transition', 'saveRoom', 'appendMessage'];
const FORMAT = 'trade-os/v1';

class FileWorkflowRepository extends MemoryWorkflowRepository {
  constructor(file) {
    super();
    this.backend = 'file';
    this.file = path.resolve(file);
    if (fs.existsSync(this.file)) {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (data.format !== FORMAT) throw new Error(`Unsupported data file format: ${data.format || 'missing'}`);
      for (const name of STORES) this[name] = new Map(Object.entries(data[name] || {}));
    }
    for (const method of WRITES) {
      const write = this[method].bind(this);
      this[method] = async (...args) => { const result = await write(...args); this.save(); return result; };
    }
  }

  save() {
    const data = { format: FORMAT, savedAt: new Date().toISOString() };
    for (const name of STORES) data[name] = Object.fromEntries(this[name]);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`);
    fs.renameSync(temp, this.file);
  }
}

module.exports = { FileWorkflowRepository, FORMAT };
