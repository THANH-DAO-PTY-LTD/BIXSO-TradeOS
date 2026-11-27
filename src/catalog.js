'use strict';

const roles = Object.freeze({
  BUYER: 'buyer',
  SELLER: 'seller',
  ADMIN: 'company_admin',
  CHECKER: 'checker',
  SYSTEM: 'system',
});

function flow(id, code, title, area, initialState, transitions, options = {}) {
  return Object.freeze({
    id: String(id).padStart(2, '0'),
    code,
    title,
    area,
    initialState,
    terminalStates: options.terminalStates || ['completed', 'cancelled'],
    trustEffect: options.trustEffect || 'none',
    transitions: Object.freeze(transitions.map((item) => Object.freeze(item))),
  });
}

const commonCancel = { action: 'cancel', from: '*', to: 'cancelled', roles: [roles.BUYER, roles.SELLER, roles.ADMIN], reasonRequired: true };

const FLOW_CATALOG = Object.freeze([
  flow(1, 'ORG-01', 'Establish organization', 'company', 'draft', [
    { action: 'submit_organization', from: 'draft', to: 'pending_approval', roles: [roles.BUYER, roles.SELLER, roles.ADMIN] },
    { action: 'approve_organization', from: 'pending_approval', to: 'completed', roles: [roles.CHECKER, roles.ADMIN], makerChecker: true },
    { action: 'return_organization', from: 'pending_approval', to: 'draft', roles: [roles.CHECKER, roles.ADMIN], reasonRequired: true },
    commonCancel,
  ]),
  flow(2, 'ORG-02', 'Membership and authority', 'company', 'created', [
    { action: 'queue_invitation', from: 'created', to: 'email_queued', roles: [roles.ADMIN] },
    { action: 'mark_delivered', from: 'email_queued', to: 'delivered', roles: [roles.SYSTEM] },
    { action: 'verify_invitation', from: ['delivered', 'opened'], to: 'verified', roles: [roles.SYSTEM] },
    { action: 'accept_invitation', from: 'verified', to: 'completed', roles: [roles.BUYER, roles.SELLER], makerChecker: true },
    commonCancel,
  ]),
  flow(3, 'BUY-01', 'Buyer demand folio', 'buyer_setup', 'draft', [
    { action: 'submit_demand', from: 'draft', to: 'pending_approval', roles: [roles.BUYER] },
    { action: 'approve_demand', from: 'pending_approval', to: 'completed', roles: [roles.CHECKER, roles.ADMIN], makerChecker: true },
    { action: 'return_demand', from: 'pending_approval', to: 'draft', roles: [roles.CHECKER, roles.ADMIN], reasonRequired: true },
    commonCancel,
  ]),
  flow(4, 'SEL-01', 'Seller supply folio', 'seller_setup', 'draft', [
    { action: 'submit_supply', from: 'draft', to: 'pending_approval', roles: [roles.SELLER] },
    { action: 'approve_supply', from: 'pending_approval', to: 'completed', roles: [roles.CHECKER, roles.ADMIN], makerChecker: true },
    { action: 'return_supply', from: 'pending_approval', to: 'draft', roles: [roles.CHECKER, roles.ADMIN], reasonRequired: true },
    commonCancel,
  ]),
  flow(5, 'MAT-01D', 'Buyer discovery', 'discovery', 'queued', [
    { action: 'start_discovery', from: 'queued', to: 'running', roles: [roles.BUYER, roles.SYSTEM] },
    { action: 'qualify_candidates', from: 'running', to: 'qualified', roles: [roles.SYSTEM] },
    { action: 'publish_pool', from: 'qualified', to: 'completed', roles: [roles.BUYER] },
    commonCancel,
  ]),
  flow(6, 'MAT-01R', 'Bilateral matching resolution', 'discovery', 'intent_created', [
    { action: 'buyer_approve', from: 'intent_created', to: 'buyer_approved', roles: [roles.BUYER] },
    { action: 'seller_approve', from: 'buyer_approved', to: 'mutual_approved', roles: [roles.SELLER] },
    { action: 'open_scoped_connection', from: 'mutual_approved', to: 'completed', roles: [roles.SYSTEM] },
    commonCancel,
  ]),
  flow(7, 'MAT-02', 'Seller demand discovery', 'discovery', 'queued', [
    { action: 'start_seller_discovery', from: 'queued', to: 'running', roles: [roles.SELLER, roles.SYSTEM] },
    { action: 'qualify_demands', from: 'running', to: 'qualified', roles: [roles.SYSTEM] },
    { action: 'publish_demand_pool', from: 'qualified', to: 'completed', roles: [roles.SELLER] },
    commonCancel,
  ]),
  flow(8, 'MAT-03', 'Existing counterparty reuse', 'discovery', 'review', [
    { action: 'refresh_evidence', from: 'review', to: 'evidence_ready', roles: [roles.BUYER, roles.SYSTEM] },
    { action: 'submit_reuse', from: 'evidence_ready', to: 'pending_approval', roles: [roles.BUYER] },
    { action: 'approve_reuse', from: 'pending_approval', to: 'completed', roles: [roles.CHECKER, roles.ADMIN], makerChecker: true },
    commonCancel,
  ]),
  flow(9, 'MAT-04', 'Continuous rematching', 'discovery', 'change_detected', [
    { action: 'classify_impact', from: 'change_detected', to: 'impact_scoped', roles: [roles.SYSTEM] },
    { action: 'run_rematch', from: 'impact_scoped', to: 'decision_required', roles: [roles.SYSTEM] },
    { action: 'accept_rematch', from: 'decision_required', to: 'completed', roles: [roles.BUYER, roles.SELLER] },
    { action: 'keep_current', from: 'decision_required', to: 'completed', roles: [roles.BUYER, roles.SELLER] },
    commonCancel,
  ]),
  flow(10, 'MAT-05', 'Controlled alternatives', 'discovery', 'alternatives_ready', [
    { action: 'shortlist_alternative', from: 'alternatives_ready', to: 'decision_required', roles: [roles.BUYER] },
    { action: 'approve_alternative', from: 'decision_required', to: 'completed', roles: [roles.CHECKER, roles.ADMIN], makerChecker: true },
    { action: 'reject_alternatives', from: 'decision_required', to: 'completed', roles: [roles.BUYER], reasonRequired: true },
    commonCancel,
  ]),
  flow(11, 'DUE-01', 'Due diligence', 'qualification', 'review', [
    { action: 'request_evidence', from: 'review', to: 'evidence_pending', roles: [roles.BUYER] },
    { action: 'submit_evidence', from: 'evidence_pending', to: 'decision_required', roles: [roles.SELLER] },
    { action: 'qualify', from: 'decision_required', to: 'completed', roles: [roles.CHECKER, roles.ADMIN], makerChecker: true },
    { action: 'decline_qualification', from: 'decision_required', to: 'completed', roles: [roles.CHECKER, roles.ADMIN], makerChecker: true, reasonRequired: true },
    commonCancel,
  ]),
  flow(12, 'SAM-01', 'Sample control', 'delivery', 'requested', [
    { action: 'dispatch_sample', from: 'requested', to: 'in_transit', roles: [roles.SELLER] },
    { action: 'receive_sample', from: 'in_transit', to: 'received', roles: [roles.BUYER] },
    { action: 'record_sample_result', from: 'received', to: 'decision_required', roles: [roles.BUYER, roles.SYSTEM] },
    { action: 'accept_sample', from: 'decision_required', to: 'completed', roles: [roles.BUYER] },
    { action: 'reject_sample', from: 'decision_required', to: 'completed', roles: [roles.BUYER], reasonRequired: true },
    commonCancel,
  ]),
  flow(13, 'RFQ-01', 'RFQ release', 'commercial', 'draft', [
    { action: 'submit_rfq', from: 'draft', to: 'pending_approval', roles: [roles.BUYER] },
    { action: 'approve_rfq', from: 'pending_approval', to: 'ready_to_release', roles: [roles.CHECKER, roles.ADMIN], makerChecker: true },
    { action: 'release_rfq', from: 'ready_to_release', to: 'completed', roles: [roles.BUYER] },
    commonCancel,
  ]),
  flow(14, 'QUO-01', 'Seller quotation', 'commercial', 'draft', [
    { action: 'submit_quotation', from: 'draft', to: 'submitted', roles: [roles.SELLER] },
    { action: 'request_clarification', from: 'submitted', to: 'clarification', roles: [roles.BUYER], reasonRequired: true },
    { action: 'resubmit_quotation', from: 'clarification', to: 'submitted', roles: [roles.SELLER] },
    { action: 'acknowledge_quotation', from: 'submitted', to: 'completed', roles: [roles.BUYER] },
    commonCancel,
  ]),
  flow(15, 'QEN-01', 'Negotiation room', 'commercial', 'scheduling', [
    { action: 'schedule_room', from: 'scheduling', to: 'scheduled', roles: [roles.BUYER, roles.SELLER] },
    { action: 'send_reminder', from: 'scheduled', to: 'reminded', roles: [roles.SYSTEM] },
    { action: 'join_room', from: ['scheduled', 'reminded'], to: 'live', roles: [roles.BUYER, roles.SELLER] },
    { action: 'align_terms', from: 'live', to: 'aligned', roles: [roles.BUYER, roles.SELLER] },
    { action: 'close_room', from: 'aligned', to: 'completed', roles: [roles.BUYER, roles.SELLER] },
    commonCancel,
  ]),
  flow(16, 'AWD-01', 'Award decision', 'commercial', 'decision_required', [
    { action: 'submit_award', from: 'decision_required', to: 'pending_approval', roles: [roles.BUYER] },
    { action: 'approve_award', from: 'pending_approval', to: 'issued', roles: [roles.CHECKER, roles.ADMIN], makerChecker: true },
    { action: 'acknowledge_award', from: 'issued', to: 'completed', roles: [roles.SELLER] },
    commonCancel,
  ]),
  flow(17, 'CTR-01', 'Contract and signing', 'contract', 'draft', [
    { action: 'submit_contract', from: 'draft', to: 'review', roles: [roles.BUYER, roles.SELLER] },
    { action: 'approve_contract', from: 'review', to: 'ready_to_sign', roles: [roles.CHECKER, roles.ADMIN], makerChecker: true },
    { action: 'sign_contract', from: 'ready_to_sign', to: 'partially_signed', roles: [roles.BUYER, roles.SELLER] },
    { action: 'countersign_contract', from: 'partially_signed', to: 'completed', roles: [roles.BUYER, roles.SELLER], makerChecker: true },
    commonCancel,
  ]),
  flow(18, 'EXE-01', 'Order execution', 'delivery', 'order_created', [
    { action: 'confirm_order', from: 'order_created', to: 'in_production', roles: [roles.SELLER] },
    { action: 'record_dispatch', from: 'in_production', to: 'in_transit', roles: [roles.SELLER, roles.SYSTEM] },
    { action: 'record_receipt', from: 'in_transit', to: 'received', roles: [roles.BUYER, roles.SYSTEM] },
    { action: 'accept_delivery', from: 'received', to: 'completed', roles: [roles.BUYER] },
    { action: 'open_dispute', from: ['in_production', 'in_transit', 'received'], to: 'disputed', roles: [roles.BUYER, roles.SELLER], reasonRequired: true },
  ]),
  flow(19, 'TRU-01', 'Outcome and Trust', 'trust', 'collecting_receipts', [
    { action: 'seal_receipts', from: 'collecting_receipts', to: 'eligibility_review', roles: [roles.SYSTEM] },
    { action: 'approve_eligibility', from: 'eligibility_review', to: 'policy_compute', roles: [roles.CHECKER, roles.ADMIN], makerChecker: true },
    { action: 'compute_trust', from: 'policy_compute', to: 'ledger_pending', roles: [roles.SYSTEM] },
    { action: 'commit_trust', from: 'ledger_pending', to: 'completed', roles: [roles.SYSTEM] },
  ], { trustEffect: 'eligible_receipts_only' }),
]);

const BY_ID = new Map(FLOW_CATALOG.map((item) => [item.id, item]));
const BY_CODE = new Map(FLOW_CATALOG.map((item) => [item.code, item]));

function getFlow(value) {
  const key = String(value || '').toUpperCase();
  return BY_ID.get(key.padStart(2, '0')) || BY_CODE.get(key) || null;
}

module.exports = { FLOW_CATALOG, getFlow, roles };
