import { Button } from '@humanlayer/ui/components/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@humanlayer/ui/components/hover-card'
import { CircleHelp } from 'lucide-react'
import { useState } from 'react'

import { ProjectExplanation } from '@/components/projects/ProjectExplanation'

export function CreateProjectPrompt({ onCreate }: { onCreate: () => void }) {
	const [helpOpen, setHelpOpen] = useState(false)
	return (
		<div className="flex items-center gap-1 px-3 py-2">
			<Button variant="outline" size="sm" onClick={onCreate}>
				Create a project
			</Button>
			<HoverCard open={helpOpen} onOpenChange={setHelpOpen}>
				<HoverCardTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						className="size-7 text-muted-foreground"
						aria-label="About projects"
						aria-expanded={helpOpen}
						aria-controls={helpOpen ? 'sidebar-project-help' : undefined}
						onClick={() => setHelpOpen(true)}
					>
						<CircleHelp aria-hidden className="size-4" />
					</Button>
				</HoverCardTrigger>
				<HoverCardContent
					id="sidebar-project-help"
					side="right"
					align="start"
					className="w-80 space-y-3 text-xs"
				>
					<ProjectExplanation />
				</HoverCardContent>
			</HoverCard>
		</div>
	)
}
