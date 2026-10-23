import { useUi } from '@/minimalist/lib/ui-state'
import { useAction } from '@/minimalist/lib/use-action'
import { useRiptideApi } from '@/orpc/client'

type ArchiveTarget = { kind: 'task' | 'session'; id: string }

/**
 * Archive or restore a task or session, with an Undo toast either way. Archiving a task leaves its
 * sessions alone so restoring it brings the thread back as it was. Resolves to whether it saved.
 */
export function useArchive() {
	const { client: api } = useRiptideApi()
	const { showToast } = useUi()
	const action = useAction()

	const archive = async (target: ArchiveTarget, archived: boolean): Promise<boolean> => {
		const saved = await action.run(
			() =>
				target.kind === 'task'
					? api.tasks.archive({ taskId: target.id, archived, cascadeToSessions: false })
					: api.sessions.update({ sessionId: target.id, archived }),
			`Could not ${archived ? 'archive' : 'unarchive'} the ${target.kind}. Try again.`,
		)
		if (saved)
			showToast(`${target.kind === 'task' ? 'Task' : 'Session'} ${archived ? 'archived' : 'unarchived'}`, {
				label: 'Undo',
				run: () => void archive(target, !archived),
			})
		return saved
	}

	return { archive, pending: action.pending }
}
