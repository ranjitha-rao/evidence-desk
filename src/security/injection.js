// Flags instruction-like text hidden in Jira and Confluence content.
// This is one layer of four (see README "Security"): even when a phrase slips past this scanner,
// it cannot change a control result, because results come from plain code in src/controls.

const RULES = [
  { id: 'override', weight: 3, re: /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|system|your)\b[^.\n]{0,30}\b(instructions?|rules?|prompts?|guidelines?|directions?|context)\b/i },
  { id: 'new-instructions', weight: 3, re: /\b(new|updated|real|actual|true)\s+(instructions?|system\s+prompt|rules?)\b/i },
  { id: 'role-hijack', weight: 2, re: /\b(you are now|act as|pretend (to be|you are)|from now on,? you|roleplay as)\b/i },
  { id: 'fake-authority', weight: 2, re: /\b(auditor|admin(istrator)?|security team|compliance team|system|assistant|rovo|agent)\s*(note|override|instruction|message|directive)\s*[:\-]/i },
  { id: 'force-result', weight: 3, re: /\b(mark|report|set|record|treat|consider|list|show)\b[^.\n]{0,40}\b(as|to)\s+(passed|pass|compliant|green|approved|resolved|complete|satisfied|effective)\b/i },
  { id: 'suppress', weight: 2, re: /\b(do not|don't|never|avoid)\s+(mention|report|include|flag|list|disclose|reveal|show)\b/i },
  { id: 'exfil', weight: 3, re: /\b(send|post|email|upload|forward|exfiltrate|leak)\b[^.\n]{0,60}\b(https?:\/\/|webhook|external|attacker|this (url|address))/i },
  { id: 'tool-call', weight: 2, re: /\b(call|invoke|run|execute|use)\s+(the\s+)?(action|tool|function)\b|\bdraft-evidence-pack\b|\brun-control-checks\b/i },
  { id: 'chat-markup', weight: 3, re: /<\|?(system|im_start|im_end|assistant|user)\|?>|\[\/?INST\]|^\s*(system|assistant)\s*:/im },
  { id: 'prompt-leak', weight: 2, re: /\b(reveal|print|show|repeat|output)\b[^.\n]{0,30}\b(system prompt|your (instructions|prompt|rules))\b/i },
  { id: 'hidden-unicode', weight: 3, re: /[​-‏‪-‮⁠-⁤﻿]|[\u{E0000}-\u{E007F}]/u },
];

export const FLAG_THRESHOLD = 2;

// Text that reaches the scanner may be split by markup or odd spacing; normalize first.
function normalize(text) {
  return String(text)
    .normalize('NFKC')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_`~#>|]/g, ' ')
    .replace(/\s+/g, ' ');
}

export function scanForInjection(text) {
  if (!text) return { flagged: false, score: 0, rules: [] };
  const raw = String(text);
  const norm = normalize(raw);
  const hits = RULES.filter((r) => (r.id === 'hidden-unicode' || r.id === 'chat-markup' ? r.re.test(raw) : r.re.test(norm)));
  const score = hits.reduce((s, r) => s + r.weight, 0);
  return { flagged: score >= FLAG_THRESHOLD, score, rules: hits.map((r) => r.id) };
}

// Wraps record text so the agent's prompt can tell it apart from instructions.
// Angle brackets inside the content are escaped so content can't close the wrapper.
export function wrapUntrusted(recordId, text) {
  const safe = String(text ?? '').replace(/</g, '‹').replace(/>/g, '›');
  return `<untrusted_record id="${recordId}">${safe}</untrusted_record>`;
}
