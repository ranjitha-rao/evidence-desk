// Masks secrets and personal data before any text reaches the agent.
// Secret hits are also returned as findings, because a leaked secret is itself a control failure (SD-1).

const SECRET_PATTERNS = [
  { kind: 'AWS access key', re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { kind: 'Atlassian API token', re: /\bATATT[A-Za-z0-9_\-=]{20,}\b/g },
  { kind: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: 'private key', re: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/g },
  { kind: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { kind: 'password assignment', re: /\b(?:password|passwd|pwd|secret|api[_-]?key)\s*[:=]\s*["']?[^\s"']{8,}/gi },
];

const PII_PATTERNS = [
  { kind: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { kind: 'card number', re: /\b(?:\d[ -]?){13,16}\b/g, validate: luhn },
];

function luhn(match) {
  const digits = match.replace(/\D/g, '');
  if (digits.length < 13) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function redact(text, recordId = null) {
  if (!text) return { text: '', secretFindings: [], piiCount: 0 };
  let out = String(text);
  const secretFindings = [];
  for (const { kind, re } of SECRET_PATTERNS) {
    out = out.replace(re, () => {
      secretFindings.push({ recordId, kind });
      return `[REDACTED ${kind.toUpperCase()}]`;
    });
  }
  let piiCount = 0;
  for (const { kind, re, validate } of PII_PATTERNS) {
    out = out.replace(re, (m) => {
      if (validate && !validate(m)) return m;
      piiCount++;
      return `[REDACTED ${kind.toUpperCase()}]`;
    });
  }
  return { text: out, secretFindings, piiCount };
}
