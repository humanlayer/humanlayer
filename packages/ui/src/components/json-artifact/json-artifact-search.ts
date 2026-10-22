import type { JsonTreeModelResult } from './json-tree-model'
import { getAncestorIds } from './json-tree-model'

type JsonTreeModel = Extract<JsonTreeModelResult, { kind: 'model' }>

export const MAX_STRUCTURED_SEARCH_MATCHES = 1_000

export interface JsonArtifactSearchMatch {
	rowId: string
	field: 'key' | 'value'
	start: number
	length: number
}

export interface JsonArtifactSearchHandle {
	setQuery: (query: string) => number
	setActiveIndex: (index: number) => void
	clear: () => void
}

export function findJsonTreeMatches(model: JsonTreeModel, query: string): JsonArtifactSearchMatch[] {
	if (!query) return []
	const needle = query.toLocaleLowerCase()
	const matches: JsonArtifactSearchMatch[] = []
	for (const row of model.rows) {
		for (const [field, text] of [['key', row.searchableKey], ['value', row.searchableValue]] as const) {
			const lower = text.toLocaleLowerCase()
			let from = 0
			while (from <= lower.length) {
				const start = lower.indexOf(needle, from)
				if (start === -1) break
				matches.push({ rowId: row.id, field, start, length: query.length })
				if (matches.length >= MAX_STRUCTURED_SEARCH_MATCHES) return matches
				from = start + Math.max(1, query.length)
			}
		}
	}
	return matches
}

export function getSearchExpandedIds(model: JsonTreeModel, matches: JsonArtifactSearchMatch[]): Set<string> {
	return getAncestorIds(model, matches.map((match) => match.rowId))
}
