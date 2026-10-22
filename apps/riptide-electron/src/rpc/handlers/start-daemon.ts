import type { DaemonSyncMode } from '@humanlayer/riptide-electron-rpc'
import * as Effect from 'effect/Effect'
import * as Redacted from 'effect/Redacted'

import { DaemonSupervisor } from '../../daemon/daemon-supervisor.service'
import { parseVerifiedClaudePath } from '../../daemon/verified-claude-path'

export const startDaemonHandler = Effect.fn('rpc.start_daemon')(function* (input: {
	readonly token: string
	readonly userId: string
	readonly organizationId: string
	readonly syncMode: DaemonSyncMode
	readonly apiOrigin: string
	readonly syncOrigin: string
	readonly verifiedClaudePath: string | null
}) {
	const daemonSupervisor = yield* DaemonSupervisor
	const verifiedClaudePath = yield* parseVerifiedClaudePath(input.verifiedClaudePath)
	return yield* daemonSupervisor.start({ ...input, verifiedClaudePath, token: Redacted.make(input.token) })
})
