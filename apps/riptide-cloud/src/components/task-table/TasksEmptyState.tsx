import { Card } from '@humanlayer/ui/components/card'
import { FolderOpen } from 'lucide-react'
import type { FC } from 'react'

export const TasksEmptyState: FC = () => {
	return (
		<Card className="p-4 text-center">
			<FolderOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
			<h3 className="font-mono uppercase tracking-wider mb-2">No Tasks</h3>
			<p className="text-sm text-muted-foreground max-w-sm mx-auto">
				Tasks will appear here when you create them in HumanLayer.
			</p>
		</Card>
	)
}
