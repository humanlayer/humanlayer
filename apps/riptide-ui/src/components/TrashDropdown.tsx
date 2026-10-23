import { Button } from '@humanlayer/ui/components/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@humanlayer/ui/components/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { FileIcon, Trash2 } from 'lucide-react'
import type { FC } from 'react'

import type { TaskArtifact } from '@/hooks/live-queries/useTaskArtifacts'

interface TrashDropdownProps {
	artifacts: TaskArtifact[]
	onArtifactClick: (artifactId: string) => void
}

export const TrashDropdown: FC<TrashDropdownProps> = ({ artifacts, onArtifactClick }) => {
	if (artifacts.length === 0) return null

	return (
		<DropdownMenu>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="icon" className="h-6 w-6">
							<Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
							<span className="sr-only">Deleted artifacts</span>
						</Button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent>Deleted Artifacts</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="end">
				<DropdownMenuLabel>Deleted artifacts</DropdownMenuLabel>
				<DropdownMenuSeparator />
				{artifacts.map((artifact) => (
					<DropdownMenuItem key={artifact.id} onClick={() => onArtifactClick(artifact.id)}>
						<FileIcon className="h-3.5 w-3.5 mr-2" />
						{artifact.file_name}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
