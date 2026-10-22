export function activityMinute(timestamp: bigint | number): number {
	return Math.floor(Number(timestamp) / 60_000)
}

type SessionActivityTimestamps = {
	last_activity_at: bigint | number
	created_at: bigint | number
}

export function compareSessionsByActivityMinute(a: SessionActivityTimestamps, b: SessionActivityTimestamps): number {
	const activityDifference = activityMinute(b.last_activity_at) - activityMinute(a.last_activity_at)
	if (activityDifference !== 0) return activityDifference

	const createdDifference = Number(b.created_at) - Number(a.created_at)
	if (createdDifference !== 0) return createdDifference

	return 0
}
