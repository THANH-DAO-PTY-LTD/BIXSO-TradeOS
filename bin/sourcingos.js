#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { WorkflowService, FileWorkflowRepository, FLOW_CATALOG, getFlow, FIELDS, PREREQUISITES } = require('../src');

const HELP = `Sourcing OS — governed B2B trade workflows on your computer

Usage
  sourcingos flows                         List the 19 flows
  sourcingos flow <code>                   Show a flow's states, actions and required fields
  sourcingos new <code> --as <who> [--id ID] [--party ORG]... [--set field=value]...
  sourcingos act <id> <action> --as <who> [--reason TEXT] [--set field=value]...
  sourcingos list --as <who> [--flow CODE] [--state STATE]
  sourcingos show <id> --as <who>
  sourcingos history <id> --as <who>
  sourcingos next <id> --as <who>          Actions this person may take now

<who> is role:person@organisation, for example buyer:mai@acme-cafe.
Roles: buyer, seller, checker, company_admin. Data is saved in .sourcing-os/data.json
(or the file named by SOURCINGOS_DATA). Use fictional records.`;

function parse(argv) {
  const args = { _: [], set: {}, party: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { args._.push(a); continue; }
    const name = a.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value`);
    i += 1;
    if (name === 'set') {
      const at = value.indexOf('=');
      if (at < 1) throw new Error('--set expects field=value');
      const raw = value.slice(at + 1);
      args.set[value.slice(0, at)] = raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : raw;
    } else if (name === 'party') args.party.push(value);
    else args[name] = value;
  }
  return args;
}

function who(value) {
  const match = /^([a-z_]+):([^@\s]+)@([a-zA-Z0-9_.-]+)$/.exec(value || '');
  if (!match) throw new Error('--as must look like role:person@organisation');
  if (match[1] === 'system') throw new Error('The system role is reserved for a verified server');
  return { role: match[1], actorId: match[2], tenantId: match[3] };
}

const line = (r) => `${r.id}\t${r.flowCode}\t${r.state}\tv${r.version}\t${r.title}`;

async function main() {
  const args = parse(process.argv.slice(2));
  const [command, ...rest] = args._;
  if (!command || command === 'help' || args.help) return console.log(HELP);

  if (command === 'flows') {
    for (const f of FLOW_CATALOG) console.log(`${f.code.padEnd(8)} ${f.area.padEnd(14)} ${f.title}`);
    return;
  }
  if (command === 'flow') {
    const f = getFlow(rest[0]);
    if (!f) throw new Error(`Unknown flow ${rest[0] || ''}`);
    console.log(`${f.code} · ${f.title} (${f.area})\nStarts in: ${f.initialState}\nRequired fields: ${(FIELDS[Number(f.id)] || []).join(', ') || 'none'}`);
    const pre = PREREQUISITES[Number(f.id)];
    if (pre) console.log(`Needs a completed ${getFlow(pre).code} as sourceRecordId`);
    for (const t of f.transitions) {
      const flags = [t.makerChecker && 'maker-checker', t.reasonRequired && 'reason'].filter(Boolean).join(', ');
      console.log(`  ${t.action.padEnd(24)} ${[].concat(t.from).join('|')} → ${t.to}   [${t.roles.join(', ')}]${flags ? `  (${flags})` : ''}`);
    }
    return;
  }

  const file = process.env.SOURCINGOS_DATA || path.join(process.cwd(), '.sourcing-os', 'data.json');
  const service = new WorkflowService(new FileWorkflowRepository(file));
  const ctx = who(args.as);
  const key = args.key || crypto.randomUUID();

  if (command === 'new') {
    const r = await service.create(ctx, { id: args.id, flowCode: rest[0], title: args.title, partyTenantIds: args.party, payload: args.set }, key);
    return console.log(line(r.record));
  }
  if (command === 'act') {
    const [id, action] = rest;
    const current = await service.get(ctx, id);
    const r = await service.transition(ctx, id, { action, reason: args.reason, patch: args.set, expectedVersion: args.expect ? Number(args.expect) : current.version }, key);
    return console.log(`${line(r.record)}\treceipt ${r.receipt.hash.slice(0, 12)}`);
  }
  if (command === 'list') {
    const flow = args.flow ? getFlow(args.flow)?.id : undefined;
    for (const r of await service.list(ctx, { flowId: flow, state: args.state })) console.log(line(r));
    return;
  }
  if (command === 'show') return console.log(JSON.stringify(await service.get(ctx, rest[0]), null, 2));
  if (command === 'history') {
    const { events } = await service.history(ctx, rest[0]);
    for (const e of events) console.log(`${e.at}\t${e.actor.id} (${e.actor.role})\t${e.action}\t${e.from || ''} → ${e.to || ''}${e.reason ? `\t“${e.reason}”` : ''}`);
    return;
  }
  if (command === 'next') {
    const current = await service.get(ctx, rest[0]);
    const options = service.availableTransitions(ctx, current);
    if (!options.length) return console.log(`No action available to ${ctx.actorId} (${ctx.role}) from ${current.state}`);
    for (const t of options) console.log(`${t.action} → ${t.to}${t.reasonRequired ? '  (needs --reason)' : ''}`);
    return;
  }
  throw new Error(`Unknown command ${command}. Run sourcingos help`);
}

main().catch((error) => {
  console.error(error.code ? `${error.code}: ${error.message}` : error.message);
  process.exit(1);
});
