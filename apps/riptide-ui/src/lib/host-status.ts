import type { OnlineHost } from '@humanlayer/db/tables/online-hosts'
import { HOST_DELETE_AFTER_MS } from '@humanlayer/riptide-api-contract/api/hosts/delete'

const STALE_AFTER_MS = 30_000

export function canDeleteHost(host: Pick<OnlineHost, 'status' | 'last_seen'>, nowMs: number): boolean {
	return host.status === 'offline' && host.last_seen <= BigInt(nowMs) - BigInt(HOST_DELETE_AFTER_MS)
}

export function getHostStatus(
	host: Pick<OnlineHost, 'status' | 'last_seen'>,
	nowMs: number,
): 'online' | 'stale' | 'offline' {
	if (host.status === 'offline') return 'offline'
	return BigInt(nowMs) - host.last_seen >= BigInt(STALE_AFTER_MS) ? 'stale' : 'online'
}
