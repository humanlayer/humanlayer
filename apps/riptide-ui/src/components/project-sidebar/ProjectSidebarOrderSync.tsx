import { useSync, type SyncContextValue } from '@/components/providers/SyncProvider'
import type { ProjectSidebarStore } from '@/hooks/stores/projectSidebarStore'
import { useMountEffect } from '@/hooks/useMountEffect'

/** One keyed mount observes one authoritative snapshot, never infers deletion from missing rows. */
export function ProjectSidebarOrderSnapshot({
	store,
	groups,
}: {
	store: ProjectSidebarStore
	groups: { id: string; taskIds: string[] }[]
}) {
	const { tasksCollection } = useSync()
	useMountEffect(() => {
		// A sync archive may have reached the collection before the React query snapshot catches up.
		store.getState().observe(
			groups.map((group) => ({
				...group,
				taskIds: group.taskIds.filter((id) => !tasksCollection.state.get(id)?.archived),
			})),
		)
	})
	return null
}

export function ProjectSidebarArchiveSync({ store }: { store: ProjectSidebarStore }) {
	const { tasksCollection } = useSync()
	return <ArchiveSubscription key={tasksCollection.id} store={store} tasksCollection={tasksCollection} />
}

/** Electric↔query failover replaces the collection. Its identity is part of the subscription lifetime. */
function ArchiveSubscription({
	store,
	tasksCollection,
}: {
	store: ProjectSidebarStore
	tasksCollection: SyncContextValue['tasksCollection']
}) {
	useMountEffect(() => {
		const subscription = tasksCollection.subscribeChanges(
			(changes) => {
				const archived = changes
					.filter((change) => change.type !== 'delete' && change.value.archived)
					.map((change) => change.value.id)
				if (archived.length) store.getState().archive(archived)
			},
			{ includeInitialState: true },
		)
		return () => subscription.unsubscribe()
	})
	return null
}
