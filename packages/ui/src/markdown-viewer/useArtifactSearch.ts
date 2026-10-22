import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { ArtifactViewMode } from '@humanlayer/ui/components/artifact-viewer'
import type { JsonArtifactSearchHandle } from '@humanlayer/ui/components/json-artifact/json-artifact-search'
import type { ArtifactRendererKind } from '@humanlayer/ui/lib/file-types'
import type { SearchMatch } from './ArtifactSearchExtension'

export interface ArtifactSearchCurrentMatch {
	/** 1-based line number in raw content */
	line: number
	/** 0-based occurrence index within that line */
	occurrence: number
	/** 0-based character index of the match start within the line */
	charIndex: number
}

export interface ArtifactSearchApi {
	isOpen: boolean
	query: string
	currentIndex: number
	totalMatches: number
	searchCurrentMatch: ArtifactSearchCurrentMatch | null
	inputRef: React.RefObject<HTMLInputElement | null>
	openSearch: () => void
	closeSearch: () => void
	toggleSearch: () => void
	setQuery: (q: string) => void
	next: () => void
	prev: () => void
}

export interface UseArtifactSearchOptions {
	editorRef: React.RefObject<Editor | null>
	content: string
	activeTab: ArtifactViewMode
	rendererKind?: ArtifactRendererKind
	structuredSearchRef?: React.RefObject<JsonArtifactSearchHandle | null>
	/** Container to restore focus to when the bar closes (for vim-style panel hotkeys) */
	contentContainerRef?: React.RefObject<HTMLElement | null>
	/** Fired on user-driven navigation that may scroll the viewer (typing, next, prev) */
	onNavigate?: () => void
}

