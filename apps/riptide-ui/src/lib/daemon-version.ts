import type { OnlineHost } from '@humanlayer/db/tables/online-hosts'
import {
	AGENT_CAPABILITY_PREFIX,
	ATTACHED_SESSIONS_ONLY,
	type DaemonCapability,
} from '@humanlayer/riptide-api-contract/daemon/heartbeat'
import { getCodingAgentLabel } from '@humanlayer/ui/components/coding-agent-badge'
import semver, { type SemVer } from 'semver'

export type DaemonVersionFields = Pick<OnlineHost, 'daemon_version' | 'distribution'>

export type DaemonCapabilityFields = DaemonVersionFields & Pick<OnlineHost, 'capabilities'>

/**
 * First CLI release carrying each capability: `ci-scripts/derive-daemon-version.ts` run at the
 * capability's merge commit. The number is the same on every channel; only the suffix differs.
 */
export const DAEMON_CAPABILITY_CLI_VERSIONS = {
	reportsRepositories: '0.31.166',
	providerLogin: '0.31.183',
	restartsAfterSelfUpdate: '0.31.215',
} as const satisfies Record<DaemonCapability, string>

export type DaemonCapabilitySupport = 'supported' | 'unsupported' | 'unknown'

/**
 * The daemon's version in the CLI series, or null when it cannot be placed there: desktop-bundled
 * daemons report the app release tag, and local builds report `dev`. A daemon that predates the
 * `distribution` field is read as CLI.
 */
export function parseCliDaemonVersion(host: DaemonVersionFields): SemVer | null {
	if (host.distribution === 'desktop') return null
	return semver.parse(host.daemon_version)
}

/**
 * A null `daemon_version` means the daemon predates the version field, which shipped together with
 * `reportsRepositories`, so it has none of the capabilities.
 */
export function daemonSupports(host: DaemonCapabilityFields, capability: DaemonCapability): DaemonCapabilitySupport {
	if (host.capabilities !== null) return host.capabilities.includes(capability) ? 'supported' : 'unsupported'
	if (host.daemon_version === null) return 'unsupported'
	const version = parseCliDaemonVersion(host)
	if (version === null) return 'unknown'
	const release = `${version.major}.${version.minor}.${version.patch}`
	return semver.gte(release, DAEMON_CAPABILITY_CLI_VERSIONS[capability]) ? 'supported' : 'unsupported'
}

/** A host that runs only the sessions started on it, such as a pi session: never a launch or sign-in target. */
export function isAttachedSessionsOnly(host: Pick<OnlineHost, 'capabilities'>): boolean {
	return host.capabilities?.includes(ATTACHED_SESSIONS_ONLY) ?? false
}

/** The agent a mirror-only host runs, from its `agent:<name>` capability: "Codex", "OpenCode", "pi". */
export function mirroredAgentLabel(host: Pick<OnlineHost, 'capabilities'>): string | undefined {
	const agent = host.capabilities
		?.find((c) => c.startsWith(AGENT_CAPABILITY_PREFIX))
		?.slice(AGENT_CAPABILITY_PREFIX.length)
	return agent ? getCodingAgentLabel(agent) : undefined
}
