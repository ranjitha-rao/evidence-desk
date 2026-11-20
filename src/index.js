// Forge entry points: wires the pipeline to real Atlassian APIs and Forge SQL.
import { runChecks, draftEvidencePack } from './pipeline.js';
import { fetchEvidence, createDraftPage } from './data/fetch.js';
import { createSqlStore } from './store/sql.js';
import { verifyChain } from './security/auditlog.js';
import { CONTROLS } from './controls/catalog.js';

const deps = () => ({ store: createSqlStore(), fetchEvidence, createDraftPage });

// Rovo actions receive (payload, context); the person's accountId comes from context,
// never from an input the agent filled in.
export const runControlChecks = (payload, context) => runChecks(payload, context ?? payload?.context, deps());

export const draftPack = (payload, context) => draftEvidencePack(payload, context ?? payload?.context, deps());

export const listControls = () =>
  CONTROLS.map(({ id, title, frameworks }) => ({ id, title, soc2: frameworks.soc2, iso27001: frameworks.iso27001 }));

// Admin page resolver: returns the log and whether its hash chain is intact.
export const auditLog = async () => {
  const entries = await createSqlStore().listAudit();
  return { entries: entries.slice(-200), chain: verifyChain(entries) };
};
