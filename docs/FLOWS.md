# The 19 flows

Generated from `src/catalog.js` and `src/inputContract.js`. Every flow except EXE-01 and TRU-01 can also be cancelled by a buyer, seller or company admin with a reason.

## ORG-01 · Establish organization

Area: company · starts in `draft` · required fields: `legalName`, `country`

| Action | From | To | Roles | Rules |
| --- | --- | --- | --- | --- |
| `submit_organization` | draft | pending_approval | buyer, seller, company_admin |  |
| `approve_organization` | pending_approval | completed | checker, company_admin | maker-checker |
| `return_organization` | pending_approval | draft | checker, company_admin | reason required |

## ORG-02 · Membership and authority

Area: company · starts in `created` · required fields: `inviteeEmail`, `invitedRole`

| Action | From | To | Roles | Rules |
| --- | --- | --- | --- | --- |
| `queue_invitation` | created | email_queued | company_admin |  |
| `mark_delivered` | email_queued | delivered | system |  |
| `verify_invitation` | delivered, opened | verified | system |  |
| `accept_invitation` | verified | completed | buyer, seller | maker-checker |

## BUY-01 · Buyer demand folio

Area: buyer_setup · starts in `draft` · required fields: `product`, `quantity`, `unit`, `destination`

| Action | From | To | Roles | Rules |
| --- | --- | --- | --- | --- |
| `submit_demand` | draft | pending_approval | buyer |  |
| `approve_demand` | pending_approval | completed | checker, company_admin | maker-checker |
| `return_demand` | pending_approval | draft | checker, company_admin | reason required |

## SEL-01 · Seller supply folio

Area: seller_setup · starts in `draft` · required fields: `product`, `capacity`, `unit`, `origin`

| Action | From | To | Roles | Rules |
| --- | --- | --- | --- | --- |
| `submit_supply` | draft | pending_approval | seller |  |
| `approve_supply` | pending_approval | completed | checker, company_admin | maker-checker |
| `return_supply` | pending_approval | draft | checker, company_admin | reason required |

## MAT-01D · Buyer discovery

Area: discovery · starts in `queued` · required fields: `product`, `region`

| Action | From | To | Roles | Rules |
| --- | --- | --- | --- | --- |
| `start_discovery` | queued | running | buyer, system |  |
| `qualify_candidates` | running | qualified | system |  |
| `publish_pool` | qualified | completed | buyer |  |

## MAT-01R · Bilateral matching resolution

Area: discovery · starts in `intent_created` · required fields: `sourceRecordId`, `candidateTenantId` · needs a completed MAT-01D

| Action | From | To | Roles | Rules |
| --- | --- | --- | --- | --- |
| `buyer_approve` | intent_created | buyer_approved | buyer |  |
| `seller_approve` | buyer_approved | mutual_approved | seller |  |
| `open_scoped_connection` | mutual_approved | completed | system |  |

## MAT-02 · Seller demand discovery

Area: discovery · starts in `queued` · required fields: `product`, `region`

| Action | From | To | Roles | Rules |
| --- | --- | --- | --- | --- |
| `start_seller_discovery` | queued | running | seller, system |  |
| `qualify_demands` | running | qualified | system |  |
| `publish_demand_pool` | qualified | completed | seller |  |

## MAT-03 · Existing counterparty reuse

Area: discovery · starts in `review` · required fields: `sourceRecordId`, `relationshipScope`

| Action | From | To | Roles | Rules |
| --- | --- | --- | --- | --- |
| `refresh_evidence` | review | evidence_ready | buyer, system |  |
| `submit_reuse` | evidence_ready | pending_approval | buyer |  |
| `approve_reuse` | pending_approval | completed | checker, company_admin | maker-checker |

## MAT-04 · Continuous rematching

Area: discovery · starts in `change_detected` · required fields: `sourceRecordId`, `eventDescription`

| Action | From | To | Roles | Rules |
| --- | --- | --- | --- | --- |
| `classify_impact` | change_detected | impact_scoped | system |  |
| `run_rematch` | impact_scoped | decision_required | system |  |
| `accept_rematch` | decision_required | completed | buyer, seller |  |
| `keep_current` | decision_required | completed | buyer, seller |  |

## MAT-05 · Controlled alternatives

Area: discovery · starts in `alternatives_ready` · required fields: `sourceRecordId`, `requirements`

| Action | From | To | Roles | Rules |
| --- | --- | --- | --- | --- |
| `shortlist_alternative` | alternatives_ready | decision_required | buyer |  |
| `approve_alternative` | decision_required | completed | checker, company_admin | maker-checker |
| `reject_alternatives` | decision_required | completed | buyer | reason required |

## DUE-01 · Due diligence

