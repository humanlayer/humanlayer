import { useQuery } from '@tanstack/react-query'

const MULTIPLAYER_PROMPTING_CLOCK_QUERY_KEY = ['multiplayer-prompting-clock'] as const
const CLOCK_TICK_INTERVAL_MILLIS = 1_000

export function getMultiplayerPromptingClockDelay(expiresAt: bigint | null | undefined, nowMillis: number): number {
	if (expiresAt == null) return CLOCK_TICK_INTERVAL_MILLIS
	const remainingUntilExpiry = Number(expiresAt) - nowMillis
	return remainingUntilExpiry > 0
		? Math.min(CLOCK_TICK_INTERVAL_MILLIS, remainingUntilExpiry)
		: CLOCK_TICK_INTERVAL_MILLIS
}

export function useMultiplayerPromptingNow(expiresAt?: bigint | null): number {
	const expiresAtKey = expiresAt?.toString() ?? 'unlimited'
	const nextTickDelay = getMultiplayerPromptingClockDelay(expiresAt, Date.now())
	const { data: nowMillis } = useQuery({
		queryKey: [...MULTIPLAYER_PROMPTING_CLOCK_QUERY_KEY, expiresAtKey],
		queryFn: Date.now,
		initialData: Date.now,
		networkMode: 'always',
		refetchInterval: nextTickDelay,
		refetchIntervalInBackground: true,
	})

	return nowMillis ?? Date.now()
}

export function formatMultiplayerPromptingCountdown(expiresAt: bigint | null, nowMillis: number): string {
	if (expiresAt === null) return 'No limit'
	const remaining = Math.max(0, Number(expiresAt) - nowMillis)
	if (remaining < 60_000) return `${Math.ceil(remaining / 1_000)}s`
	if (remaining < 3_600_000) return `${Math.ceil(remaining / 60_000)}m`
	if (remaining < 86_400_000) return `${Math.ceil(remaining / 3_600_000)}h`
	return `${Math.ceil(remaining / 86_400_000)}d`
}

export function isMultiplayerPromptingActive(
	userIds: string[],
	startedAt: bigint | null,
	expiresAt: bigint | null,
	nowMillis: number,
): boolean {
	return (
		userIds.length > 0 &&
		startedAt !== null &&
		startedAt <= BigInt(nowMillis) &&
		(expiresAt === null || expiresAt > BigInt(nowMillis))
	)
}
