// ── Storage Interface ────────────────────────────────────────────────────────
// ── NoopProvider ────────────────────────────────────────────────────────────
export class NoopStorageProvider {
    configured() { return false; }
    async put() { throw new Error("storage not configured"); }
    async get() { throw new Error("storage not configured"); }
}
//# sourceMappingURL=index.js.map