import { isImageFile } from '@humanlayer/ui/lib/file-types'
import { cn } from '@humanlayer/ui/lib/utils'
import { FileEdit, FilePlus, FileText, FileUp, Image } from 'lucide-react'
import type { ReactNode } from 'react'

import type { ArtifactCategory } from './sidebar-transforms'

export interface ArtifactIconInput {
	fileName: string
	category?: ArtifactCategory
	storageType?: string | null
}

const DEFAULT_SIZE = 'w-4 h-4'

export function getArtifactIconNode(input: ArtifactIconInput, sizeClasses: string = DEFAULT_SIZE): ReactNode {
	const base = cn(sizeClasses, 'flex-shrink-0')

	if (isImageFile(input.fileName)) {
		return <Image className={cn(base, 'text-[var(--terminal-accent-alt)]')} />
	}

	if (input.category === 'unreferenced') {
		if (input.storageType === 's3') {
			return <FileUp className={cn(base, 'text-[var(--terminal-accent-alt)]')} />
		}
		return <FileText className={cn(base, 'text-[var(--terminal-fg-dim)]')} />
	}

	switch (input.category) {
		case 'edited':
			return <FileEdit className={cn(base, 'text-[var(--terminal-warning)]')} />
		case 'new':
			return <FilePlus className={cn(base, 'text-[var(--terminal-success)]')} />
		default:
			return <FileText className={cn(base, 'text-[var(--terminal-accent)]')} />
	}
}
