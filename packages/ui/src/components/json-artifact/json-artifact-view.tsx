import { forwardRef, useImperativeHandle, useMemo, useState } from 'react'

import { ArtifactRaw } from '../artifact-raw'
import { findJsonTreeMatches, type JsonArtifactSearchHandle } from './json-artifact-search'
import { parseJsonArtifact, parseJsonlArtifact } from './json-artifact-parser'
import { JsonTree } from './json-tree'
import { buildJsonTreeModel, buildJsonlTreeModel } from './json-tree-model'

export interface JsonArtifactViewProps {
	content: string
	kind?: 'json' | 'jsonl'
}

export const JsonArtifactView = forwardRef<JsonArtifactSearchHandle, JsonArtifactViewProps>(function JsonArtifactView(
	{ content, kind = 'json' },
	ref,
) {
	const parsed = useMemo(
		() => (kind === 'jsonl' ? parseJsonlArtifact(content) : parseJsonArtifact(content)),
		[content, kind],
	)
	const model = useMemo(() => {
		if (parsed.kind === 'value') return buildJsonTreeModel(parsed.value)
		if (parsed.kind === 'records') return buildJsonlTreeModel(parsed.records)
		return null
	}, [parsed])
	const [query, setQuery] = useState('')
	const [activeIndex, setActiveIndex] = useState(0)
	const matches = useMemo(
		() => (model?.kind === 'model' ? findJsonTreeMatches(model, query) : []),
		[model, query],
	)

	useImperativeHandle(
		ref,
		() => ({
			setQuery(nextQuery) {
				setQuery(nextQuery)
				setActiveIndex(0)
				return model?.kind === 'model' ? findJsonTreeMatches(model, nextQuery).length : 0
			},
			setActiveIndex(index) {
				setActiveIndex(index)
			},
			clear() {
				setQuery('')
				setActiveIndex(0)
			},
		}),
		[model],
	)

	const fallback = parsed.kind === 'fallback' ? parsed : model?.kind === 'fallback' ? model : null
	if (fallback) {
		return (
			<div className="bg-background text-foreground">
				<p
					role="status"
					className="border-b border-border bg-muted px-4 py-2 font-mono text-xs text-muted-foreground"
				>
					{fallback.message}
				</p>
				<ArtifactRaw content={content} />
			</div>
		)
	}
	if (!model || model.kind !== 'model') return null
	return (
		<div className="h-full min-h-0">
			<JsonTree model={model} matches={matches} activeMatchIndex={activeIndex} />
		</div>
	)
})
