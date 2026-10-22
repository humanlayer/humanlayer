import type { JsonArtifactSearchHandle } from '../../components/json-artifact/json-artifact-search'
import { JsonArtifactView } from '../../components/json-artifact/json-artifact-view'
import { getArtifactRendererKind, isJsonlFile } from '../../lib/file-types'
import type { ArtifactSearchCurrentMatch } from '../../markdown-viewer/useArtifactSearch'
import type { ReactNode, RefObject } from 'react'

import { RawArtifactView } from './RawArtifactView'

export interface ArtifactViewerDisplayProps {
	content: string
	fileName: string
	viewMode: 'rendered' | 'raw'
	renderedMarkdown: ReactNode
	searchQuery?: string
	searchCurrentMatch?: ArtifactSearchCurrentMatch | null
	structuredSearchRef?: RefObject<JsonArtifactSearchHandle | null>
}

/** Selects the V2 document renderer for the active file type and view mode. */
export function ArtifactViewerDisplay({
	content,
	fileName,
	viewMode,
	renderedMarkdown,
	searchQuery,
	searchCurrentMatch,
	structuredSearchRef,
}: ArtifactViewerDisplayProps) {
	const rendererKind = getArtifactRendererKind(fileName, viewMode)

	if (rendererKind === 'json-tree') {
		return (
			<JsonArtifactView
				ref={structuredSearchRef}
				content={content}
				kind={isJsonlFile(fileName) ? 'jsonl' : 'json'}
			/>
		)
	}

	if (rendererKind === 'markdown') return renderedMarkdown

	return (
		<RawArtifactView
			content={content}
			fileName={fileName}
			searchQuery={searchQuery}
			searchCurrentMatch={searchCurrentMatch}
		/>
	)
}
