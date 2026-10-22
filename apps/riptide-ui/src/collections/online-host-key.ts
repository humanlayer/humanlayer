import type { OnlineHost } from '@humanlayer/db/tables/online-hosts'

export function getOnlineHostKey(host: Pick<OnlineHost, 'host_id' | 'organization_id' | 'user_id'>): string {
	return JSON.stringify([host.host_id, host.organization_id, host.user_id])
}
