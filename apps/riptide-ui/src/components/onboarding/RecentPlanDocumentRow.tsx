import { Button } from '@humanlayer/ui/components/button'

import type { RecentPlanDocument } from '@/hooks/live-queries/useRecentPlanDocuments'
import { useArtifactSharingDialog } from '@/hooks/useArtifactSharingDialog'
import { documentTypeLabel } from '@/utils/artifact-document-type'

interface RecentPlanDocumentRowProps {
	document: RecentPlanDocument
	userId: string
}

function documentTitle(fileName: string): string {
	return fileName
		.replace(/\.md$/i, '')
		.replace(/^\d+[-_]/, '')
		.replaceAll(/[-_]+/g, ' ')
}

export function RecentPlanDocumentRow({ document }: RecentPlanDocumentRowProps) {
	const { openSharingDialog } = useArtifactSharingDialog()

	return (
		<div className="grid gap-3 border-t py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
			<div className="min-w-0">
				<div className="truncate text-sm font-medium text-foreground">{documentTitle(document.fileName)}</div>
				<div className="mt-1 truncate text-[11px] uppercase tracking-wide text-muted-foreground">
					{documentTypeLabel(document.documentType)}
					{document.taskName ? ` · ${document.taskName}` : ''}
				</div>
			</div>
			<div className="flex flex-wrap gap-2">
				<Button
					size="sm"
					variant="outline"
					onClick={() => openSharingDialog({ artifactId: document.id, source: 'onboarding' })}
				>
					Share artifact
				</Button>
			</div>
		</div>
	)
}
