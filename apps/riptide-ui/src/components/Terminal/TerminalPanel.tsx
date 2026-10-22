import { Button } from '@humanlayer/ui/components/button'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { useTheme } from '@humanlayer/ui/components/theme-provider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { useLocalStorage } from '@uidotdev/usehooks'
import { RotateCcw, Terminal as TerminalIcon, X } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useAppHotkeys } from '@/hooks/hotkeys/useAppHotkeys'
import { useTerminalSession } from '@/hooks/terminal/useTerminalSession'

const MIN_HEIGHT = 100
const MAX_HEIGHT_PERCENT = 0.8
const DEFAULT_HEIGHT = 256

export interface TerminalPanelProps {
	/** Key used for localStorage height persistence (e.g. sessionId or `task-${taskId}`) */
	storageKey: string
	/** Working directory to spawn PTY in */
	workingDirectory: string
	/** Input to send after a newly created PTY starts */
	initialInput?: string
	/** Embedded terminals fill their container and do not expose task-terminal chrome/resize/hotkeys */
	embedded?: boolean
	/**
	 * Fill the parent's height (height:100%) instead of rendering a fixed-pixel panel with its own
	 * drag handle. Defaults to `embedded`. Set this independently of `embedded` to keep task-terminal
	 * chrome (label, close button, hotkeys) while letting an outer Resizable panel control the height.
	 */
	fillHeight?: boolean
	/** Whether the panel is open */
	isOpen: boolean
	/** Called when panel should close */
	onClose: () => void
	/** Called when dragging the collapsed handle should open the panel */
	onOpen: () => void
}

/**
 * Terminal theme that matches the application's color scheme.
 * Reads colors from CSS custom properties with sensible fallbacks.
 */
function buildTerminalTheme() {
	const get = (varName: string, fallback: string): string => {
		if (typeof document === 'undefined') return fallback
		const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
		return value || fallback
	}

	const background = get('--terminal-bg', '#1e1e2e')
	const foreground = get('--terminal-fg', '#cdd6f4')

	return {
		background,
		foreground,
		cursor: foreground,
		cursorAccent: background,
		selectionBackground: get('--terminal-selection', '#45475a'),
		selectionForeground: foreground,
		black: get('--terminal-color-0', '#45475a'),
		red: get('--terminal-color-1', '#f38ba8'),
		green: get('--terminal-color-2', '#a6e3a1'),
		yellow: get('--terminal-color-3', '#f9e2af'),
		blue: get('--terminal-color-4', '#89b4fa'),
		magenta: get('--terminal-color-5', '#f5c2e7'),
		cyan: get('--terminal-color-6', '#94e2d5'),
		white: get('--terminal-color-7', '#bac2de'),
		brightBlack: get('--terminal-color-8', '#585b70'),
		brightRed: get('--terminal-color-9', '#f38ba8'),
		brightGreen: get('--terminal-color-10', '#a6e3a1'),
		brightYellow: get('--terminal-color-11', '#f9e2af'),
		brightBlue: get('--terminal-color-12', '#89b4fa'),
		brightMagenta: get('--terminal-color-13', '#f5c2e7'),
		brightCyan: get('--terminal-color-14', '#94e2d5'),
		brightWhite: get('--terminal-color-15', '#a6adc8'),
	}
}

function useTerminalTheme() {
	const { theme: appTheme } = useTheme()
	return { appTheme, terminalTheme: buildTerminalTheme() }
}

function TerminalResizeHandle({
	onPointerDown,
	onPointerMove,
	onPointerUp,
}: {
	onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
	onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
	onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void
}) {
	return (
		<div
			data-slot="resizable-handle"
			aria-orientation="horizontal"
			className="relative flex h-4 w-full cursor-row-resize items-center justify-center bg-transparent outline-hidden"
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
		>
			<div className="z-10 flex h-1 w-8 shrink-0 rounded-none bg-muted-foreground/50 transition-[background-color] [[data-slot=resizable-handle]:hover_&]:bg-muted-foreground [[data-slot=resizable-handle]:active_&]:bg-primary" />
		</div>
	)
}

interface TerminalBodyProps {
	storageKey: string
	workingDirectory: string
	initialInput?: string
	embedded: boolean
	fillHeight: boolean
	height: number
	theme: ReturnType<typeof buildTerminalTheme>
	onClose: () => void
}

