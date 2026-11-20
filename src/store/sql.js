// Forge SQL store. Data stays in Atlassian-hosted storage, one database per install.
// TODO(spike): confirm the @forge/sql 4.x export shape (named `sql` and `migrationRunner`).
import { sql, migrationRunner } from '@forge/sql';

const MIGRATIONS = [
  [
    'v001_create_runs',
    `CREATE TABLE IF NOT EXISTS runs (
      run_id VARCHAR(36) PRIMARY KEY,
      created_at VARCHAR(32) NOT NULL,
      actor VARCHAR(128) NOT NULL,
      body LONGTEXT NOT NULL
    )`,
  ],
  [
    'v002_create_audit_log',
    `CREATE TABLE IF NOT EXISTS audit_log (
      seq INT PRIMARY KEY,
      at VARCHAR(32) NOT NULL,
      actor VARCHAR(128) NOT NULL,
      action VARCHAR(64) NOT NULL,
      inputs TEXT NOT NULL,
      record_ids TEXT NOT NULL,
      outcome TEXT NOT NULL,
      prev_hash CHAR(64) NOT NULL,
      hash CHAR(64) NOT NULL
    )`,
  ],
];

let migrated = false;

export async function ensureSchema() {
  if (migrated) return;
  let runner = migrationRunner;
  for (const [name, ddl] of MIGRATIONS) runner = runner.enqueue(name, ddl);
  await runner.run();
  migrated = true;
}

export function createSqlStore() {
  return {
    async saveRun(run) {
      await ensureSchema();
      await sql
        .prepare('INSERT INTO runs (run_id, created_at, actor, body) VALUES (?, ?, ?, ?)')
        .bindParams(run.runId, run.createdAt, run.actor, JSON.stringify(run))
        .execute();
    },
    async getRun(runId) {
      await ensureSchema();
      const { rows } = await sql.prepare('SELECT body FROM runs WHERE run_id = ?').bindParams(runId).execute();
      return rows.length ? JSON.parse(rows[0].body) : null;
    },
    async lastAudit() {
      await ensureSchema();
      const { rows } = await sql.prepare('SELECT * FROM audit_log ORDER BY seq DESC LIMIT 1').execute();
      return rows.length ? fromRow(rows[0]) : null;
    },
    async insertAudit(e) {
      await ensureSchema();
      // seq is the primary key, so two runs racing for the same seq cannot both write.
      await sql
        .prepare(
          'INSERT INTO audit_log (seq, at, actor, action, inputs, record_ids, outcome, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bindParams(e.seq, e.at, e.actor, e.action, JSON.stringify(e.inputs), JSON.stringify(e.recordIds), JSON.stringify(e.outcome), e.prevHash, e.hash)
        .execute();
    },
    async listAudit() {
      await ensureSchema();
      const { rows } = await sql.prepare('SELECT * FROM audit_log ORDER BY seq ASC').execute();
      return rows.map(fromRow);
    },
  };
}

function fromRow(r) {
  return {
    seq: Number(r.seq),
    at: r.at,
    actor: r.actor,
    action: r.action,
    inputs: JSON.parse(r.inputs),
    recordIds: JSON.parse(r.record_ids),
    outcome: JSON.parse(r.outcome),
    prevHash: r.prev_hash,
    hash: r.hash,
  };
}