Area: qualification · starts in `review` · required fields: `sourceRecordId`, `evidenceScope`

| Action | From | To | Roles | Rules |
| --- | --- | --- | --- | --- |
| `request_evidence` | review | evidence_pending | buyer |  |
| `submit_evidence` | evidence_pending | decision_required | seller |  |
| `qualify` | decision_required | completed | checker, company_admin | maker-checker |
| `decline_qualification` | decision_required | completed | checker, company_admin | maker-checker, reason required |

## SAM-01 · Sample control

Area: delivery · starts in `requested` · required fields: `sourceRecordId`, `sampleSpecification`

| Action | From | To | Roles | Rules |
| --- | --- | --- | --- | --- |
| `dispatch_sample` | requested | in_transit | seller |  |
| `receive_sample` | in_transit | received | buyer |  |
| `record_sample_result` | received | decision_required | buyer, system |  |
| `accept_sample` | decision_required | completed | buyer |  |
| `reject_sample` | decision_required | completed | buyer | reason required |

## RFQ-01 · RFQ release

Area: commercial · starts in `draft` · required fields: `sourceRecordId`, `deliveryTerms` · needs a completed BUY-01

| Action | From | To | Roles | Rules |
| --- | --- | --- | --- | --- |
| `submit_rfq` | draft | pending_approval | buyer |  |
| `approve_rfq` | pending_approval | ready_to_release | checker, company_admin | maker-checker |
| `release_rfq` | ready_to_release | completed | buyer |  |

## QUO-01 · Seller quotation

Area: commercial · starts in `draft` · required fields: `sourceRecordId`, `price`, `quantity`, `currency` · needs a completed RFQ-01

| Action | From | To | Roles | Rules |
| --- | --- | --- | --- | --- |
| `submit_quotation` | draft | submitted | seller |  |
| `request_clarification` | submitted | clarification | buyer | reason required |
| `resubmit_quotation` | clarification | submitted | seller |  |
| `acknowledge_quotation` | submitted | completed | buyer |  |

## QEN-01 · Negotiation room

Area: commercial · starts in `scheduling` · required fields: `sourceRecordId`, `agenda` · needs a completed QUO-01

| Action | From | To | Roles | Rules |
| --- | --- | --- | --- | --- |
| `schedule_room` | scheduling | scheduled | buyer, seller |  |
| `send_reminder` | scheduled | reminded | system |  |
| `join_room` | scheduled, reminded | live | buyer, seller |  |
| `align_terms` | live | aligned | buyer, seller |  |
| `close_room` | aligned | completed | buyer, seller |  |

## AWD-01 · Award decision

Area: commercial · starts in `decision_required` · required fields: `sourceRecordId`, `decisionReason` · needs a completed QEN-01

| Action | From | To | Roles | Rules |
| --- | --- | --- | --- | --- |
| `submit_award` | decision_required | pending_approval | buyer |  |
| `approve_award` | pending_approval | issued | checker, company_admin | maker-checker |
| `acknowledge_award` | issued | completed | seller |  |

## CTR-01 · Contract and signing

Area: contract · starts in `draft` · required fields: `sourceRecordId`, `contractTerms` · needs a completed AWD-01

| Action | From | To | Roles | Rules |
| --- | --- | --- | --- | --- |
| `submit_contract` | draft | review | buyer, seller |  |
| `approve_contract` | review | ready_to_sign | checker, company_admin | maker-checker |
| `sign_contract` | ready_to_sign | partially_signed | buyer, seller |  |
| `countersign_contract` | partially_signed | completed | buyer, seller | maker-checker |

## EXE-01 · Order execution

Area: delivery · starts in `order_created` · required fields: `sourceRecordId`, `deliveryPlan` · needs a completed CTR-01

| Action | From | To | Roles | Rules |
| --- | --- | --- | --- | --- |
| `confirm_order` | order_created | in_production | seller |  |
| `record_dispatch` | in_production | in_transit | seller, system |  |
| `record_receipt` | in_transit | received | buyer, system |  |
| `accept_delivery` | received | completed | buyer |  |
| `open_dispute` | in_production, in_transit, received | disputed | buyer, seller | reason required |

## TRU-01 · Outcome and Trust

Area: trust · starts in `collecting_receipts` · required fields: `sourceRecordId`, `outcomeSummary` · needs a completed EXE-01

| Action | From | To | Roles | Rules |
| --- | --- | --- | --- | --- |
| `seal_receipts` | collecting_receipts | eligibility_review | system |  |
| `approve_eligibility` | eligibility_review | policy_compute | checker, company_admin | maker-checker |
| `compute_trust` | policy_compute | ledger_pending | system |  |
| `commit_trust` | ledger_pending | completed | system |  |