/** Header and viewport for one terminal; keyed by storage key and theme so xterm is rebuilt for each. */
function TerminalBody({
	storageKey,
	workingDirectory,
	initialInput,
	embedded,
	fillHeight,
	height,
	theme,
	onClose,
}: TerminalBodyProps) {
	const { containerRef, isLoading, isConnecting, restart } = useTerminalSession({
		storageKey,
		workingDirectory,
		initialInput,
		embedded,
		theme,
		onExit: (code) => {
			toast.info('Terminal process exited', {
				description: code !== null ? `Exit code: ${code}` : 'Process terminated',
			})
			onClose()
		},
		onOpenError: (error) => {
			if (error.kind === 'unavailable') {
				toast.error('Failed to create terminal', {
					description: 'Terminal is only available in the desktop app',
				})
			} else {
				toast.error('Could not open terminal', { description: error.message })
			}
		},
	})

	return (
		<>
			{/* Header */}
			<div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30 flex-shrink-0">
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<TerminalIcon className="h-4 w-4" />
					<span>Terminal</span>
					{isConnecting && <span className="text-xs">(connecting…)</span>}
				</div>
				<div className="flex items-center">
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								aria-label="Restart terminal"
								className="w-5 h-5"
								onClick={restart}
							>
								<RotateCcw className="w-2.5 h-2.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							<p>Restart terminal</p>
						</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								aria-label={embedded ? 'Close' : 'Close terminal'}
								className="w-5 h-5"
								onClick={onClose}
							>
								<X className="w-3 h-3" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							<p className="flex items-center gap-1">
								{embedded ? (
									'Close'
								) : (
									<>
										Close terminal <KeyboardShortcut>⌘+J</KeyboardShortcut>
									</>
								)}
							</p>
						</TooltipContent>
					</Tooltip>
				</div>
			</div>
			<div
				className={fillHeight ? 'relative min-h-0 flex-1 overflow-hidden' : 'relative overflow-hidden'}
				style={{ height: fillHeight ? '100%' : `${height}px`, backgroundColor: theme.background }}
			>
				{isLoading && (
					<div
						className="absolute inset-0 flex items-center justify-center z-10"
						style={{ backgroundColor: theme.background }}
					>
						<SyncGridAnimation variant="snake" size="md" speed={120} className="text-muted-foreground" />
						<span className="ml-2 text-muted-foreground">Loading terminal…</span>
					</div>
				)}
				<div
					ref={containerRef}
					style={{
						visibility: isLoading ? 'hidden' : 'visible',
						width: '100%',
						height: '100%',
						overflow: 'hidden',
						backgroundColor: theme.background,
					}}
				/>
			</div>
		</>
	)
}

export function TerminalPanel({
	storageKey,
	workingDirectory,
	initialInput,
	embedded = false,
	fillHeight = embedded,
	isOpen,
	onClose,
	onOpen,
}: TerminalPanelProps) {
	const [height, setHeight] = useLocalStorage<number>(`terminal-height-${storageKey}`, DEFAULT_HEIGHT)
	const [isDragging, setIsDragging] = useState(false)
	const dragStartY = useRef(0)
	const dragStartHeight = useRef(0)

	const { appTheme, terminalTheme } = useTerminalTheme()

	// Handle drag start
	const handlePointerDown = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (fillHeight) return
			e.preventDefault()
			e.currentTarget.setPointerCapture(e.pointerId)
			setIsDragging(true)
			dragStartY.current = e.clientY
			dragStartHeight.current = isOpen ? height : 0
		},
		[fillHeight, height, isOpen],
	)

	const handlePointerMove = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (!isDragging || fillHeight) return

			const maxHeight = window.innerHeight * MAX_HEIGHT_PERCENT
			const delta = dragStartY.current - e.clientY
			const rawHeight = dragStartHeight.current + delta

			if (rawHeight < MIN_HEIGHT) {
				if (isOpen) {
					setHeight(MIN_HEIGHT)
					onClose()
				}
				return
			}

			if (!isOpen) {
				onOpen()
			}

			setHeight(Math.min(maxHeight, rawHeight))
		},
		[fillHeight, isDragging, isOpen, onClose, onOpen, setHeight],
	)

	const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
		if (e.currentTarget.hasPointerCapture(e.pointerId)) {
			e.currentTarget.releasePointerCapture(e.pointerId)
		}
		setIsDragging(false)
	}, [])

	// Cmd+J to close terminal (scoped to TERMINAL so it fires when terminal has focus)
	useAppHotkeys(
		'mod+j',
		() => {
			onClose()
		},
		{
			scopes: [HOTKEY_SCOPES.TERMINAL],
			enabled: isOpen && !embedded,
			preventDefault: true,
			enableOnFormTags: true,
			enableOnContentEditable: true,
		},
		[onClose, isOpen, embedded],
	)

	const terminalContent = isOpen ? (
		<div
			className={
				fillHeight
					? 'h-full rounded-lg border bg-background flex flex-col'
					: 'rounded-lg border bg-background flex flex-col'
			}
		>
			<TerminalBody
				key={`${storageKey}:${appTheme}`}
				storageKey={storageKey}
				workingDirectory={workingDirectory}
				initialInput={initialInput}
				embedded={embedded}
				fillHeight={fillHeight}
				height={height}
				theme={terminalTheme}
				onClose={onClose}
			/>
		</div>
	) : null

	return (
		<div className={fillHeight ? 'min-h-0 flex-1' : 'flex-shrink-0'}>
			{!fillHeight && !embedded && (
				<TerminalResizeHandle
					onPointerDown={handlePointerDown}
					onPointerMove={handlePointerMove}
					onPointerUp={handlePointerUp}
				/>
			)}
			{embedded
				? terminalContent
				: terminalContent && (
						<HotkeyScopeBoundary scope={HOTKEY_SCOPES.TERMINAL} componentName="TerminalPanel">
							{terminalContent}
						</HotkeyScopeBoundary>
					)}
		</div>
	)
}