export function useArtifactSearch({
	editorRef,
	content,
	activeTab,
	rendererKind = activeTab === 'rendered' ? 'markdown' : 'raw',
	structuredSearchRef,
	contentContainerRef,
	onNavigate,
}: UseArtifactSearchOptions): ArtifactSearchApi {
	const [isOpen, setIsOpen] = useState(false)
	const [query, setQueryState] = useState('')
	const [currentIndex, setCurrentIndex] = useState(0)
	const [structuredMatchCount, setStructuredMatchCount] = useState(0)
	const [prevTab, setPrevTab] = useState(activeTab)
	const inputRef = useRef<HTMLInputElement | null>(null)

	// Reset cursor when the tab transitions (adjust state during render — no effect needed)
	if (prevTab !== activeTab) {
		setPrevTab(activeTab)
		setCurrentIndex(0)
	}

	// Capture latest query for the tab-sync effect without re-firing it on every keystroke
	const queryRef = useRef(query)
	queryRef.current = query

	// Raw-tab match scanning (Phase 2 wires this; Phase 1 keeps the array empty in raw mode)
	const rawMatches = useMemo<ArtifactSearchCurrentMatch[]>(() => {
		if (rendererKind !== 'raw' || !query) return []
		const lower = query.toLowerCase()
		const out: ArtifactSearchCurrentMatch[] = []
		const lines = content.split('\n')
		for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
			const line = lines[lineIdx]!
			const lineLower = line.toLowerCase()
			let from = 0
			let occurrence = 0
			while (from <= lineLower.length) {
				const idx = lineLower.indexOf(lower, from)
				if (idx === -1) break
				out.push({ line: lineIdx + 1, occurrence, charIndex: idx })
				from = idx + Math.max(1, query.length)
				occurrence++
			}
		}
		return out
	}, [content, query, rendererKind])

	// Total matches per tab
	const totalMatches = useMemo(() => {
		if (!query) return 0
		if (rendererKind === 'json-tree') return structuredMatchCount
		if (rendererKind === 'markdown') {
			const editor = editorRef.current
			if (!editor) return 0
			const storage = editor.storage as { artifactSearch?: { matches?: SearchMatch[] } }
			return storage.artifactSearch?.matches?.length ?? 0
		}
		return rawMatches.length
	}, [query, rendererKind, rawMatches, editorRef, structuredMatchCount])

	const searchCurrentMatch = useMemo<ArtifactSearchCurrentMatch | null>(() => {
		if (rendererKind !== 'raw') return null
		return rawMatches[currentIndex] ?? null
	}, [rendererKind, rawMatches, currentIndex])

	// Drive the rendered editor's active match + scroll. Read-only editor means
	// setTextSelection-based scrollIntoView is unreliable, so we read DOM coords directly.
	const driveEditorIndex = useCallback(
		(idx: number) => {
			if (rendererKind === 'json-tree') {
				structuredSearchRef?.current?.setActiveIndex(idx)
				return
			}
			if (rendererKind !== 'markdown') return
			const editor = editorRef.current
			if (!editor) return
			editor.commands.setSearchIndex(idx)
			const storage = editor.storage as { artifactSearch?: { matches?: SearchMatch[] } }
			const m = storage.artifactSearch?.matches?.[idx]
			const view = editor.view
			if (view && m) {
				try {
					const domAtPos = view.domAtPos(m.from)
					const el =
						domAtPos.node.nodeType === Node.ELEMENT_NODE
							? (domAtPos.node as HTMLElement)
							: domAtPos.node.parentElement
					el?.scrollIntoView({ behavior: 'auto', block: 'nearest' })
				} catch {
					// Position may be invalid right after a doc change — ignore.
				}
			}
		},
		[rendererKind, editorRef, structuredSearchRef],
	)

	const setQuery = useCallback(
		(q: string) => {
			setQueryState(q)
			setCurrentIndex(0)
			if (rendererKind === 'markdown') {
				editorRef.current?.commands.setSearchQuery(q)
				if (q) driveEditorIndex(0)
			}
			if (rendererKind === 'json-tree') {
				setStructuredMatchCount(structuredSearchRef?.current?.setQuery(q) ?? 0)
				if (q) driveEditorIndex(0)
			}
			if (q) onNavigate?.()
		},
		[rendererKind, editorRef, structuredSearchRef, driveEditorIndex, onNavigate],
	)

	// External sync: re-apply or clear the TipTap extension when the active tab changes.
	// queryRef keeps deps honest — per-keystroke sync is owned by setQuery.
	useEffect(() => {
		setCurrentIndex(0)
		if (rendererKind === 'markdown') {
			editorRef.current?.commands.setSearchQuery(queryRef.current)
			if (queryRef.current) driveEditorIndex(0)
		} else if (rendererKind === 'json-tree') {
			editorRef.current?.commands.clearSearch()
			setStructuredMatchCount(structuredSearchRef?.current?.setQuery(queryRef.current) ?? 0)
			if (queryRef.current) driveEditorIndex(0)
		} else {
			editorRef.current?.commands.clearSearch()
			structuredSearchRef?.current?.clear()
			setStructuredMatchCount(0)
		}
	}, [activeTab, content, rendererKind, editorRef, structuredSearchRef, driveEditorIndex])

	const openSearch = useCallback(() => {
		setIsOpen(true)
		// Focus + select the input on next frame (after mount)
		requestAnimationFrame(() => {
			inputRef.current?.focus()
			inputRef.current?.select()
		})
	}, [])

	const closeSearch = useCallback(() => {
		setIsOpen(false)
		setQueryState('')
		setCurrentIndex(0)
		editorRef.current?.commands.clearSearch()
		structuredSearchRef?.current?.clear()
		setStructuredMatchCount(0)
		// Restore focus to the artifact pane so panel hotkeys fire immediately
		contentContainerRef?.current?.focus()
	}, [editorRef, structuredSearchRef, contentContainerRef])

	const toggleSearch = useCallback(() => {
		if (isOpen) {
			closeSearch()
			return
		}
		openSearch()
	}, [isOpen, openSearch, closeSearch])

	const next = useCallback(() => {
		if (totalMatches === 0) return
		const nextIdx = (currentIndex + 1) % totalMatches
		setCurrentIndex(nextIdx)
		driveEditorIndex(nextIdx)
		onNavigate?.()
		// Keep input focused so panel-level hotkeys (e.g. vim `gg`) don't fire after navigation.
		inputRef.current?.focus()
	}, [totalMatches, currentIndex, driveEditorIndex, onNavigate])

	const prev = useCallback(() => {
		if (totalMatches === 0) return
		const prevIdx = (currentIndex - 1 + totalMatches) % totalMatches
		setCurrentIndex(prevIdx)
		driveEditorIndex(prevIdx)
		onNavigate?.()
		inputRef.current?.focus()
	}, [totalMatches, currentIndex, driveEditorIndex, onNavigate])

	return {
		isOpen,
		query,
		currentIndex,
		totalMatches,
		searchCurrentMatch,
		inputRef,
		openSearch,
		closeSearch,
		toggleSearch,
		setQuery,
		next,
		prev,
	}
}
