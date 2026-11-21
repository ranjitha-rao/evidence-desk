// Writes the Jira CSV import files for the "Northwind Ledger" demo site.
// Emails come from environment variables so no personal address is committed:
//   DEV_A_EMAIL=you@example.com DEV_B_EMAIL=you+dev@example.com node scripts/make-seed-csv.mjs
// Audit period for the demo: 2026-09-01 to 2026-11-30.
import { writeFileSync, mkdirSync } from 'node:fs';
import { seedRows } from '../seed/data.mjs';

const A = process.env.DEV_A_EMAIL;
const B = process.env.DEV_B_EMAIL;
if (!A || !B || A === B) {
  console.error('Set DEV_A_EMAIL and DEV_B_EMAIL to two different users on the site.');
  process.exit(1);
}

const { web, help } = seedRows(A, B);

const csv = (rows) =>
  rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n') + '\n';

mkdirSync('seed/out', { recursive: true });
writeFileSync(
  'seed/out/northwind-web.csv',
  csv([['Summary', 'Issue Type', 'Priority', 'Labels', 'Assignee', 'Code reviewer', 'Created', 'Resolved', 'Status', 'Description'], ...web]),
);
writeFileSync(
  'seed/out/northwind-help.csv',
  csv([['Summary', 'Issue Type', 'Priority', 'Reporter', 'Assignee', 'Created', 'Resolved', 'Status', 'Description', 'Comment'], ...help]),
);
console.log('Wrote seed/out/northwind-web.csv (9 issues) and seed/out/northwind-help.csv (3 incidents).');
