# riptide-daemon

<important if="doing file or process I/O">
NO sync Node APIs (`execFileSync`, `readFileSync`, `existsSync`, any `*Sync`) — the daemon is a
single event loop; sync calls have caused lock-ups. Tests included, so the pattern never re-seeds.
Use `node:fs/promises` and `promisify(execFile)` (wraps the async `execFile` — non-blocking).
Existence check: `access(p).then(() => true, () => false)`. Module-load guard: top-level `await`.
</important>
