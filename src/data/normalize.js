// Turns Jira, JSM and Confluence API responses into one flat record shape for the control checks.
// Field names follow the Jira Cloud REST v3 and JSM REST shapes; the spike confirms them on a real site.

const ISSUE_KEY_RE = /\b[A-Z][A-Z0-9_]+-\d+\b/g;

export function fromJiraIssue(issue, { reviewerFieldId, source = 'jira' } = {}) {
  const f = issue.fields ?? {};
  return {
    id: issue.key,
    citeKey: issue.key,
    key: issue.key,
    source,
    type: f.issuetype?.name ?? null,
    title: f.summary ?? '',
    text: [f.summary, adfToText(f.description)].filter(Boolean).join('\n'),
    priority: f.priority?.name ?? null,
    labels: f.labels ?? [],
    assignee: f.assignee?.accountId ?? null,
    reviewer: reviewerFieldId ? (f[reviewerFieldId]?.accountId ?? null) : null,
    createdAt: f.created ?? null,
    resolvedAt: f.resolutiondate ?? null,
  };
}

export function withSla(record, slaValues) {
  const ttfr = (slaValues ?? []).find((s) => /first response/i.test(s.name ?? ''));
  const cycle = ttfr?.completedCycles?.[0];
  return { ...record, firstResponseMinutes: cycle ? Math.round(cycle.elapsedTime.millis / 60000) : null };
}

export function withApproval(record, approvals) {
  const final = (approvals ?? []).find((a) => a.finalDecision && a.finalDecision !== 'pending');
  return {
    ...record,
    approval: final ? { status: final.finalDecision, decidedAt: final.completedDate?.iso8601 ?? null } : null,
  };
}

export function fromConfluencePage(page) {
  const body = storageToText(page.body?.storage?.value ?? '');
  return {
    id: `CONF:${page.id}`,
    citeKey: `CONF:${page.id}`,
    key: null,
    source: 'confluence',
    type: 'Page',
    title: page.title ?? '',
    text: [page.title, body].filter(Boolean).join('\n'),
    labels: (page.metadata?.labels?.results ?? []).map((l) => l.name),
    updatedAt: page.version?.when ?? null,
    linkedKeys: [...new Set(body.match(ISSUE_KEY_RE) ?? [])],
  };
}

// Atlassian Document Format -> plain text (enough for scanning and excerpts).
export function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text ?? '';
  const inner = (node.content ?? []).map(adfToText).join(node.type === 'doc' ? '\n' : '');
  return ['paragraph', 'heading', 'listItem', 'codeBlock'].includes(node.type) ? `${inner}\n` : inner;
}

export function storageToText(html) {
  return String(html)
    .replace(/<(br|\/p|\/h\d|\/li)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}
