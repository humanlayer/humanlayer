import type { SDKControlGetUsageResponse, SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk'
import {
	type ClaudeUsageLimits,
	ClaudeUsageLimitsSchema,
	type CodingAgentUsageLimits,
	USAGE_LIMIT_WARNING_PERCENT,
	type UsageLimitWindow,
} from '@humanlayer/schemas/zod/host/usage-limits'
import { Clock, Context, Effect, Layer, Stream, SubscriptionRef } from 'effect'

// rate_limit_event utilization is a 0-1 fraction; the normalized record uses 0-100.
const EVENT_UTILIZATION_TO_PERCENT = 100
// A window can pass 100% under overage, but this far past its cap means the SDK likely changed units.
const SUSPECTED_UNIT_DRIFT_PERCENT = 500
const OVERAGE_RATE_LIMIT_TYPES = ['overage', 'seven_day_overage_included'] as const satisfies readonly NonNullable<
	SDKRateLimitInfo['rateLimitType']
>[]
// The snapshot also carries credit balances and internal buckets under codenames (e.g. nimbus_quill),
// which would render as unlabelled bars, so only the plan windows are read; model_scoped is read separately.
const SNAPSHOT_WINDOW_KEYS = [
	'five_hour',
	'seven_day',
	'seven_day_opus',
	'seven_day_sonnet',
	'seven_day_oauth_apps',
] as const

const isOverageRateLimitType = (type: string): boolean => (OVERAGE_RATE_LIMIT_TYPES as readonly string[]).includes(type)

export type UsageLimitsWarn = (detail: Record<string, unknown>, message: string) => void
const noopWarn: UsageLimitsWarn = () => {}

const emptyClaudeLimits = (now: number): ClaudeUsageLimits => ({
	checked_at: now,
	available: true,
	subscription_type: null,
	windows: {},
})

// Epoch seconds reach this only in the year 5138, epoch milliseconds passed it in 1973, so a
// value at or above it is unambiguously milliseconds.
const EPOCH_SECONDS_CEILING = 100_000_000_000

/** rate_limit_event reset times are epoch seconds; a value already in milliseconds is kept as is. */
export const rateLimitResetToMs = (resetsAt: number | undefined, warn: UsageLimitsWarn = noopWarn): number | null => {
	if (resetsAt === undefined) return null
	if (resetsAt >= EPOCH_SECONDS_CEILING) {
		warn({ resetsAt }, 'Rate limit reset time is in milliseconds, not seconds; the SDK may have changed units')
		return Math.round(resetsAt)
	}
	return Math.round(resetsAt * 1000)
}

const isoToMs = (iso: string | null): number | null => {
	if (iso === null) return null
	const parsed = Date.parse(iso)
	return Number.isNaN(parsed) ? null : parsed
}

const eventUtilizationToPercentWarningOnUnitDrift = (
	utilization: number,
	key: string,
	warn: UsageLimitsWarn,
): number => {
	const percent = utilization * EVENT_UTILIZATION_TO_PERCENT
	if (percent > SUSPECTED_UNIT_DRIFT_PERCENT) {
		warn({ key, utilization, percent }, 'Usage utilization far past its cap; the SDK may have changed units')
	}
	return percent
}

// A rejected window with no overage to fall back on: the SDK then emits no further messages and no result.
export const rateLimitRejectionParksTurnUntilReset = (info: SDKRateLimitInfo): boolean =>
	info.status === 'rejected' &&
	info.overageStatus !== 'allowed' &&
	info.overageStatus !== 'allowed_warning' &&
	!info.isUsingOverage &&
	!info.overageInUse

// One event names one window (0-1 fraction, epoch seconds); windows it does not mention keep their value.
export const mergeClaudeRateLimitEvent = (
	previous: ClaudeUsageLimits | undefined,
	info: SDKRateLimitInfo,
	now: number,
	warn: UsageLimitsWarn = noopWarn,
): ClaudeUsageLimits => {
	const base = previous ?? emptyClaudeLimits(now)
	const windows = { ...base.windows }
	let overage = base.overage

	const type = info.rateLimitType
	if (type !== undefined && isOverageRateLimitType(type)) {
		overage = {
			status: info.overageStatus ?? info.status,
			in_use: Boolean(info.isUsingOverage || info.overageInUse),
			disabled_reason: info.overageDisabledReason,
			resets_at: rateLimitResetToMs(info.overageResetsAt ?? info.resetsAt, warn),
		}
	} else if (type !== undefined) {
		windows[type] = {
			used_percent:
				info.utilization === undefined
					? (windows[type]?.used_percent ?? 0)
					: eventUtilizationToPercentWarningOnUnitDrift(info.utilization, type, warn),
			resets_at: rateLimitResetToMs(info.resetsAt, warn) ?? windows[type]?.resets_at ?? null,
			status: info.status,
		}
	}

	if (info.overageStatus !== undefined && (type === undefined || !isOverageRateLimitType(type))) {
		overage = {
			status: info.overageStatus,
			in_use: Boolean(info.isUsingOverage || info.overageInUse),
			disabled_reason: info.overageDisabledReason,
			resets_at: rateLimitResetToMs(info.overageResetsAt, warn) ?? overage?.resets_at ?? null,
		}
	}

	return { ...base, checked_at: now, available: true, windows, overage }
}

const readScalarWindowEntryOrInvalid = (
	value: unknown,
): { utilization: number | null; resets_at: string | null } | 'invalid' => {
	if (value === null || value === undefined) return { utilization: null, resets_at: null }
	if (typeof value !== 'object') return 'invalid'
	const entry = value as Record<string, unknown>
	const utilization = entry.utilization ?? null
	const resetsAt = entry.resets_at ?? null
	if (utilization !== null && typeof utilization !== 'number') return 'invalid'
	if (resetsAt !== null && typeof resetsAt !== 'string') return 'invalid'
	return { utilization, resets_at: resetsAt }
}

const normalizeSnapshotWindowSkippingUnexpectedShape = (
	previous: UsageLimitWindow | undefined,
	value: unknown,
	key: string,
	warn: UsageLimitsWarn,
): UsageLimitWindow | undefined => {
	const entry = readScalarWindowEntryOrInvalid(value)
	if (entry === 'invalid') {
		warn({ key }, 'Skipping usage window with an unexpected shape')
		return undefined
	}
	if (entry.utilization === null) return undefined
	const usedPercent = entry.utilization
	if (usedPercent > SUSPECTED_UNIT_DRIFT_PERCENT) {
		warn({ key, usedPercent }, 'Usage utilization far past its cap; the SDK may have changed units')
	}
	const window: UsageLimitWindow = {
		used_percent: usedPercent,
		resets_at: isoToMs(entry.resets_at) ?? previous?.resets_at ?? null,
	}
	const previousStatusStillHolds =
		previous?.status === 'allowed' ||
		(previous?.status === 'allowed_warning' && usedPercent >= USAGE_LIMIT_WARNING_PERCENT) ||
		(previous?.status === 'rejected' && usedPercent >= 100)
	if (previousStatusStillHolds) window.status = previous.status
	return window
}

// The /usage snapshot lists every window at once in 0-100 percent and ISO time; statuses from events
// survive while they hold.
export const claudeUsageLimitsFromSnapshot = (
	previous: ClaudeUsageLimits | undefined,
	snapshot: Pick<SDKControlGetUsageResponse, 'rate_limits' | 'rate_limits_available' | 'subscription_type'>,
	now: number,
	warn: UsageLimitsWarn = noopWarn,
): ClaudeUsageLimits => {
	if (!snapshot.rate_limits_available || snapshot.rate_limits === null) {
		return {
			checked_at: now,
			available: false,
			subscription_type: snapshot.subscription_type,
			windows: {},
		}
	}
	const windows: Record<string, UsageLimitWindow> = {}
	for (const key of SNAPSHOT_WINDOW_KEYS) {
		const window = normalizeSnapshotWindowSkippingUnexpectedShape(
			previous?.windows[key],
			snapshot.rate_limits[key],
			key,
			warn,
		)
		if (window) windows[key] = window
	}
	for (const scoped of snapshot.rate_limits.model_scoped ?? []) {
		const id = `model:${scoped.display_name}`
		const window = normalizeSnapshotWindowSkippingUnexpectedShape(previous?.windows[id], scoped, id, warn)
		if (window) windows[id] = window
	}
	const limits: ClaudeUsageLimits = {
		checked_at: now,
		available: true,
		subscription_type: snapshot.subscription_type,
		windows,
	}
	if (previous?.overage) limits.overage = previous.overage
	return limits
}

type ClaudeUsageSnapshotInput = Pick<
	SDKControlGetUsageResponse,
	'rate_limits' | 'rate_limits_available' | 'subscription_type'
>

export interface HostUsageLimitsService {
	readonly current: Effect.Effect<CodingAgentUsageLimits | undefined>
	readonly changes: Stream.Stream<CodingAgentUsageLimits>
	readonly applyClaudeRateLimitEvent: (info: SDKRateLimitInfo) => Effect.Effect<void>
	readonly applyClaudeUsageSnapshot: (response: ClaudeUsageSnapshotInput) => Effect.Effect<void>
}

/** One daemon serves one host and one account per agent, so every session shares these windows. */
export class HostUsageLimits extends Context.Service<HostUsageLimits, HostUsageLimitsService>()('HostUsageLimits') {}

interface CommitReport {
	readonly warnings: ReadonlyArray<readonly [Record<string, unknown>, string]>
	readonly rejectedIssues: ReadonlyArray<unknown> | undefined
}

const collectWarnings = () => {
	const warnings: Array<readonly [Record<string, unknown>, string]> = []
	const warn: UsageLimitsWarn = (detail, message) => warnings.push([detail, message] as const)
	return { warn, warnings }
}

export const HostUsageLimitsLive = Layer.effect(
	HostUsageLimits,
	Effect.gen(function* () {
		const claude = yield* SubscriptionRef.make<ClaudeUsageLimits | undefined>(undefined)

		const commit = (
			produce: (previous: ClaudeUsageLimits | undefined, warn: UsageLimitsWarn) => ClaudeUsageLimits,
		) =>
			SubscriptionRef.modify(claude, (previous): readonly [CommitReport, ClaudeUsageLimits | undefined] => {
				const { warn, warnings } = collectWarnings()
				const parsed = ClaudeUsageLimitsSchema.safeParse(produce(previous, warn))
				if (parsed.success) return [{ warnings, rejectedIssues: undefined }, parsed.data]
				return [{ warnings, rejectedIssues: parsed.error.issues }, previous]
			}).pipe(
				Effect.flatMap(({ warnings, rejectedIssues }) =>
					Effect.gen(function* () {
						for (const [detail, message] of warnings)
							yield* Effect.logWarning(message).pipe(Effect.annotateLogs(detail))
						if (rejectedIssues !== undefined) {
							yield* Effect.logWarning('Discarding usage limits that failed schema validation').pipe(
								Effect.annotateLogs({ issues: rejectedIssues }),
							)
						}
					}),
				),
			)

		return HostUsageLimits.of({
			current: SubscriptionRef.get(claude).pipe(Effect.map((c) => (c ? { claude: c } : undefined))),
			changes: SubscriptionRef.changes(claude).pipe(
				Stream.changes,
				Stream.filter((c): c is ClaudeUsageLimits => c !== undefined),
				Stream.map((c) => ({ claude: c })),
			),
			applyClaudeRateLimitEvent: (info) =>
				Clock.currentTimeMillis.pipe(
					Effect.flatMap((now) =>
						commit((previous, warn) => mergeClaudeRateLimitEvent(previous, info, now, warn)),
					),
				),
			applyClaudeUsageSnapshot: (response) =>
				Clock.currentTimeMillis.pipe(
					Effect.flatMap((now) =>
						commit((previous, warn) => claudeUsageLimitsFromSnapshot(previous, response, now, warn)),
					),
				),
		})
	}),
)
