import type { ITheme } from '@xterm/xterm'
import { RotateCcw, X } from 'lucide-react'
import { type KeyboardEvent, type PointerEvent, useState } from 'react'

import { useTerminalSession } from '@/hooks/terminal/useTerminalSession'
import { useMinimalistDark } from '@/minimalist/lib/color-scheme'
import { shortPath } from '@/minimalist/lib/format'
import { shortcutHint } from '@/minimalist/lib/shortcuts'
import { useUi } from '@/minimalist/lib/ui-state'

const HEIGHT_KEY = 'hl-min-terminal-h'
const DEFAULT_HEIGHT = 260
const MIN_HEIGHT = 120
const STEP = 16

/** The sidebar surface and GitHub's ANSI colors, matching the minimalist code colors. */
const THEMES: Record<'light' | 'dark', ITheme> = {
	light: {
		background: '#f7f7f8',
		foreground: '#1a1c1f',
		cursor: '#1a1c1f',
		cursorAccent: '#f7f7f8',
		selectionBackground: 'rgba(0, 102, 255, 0.16)',
		black: '#24292f',
		red: '#cf222e',
		green: '#116329',
		yellow: '#4d2d00',
		blue: '#0969da',
		magenta: '#8250df',
		cyan: '#1b7c83',
		white: '#6e7781',
		brightBlack: '#57606a',
		brightRed: '#a40e26',
		brightGreen: '#1a7f37',
		brightYellow: '#633c01',
		brightBlue: '#218bff',
		brightMagenta: '#a475f9',
		brightCyan: '#3192aa',
		brightWhite: '#8c959f',
	},
	dark: {
		background: '#1f1f1f',
		foreground: '#f5f5f5',
		cursor: '#f5f5f5',
		cursorAccent: '#1f1f1f',
		selectionBackground: 'rgba(64, 140, 255, 0.34)',
		black: '#484f58',
		red: '#ff7b72',
		green: '#3fb950',
		yellow: '#d29922',
		blue: '#58a6ff',
		magenta: '#bc8cff',
		cyan: '#39c5cf',
		white: '#b1bac4',
		brightBlack: '#6e7681',
		brightRed: '#ffa198',
		brightGreen: '#56d364',
		brightYellow: '#e3b341',
		brightBlue: '#79c0ff',
		brightMagenta: '#d2a8ff',
		brightCyan: '#56d4dd',
		brightWhite: '#ffffff',
	},
}

function storedHeight(): number {
	try {
		const value = Number(localStorage.getItem(HEIGHT_KEY))
		return value >= MIN_HEIGHT ? value : DEFAULT_HEIGHT
	} catch {
		return DEFAULT_HEIGHT
	}
}

function saveHeight(height: number | null) {
	try {
		if (height === null) localStorage.removeItem(HEIGHT_KEY)
		else localStorage.setItem(HEIGHT_KEY, String(height))
	} catch {
		// The height still applies for this visit when the browser blocks storage.
	}
}

const clampHeight = (height: number) => Math.round(Math.min(window.innerHeight * 0.7, Math.max(MIN_HEIGHT, height)))

/**
 * The task's shell, docked under the session. Drag the top edge to resize it. The shell keeps
 * running when the panel closes, so reopening it picks up the same session.
 */
export function TerminalPanel({
	storageKey,
	directory,
	onClose,
}: {
	storageKey: string
	directory: string
	onClose: () => void
}) {
	const dark = useMinimalistDark()
	const [height, setHeight] = useState(storedHeight)

	const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return
		event.preventDefault()
		const handle = event.currentTarget
		const startY = event.clientY
		const startHeight = height
		let latest = startHeight
		const root = handle.closest<HTMLElement>('.minimalist-ui')
		handle.setPointerCapture(event.pointerId)
		root?.classList.add('pane-resizing')
		const move = (moveEvent: globalThis.PointerEvent) => {
			latest = clampHeight(startHeight + startY - moveEvent.clientY)
			setHeight(latest)
		}
		const stop = () => {
			handle.removeEventListener('pointermove', move)
			handle.removeEventListener('pointerup', stop)
			handle.removeEventListener('pointercancel', stop)
			root?.classList.remove('pane-resizing')
			saveHeight(latest)
		}
		handle.addEventListener('pointermove', move)
		handle.addEventListener('pointerup', stop)
		handle.addEventListener('pointercancel', stop)
	}

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
		event.preventDefault()
		const next = clampHeight(height + (event.key === 'ArrowUp' ? STEP : -STEP))
		setHeight(next)
		saveHeight(next)
	}

	return (
		<section className="term" style={{ height }} aria-label="Terminal">
			<div
				className="term-resize"
				role="separator"
				aria-orientation="horizontal"
				aria-label="Resize terminal"
				aria-valuemin={MIN_HEIGHT}
				aria-valuenow={height}
				tabIndex={0}
				title="Drag to resize. Double-click to reset."
				onPointerDown={onPointerDown}
				onKeyDown={onKeyDown}
				onDoubleClick={() => {
					setHeight(DEFAULT_HEIGHT)
					saveHeight(null)
				}}
			/>
			<TerminalBody
				key={dark ? 'dark' : 'light'}
				storageKey={storageKey}
				directory={directory}
				theme={dark ? THEMES.dark : THEMES.light}
				onClose={onClose}
			/>
		</section>
	)
}

/** Keyed by color scheme: xterm takes its colors once, when it is created. */
function TerminalBody({
	storageKey,
	directory,
	theme,
	onClose,
}: {
	storageKey: string
	directory: string
	theme: ITheme
	onClose: () => void
}) {
	const { showToast } = useUi()
	const { containerRef, isLoading, isConnecting, restart } = useTerminalSession({
		storageKey,
		workingDirectory: directory,
		theme,
		fontSize: 12,
		fontFamily: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace",
		onExit: (code) => {
			showToast(code === null || code === 0 ? 'The shell exited' : `The shell exited with code ${code}`)
			onClose()
		},
		onOpenError: (error) => {
			showToast(
				error.kind === 'unavailable'
					? 'Could not open the terminal. It runs only in the desktop app.'
					: 'Could not open the terminal. Check that the working directory still exists, then try again.',
			)
			onClose()
		},
	})
	return (
		<>
			<header className="term-head">
				<span className="t">Terminal</span>
				<span className="meta" title={directory}>
					{isConnecting ? 'Starting…' : shortPath(directory, 40)}
				</span>
				<span className="sp" />
				<button
					type="button"
					className="iconbtn"
					aria-label="Restart terminal"
					title="Restart terminal"
					onClick={() => void restart()}
				>
					<RotateCcw className="i sm" />
				</button>
				<button
					type="button"
					className="iconbtn"
					aria-label="Close terminal"
					title={`Close terminal ${shortcutHint('terminal')}`}
					onClick={onClose}
				>
					<X className="i sm" />
				</button>
			</header>
			<div className="term-view" style={{ background: theme.background }}>
				<div
					ref={containerRef}
					className="term-xterm"
					style={{ visibility: isLoading ? 'hidden' : 'visible' }}
				/>
			</div>
		</>
	)
}
