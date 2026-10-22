import type { SlackNotificationAutomation } from '@humanlayer/db/tables/slack-notification-automations'

export function mapSlackAutomation(row: SlackNotificationAutomation) {
	return {
		id: row.id,
		name: row.name,
		channelId: row.channel_id,
		channelName: row.channel_name,
		channelIsPrivate: row.channel_is_private,
		eventTypes: row.event_types as Array<
			'design-discussion' | 'design-prd' | 'design-tdd' | 'structure-outline' | 'comment'
		>,
		ownerUserIds: row.owner_user_ids,
		enabled: row.enabled,
	}
}
