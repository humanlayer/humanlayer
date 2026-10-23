import z from 'zod/v4'

/** Hardware and OS of the machine a daemon runs on, re-sent with every heartbeat. Only `uptimeSec` changes between beats. */
export const HostMachineSchema = z.object({
	os: z.string(),
	arch: z.string(),
	cpuModel: z.string(),
	cpuCores: z.number().int().positive(),
	memTotalBytes: z.number().nonnegative(),
	uptimeSec: z.number().nonnegative(),
})

export type HostMachine = z.infer<typeof HostMachineSchema>

export const HOST_PROCESS_NAME_MAX_LENGTH = 64
export const HOST_PROCESS_GROUPS_MAX = 10
export const HOST_ACTIVE_SESSIONS_MAX = 100

/** Processes sharing an executable name and origin, summed. Names only: arguments can carry secrets. */
export const HostProcessGroupSchema = z.object({
	name: z.string().min(1).max(HOST_PROCESS_NAME_MAX_LENGTH),
	processCount: z.number().int().positive(),
	/** 0-100 share of the whole machine over the interval since the previous sample. */
	cpuPct: z.number().min(0).max(100),
	memBytes: z.number().nonnegative(),
	/** Whether the daemon or a process it spawned, such as an agent session or its tools, runs these. */
	startedByDaemon: z.boolean(),
})

export type HostProcessGroup = z.infer<typeof HostProcessGroupSchema>

/** A single sample of machine load, captured by the daemon at heartbeat time. */
export const HostStatsSchema = z.object({
	capturedAt: z.number(),
	/** 0-100 averaged across all cores over the interval since the previous sample. */
	cpuPct: z.number().min(0).max(100),
	memUsedBytes: z.number().nonnegative(),
	memTotalBytes: z.number().nonnegative(),
	/** Resident memory of the daemon and every process it spawned. Absent where the process tree cannot be read. */
	memDaemonTreeBytes: z.number().nonnegative().optional(),
	/** Absent on platforms without a run-queue average, which is every Windows host. */
	load1: z.number().nonnegative().optional(),
	load5: z.number().nonnegative().optional(),
	load15: z.number().nonnegative().optional(),
	diskFreeBytes: z.number().nonnegative().optional(),
	diskTotalBytes: z.number().nonnegative().optional(),
	/** Coding-agent sessions the daemon was running when the sample was taken. */
	sessionCount: z.number().int().nonnegative(),
	/** Ids of the sessions counted in `sessionCount`, up to the first 100. Absent from daemons that predate it. */
	activeSessionIds: z.array(z.string().min(1).max(128)).max(HOST_ACTIVE_SESSIONS_MAX).optional(),
	/**
	 * The busiest process groups by cpu and by memory. Absent on the first sample, where no cpu
	 * interval exists yet, and where the process table cannot be read.
	 */
	topProcesses: z.array(HostProcessGroupSchema).max(HOST_PROCESS_GROUPS_MAX).optional(),
})

export type HostStats = z.infer<typeof HostStatsSchema>
