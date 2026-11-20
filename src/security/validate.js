// Schema checks for every Rovo action input. The agent fills these fields, and its words
// can be steered by content it read, so nothing is trusted until it passes here.
import { z } from 'zod';
import { CONTROLS } from '../controls/catalog.js';

const CONTROL_IDS = CONTROLS.map((c) => c.id);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const projectKey = z.string().regex(/^[A-Z][A-Z0-9_]{1,9}$/, 'Not a Jira project key');
const spaceKey = z.string().regex(/^[A-Za-z0-9~]{1,255}$/, 'Not a Confluence space key');

const MAX_PERIOD_DAYS = 400;

export const RunChecksInput = z
  .object({
    projectKeys: z.string().max(200).transform(splitList).pipe(z.array(projectKey).min(1).max(10)),
    serviceDeskProjectKey: projectKey.optional(),
    policySpaceKey: spaceKey.optional(),
    periodStart: isoDate,
    periodEnd: isoDate,
    controlIds: z
      .string()
      .max(200)
      .optional()
      .transform((v) => (v ? splitList(v) : []))
      .pipe(z.array(z.enum(CONTROL_IDS)).max(CONTROL_IDS.length)),
  })
  .refine((v) => Date.parse(v.periodStart) <= Date.parse(v.periodEnd), { message: 'periodStart must be on or before periodEnd' })
  .refine((v) => (Date.parse(v.periodEnd) - Date.parse(v.periodStart)) / 86400000 <= MAX_PERIOD_DAYS, {
    message: `Audit period can be at most ${MAX_PERIOD_DAYS} days`,
  });

export const DraftPackInput = z.object({
  runId: z.string().uuid(),
  spaceKey,
  narrative: z.string().max(8000).optional(),
});

function splitList(v) {
  return v
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseInput(schema, payload) {
  const parsed = schema.safeParse(payload ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
    return { ok: false, error: `Invalid input. ${message}` };
  }
  return { ok: true, value: parsed.data };
}
