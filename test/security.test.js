import { describe, it, expect } from 'vitest';
import { redact } from '../src/security/redact.js';
import { parseInput, RunChecksInput, DraftPackInput } from '../src/security/validate.js';
import { verifyNarrative } from '../src/security/verifier.js';
import { appendAudit, verifyChain, hashEntry } from '../src/security/auditlog.js';
import { createMemoryStore } from '../src/store/memory.js';

describe('redaction', () => {
  it('masks secrets and reports them', () => {
    const r = redact('key AKIAABCDEFGHIJKLMNOP and ghp_' + 'a'.repeat(36), 'API-1');
    expect(r.text).not.toMatch(/AKIA|ghp_/);
    expect(r.secretFindings.map((f) => f.kind)).toEqual(['AWS access key', 'GitHub token']);
    expect(r.secretFindings[0].recordId).toBe('API-1');
  });
  it('masks emails and valid card numbers but not ticket numbers', () => {
    const r = redact('mail jo@example.com card 4111 1111 1111 1111 ticket 1234567890123');
    expect(r.text).toContain('[REDACTED EMAIL]');
    expect(r.text).toContain('[REDACTED CARD NUMBER]');
    expect(r.text).toContain('1234567890123');
    expect(r.piiCount).toBe(2);
  });
  it('masks password assignments', () => {
    expect(redact('password: hunter2hunter2').text).toContain('[REDACTED PASSWORD ASSIGNMENT]');
  });
});

describe('input validation', () => {
  const ok = { projectKeys: 'WEB, API', periodStart: '2026-07-01', periodEnd: '2026-09-30' };
  it('accepts good input and splits lists', () => {
    const r = parseInput(RunChecksInput, ok);
    expect(r.ok).toBe(true);
    expect(r.value.projectKeys).toEqual(['WEB', 'API']);
    expect(r.value.controlIds).toEqual([]);
  });
  it.each([
    ['JQL injection in project key', { ...ok, projectKeys: 'WEB) OR project in (HR' }],
    ['lowercase key', { ...ok, projectKeys: 'web' }],
    ['bad date', { ...ok, periodStart: 'July 1' }],
    ['reversed period', { ...ok, periodStart: '2026-10-01' }],
    ['period too long', { ...ok, periodStart: '2024-01-01' }],
    ['unknown control', { ...ok, controlIds: 'CM-1,XX-9' }],
    ['CQL injection in space key', { ...ok, policySpaceKey: 'SEC" OR space = "HR' }],
  ])('rejects %s', (_name, input) => {
    expect(parseInput(RunChecksInput, input).ok).toBe(false);
  });
  it('requires a UUID run id', () => {
    expect(parseInput(DraftPackInput, { runId: '1 OR 1=1', spaceKey: 'SEC' }).ok).toBe(false);
  });
});

describe('narrative verifier', () => {
  const run = {
    records: [{ citeKey: 'WEB-101' }, { citeKey: 'HELP-35' }],
    results: [
      { controlId: 'CM-1', status: 'pass' },
      { controlId: 'IR-1', status: 'fail' },
    ],
  };
  it('keeps cited, consistent sentences', () => {
    const v = verifyNarrative('CM-1 passed with independent review [WEB-101]. IR-1 failed because HELP-35 was late [HELP-35].', run);
    expect(v.kept).toHaveLength(2);
    expect(v.rejected).toHaveLength(0);
  });
  it('drops uncited, invented and contradicting claims', () => {
    const v = verifyNarrative('All good overall. See [WEB-999] for proof. IR-1 passed after review [HELP-35].', run);
    expect(v.kept).toHaveLength(0);
    expect(v.rejected.map((r) => r.reason)).toEqual([
      'No citation',
      'Cites records not read in this run: WEB-999',
      'Claims IR-1 passed, but the computed status is not pass',
    ]);
  });
});

describe('audit log', () => {
  it('builds a valid hash chain and detects tampering', async () => {
    const store = createMemoryStore();
    for (let i = 0; i < 3; i++) await appendAudit(store, { actor: 'acc-1', action: 'run-control-checks', inputs: { i }, outcome: { ok: true } });
    expect(verifyChain(await store.listAudit())).toEqual({ ok: true, entries: 3 });

    store._audit[1].outcome = { ok: false };
    expect(verifyChain(await store.listAudit())).toMatchObject({ ok: false, brokenAt: 2 });

    store._audit[1].hash = hashEntry(store._audit[1]);
    expect(verifyChain(await store.listAudit())).toMatchObject({ ok: false, brokenAt: 3 });
  });
  it('detects a deleted entry', async () => {
    const store = createMemoryStore();
    for (let i = 0; i < 3; i++) await appendAudit(store, { actor: 'a', action: 'x', inputs: {}, outcome: {} });
    store._audit.splice(1, 1);
    expect(verifyChain(await store.listAudit())).toMatchObject({ ok: false, brokenAt: 3 });
  });
});

import { reviewedOn, CONTROLS } from '../src/controls/catalog.js';
import { withSla } from '../src/data/normalize.js';

describe('date sources', () => {
  it('PL-1 uses a stated "Last reviewed" date over the last edit', () => {
    const page = { id: 'CONF:1', source: 'confluence', labels: ['policy'], text: 'Owner: Security\nLast reviewed: 2025-01-10', updatedAt: '2026-10-01T00:00:00Z' };
    expect(reviewedOn(page)).toBe('2025-01-10T00:00:00Z');
    const pl1 = CONTROLS.find((c) => c.id === 'PL-1').check([page], { start: '2026-08-01', end: '2026-10-31' });
    expect(pl1.status).toBe('fail');
    expect(pl1.exceptions[0].reason).toBe('Last reviewed 2025-01-10');
  });
  it('IR-1 falls back to the first reply from someone other than the reporter', () => {
    const issue = {
      fields: {
        created: '2026-09-01T10:00:00Z',
        reporter: { accountId: 'cust' },
        comment: { comments: [
          { author: { accountId: 'cust' }, created: '2026-09-01T10:05:00Z' },
          { author: { accountId: 'agent' }, created: '2026-09-01T10:47:00Z' },
        ] },
      },
    };
    const r = withSla({ createdAt: issue.fields.created }, [], issue);
    expect(r).toMatchObject({ firstResponseMinutes: 47, firstResponseSource: 'first-comment' });
  });
  it('IR-1 prefers SLA data when present', () => {
    const r = withSla({}, [{ name: 'Time to first response', completedCycles: [{ elapsedTime: { millis: 12 * 60000 } }] }], {});
    expect(r).toMatchObject({ firstResponseMinutes: 12, firstResponseSource: 'sla' });
  });
});
