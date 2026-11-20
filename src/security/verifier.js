// Checks the agent's narrative against the stored run before anything is written.
// A sentence survives only if every record it cites was read in this run, and it does not
// contradict a control's computed status.

const CITE_RE = /\[([A-Z][A-Z0-9_]+-\d+|CONF:\d+)\]/g;
const PASS_WORDS = /\b(pass(es|ed)?|compliant|effective|satisf(y|ies|ied)|no exceptions|fully met)\b/i;
const CONTROL_RE = /\b([A-Z]{2}-\d)\b/g;

export function verifyNarrative(narrative, run) {
  const known = new Set(run.records.map((r) => r.citeKey));
  const statusById = Object.fromEntries(run.results.map((r) => [r.controlId, r.status]));
  const kept = [];
  const rejected = [];

  for (const sentence of splitSentences(narrative ?? '')) {
    const cites = [...sentence.matchAll(CITE_RE)].map((m) => m[1]);
    const controls = [...sentence.matchAll(CONTROL_RE)].map((m) => m[1]).filter((id) => id in statusById);

    if (cites.length === 0) {
      rejected.push({ sentence, reason: 'No citation' });
      continue;
    }
    const unknown = cites.filter((c) => !known.has(c));
    if (unknown.length) {
      rejected.push({ sentence, reason: `Cites records not read in this run: ${unknown.join(', ')}` });
      continue;
    }
    const contradicted = controls.filter((id) => statusById[id] !== 'pass' && PASS_WORDS.test(sentence));
    if (contradicted.length) {
      rejected.push({ sentence, reason: `Claims ${contradicted.join(', ')} passed, but the computed status is not pass` });
      continue;
    }
    kept.push(sentence);
  }
  return { kept, rejected, checked: kept.length + rejected.length };
}

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z[])/)
    .map((s) => s.trim())
    .filter(Boolean);
}
