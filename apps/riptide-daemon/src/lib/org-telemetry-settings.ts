/**
 * Cache of this daemon's effective telemetry-collection flags, sourced from
 * `daemon.settings.get`. The API returns them already resolved as
 * `organization_settings.{commit,pr}_tracking_enabled && user_settings.metrics_advanced_enabled`,
 * so the org flags are the opt-in and the per-user flag (default TRUE) lets an org admin exclude
 * individual members.
 *
 * The collector gate ({@link isCommitAttributionEnabled}) is
 * synchronous and called from many places (daemon startup, per-session, per-event). A daemon
 * process serves a single org, so rather than thread the org settings through every call site the
 * daemon seeds this cache once at startup and refreshes it on each per-session settings fetch, and
 * the gates read it synchronously. Follows the same cached-singleton shape as
 * {@link createCachedBinaryLocator} (state encapsulated in a closure, exposed via methods).
 *
 * Both collectors gate on this cache alone. Flipping the org's DB flag turns collection on
 * (phantom enablement) the next time the daemon starts or runs a session. Defaults OFF until
 * seeded.
 *
 * STALENESS, and which direction it fails: the only writers are daemon startup and the per-session
 * settings fetch — there is no periodic refresh, and the ingest procedures do not re-check
 * server-side. Turning collection ON is therefore delayed until the next start or session launch,
 * which is benign. Turning a member's exclusion on is delayed the same way, which is NOT: a daemon
 * that has been up for days with no new session keeps its commit watch running for a member who
 * has just been excluded. That is the fail-open direction, and it is why the settings
 * copy promises the exclusion lands "the next time their daemon starts or runs a session" rather
 * than immediately. Closing it needs a refresh on the reconcile loop, placed ABOVE the
 * `if (!isCommitAttributionEnabled())` early-return in ./git/commit-watcher.ts — below it, a daemon
 * that has gone off could never come back on without a restart. Tracked separately; not in the
 * change that made the exclusion the load-bearing direction.
 */
type OrgTelemetryFlags = {
	commitTrackingEnabled: boolean
	prTrackingEnabled: boolean
}

function createOrgTelemetryCache() {
	let flags: OrgTelemetryFlags = { commitTrackingEnabled: false, prTrackingEnabled: false }

	return {
		/** Seed/refresh the cache from a settings fetch. Ignores unrelated fields. */
		set(next: OrgTelemetryFlags): void {
			flags = { commitTrackingEnabled: next.commitTrackingEnabled, prTrackingEnabled: next.prTrackingEnabled }
		},
		commitTrackingEnabled: (): boolean => flags.commitTrackingEnabled,
		prTrackingEnabled: (): boolean => flags.prTrackingEnabled,
		/** Reset to the default (OFF) state — used by tests. */
		reset(): void {
			flags = { commitTrackingEnabled: false, prTrackingEnabled: false }
		},
	}
}

export const orgTelemetryCache = createOrgTelemetryCache()
