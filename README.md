# Evidence Desk

A Rovo agent for Atlassian that gets a team audit-ready for SOC 2 and ISO 27001. It checks controls against
real Jira, Jira Service Management and Confluence records, explains what failed and why, and drafts an
evidence pack in Confluence where every claim links to its source.

Built on Forge for Atlassian Codegeist 2026. Design doc: requirements, architecture and security plan
(shared in the project).

**Code decides every result; the agent only puts it into words.**

## How it works

| Step | Where |
| --- | --- |
| Validate action inputs with strict schemas | `src/security/validate.js` |
| Read records as the calling user (`asUser()`) | `src/data/fetch.js` |
| Mask secrets and personal data, scan for prompt injection | `src/security/redact.js`, `src/security/injection.js` |
| Run 8 control checks in plain code | `src/controls/catalog.js` |
| Save the run and append to a hash-chained audit log | `src/store/sql.js`, `src/security/auditlog.js` |
| Verify the agent's narrative, then create a draft Confluence page | `src/security/verifier.js`, `src/pipeline.js` |

## Controls

| ID | Control | SOC 2 | ISO 27001:2022 |
| --- | --- | --- | --- |
| CM-1 | Code changes are peer reviewed | CC8.1 | A.8.32 |
| CM-2 | Production changes are approved first | CC8.1 | A.8.32 |
| IR-1 | P1 incidents acknowledged within 30 minutes | CC7.4 | A.5.26 |
| IR-2 | P1 incidents get a postmortem | CC7.5 | A.5.27 |
| VM-1 | Critical vulnerabilities fixed within 30 days | CC7.1 | A.8.8 |
| PL-1 | Policies reviewed every 12 months | CC5.3 | A.5.1 |
| AC-1 | Quarterly access reviews | CC6.2 | A.5.18 |
| SD-1 | No secrets in tickets or pages | CC6.1 | A.8.12 |

## Security

| Control | What it does |
| --- | --- |
| Runs on Atlassian | No `external` permissions; data in Forge SQL. CI fails if the manifest declares egress. |
| Least privilege | Six scopes, read-only except `write:confluence-content`, used only to create draft pages. |
| User-scoped reads | All product reads use `asUser()`. CI fails on `asApp()` in `src/data`. |
| Prompt-injection defense | Results come from code; excerpts are wrapped as untrusted; a scanner flags instruction-like text; the agent's only write is a draft. |
| Verifier | Narrative sentences must cite a record read in this run and must not call a failed control passed. |
| Input validation | zod schemas; keys checked before they reach JQL or CQL; 400-day period limit. |
| Redaction | AWS, GitHub, Atlassian and Slack tokens, private keys, JWTs, passwords, emails and card numbers are masked. |
| Audit log | Append-only, SHA-256 chained; edits and deletions are detectable. |
| Supply chain | Pinned versions, `npm audit`, CodeQL and Dependabot. |

### Scopes

| Scope | Why |
| --- | --- |
| `read:jira-work` | Search issues and read their fields |
| `read:jira-user` | Read reviewer and assignee account IDs |
| `read:servicedesk-request` | Read JSM SLA and approval data |
| `read:confluence-content.all` | Read policy and postmortem pages |
| `search:confluence` | CQL search for labeled pages |
| `write:confluence-content` | Create the draft evidence page (the only write) |

## Develop

```sh
npm ci
npm test            # unit, security and pipeline tests on a synthetic site
npm i -g @forge/cli
forge login
forge register      # replaces the placeholder app id in manifest.yml
forge lint
forge deploy && forge install
forge eligibility   # Runs on Atlassian check
```

All demo data is synthetic (fictional company "Northwind Ledger").
