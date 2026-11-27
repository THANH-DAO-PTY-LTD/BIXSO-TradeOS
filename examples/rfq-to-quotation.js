'use strict';

// Walks one fictional trade from a buyer's demand to an acknowledged quotation.
// Two organisations, three people, in-memory storage. Run: npm run demo
const { WorkflowService, MemoryWorkflowRepository } = require('../src');

const buyer = { tenantId: 'acme-cafe', actorId: 'mai', role: 'buyer' };
const buyerChecker = { tenantId: 'acme-cafe', actorId: 'linh', role: 'checker' };
const seller = { tenantId: 'green-bean-roasters', actorId: 'tom', role: 'seller' };

let step = 0;
const key = () => `demo-${++step}`;
const say = (who, result) => console.log(`${String(step).padStart(2)}. ${who.actorId.padEnd(5)} ${result.record.flowCode.padEnd(7)} ${result.record.id.padEnd(9)} → ${result.record.state}`);

async function act(service, who, id, action, extra = {}) {
  const current = await service.get(who, id);
  const result = await service.transition(who, id, { action, expectedVersion: current.version, ...extra }, key());
  say(who, result);
  return result;
}

async function main() {
  const service = new WorkflowService(new MemoryWorkflowRepository());

  let r = await service.create(buyer, { id: 'DEMAND-1', flowCode: 'BUY-01', payload: { product: 'Single-origin coffee beans', quantity: 40, unit: 'kg', destination: 'Melbourne' } }, key());
  say(buyer, r);
  await act(service, buyer, 'DEMAND-1', 'submit_demand');
  await act(service, buyerChecker, 'DEMAND-1', 'approve_demand');

  r = await service.create(buyer, { id: 'RFQ-1', flowCode: 'RFQ-01', partyTenantIds: [seller.tenantId], payload: { sourceRecordId: 'DEMAND-1', deliveryTerms: 'Delivered weekly, 10 kg per drop' } }, key());
  say(buyer, r);
  await act(service, buyer, 'RFQ-1', 'submit_rfq');
  await act(service, buyerChecker, 'RFQ-1', 'approve_rfq');
  await act(service, buyer, 'RFQ-1', 'release_rfq');

  r = await service.create(seller, { id: 'QUOTE-1', flowCode: 'QUO-01', partyTenantIds: [buyer.tenantId], payload: { sourceRecordId: 'RFQ-1', price: 31.5, quantity: 40, currency: 'AUD' } }, key());
  say(seller, r);
  await act(service, seller, 'QUOTE-1', 'submit_quotation');
  await act(service, buyer, 'QUOTE-1', 'acknowledge_quotation');

  try {
    await act(service, buyer, 'DEMAND-1', 'approve_demand');
  } catch (error) {
    console.log(`    Blocked as expected: ${error.code}`);
  }

  const { receipts } = await service.history(buyer, 'RFQ-1');
  console.log(`\nRFQ-1 has ${receipts.length} hashed receipts. Last: ${receipts.at(-1).hash.slice(0, 16)}…`);
}

main().catch((error) => { console.error(error); process.exit(1); });
