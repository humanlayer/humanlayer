import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

export interface SearchMatch {
	from: number
	to: number
}

export interface ArtifactSearchStorage {
	query: string
	matches: SearchMatch[]
	activeIndex: number
	caseSensitive: boolean
}

export interface ArtifactSearchOptions {
	searchResultClass: string
	searchResultCurrentClass: string
}

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		artifactSearch: {
			setSearchQuery: (query: string) => ReturnType
			setSearchIndex: (index: number) => ReturnType
			clearSearch: () => ReturnType
		}
	}
}

export const artifactSearchKey = new PluginKey<PluginState>('artifactSearch')

interface PluginState {
	query: string
	matches: SearchMatch[]
	activeIndex: number
	decorationSet: DecorationSet
}

function findMatches(doc: ProseMirrorNode, query: string): SearchMatch[] {
	if (!query) return []
	const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const matches: SearchMatch[] = []

	doc.descendants((node, blockPos) => {
		// Skip frontmatter — search should not match keys/values inside the YAML/TOML block,
		// otherwise the active match scrolls to the very top of the artifact.
		if (node.type.name === 'frontmatter') return false
		if (!node.isTextblock) return undefined

		// Flatten the textblock into a contiguous string with parallel doc-position mapping
		// so multi-word queries match across mark boundaries (e.g. "**hello** world" where
		// the two words live in separate text nodes due to the bold mark).
		const segments: { docPos: number; text: string }[] = []
		collectTextSegments(node, blockPos + 1, segments)
		if (segments.length === 0) return false

		const fullText = segments.map((s) => s.text).join('')
		// Fresh regex per block — prevents `lastIndex` leaking across blocks.
		const regex = new RegExp(escaped, 'gi')
		let m: RegExpExecArray | null
		// biome-ignore lint/suspicious/noAssignInExpressions: standard regex.exec loop
		while ((m = regex.exec(fullText)) !== null) {
			const from = mapTextIndexToDocPos(segments, m.index)
			const to = mapTextIndexToDocPos(segments, m.index + m[0].length)
			if (from !== -1 && to !== -1) matches.push({ from, to })
			if (m[0].length === 0) regex.lastIndex++
		}
		return false
	})

	return matches
}

function collectTextSegments(
	node: ProseMirrorNode,
	contentStart: number,
	segments: { docPos: number; text: string }[],
): void {
	let offset = 0
	node.content.forEach((child) => {
		const childPos = contentStart + offset
		if (child.isText && child.text) {
			segments.push({ docPos: childPos, text: child.text })
		} else if (child.content.size > 0) {
			// Recurse into wrappers (e.g. mark-as-node patterns) — childPos + 1 skips the open token.
			collectTextSegments(child, childPos + 1, segments)
		}
		offset += child.nodeSize
	})
}

function mapTextIndexToDocPos(segments: { docPos: number; text: string }[], idx: number): number {
	let cum = 0
	for (const seg of segments) {
		const segEnd = cum + seg.text.length
		if (idx >= cum && idx <= segEnd) return seg.docPos + (idx - cum)
		cum = segEnd
	}
	return -1
}

export const ArtifactSearch = Extension.create<ArtifactSearchOptions, ArtifactSearchStorage>({
	name: 'artifactSearch',

	addOptions() {
		return {
			searchResultClass: 'search-match',
			searchResultCurrentClass: 'search-match-current',
		}
	},

	addStorage() {
		return { query: '', matches: [], activeIndex: 0, caseSensitive: false }
	},

	addCommands() {
		return {
			setSearchQuery:
				(query: string) =>
				({ tr, dispatch }) => {
					if (dispatch) dispatch(tr.setMeta(artifactSearchKey, { type: 'setQuery', query }))
					return true
				},
			setSearchIndex:
				(index: number) =>
				({ tr, dispatch }) => {
					if (dispatch) dispatch(tr.setMeta(artifactSearchKey, { type: 'setIndex', index }))
					return true
				},
			clearSearch:
				() =>
				({ tr, dispatch }) => {
					if (dispatch) dispatch(tr.setMeta(artifactSearchKey, { type: 'clear' }))
					return true
				},
		}
	},

	addProseMirrorPlugins() {
		const extension = this
		const opts = this.options

		return [
			new Plugin<PluginState>({
				key: artifactSearchKey,
				state: {
					init(_config: unknown, _state: EditorState): PluginState {
						return {
							query: '',
							matches: [],
							activeIndex: 0,
							decorationSet: DecorationSet.empty,
						}
					},
					apply(tr: Transaction, prev: PluginState, _oldState: EditorState, newState: EditorState): PluginState {
						const meta = tr.getMeta(artifactSearchKey) as
							| { type: 'setQuery'; query: string }
							| { type: 'setIndex'; index: number }
							| { type: 'clear' }
							| undefined

						// Handle meta updates first
						if (meta?.type === 'clear') {
							extension.storage.query = ''
							extension.storage.matches = []
							extension.storage.activeIndex = 0
							return { query: '', matches: [], activeIndex: 0, decorationSet: DecorationSet.empty }
						}
						if (meta?.type === 'setQuery') {
							const matches = findMatches(newState.doc, meta.query)
							extension.storage.query = meta.query
							extension.storage.matches = matches
							extension.storage.activeIndex = 0
							return {
								query: meta.query,
								matches,
								activeIndex: 0,
								decorationSet: DecorationSet.create(
									newState.doc,
									matches.map((m, i) =>
										Decoration.inline(m.from, m.to, {
											class:
												i === 0
													? `${opts.searchResultClass} ${opts.searchResultCurrentClass}`
													: opts.searchResultClass,
										}),
									),
								),
							}
						}
						if (meta?.type === 'setIndex') {
							const total = prev.matches.length
							const next = total === 0 ? 0 : ((meta.index % total) + total) % total
							extension.storage.activeIndex = next
							return {
								...prev,
								activeIndex: next,
								decorationSet: DecorationSet.create(
									newState.doc,
									prev.matches.map((m, i) =>
										Decoration.inline(m.from, m.to, {
											class:
												i === next
													? `${opts.searchResultClass} ${opts.searchResultCurrentClass}`
													: opts.searchResultClass,
										}),
									),
								),
							}
						}

						// Rebuild on doc change (rare for read-only viewer but defensive)
						if (tr.docChanged && prev.query) {
							const matches = findMatches(newState.doc, prev.query)
							extension.storage.matches = matches
							const activeIndex = Math.min(prev.activeIndex, Math.max(0, matches.length - 1))
							extension.storage.activeIndex = activeIndex
							return {
								...prev,
								matches,
								activeIndex,
								decorationSet: DecorationSet.create(
									newState.doc,
									matches.map((m, i) =>
										Decoration.inline(m.from, m.to, {
											class:
												i === activeIndex
													? `${opts.searchResultClass} ${opts.searchResultCurrentClass}`
													: opts.searchResultClass,
										}),
									),
								),
							}
						}

						return prev
					},
				},
				props: {
					decorations(state) {
						return this.getState(state)?.decorationSet ?? DecorationSet.empty
					},
				},
			}),
		]
	},
})
