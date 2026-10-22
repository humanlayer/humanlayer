/**
 * The commit-attribution gate is ONE knob: the org's `commit_tracking_enabled` setting. Its only
 * writer is our internal admin dashboard (per-org rollout gate, default off) — there is
 * deliberately NO user-facing env override. Env vars exist in this design only as plumbing WE
 * control — carrying the org's answer into processes that cannot query it.
 *
 * Who knows the org's answer, and how it travels:
 *   - the DAEMON reads it from orgTelemetryCache (populated by `daemon.settings.get` at boot and
 *     on every session launch) and gates its own env injection + hook installs with it;
 *   - the terminal LAUNCHER (the riptide UI, which already polls the org settings) injects
 *     `HUMANLAYER_COMMIT_TRACKING=1` into the PTY env it builds when the org is opted in; the
 *     CLI hook processes inside that PTY read the variable as their org answer. A launcher that
 *     predates the variable simply leaves terminal attribution off — fails safe.
 */

/**
 * The env var through which a launcher hands the org's `commit_tracking_enabled` answer to the
 * processes it spawns (the terminal PTY → CLI hook processes). Set to `'1'` when the org is
 * opted in; absent otherwise. Internal plumbing, not a user-facing toggle: the only intended
 * writers are our own launchers. Hand-setting it in a shell arms only local trailer STAMPING —
 * recording to the ledger happens in the daemon, which reads the org's answer from the API and
 * ignores this variable entirely.
 */
export const COMMIT_TRACKING_ENV_VAR = 'HUMANLAYER_COMMIT_TRACKING'
