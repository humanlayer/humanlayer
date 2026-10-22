import { HostMachineSchema, HostStatsSchema } from '@humanlayer/db/zodschemas/host-machine-stats'
import { CodingAgentUsageLimitsSchema } from '@humanlayer/schemas/zod/host/usage-limits'
import { HostModelCatalogSchema } from '@humanlayer/schemas/zod/model-catalog'
import z from 'zod/v4'

import { contractBuilder } from '../contract-builder'

/** What a daemon built from this contract can do. The app gates features on these names. */
export const DAEMON_CAPABILITIES = ['reportsRepositories', 'providerLogin', 'restartsAfterSelfUpdate'] as const

export type DaemonCapability = (typeof DAEMON_CAPABILITIES)[number]

/**
 * Sent in `capabilities` by a host that only runs sessions a user started on it, such as the pi
 * extension (apps/riptide-pi-extension). The app offers such a host for no launch or sign-in.
 * riptide-daemon never sends it.
 */
export const ATTACHED_SESSIONS_ONLY = 'attachedSessionsOnly'

/**
 * Sent with ATTACHED_SESSIONS_ONLY as `agent:<coding agent>` (`agent:pi`, `agent:opencode`,
 * `agent:codex`), so the app can name the agent a mirror-only host runs. Each agent on a machine
 * is its own host, and they all send the same machine name.
 */
export const AGENT_CAPABILITY_PREFIX = 'agent:'

export const heartbeatInputSchema = z.object({
	hostId: z.string(),
	hostName: z.string(),
	/** Build version of the daemon binary, for display. Absent from daemons built before it was sent. */
	daemonVersion: z.string().optional(),
	/** Sent by daemons from before `capabilities`; newer daemons list `reportsRepositories` there. */
	reportsRepositories: z.boolean().optional(),
	/**
	 * Names from `DAEMON_CAPABILITIES`. Absent from daemons built before the list was sent. Kept as
	 * plain strings so a daemon newer than the API does not fail its heartbeat on an unknown name.
	 */
	capabilities: z.array(z.string()).optional(),
	/**
	 * Models the host's Claude Code binary and Codex account offer right now. Absent until the
	 * daemon's first probe completes and from daemons built before the catalog was sent.
	 */
	supportedModels: HostModelCatalogSchema.optional(),
	/** How the daemon was installed. Absent from daemons built before it was sent. */
	distribution: z.enum(['cli', 'desktop']).optional(),
	/** Whether the daemon can install a new version of itself and restart. */
	canSelfUpdate: z.boolean().optional(),
	/** Registration belongs to a bounded automation run. Absence means false, including on updates. */
	ephemeral: z.boolean().optional(),
	/** Progress of an update the daemon is applying. Absent leaves the recorded progress untouched. */
	update: z
		.object({
			version: z.string(),
			state: z.enum(['installing', 'failed']),
			error: z.string().optional(),
		})
		.optional(),
	/** Hardware and OS of the machine. Absent from daemons built before machine stats were sent. */
	machine: HostMachineSchema.optional().catch(undefined),
	/** Load at the moment the beat was sent. Absent where collection failed or is unsupported; dropped when unparseable. */
	stats: HostStatsSchema.optional().catch(undefined),
	/**
	 * Subscription usage windows the daemon has observed for its coding agents. Absent from daemons
	 * built before usage reporting, and from a daemon that has not seen a rate-limit signal yet.
	 * A record this schema cannot parse is dropped rather than failing the beat, which keeps the host online.
	 */
	codingAgentUsageLimits: CodingAgentUsageLimitsSchema.optional().catch(undefined),
})

export const heartbeatOutputSchema = z.object({
	updateRequest: z.object({ version: z.string() }).nullable(),
})

export const heartbeatContract = contractBuilder.input(heartbeatInputSchema).output(heartbeatOutputSchema)
