import type { Session } from '@humanlayer/db/tables/sessions'

import { handoffBlockedReason } from '@/lib/harness-handoff'
import { useSessionAccess } from '@/minimalist/lib/access'
import { useHost } from '@/minimalist/lib/data'
import { type ComposerSettings, modelCatalog } from '@/minimalist/lib/models'
import { useUi } from '@/minimalist/lib/ui-state'
import { useRiptideApi } from '@/orpc/client'

/**
 * The models a session's host offers, and `change` to save new settings; `sessionSettings`
 * reads the current ones. `done` names the change in a toast, and failures always show one.
 * The agent stays fixed: the other agent's models hand off to a new session instead, and
 * `handoffBlocked` says why that can't happen yet.
 */
export function useSessionSettings(session: Session | null) {
	const { client: api } = useRiptideApi()
	const { showToast } = useUi()
	const { host } = useHost(session?.host_id, session?.created_by)
	const { canManageSession } = useSessionAccess(session ?? undefined)
	const change = (next: ComposerSettings, done?: string) => {
		if (!session) return
		void api.sessions
			.update({
				sessionId: session.id,
				model: next.model,
				effort: next.effort,
				fastMode: next.fastMode,
				permissionsMode: next.permissionsMode,
			})
			.then(
				() => {
					if (done) showToast(done)
				},
				() => showToast('Could not change the session settings. Try again.'),
			)
	}
	return {
		catalog: modelCatalog(host?.host),
		change,
		handoffBlocked: session ? handoffBlockedReason(session, canManageSession, host !== null && !host.online) : null,
	}
}
