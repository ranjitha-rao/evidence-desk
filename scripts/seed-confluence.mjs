// Creates the demo policy and postmortem pages in the Confluence space SEC. Safe to re-run:
// a page whose title already exists in the space is skipped.
//   ATLASSIAN_EMAIL=... ATLASSIAN_API_TOKEN=... node scripts/seed-confluence.mjs
// Optional: SITE (default evidence-desk.atlassian.net), SPACE (default SEC), INCIDENT_KEY (default HELP-1).
const site = process.env.SITE ?? 'evidence-desk.atlassian.net';
const space = process.env.SPACE ?? 'SEC';
const incident = process.env.INCIDENT_KEY ?? 'HELP-1';
const { ATLASSIAN_EMAIL: email, ATLASSIAN_API_TOKEN: token } = process.env;
if (!email || !token) {
  console.error('Set ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN (never commit them).');
  process.exit(1);
}
const auth = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
const base = `https://${site}/wiki/rest/api`;

const PAGES = [
  { title: 'Information Security Policy', label: 'policy', body: '<p>Owner: Security</p><p>Last reviewed: 2026-03-01</p><p>This policy sets how Northwind Ledger protects customer data.</p>' },
  { title: 'Acceptable Use Policy', label: 'policy', body: '<p>Owner: IT</p><p>Last reviewed: 2025-06-01</p><p>Rules for using company devices and accounts.</p>' },
  { title: 'Incident Response Policy', label: 'policy', body: '<p>Owner: Security</p><p>Last reviewed: 2026-07-15</p><p>P1 incidents are acknowledged within 30 minutes and get a postmortem.</p>' },
  { title: 'Postmortem: Checkout returning 500 errors', label: 'postmortem', body: `<p>Incident: ${incident}</p><p>Root cause: a bad deploy of 2.4. Rolled back after 2 hours.</p><p>Actions: add a canary stage.</p>` },
];

async function call(path, init = {}) {
  const res = await fetch(`${base}${path}`, { ...init, headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json', ...init.headers } });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

for (const p of PAGES) {
  const found = await call(`/content?spaceKey=${encodeURIComponent(space)}&title=${encodeURIComponent(p.title)}`);
  if (found.results?.length) {
    console.log(`skip   ${p.title} (exists, id ${found.results[0].id})`);
    continue;
  }
  const page = await call('/content', {
    method: 'POST',
    body: JSON.stringify({
      type: 'page',
      title: p.title,
      space: { key: space },
      body: { storage: { value: p.body, representation: 'storage' } },
      metadata: { labels: [{ prefix: 'global', name: p.label }] },
    }),
  });
  console.log(`create ${p.title} (id ${page.id}, label ${p.label})`);
}
