'use client'

import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import { ToolResultModal } from '@humanlayer/ui/components/conversation-stream'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef } from 'react'

import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'

import { HotkeyScopeBoundary } from './HotkeyScopeBoundary'

export interface WiredToolResultModalProps {
	/** The tool call event (contains tool name and input parameters) */
	toolCall: ConversationEvent | null
	/** The tool result event (contains output/result) */
	toolResult: ConversationEvent | null
	/** Working directory for relative file path display */
	workingDir?: string
	/** Callback when modal is closed */
	onClose: () => void
	/** Optional callback to render custom file links */
	renderFileLink?: (filePath: string, workingDir?: string) => ReactNode
	/** Optional callback when a file path is clicked */
	onOpenFile?: (filePath: string) => void
}

/**
 * Wired version of ToolResultModal with hotkey support and scope isolation.
 * Wraps the pure ToolResultModal from packages/ui with:
 * - HotkeyScopeBoundary for scope isolation
 * - j/k and ↓/↑ for scrolling
 * - i and ESC for closing
 * - Focus preservation on close
 */
export function WiredToolResultModal({
	toolCall,
	toolResult,
	workingDir,
	onClose,
	renderFileLink,
	onOpenFile,
}: WiredToolResultModalProps) {
	const isOpen = !!(toolResult || toolCall)

	// Store the focused element when modal opens for restoration on close
	const previousFocusRef = useRef<HTMLElement | null>(null)

	useEffect(() => {
		if (isOpen) {
			previousFocusRef.current = document.activeElement as HTMLElement
		}
	}, [isOpen])

	// Create a unified close handler that preserves focus
	const handleClose = useCallback(() => {
		onClose()
		// Restore focus after a microtask to avoid race conditions
		setTimeout(() => {
			if (previousFocusRef.current?.focus) {
				previousFocusRef.current.focus()
			}
		}, 0)
	}, [onClose])

	// Handle j/k and arrow key navigation for scrolling
	useHotkeys(
		'j,down',
		(e) => {
			e.preventDefault()
			e.stopPropagation()
			// Find the ScrollArea viewport using the data attribute
			const viewport = document.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement
			if (viewport) {
				viewport.scrollTop += 100
			}
		},
		{
			enabled: isOpen,
			enableOnFormTags: true,
			preventDefault: true,
			scopes: [HOTKEY_SCOPES.TOOL_RESULT_MODAL],
		},
	)

	useHotkeys(
		'k,up',
		(e) => {
			e.preventDefault()
			e.stopPropagation()
			// Find the ScrollArea viewport using the data attribute
			const viewport = document.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement
			if (viewport) {
				viewport.scrollTop -= 100
			}
		},
		{
			enabled: isOpen,
			enableOnFormTags: true,
			preventDefault: true,
			scopes: [HOTKEY_SCOPES.TOOL_RESULT_MODAL],
		},
	)

	// Handle escape and 'i' key to close
	useHotkeys(
		'escape,i',
		(e) => {
			e.preventDefault()
			e.stopPropagation()
			e.stopImmediatePropagation()
			handleClose()
		},
		{
			enabled: isOpen,
			scopes: [HOTKEY_SCOPES.TOOL_RESULT_MODAL],
			preventDefault: true,
		},
	)

	if (!isOpen) return null

	// Footer with keyboard hints
	const footer = (
		<>
			<span className="text-xs text-muted-foreground">
				<kbd className="px-1 py-0.5 text-xs bg-muted/50 rounded">j/k</kbd> or{' '}
				<kbd className="px-1 py-0.5 text-xs bg-muted/50 rounded">↓/↑</kbd> to scroll
			</span>
			<span className="text-xs text-muted-foreground">
				<kbd className="px-1 py-0.5 text-xs bg-muted/50 rounded">i</kbd> or{' '}
				<kbd className="px-1 py-0.5 text-xs bg-muted/50 rounded">ESC</kbd> to close
			</span>
		</>
	)

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.TOOL_RESULT_MODAL}
			isActive={isOpen}
			rootScopeDisabled={true}
			componentName="WiredToolResultModal"
		>
			<ToolResultModal
				toolCall={toolCall}
				toolResult={toolResult}
				workingDir={workingDir}
				onClose={handleClose}
				renderFileLink={renderFileLink}
				onOpenFile={onOpenFile}
				footer={footer}
			/>
		</HotkeyScopeBoundary>
	)
}
