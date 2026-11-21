// Control checks. Plain code decides pass or fail; no model output is ever an input here.
// Every check takes normalized records (see src/data/normalize.js) and the audit period,
// and returns a result whose evidence lists the record IDs it relied on.

const DAY_MS = 24 * 60 * 60 * 1000;
// Operational work tracked in Jira that is not a code change, so CM-1 skips it.
const NON_CODE_LABELS = ['access-review', 'no-code'];

const inPeriod = (iso, period) => {
  if (!iso) return false;
  const t = Date.parse(iso);
  return t >= Date.parse(period.start) && t <= Date.parse(period.end) + DAY_MS - 1;
};

const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / DAY_MS;

function result(control, { evidence, exceptions, summary, noEvidence = false }) {
  const status = noEvidence ? 'no_evidence' : exceptions.length === 0 ? 'pass' : 'fail';
  return {
    controlId: control.id,
    title: control.title,
    frameworks: control.frameworks,
    status,
    summary,
    evidence,
    exceptions,
  };
}

export const CONTROLS = [
  {
    id: 'CM-1',
    title: 'Code changes are peer reviewed before release',
    frameworks: { soc2: 'CC8.1', iso27001: 'A.8.32' },
    check(records, period) {
      const changes = records.filter(
        (r) =>
          r.source === 'jira' &&
          ['Story', 'Bug', 'Task'].includes(r.type) &&
          !r.labels?.some((l) => NON_CODE_LABELS.includes(l)) &&
          inPeriod(r.resolvedAt, period),
      );
      const exceptions = [];
      for (const r of changes) {
        if (!r.reviewer) exceptions.push({ recordId: r.id, reason: 'No reviewer recorded' });
        else if (r.reviewer === r.assignee) exceptions.push({ recordId: r.id, reason: 'Reviewer is the same person as the assignee' });
      }
      return result(this, {
        evidence: changes.map((r) => r.id),
        exceptions,
        noEvidence: changes.length === 0,
        summary: `${changes.length - exceptions.length} of ${changes.length} resolved changes had an independent reviewer.`,
      });
    },
  },
  {
    id: 'CM-2',
    title: 'Production changes are approved before they are made',
    frameworks: { soc2: 'CC8.1', iso27001: 'A.8.32' },
    check(records, period) {
      const changes = records.filter((r) => r.source === 'jsm' && r.type === 'Change' && inPeriod(r.resolvedAt, period));
      const exceptions = [];
      for (const r of changes) {
        if (r.approval?.status !== 'approved') exceptions.push({ recordId: r.id, reason: 'No approval recorded' });
        else if (Date.parse(r.approval.decidedAt) > Date.parse(r.resolvedAt))
          exceptions.push({ recordId: r.id, reason: 'Approved after the change was completed' });
      }
      return result(this, {
        evidence: changes.map((r) => r.id),
        exceptions,
        noEvidence: changes.length === 0,
        summary: `${changes.length - exceptions.length} of ${changes.length} change requests were approved before completion.`,
      });
    },
  },
  {
    id: 'IR-1',
    title: 'Priority 1 incidents are acknowledged within 30 minutes',
    frameworks: { soc2: 'CC7.4', iso27001: 'A.5.26' },
    check(records, period) {
      const incidents = records.filter(
        (r) => r.source === 'jsm' && r.type === 'Incident' && r.priority === 'Highest' && inPeriod(r.createdAt, period),
      );
      const exceptions = incidents
        .filter((r) => r.firstResponseMinutes == null || r.firstResponseMinutes > 30)
        .map((r) => ({
          recordId: r.id,
          reason: r.firstResponseMinutes == null ? 'No first response recorded' : `Acknowledged after ${r.firstResponseMinutes} minutes`,
        }));
      return result(this, {
        evidence: incidents.map((r) => r.id),
        exceptions,
        noEvidence: incidents.length === 0,
        summary: `${incidents.length - exceptions.length} of ${incidents.length} P1 incidents were acknowledged within 30 minutes.`,
      });
    },
  },
  {
    id: 'IR-2',
    title: 'Priority 1 incidents have a post-incident review',
    frameworks: { soc2: 'CC7.5', iso27001: 'A.5.27' },
    check(records, period) {
      const incidents = records.filter(
        (r) => r.source === 'jsm' && r.type === 'Incident' && r.priority === 'Highest' && inPeriod(r.createdAt, period),
      );
      const postmortems = new Set(
        records.filter((r) => r.source === 'confluence' && r.labels?.includes('postmortem')).flatMap((r) => r.linkedKeys ?? []),
      );
      const exceptions = incidents
        .filter((r) => !postmortems.has(r.key))
        .map((r) => ({ recordId: r.id, reason: 'No Confluence page labeled postmortem links to this incident' }));
      return result(this, {
        evidence: incidents.map((r) => r.id),
        exceptions,
        noEvidence: incidents.length === 0,
        summary: `${incidents.length - exceptions.length} of ${incidents.length} P1 incidents have a postmortem page.`,
      });
    },
  },
  {
    id: 'VM-1',
    title: 'Critical vulnerabilities are fixed within 30 days',
    frameworks: { soc2: 'CC7.1', iso27001: 'A.8.8' },
    check(records, period) {
      const vulns = records.filter(
        (r) => r.source === 'jira' && r.labels?.includes('security-vuln') && r.priority === 'Highest' && Date.parse(r.createdAt) <= Date.parse(period.end) + DAY_MS,
      );
      const exceptions = [];
      for (const r of vulns) {
        const closedOrEnd = r.resolvedAt ?? new Date(Date.parse(period.end) + DAY_MS - 1).toISOString();
        const age = daysBetween(r.createdAt, closedOrEnd);
        if (age > 30) exceptions.push({ recordId: r.id, reason: `${r.resolvedAt ? 'Fixed' : 'Still open'} after ${Math.floor(age)} days` });
      }
      return result(this, {
        evidence: vulns.map((r) => r.id),
        exceptions,
        noEvidence: vulns.length === 0,
        summary: `${vulns.length - exceptions.length} of ${vulns.length} critical vulnerabilities were fixed within 30 days.`,
      });
    },
  },
  {
    id: 'PL-1',
    title: 'Security policies are reviewed at least every 12 months',
    frameworks: { soc2: 'CC5.3', iso27001: 'A.5.1' },
    check(records, period) {
      const policies = records.filter((r) => r.source === 'confluence' && r.labels?.includes('policy'));
      const exceptions = policies
        .filter((r) => daysBetween(reviewedOn(r), period.end) > 365)
        .map((r) => ({ recordId: r.id, reason: `Last reviewed ${reviewedOn(r).slice(0, 10)}` }));
      return result(this, {
        evidence: policies.map((r) => r.id),
        exceptions,
        noEvidence: policies.length === 0,
        summary: `${policies.length - exceptions.length} of ${policies.length} policy pages were reviewed in the last 12 months.`,
      });
    },
  },
  {
    id: 'AC-1',
    title: 'User access is reviewed every quarter',
    frameworks: { soc2: 'CC6.2', iso27001: 'A.5.18' },
    check(records, period) {
      const reviews = records.filter((r) => r.source === 'jira' && r.labels?.includes('access-review') && r.resolvedAt);
      const quarters = quartersIn(period);
      const covered = new Set(reviews.map((r) => quarterOf(r.resolvedAt)));
      const exceptions = quarters.filter((q) => !covered.has(q)).map((q) => ({ recordId: null, reason: `No completed access review in ${q}` }));
      return result(this, {
        evidence: reviews.filter((r) => quarters.includes(quarterOf(r.resolvedAt))).map((r) => r.id),
        exceptions,
        summary: `${quarters.length - exceptions.length} of ${quarters.length} quarters had a completed access review.`,
      });
    },
  },
  {
    id: 'SD-1',
    title: 'No secrets are stored in tickets or pages',
    frameworks: { soc2: 'CC6.1', iso27001: 'A.8.12' },
    check(records, _period, scan) {
      const exceptions = (scan?.secretFindings ?? []).map((f) => ({ recordId: f.recordId, reason: `Possible ${f.kind} found (masked)` }));
      return result(this, {
        evidence: records.map((r) => r.id),
        exceptions,
        noEvidence: records.length === 0,
        summary: `${exceptions.length} possible secrets found across ${records.length} records.`,
      });
    },
  },
];

// Policies usually state their review date; trust that over the page's last-edit time,
// since a typo fix is not a review. Falls back to the last edit when no date is stated.
const REVIEWED_RE = /last reviewed\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})/i;
export function reviewedOn(r) {
  const m = REVIEWED_RE.exec(r.text ?? '');
  return m ? `${m[1]}T00:00:00Z` : r.updatedAt;
}

export function quarterOf(iso) {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

export function quartersIn(period) {
  const out = [];
  const d = new Date(period.start);
  d.setUTCDate(1);
  const end = Date.parse(period.end);
  while (d.getTime() <= end) {
    const q = quarterOf(d.toISOString());
    if (!out.includes(q)) out.push(q);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

export function runControls(records, period, scan, controlIds) {
  const selected = controlIds?.length ? CONTROLS.filter((c) => controlIds.includes(c.id)) : CONTROLS;
  return selected.map((c) => c.check(records, period, scan));
}
