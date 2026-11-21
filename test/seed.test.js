// Runs the demo seed rows through the real control checks, so the expected-results table in
// seed/README.md is computed, not guessed. Keys follow import order (NW-1.., HELP-1..).
import { describe, it, expect } from 'vitest';
import { seedRows } from '../seed/data.mjs';
import { runControls } from '../src/controls/catalog.js';
import { redact } from '../src/security/redact.js';
import { scanForInjection } from '../src/security/injection.js';

const iso = (d) => (d ? d.replace(' ', 'T') + ':00Z' : null);

function records() {
  const { web, help } = seedRows('a@x', 'b@x');
  const out = web.map(([summary, type, priority, labels, assignee, reviewer, created, resolved, , desc], i) => ({
    id: `NW-${i + 1}`, citeKey: `NW-${i + 1}`, key: `NW-${i + 1}`, source: 'jira', type, priority, title: summary,
    text: `${summary}\n${desc}`, labels: labels ? labels.split(' ') : [], assignee, reviewer: reviewer || null,
    createdAt: iso(created), resolvedAt: iso(resolved),
  }));
  help.forEach(([summary, type, priority, , , created, resolved, , desc, comment], i) => {
    const ack = comment.split(';')[0];
    out.push({
      id: `HELP-${i + 1}`, citeKey: `HELP-${i + 1}`, key: `HELP-${i + 1}`, source: 'jsm', type, priority, title: summary,
      text: `${summary}\n${desc}`, labels: [], createdAt: iso(created), resolvedAt: iso(resolved),
      firstResponseMinutes: (Date.parse(iso(ack)) - Date.parse(iso(created))) / 60000,
    });
  });
  // Live-created changes (step 4 of seed/README.md) and the Confluence pages from scripts/seed-confluence.mjs.
  out.push(
    { id: 'HELP-4', citeKey: 'HELP-4', key: 'HELP-4', source: 'jsm', type: 'Change', text: '', labels: [], createdAt: '2026-11-22T09:00:00Z', resolvedAt: '2026-11-22T12:00:00Z', approval: { status: 'approved', decidedAt: '2026-11-22T10:00:00Z' } },
    { id: 'HELP-5', citeKey: 'HELP-5', key: 'HELP-5', source: 'jsm', type: 'Change', text: '', labels: [], createdAt: '2026-11-22T09:00:00Z', resolvedAt: '2026-11-22T12:00:00Z', approval: null },
    { id: 'CONF:1', citeKey: 'CONF:1', source: 'confluence', labels: ['policy'], text: 'Last reviewed: 2026-03-01', updatedAt: '2026-11-22T00:00:00Z' },
    { id: 'CONF:2', citeKey: 'CONF:2', source: 'confluence', labels: ['policy'], text: 'Last reviewed: 2025-06-01', updatedAt: '2026-11-22T00:00:00Z' },
    { id: 'CONF:3', citeKey: 'CONF:3', source: 'confluence', labels: ['policy'], text: 'Last reviewed: 2026-07-15', updatedAt: '2026-11-22T00:00:00Z' },
    { id: 'CONF:4', citeKey: 'CONF:4', source: 'confluence', labels: ['postmortem'], text: 'Incident: HELP-1', updatedAt: '2026-11-22T00:00:00Z', linkedKeys: ['HELP-1'] },
  );
  return out;
}

describe('demo seed', () => {
  it('produces the expected results in seed/README.md', () => {
    const recs = records();
    const secretFindings = recs.flatMap((r) => redact(r.text, r.citeKey).secretFindings);
    const results = runControls(recs, { start: '2026-09-01', end: '2026-11-30' }, { secretFindings });
    const byId = Object.fromEntries(results.map((r) => [r.controlId, r]));
    expect(Object.fromEntries(results.map((r) => [r.controlId, r.status]))).toEqual({
      'CM-1': 'fail', 'CM-2': 'fail', 'IR-1': 'fail', 'IR-2': 'fail', 'VM-1': 'fail', 'PL-1': 'fail', 'AC-1': 'pass', 'SD-1': 'fail',
    });
    expect(byId['CM-1'].summary).toBe('4 of 6 resolved changes had an independent reviewer.');
    expect(byId['CM-1'].exceptions.map((e) => e.recordId)).toEqual(['NW-2', 'NW-3']);
    expect(byId['IR-1'].exceptions).toEqual([{ recordId: 'HELP-2', reason: 'Acknowledged after 47 minutes' }]);
    expect(byId['VM-1'].exceptions).toEqual([{ recordId: 'NW-6', reason: 'Still open after 51 days' }]);
    expect(byId['SD-1'].exceptions.map((e) => e.recordId)).toEqual(['NW-3']);
    expect(recs.filter((r) => scanForInjection(r.text).flagged).map((r) => r.citeKey)).toEqual(['NW-2', 'HELP-2']);
  });
});
