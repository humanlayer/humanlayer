import { Button } from '@humanlayer/ui/components/button'

import { useRecentPlanDocuments, RecentPlanDocumentsState } from '@/hooks/live-queries/useRecentPlanDocuments'
import { useUserInfo } from '@/hooks/useUserInfo'

import { RecentPlanDocumentRow } from './RecentPlanDocumentRow'

interface PlanDocumentCollaborationStepProps {
	expanded: boolean
	onCreateRpiTask: () => void
}

export function PlanDocumentCollaborationStep({ expanded, onCreateRpiTask }: PlanDocumentCollaborationStepProps) {
	const { userId, dbOrganizationId } = useUserInfo()
	const state = useRecentPlanDocuments({
		expanded,
		userId: userId ?? null,
		organizationId: dbOrganizationId ?? null,
	})

	return (
		<div className="space-y-4">
			<p>
				<strong className="font-medium text-foreground">
					Invite a teammate to comment while the direction is still easy to improve.
				</strong>{' '}
				Choose one of your recent plan documents to share.
			</p>
			<div className="grid gap-2 sm:grid-cols-2">
				<div className="border p-3">
					<div className="text-xs font-semibold uppercase tracking-wide text-accent">
						Cloud link · collaborate
					</div>
					<p className="mt-1 text-xs leading-5">
						Teammates sign in, request access if needed, and can comment.
					</p>
				</div>
				<div className="border p-3">
					<div className="text-xs font-semibold uppercase tracking-wide text-[var(--terminal-warning)]">
						Public link · view only
					</div>
					<p className="mt-1 text-xs leading-5">
						Anyone with the link can read, but public viewers cannot comment.
					</p>
				</div>
			</div>
			{RecentPlanDocumentsState.$match(state, {
				Disabled: () => null,
				Loading: () => <p role="status">Loading recent plan documents…</p>,
				Error: ({ retry }) => (
					<div className="flex items-center justify-between gap-3 border border-destructive/50 p-3">
						<span>Could not load recent plan documents.</span>
						<Button size="sm" variant="outline" onClick={retry}>
							Retry
						</Button>
					</div>
				),
				Ready: ({ documents }) =>
					documents.length === 0 || !userId ? (
						<div className="space-y-3 border-t pt-3">
							<p>Start an RPI workflow to create a plan document you can share for feedback.</p>
							<Button onClick={onCreateRpiTask}>Create an RPI workflow task</Button>
						</div>
					) : (
						<div>
							<div className="text-[11px] font-semibold uppercase tracking-[0.13em] text-accent">
								Recent plan documents
							</div>
							{documents.map((document) => (
								<RecentPlanDocumentRow key={document.id} document={document} userId={userId} />
							))}
						</div>
					),
			})}
		</div>
	)
}
