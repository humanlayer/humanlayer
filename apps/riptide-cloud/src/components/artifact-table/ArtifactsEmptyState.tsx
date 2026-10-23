import { Card } from '@humanlayer/ui/components/card'
import { FileText } from 'lucide-react'
import type { FC } from 'react'

export const ArtifactsEmptyState: FC = () => {
	return (
		<Card className="p-4 text-center">
			<FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
			<h3 className="font-mono uppercase tracking-wider mb-2">No Artifacts</h3>
			<p className="text-sm text-muted-foreground max-w-sm mx-auto">
				Artifacts will appear here when you create files in your HumanLayer sessions.
			</p>
		</Card>
	)
}
