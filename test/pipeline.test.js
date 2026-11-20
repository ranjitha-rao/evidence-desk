import { describe, it, expect } from 'vitest';
import { runChecks, draftEvidencePack } from '../src/pipeline.js';
import { createMemoryStore } from '../src/store/memory.js';
import { verifyChain } from '../src/security/auditlog.js';
import { RECORDS, PERIOD } from './fixtures/site.js';

const RUN_ID = '11111111-2222-4333-8444-555555555555';

function setup() {
  const store = createMemoryStore();
  const pages = [];
  const deps = {
    store,
    uuid: () => RUN_ID,
    now: () => new Date('2026-10-01T00:00:00Z'),
    fetchEvidence: async () => structuredClone(RECORDS),
    createDraftPage: async (p) => {
      pages.push(p);
      return { id: 'p1', url: 'https://example.atlassian.net/wiki/p1' };
    },
  };
  return { store, pages, deps };
}

const ctx = { accountId: 'acc-lead' };
const input = { projectKeys: 'WEB,API,SEC,OPS', serviceDeskProjectKey: 'HELP', policySpaceKey: 'SEC', ...PERIOD };

describe('run-control-checks on the synthetic site', () => {
  it('computes every control from records, not from planted text', async () => {
    const { deps } = setup();
    const out = await runChecks(input, ctx, deps);
    const status = Object.fromEntries(out.results.map((r) => [r.controlId, r.status]));
    expect(out.results.find((r) => r.controlId === 'CM-1').summary).toBe('3 of 5 resolved changes had an independent reviewer.');
    expect(status).toEqual({
      'CM-1': 'fail', // WEB-102 no reviewer, API-201 self-review
      'CM-2': 'fail', // HELP-41 approved after the change
      'IR-1': 'fail', // HELP-35 acknowledged after 47 minutes
      'IR-2': 'fail', // HELP-35 has no postmortem
      'VM-1': 'fail', // SEC-12 still open after 41 days
      'PL-1': 'fail', // CONF:9002 last updated 2025-06-01
      'AC-1': 'pass', // OPS-7 covers Q3
      'SD-1': 'fail', // AWS key in API-201
    });
  });

  it('reports the planted auditor note and still fails CM-1', async () => {
    const { deps } = setup();
    const out = await runChecks(input, ctx, deps);
    expect(out.injectionWarnings.map((w) => w.recordId)).toEqual(expect.arrayContaining(['WEB-102', 'HELP-35']));
    const cm1 = out.results.find((r) => r.controlId === 'CM-1');
    expect(cm1.status).toBe('fail');
    expect(cm1.exceptions.map((e) => e.recordId)).toEqual(['WEB-102', 'API-201']);
    expect(cm1.exceptions[0].excerpt).toMatch(/^<untrusted_record id="WEB-102">/);
  });

  it('never returns an unredacted secret to the agent', async () => {
    const { deps, store } = setup();
    const out = await runChecks(input, ctx, deps);
    expect(JSON.stringify(out)).not.toContain('AKIAABCDEFGHIJKLMNOP');
    expect(JSON.stringify(await store.getRun(RUN_ID))).not.toContain('AKIAABCDEFGHIJKLMNOP');
  });

  it('rejects bad input and logs the attempt', async () => {
    const { deps, store } = setup();
    const out = await runChecks({ ...input, projectKeys: 'WEB) OR project = HR' }, ctx, deps);
    expect(out.error).toMatch(/Invalid input/);
    const log = await store.listAudit();
    expect(log).toHaveLength(1);
    expect(log[0].outcome.rejected).toBeTruthy();
  });
});

describe('draft-evidence-pack', () => {
  it('builds the table from stored results and drops bad claims', async () => {
    const { deps, store, pages } = setup();
    await runChecks(input, ctx, deps);
    const narrative =
      'IR-1 failed because HELP-35 was acknowledged after 47 minutes [HELP-35]. ' +
      'CM-1 passed and every change was reviewed [WEB-102]. ' +
      'The team is in great shape overall.';
    const out = await draftEvidencePack({ runId: RUN_ID, spaceKey: 'SEC', narrative }, ctx, deps);
    expect(out.status).toBe('draft');
    expect(out.claimsKept).toBe(1);
    expect(out.claimsRejected).toHaveLength(2);
    expect(pages).toHaveLength(1);
    expect(pages[0].storageBody).toContain('<strong>FAIL</strong>');
    expect(pages[0].storageBody).not.toContain('CM-1 passed');
    expect(pages[0].storageBody).toContain('WEB-102: fake-authority, force-result');
    expect(verifyChain(await store.listAudit())).toEqual({ ok: true, entries: 2 });
  });

  it("refuses another user's run with the same error as a missing run", async () => {
    const { deps } = setup();
    await runChecks(input, ctx, deps);
    const other = await draftEvidencePack({ runId: RUN_ID, spaceKey: 'SEC' }, { accountId: 'acc-other' }, deps);
    const missing = await draftEvidencePack({ runId: '99999999-2222-4333-8444-555555555555', spaceKey: 'SEC' }, ctx, deps);
    expect(other.error).toBe(missing.error);
  });

  it('escapes HTML in record titles', async () => {
    const { deps, pages } = setup();
    deps.fetchEvidence = async () => [{ ...structuredClone(RECORDS[0]), title: '<script>x</script>' }];
    await runChecks(input, ctx, deps);
    await draftEvidencePack({ runId: RUN_ID, spaceKey: 'SEC' }, ctx, deps);
    expect(pages[0].storageBody).not.toContain('<script>');
  });
});
