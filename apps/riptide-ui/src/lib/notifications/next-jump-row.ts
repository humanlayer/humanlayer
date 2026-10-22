import type { NotificationRow } from './notification-row'

export function nextJumpRow(
	rows: readonly NotificationRow[],
	opened: Readonly<Record<string, number>>,
): NotificationRow | undefined {
	return rows.find((row) => {
		const openedAt = opened[row.key]
		return openedAt === undefined || row.at > openedAt
	})
}
