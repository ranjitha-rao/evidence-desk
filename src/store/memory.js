// In-memory store with the same interface as the Forge SQL store. Used by tests and local runs.
export function createMemoryStore() {
  const runs = new Map();
  const audit = [];
  return {
    async saveRun(run) {
      runs.set(run.runId, structuredClone(run));
    },
    async getRun(runId) {
      return runs.has(runId) ? structuredClone(runs.get(runId)) : null;
    },
    async lastAudit() {
      return audit.length ? { ...audit[audit.length - 1] } : null;
    },
    async insertAudit(entry) {
      audit.push(structuredClone(entry));
    },
    async listAudit() {
      return audit.map((e) => structuredClone(e));
    },
    _audit: audit,
  };
}
