import { Button } from '@humanlayer/ui/components/button'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Popover, PopoverContent, PopoverTrigger } from '@humanlayer/ui/components/popover'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'

import type { SessionArtifact } from '@/utils/sidebar-transforms'

import { ArtifactsListPure } from '../ArtifactsListPure'

interface ArtifactListPopoverShellProps {
	artifacts: SessionArtifact[]
	selectedArtifactId: string | null
	onArtifactSelect: (id: string) => void
}

export function ArtifactListPopoverShell({
	artifacts,
	selectedArtifactId,
	onArtifactSelect,
}: ArtifactListPopoverShellProps) {
	const [open, setOpen] = useState(false)
	const selectedName =
		artifacts
			.find((a) => a.id === selectedArtifactId)
			?.path.split('/')
			.pop() ?? 'Artifacts'

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="outline" className="justify-between gap-2 font-mono text-xs">
					{selectedName}
					<span className="flex items-center gap-1.5">
						<KeyboardShortcut size="xs">⇧+A</KeyboardShortcut>
						<ChevronDown className="h-3 w-3" />
					</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="p-2 w-80 max-h-96 overflow-y-auto">
				<ArtifactsListPure
					artifacts={artifacts}
					onArtifactClick={(id) => {
						onArtifactSelect(id)
						setOpen(false)
					}}
					commentCounts={{}}
				/>
			</PopoverContent>
		</Popover>
	)
}

export function ArtifactListPopoverShellDemo({ artifacts }: { artifacts: SessionArtifact[] }) {
	const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(artifacts[0]?.id ?? null)

	return (
		<div className="flex flex-col gap-4">
			<ArtifactListPopoverShell
				artifacts={artifacts}
				selectedArtifactId={selectedArtifactId}
				onArtifactSelect={setSelectedArtifactId}
			/>
			<div className="text-xs text-muted-foreground border-t pt-2">
				Selected:{' '}
				{selectedArtifactId ? (artifacts.find((a) => a.id === selectedArtifactId)?.path ?? 'unknown') : 'none'}
			</div>
		</div>
	)
}
