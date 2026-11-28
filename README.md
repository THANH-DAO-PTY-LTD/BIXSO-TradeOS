# BIXSO Sourcing OS

Governed workflows for small B2B trade. A buyer and a seller move a deal through 19 explicit state machines, from setting up an organisation to delivering an order. Every step records who acted, in which role, from which state to which state, and a SHA-256 receipt.

The rules are in code, not in a spreadsheet:

- **Maker-checker.** The person who submitted a demand, RFQ, award or contract cannot approve it.
- **Lineage.** An RFQ needs a completed buyer demand. A quotation needs a released RFQ. Each later step needs the one before it to be completed.
- **Independent signatures.** A contract countersignature must come from a different person, organisation and role from the first signer.
- **Organisation isolation.** A record is visible only to the organisations named on it.
- **Safe retries.** Every write takes an idempotency key and an expected version, so a repeated or stale request cannot apply twice.

## Try it

Use Node.js 22 or later. There are no dependencies to install.

```sh
npm test
npm run demo
```

The demo walks a fictional café buying coffee beans: demand → checker approval → RFQ → release → supplier quotation → acknowledgement.

Use the command line to run your own trade. Data is saved in `.sourcing-os/data.json` in the current folder.

```sh
node bin/sourcingos.js flows
node bin/sourcingos.js flow RFQ-01
node bin/sourcingos.js new BUY-01 --as buyer:mai@acme-cafe --id D-1 \
  --set product="Coffee beans" --set quantity=40 --set unit=kg --set destination=Melbourne
node bin/sourcingos.js act D-1 submit_demand --as buyer:mai@acme-cafe
node bin/sourcingos.js act D-1 approve_demand --as checker:linh@acme-cafe
node bin/sourcingos.js history D-1 --as buyer:mai@acme-cafe
```

`--as` is `role:person@organisation`. Roles are `buyer`, `seller`, `checker` and `company_admin`.

## The 19 flows

See [docs/FLOWS.md](docs/FLOWS.md) for every state, action, role and required field.

| Area | Flows |
| --- | --- |
| Company | `ORG-01` organisation · `ORG-02` membership |
| Setup | `BUY-01` buyer demand · `SEL-01` seller supply |
| Discovery | `MAT-01D` buyer discovery · `MAT-01R` mutual match · `MAT-02` seller discovery · `MAT-03` reuse a counterparty · `MAT-04` rematching · `MAT-05` alternatives |
| Qualification and delivery | `DUE-01` due diligence · `SAM-01` samples |
| Commercial | `RFQ-01` RFQ · `QUO-01` quotation · `QEN-01` negotiation room · `AWD-01` award |
| Contract and execution | `CTR-01` contract and signing · `EXE-01` order execution |
| Trust | `TRU-01` outcome and trust |

## Limits of this preview

- It runs for one person on one computer. The JSON file is not a database, has no locking across processes and no backup.
- 13 flows can be completed from the command line. Six (`ORG-02`, `MAT-01D`, `MAT-01R`, `MAT-02`, `MAT-04`, `TRU-01`) include steps reserved for a verified server, such as sending an invitation or sealing receipts. The command line cannot act as that server.
- Sourcing OS records decisions. It does not move money, hold funds, sign documents legally, verify identities or match counterparties for you.
- Use fictional records. Do not store customer or personal data in issues.

## Use it as a library

```js
const { WorkflowService, MemoryWorkflowRepository } = require('./src');
const service = new WorkflowService(new MemoryWorkflowRepository());
```

Bring your own repository by implementing the methods in `src/memoryRepository.js`.

## Help shape it

Open an [issue](https://github.com/THANH-DAO-PTY-LTD/BIXSO-Sourcing-OS/issues) if a flow does not match how your business buys or sells. Describe the step, who decides, and what should block it. See [CONTRIBUTING](CONTRIBUTING.md) and the [security policy](SECURITY.md).

<!-- bixso-os-family:start -->
## BIXSO OS family

Small, local-first, MIT-licensed tools for running real work, each built from the rules of a BIXSO product.

| Project | What it does |
| --- | --- |
| [BIXSO Service OS](https://github.com/THANH-DAO-PTY-LTD/BIXSO-Service-OS) | Run a one-person service business: Company, Flow and Work in a local web app. |
| [BIXSO Sourcing OS](https://github.com/THANH-DAO-PTY-LTD/BIXSO-Sourcing-OS) (this project) | B2B sourcing workflows from RFQ to delivered order, with a receipt for every step. |
| [BIXSO Consulting OS](https://github.com/THANH-DAO-PTY-LTD/BIXSO-Consulting-OS) | An evidence-first record of a consulting engagement. |
| [BIXSO Construction OS](https://github.com/THANH-DAO-PTY-LTD/BIXSO-Construction-OS) | An outdoor or landscape job from site survey to handover. |
| [BIXSO Paperwork OS](https://github.com/THANH-DAO-PTY-LTD/BIXSO-Paperwork-OS) | One shared record of a paperwork matter between a client and their professionals. |
| [BIXSO Travel OS](https://github.com/THANH-DAO-PTY-LTD/BIXSO-Travel-OS) | Trip plans where every suggestion explains itself, plus traveller-host meetups. |
| [BIXSO Sport OS](https://github.com/THANH-DAO-PTY-LTD/BIXSO-Sport-OS) | Community pickup games with a fair waitlist, check-in and results. |
| [BIXSO Social OS](https://github.com/THANH-DAO-PTY-LTD/BIXSO-Social-OS) | Connections and a trust ledger that moves only on independent receipts. |

Release news, questions and ideas: [r/BIXSO](https://www.reddit.com/r/BIXSO/).

## Work with BIXSO

Want this set up for your business, or shaped around how your team actually works? BIXSO provides business workflow advisory and implementation. See [bixso.ai](https://bixso.ai).
<!-- bixso-os-family:end -->

## License

[MIT](LICENSE) · Copyright (c) 2026 Thanh Dao Pty Ltd. See [docs/PROVENANCE.md](docs/PROVENANCE.md).

The software is provided under the MIT license. Nothing in that license or in this repository excludes, restricts or modifies any right or remedy you have under the Australian Consumer Law, or any other law, that cannot lawfully be excluded.

BIXSO and the BIXSO logo are trademarks of Thanh Dao Pty Ltd. The MIT license covers the code, not the names or logo; see [TRADEMARKS.md](TRADEMARKS.md).
