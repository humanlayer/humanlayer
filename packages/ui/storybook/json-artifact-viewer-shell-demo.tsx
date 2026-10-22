import type { Editor } from '@tiptap/react'
import { useRef, useState } from 'react'

import { ArtifactSearchBar } from '../src/components/artifact-search-bar'
import { ArtifactViewer, type ArtifactViewMode } from '../src/components/artifact-viewer'
import type { JsonArtifactSearchHandle } from '../src/components/json-artifact/json-artifact-search'
import { getArtifactRendererKind } from '../src/lib/file-types'
import { useArtifactSearch } from '../src/markdown-viewer/useArtifactSearch'

export interface JsonArtifactViewerShellDemoProps {
	fileName: string
	content: string
}

export function JsonArtifactViewerShellDemo({ fileName, content }: JsonArtifactViewerShellDemoProps) {
	const [mode, setMode] = useState<ArtifactViewMode>('rendered')
	const editorRef = useRef<Editor | null>(null)
	const structuredSearchRef = useRef<JsonArtifactSearchHandle | null>(null)
	const containerRef = useRef<HTMLDivElement | null>(null)
	const searchableMode = mode === 'diff' ? 'rendered' : mode
	const search = useArtifactSearch({
		editorRef,
		content,
		activeTab: searchableMode,
		rendererKind: getArtifactRendererKind(fileName, searchableMode),
		structuredSearchRef,
		contentContainerRef: containerRef,
	})

	return (
		<div ref={containerRef} className="mx-auto h-dvh max-w-5xl bg-background p-6 text-foreground" tabIndex={-1}>
			<ArtifactViewer
				content={content}
				fileName={fileName}
				tabValue={mode}
				onTabValueChange={setMode}
				editorRef={editorRef}
				structuredSearchRef={structuredSearchRef}
				onSearchToggleRequest={search.toggleSearch}
				searchQuery={search.query}
				searchCurrentMatch={search.searchCurrentMatch}
			>
				{search.isOpen ? (
					<ArtifactSearchBar
						query={search.query}
						totalMatches={search.totalMatches}
						currentIndex={search.currentIndex}
						onQueryChange={search.setQuery}
						onNext={search.next}
						onPrev={search.prev}
						onClose={search.closeSearch}
						inputRef={search.inputRef}
					/>
				) : null}
			</ArtifactViewer>
		</div>
	)
}
