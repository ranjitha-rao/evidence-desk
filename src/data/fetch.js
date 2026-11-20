// Reads evidence as the person who asked (asUser), so the agent only ever sees records
// that person can already open. Nothing here uses asApp for reads.
import api, { route } from '@forge/api';
import { fromJiraIssue, withSla, withApproval, fromConfluencePage } from './normalize.js';

const MAX_ISSUES = 200;
const MAX_PAGES = 100;
const JIRA_FIELDS = ['summary', 'description', 'issuetype', 'priority', 'labels', 'assignee', 'created', 'resolutiondate'];

async function json(res, what) {
  if (res.status === 401 || res.status === 403) throw new Error(`No permission to read ${what}`);
  if (!res.ok) throw new Error(`Could not read ${what} (HTTP ${res.status})`);
  return res.json();
}

async function findReviewerField() {
  const fields = await json(await api.asUser().requestJira(route`/rest/api/3/field`), 'Jira fields');
  return fields.find((f) => /^code reviewer$/i.test(f.name))?.id ?? null;
}

async function searchJql(jql, fields) {
  const out = [];
  let nextPageToken;
  do {
    const body = { jql, fields, maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) };
    const res = await api.asUser().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const page = await json(res, 'Jira issues');
    out.push(...(page.issues ?? []));
    nextPageToken = page.nextPageToken;
  } while (nextPageToken && out.length < MAX_ISSUES);
  return out.slice(0, MAX_ISSUES);
}

// Inputs reaching here have passed src/security/validate.js, so keys match strict patterns
// and are safe to place inside JQL and CQL.
export async function fetchEvidence({ projectKeys, serviceDeskProjectKey, policySpaceKey, periodStart }) {
  const reviewerFieldId = await findReviewerField();
  const records = [];
  const since = periodStart;

  const jiraIssues = await searchJql(
    `project in (${projectKeys.join(',')}) AND (resolved >= "${since}" OR labels in (security-vuln, access-review)) ORDER BY created ASC`,
    reviewerFieldId ? [...JIRA_FIELDS, reviewerFieldId] : JIRA_FIELDS,
  );
  records.push(...jiraIssues.map((i) => fromJiraIssue(i, { reviewerFieldId })));

  if (serviceDeskProjectKey) {
    const jsmIssues = await searchJql(
      `project = ${serviceDeskProjectKey} AND issuetype in (Incident, Change) AND created >= "${since}" ORDER BY created ASC`,
      JIRA_FIELDS,
    );
    for (const issue of jsmIssues) {
      let rec = fromJiraIssue(issue, { source: 'jsm' });
      if (rec.type === 'Incident') {
        const sla = await json(await api.asUser().requestJira(route`/rest/servicedeskapi/request/${issue.key}/sla`), 'SLA data');
        rec = withSla(rec, sla.values);
      } else if (rec.type === 'Change') {
        const ap = await json(await api.asUser().requestJira(route`/rest/servicedeskapi/request/${issue.key}/approval`), 'approvals');
        rec = withApproval(rec, ap.values);
      }
      records.push(rec);
    }
  }

  if (policySpaceKey) {
    const cql = `space = "${policySpaceKey}" AND type = page AND label in ("policy", "postmortem")`;
    const res = await api
      .asUser()
      .requestConfluence(route`/wiki/rest/api/content/search?cql=${cql}&limit=${MAX_PAGES}&expand=version,metadata.labels,body.storage`);
    const page = await json(res, 'Confluence pages');
    records.push(...(page.results ?? []).map(fromConfluencePage));
  }

  return records;
}

// Creates the evidence pack as a DRAFT page. A person reviews and publishes it in Confluence;
// the agent can never publish on its own.
export async function createDraftPage({ spaceKey, title, storageBody }) {
  const res = await api.asUser().requestConfluence(route`/wiki/rest/api/content`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'page', status: 'draft', title, space: { key: spaceKey }, body: { storage: { value: storageBody, representation: 'storage' } } }),
  });
  const page = await json(res, 'the new Confluence page');
  return { id: page.id, url: page._links?.base && page._links?.webui ? page._links.base + page._links.webui : null };
}
