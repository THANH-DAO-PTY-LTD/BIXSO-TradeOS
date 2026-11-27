'use strict';
const { WorkflowError } = require('./errors');
const FIELDS = Object.freeze({
  1: ['legalName', 'country'], 2: ['inviteeEmail', 'invitedRole'],
  3: ['product', 'quantity', 'unit', 'destination'], 4: ['product', 'capacity', 'unit', 'origin'],
  5: ['product', 'region'], 6: ['sourceRecordId', 'candidateTenantId'],
  7: ['product', 'region'], 8: ['sourceRecordId', 'relationshipScope'],
  9: ['sourceRecordId', 'eventDescription'], 10: ['sourceRecordId', 'requirements'],
  11: ['sourceRecordId', 'evidenceScope'], 12: ['sourceRecordId', 'sampleSpecification'],
  13: ['sourceRecordId', 'deliveryTerms'], 14: ['sourceRecordId', 'price', 'quantity', 'currency'],
  15: ['sourceRecordId', 'agenda'], 16: ['sourceRecordId', 'decisionReason'],
  17: ['sourceRecordId', 'contractTerms'], 18: ['sourceRecordId', 'deliveryPlan'],
  19: ['sourceRecordId', 'outcomeSummary'],
});
const PREREQUISITES = Object.freeze({ 6: 5, 13: 3, 14: 13, 15: 14, 16: 15, 17: 16, 18: 17, 19: 18 });
async function validateWorkflowInput(flowId, payload, getSource) {
  for (const field of FIELDS[Number(flowId)] || []) {
    if (!['string', 'number'].includes(typeof payload[field]) || !String(payload[field]).trim()) throw new WorkflowError(422, 'WORKFLOW_FIELD_REQUIRED', `${field} is required`);
  }
  for (const field of ['quantity', 'capacity', 'price']) if (field in payload && !(Number.isFinite(Number(payload[field])) && Number(payload[field]) > 0)) throw new WorkflowError(422, 'WORKFLOW_NUMBER_INVALID', `${field} must be positive`);
  if (Number(flowId) === 2 && (!/^\S+@\S+\.\S+$/.test(payload.inviteeEmail) || !['buyer', 'seller'].includes(payload.invitedRole))) throw new WorkflowError(422, 'INVITATION_INVALID', 'A valid email and buyer or seller role are required');
  const prerequisite = PREREQUISITES[Number(flowId)];
  if (payload.sourceRecordId) {
    const source = await getSource(String(payload.sourceRecordId));
    if (prerequisite && (source.flowId !== String(prerequisite).padStart(2, '0') || source.state !== 'completed')) throw new WorkflowError(409, 'PREREQUISITE_NOT_COMPLETE', `Complete Flow ${prerequisite} before submitting this record`);
  } else if (prerequisite) throw new WorkflowError(409, 'PREREQUISITE_NOT_COMPLETE', `Complete Flow ${prerequisite} before submitting this record`);
}
module.exports = { FIELDS, PREREQUISITES, validateWorkflowInput };
