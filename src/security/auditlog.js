// Append-only, hash-chained audit log. Each entry stores the SHA-256 of the entry before it,
// so editing or deleting any row breaks verification from that row onward.
import { createHash } from 'node:crypto';

export const GENESIS = '0'.repeat(64);

export function canonical(entry) {
  const { seq, at, actor, action, inputs, recordIds, outcome, prevHash } = entry;
  return JSON.stringify({ seq, at, actor, action, inputs, recordIds, outcome, prevHash });
}

export function hashEntry(entry) {
  return createHash('sha256').update(canonical(entry)).digest('hex');
}

export async function appendAudit(store, { actor, action, inputs, recordIds = [], outcome }) {
  const last = await store.lastAudit();
  const entry = {
    seq: last ? last.seq + 1 : 1,
    at: new Date().toISOString(),
    actor,
    action,
    inputs,
    recordIds,
    outcome,
    prevHash: last ? last.hash : GENESIS,
  };
  entry.hash = hashEntry(entry);
  await store.insertAudit(entry);
  return entry;
}

export function verifyChain(entries) {
  let prev = GENESIS;
  let expectedSeq = 1;
  for (const e of entries) {
    if (e.seq !== expectedSeq) return { ok: false, brokenAt: e.seq, reason: `Missing entry before #${e.seq}` };
    if (e.prevHash !== prev) return { ok: false, brokenAt: e.seq, reason: `Entry #${e.seq} does not follow #${e.seq - 1}` };
    if (hashEntry(e) !== e.hash) return { ok: false, brokenAt: e.seq, reason: `Entry #${e.seq} was changed after it was written` };
    prev = e.hash;
    expectedSeq++;
  }
  return { ok: true, entries: entries.length };
}
