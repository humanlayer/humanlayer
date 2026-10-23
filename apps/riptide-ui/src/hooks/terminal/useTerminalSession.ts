import { FitAddon } from '@xterm/addon-fit'
import { SerializeAddon } from '@xterm/addon-serialize'
import { WebglAddon } from '@xterm/addon-webgl'

import '@xterm/xterm/css/xterm.css'
import { type ITheme, Terminal } from '@xterm/xterm'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'

import { useTerminalRuntimeStore } from '@/hooks/stores/terminalRuntimeStore'
import { useTerminalStore } from '@/hooks/stores/terminalStore'
import { useMountEffect } from '@/hooks/useMountEffect'
import {
	attachPty,
	createPty,
	detachPty,
	killPty,
	type PtyEvent,
	resizePty,
	writePty,
} from '@/integrations/desktop/pty'

/** Trailing debounce for container-driven fit/resize so a TUI repaints once, at the final size. */
const RESIZE_DEBOUNCE_MS = 100

const DEFAULT_FONT_FAMILY = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace'

/** Embedded terminals keep scrollback in memory only; the rest persist it. */
function scrollbackStore(embedded: boolean) {
	return embedded ? useTerminalRuntimeStore.getState() : useTerminalStore.getState()
}

export type TerminalOpenError = { kind: 'unavailable' } | { kind: 'failed'; message: string }

export interface TerminalSessionOptions {
	/** Key for the PTY mapping and saved scrollback (e.g. sessionId or `task-${taskId}`) */
	storageKey: string
	/** Working directory to spawn the PTY in */
	workingDirectory: string
	/** Input to send after a newly created PTY starts */
	initialInput?: string
	/** Embedded terminals keep scrollback in memory only, instead of the persisted terminal store */
	embedded?: boolean
	/** Read once on mount; key the calling component to apply a new theme or font */
	theme: ITheme
	fontSize?: number
	fontFamily?: string
	/** The shell exited. The PTY and its saved scrollback are already cleared. */
	onExit: (code: number | null) => void
	onOpenError: (error: TerminalOpenError) => void
}

/**
 * An xterm bound to a desktop PTY: creates or reattaches the shell for `storageKey`, keeps the
 * PTY sized to the container, and saves the scrollback on unmount so a remount picks up where it
 * left off. Renders nothing; attach `containerRef` to the element the terminal should fill.
 */
export function useTerminalSession({
	storageKey,
	workingDirectory,
	initialInput,
	embedded = false,
	theme,
	fontSize = 13,
	fontFamily = DEFAULT_FONT_FAMILY,
	onExit,
	onOpenError,
}: TerminalSessionOptions) {
	const [isLoading, setIsLoading] = useState(true)
	const [isConnecting, setIsConnecting] = useState(false)
	const containerRef = useRef<HTMLDivElement>(null)
	const terminalRef = useRef<Terminal | null>(null)
	const channelGenerationRef = useRef(0)
	// Last cols/rows pushed to the PTY; lets us skip redundant (e.g. height-only) resizes.
	const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null)
	const ptyIdRef = useRef<string | null>(null)
	const ptyExitedRef = useRef(false)

	const callbacksRef = useRef({ onExit, onOpenError })
	useLayoutEffect(() => {
		callbacksRef.current = { onExit, onOpenError }
	})

	// Handle user input from terminal - uses ref to always get current ptyId
	const handleData = useCallback((data: string) => {
		const currentPtyId = ptyIdRef.current
		if (currentPtyId) {
			writePty(currentPtyId, new TextEncoder().encode(data)).catch(() => {
				// Ignore write errors - PTY may have been closed
			})
		}
	}, [])

	// Skip no-op resizes to avoid redundant SIGWINCH signals to programs running in the shell.
	const handleResize = useCallback((cols: number, rows: number) => {
		const currentPtyId = ptyIdRef.current
		if (!currentPtyId) return
		const last = lastSizeRef.current
		if (last && last.cols === cols && last.rows === rows) return
		lastSizeRef.current = { cols, rows }
		resizePty(currentPtyId, cols, rows).catch(() => {
			// Ignore resize errors - PTY may have been closed
		})
	}, [])

	/** Create an event listener wired to the current terminal instance. */
	const createPtyEventListener = useCallback(() => {
		const generation = ++channelGenerationRef.current
		return (message: PtyEvent) => {
			if (generation !== channelGenerationRef.current) return

			if (message.event === 'output') {
				const data = new Uint8Array(message.data.data)
				if (embedded) {
					useTerminalRuntimeStore.getState().appendPtyOutput(storageKey, data)
				}
				terminalRef.current?.write(data)
			} else if (message.event === 'exit') {
				// Clean up dead PTY session (mirrors restart teardown)
				if (ptyIdRef.current) {
					void killPty(ptyIdRef.current)
					useTerminalRuntimeStore.getState().clearPty(storageKey)
					ptyIdRef.current = null
				}
				// Clear saved terminal state so reopening spawns a fresh shell
				scrollbackStore(embedded).clearTerminalState(storageKey)
				ptyExitedRef.current = true
				callbacksRef.current.onExit(message.data.code)
			}
		}
	}, [storageKey, embedded])

	const createPtySession = useCallback(() => {
		if (ptyIdRef.current) return

		const runtimeStore = useTerminalRuntimeStore.getState()
		const existing = runtimeStore.getPty(storageKey)
		if (existing?.state === 'active') return
		if (!runtimeStore.beginPtyCreate(storageKey)) return

		setIsConnecting(true)

		const onPtyEvent = createPtyEventListener()
		const createGeneration = channelGenerationRef.current

		createPty(workingDirectory, onPtyEvent)
			.then(async (id) => {
				if (!id) {
					useTerminalRuntimeStore.getState().clearPty(storageKey)
					callbacksRef.current.onOpenError({ kind: 'unavailable' })
					return
				}
				if (createGeneration !== channelGenerationRef.current) {
					await killPty(id)
					return
				}

				ptyIdRef.current = id
				useTerminalRuntimeStore.getState().setPtyActive(storageKey, id)

				// Sync the shell PTY to the terminal's current dimensions.
				const terminal = terminalRef.current
				if (terminal) {
					lastSizeRef.current = { cols: terminal.cols, rows: terminal.rows }
					await resizePty(id, terminal.cols, terminal.rows)
				}
				if (initialInput) {
					await writePty(id, new TextEncoder().encode(initialInput))
				}

				// Focus terminal after PTY is created and resized
				setTimeout(() => {
					terminalRef.current?.focus()
				}, 50)
			})
			.catch((error) => {
				const message = error instanceof Error ? error.message : String(error)
				useTerminalRuntimeStore.getState().clearPty(storageKey)
				callbacksRef.current.onOpenError({ kind: 'failed', message })
			})
			.finally(() => {
				setIsConnecting(false)
			})
	}, [workingDirectory, storageKey, createPtyEventListener, initialInput])

	/** Reattach to an existing PTY session. Falls back to creating a new one. */
	const attachToPtySession = useCallback(
		(existingPtyId: string) => {
			setIsConnecting(true)

			const onPtyEvent = createPtyEventListener()
			const attachGeneration = channelGenerationRef.current

			attachPty(existingPtyId, onPtyEvent)
				.then(async () => {
					if (attachGeneration !== channelGenerationRef.current) return

					ptyIdRef.current = existingPtyId
					useTerminalRuntimeStore.getState().setPtyActive(storageKey, existingPtyId)

					const terminal = terminalRef.current
					if (terminal) {
						lastSizeRef.current = { cols: terminal.cols, rows: terminal.rows }
						await resizePty(existingPtyId, terminal.cols, terminal.rows)
					}

					setTimeout(() => {
						terminalRef.current?.focus()
					}, 50)
				})
				.catch(() => {
					// PTY no longer exists — clear mapping and create fresh
					useTerminalRuntimeStore.getState().clearPty(storageKey)
					createPtySession()
				})
				.finally(() => {
					setIsConnecting(false)
				})
		},
		[storageKey, createPtyEventListener, createPtySession],
	)

	/** Clear the buffer, kill the PTY and start a fresh shell. */
	const restart = useCallback(async () => {
		const terminal = terminalRef.current
		if (!terminal) return

		const oldPtyId = ptyIdRef.current
		channelGenerationRef.current += 1
		ptyIdRef.current = null
		useTerminalRuntimeStore.getState().clearPty(storageKey)
		scrollbackStore(embedded).clearTerminalState(storageKey)

		terminal.clear()
		terminal.reset()

		if (oldPtyId) {
			await killPty(oldPtyId)
		}

		createPtySession()
	}, [storageKey, createPtySession, embedded])

	useMountEffect(() => {
		const container = containerRef.current
		if (!container || terminalRef.current) return

		let cancelled = false

		const terminal = new Terminal({
			cursorBlink: true,
			cursorStyle: 'block',
			fontSize,
			fontFamily,
			theme,
			cols: 80,
			rows: 24,
			allowTransparency: false,
		})

		const fitAddon = new FitAddon()
		const serializeAddon = new SerializeAddon()
		terminal.loadAddon(fitAddon)
		terminal.loadAddon(serializeAddon)

		terminal.onData(handleData)
		terminal.open(container)

		try {
			terminal.loadAddon(new WebglAddon())
		} catch {
			// WebGL not available — fall back to canvas renderer
		}

		terminalRef.current = terminal

		const runtimeBuffer = embedded ? useTerminalRuntimeStore.getState().getPtyBuffer(storageKey) : []
		const saved = embedded ? undefined : useTerminalStore.getState().getTerminalState(storageKey)
		if (runtimeBuffer.length > 0) {
			for (const data of runtimeBuffer) {
				terminal.write(data)
			}
		} else if (saved?.buffer) {
			if (saved.cols && saved.rows) {
				terminal.resize(saved.cols, saved.rows)
			}
			terminal.write(saved.buffer)
		}

		let resizeDebounce: ReturnType<typeof setTimeout> | null = null
		const applyFit = () => {
			if (cancelled) return
			try {
				fitAddon.fit()
				handleResize(terminal.cols, terminal.rows)
			} catch {
				// Ignore fit errors during rapid mount/unmount
			}
		}
		const resizeObserver = new ResizeObserver(() => {
			if (resizeDebounce) clearTimeout(resizeDebounce)
			resizeDebounce = setTimeout(applyFit, RESIZE_DEBOUNCE_MS)
		})
		resizeObserver.observe(container)

		const existingPty = useTerminalRuntimeStore.getState().getPty(storageKey)

		requestAnimationFrame(() => {
			if (cancelled || !terminalRef.current) return
			try {
				fitAddon.fit()
				handleResize(terminal.cols, terminal.rows)
			} catch {
				// Ignore fit errors during rapid mount/unmount
			}
			terminal.focus()
			setIsLoading(false)

			if (existingPty?.state === 'active') {
				attachToPtySession(existingPty.ptyId)
			} else {
				createPtySession()
			}
		})

		return () => {
			cancelled = true
			if (resizeDebounce) clearTimeout(resizeDebounce)
			resizeObserver.disconnect()
			if (!ptyExitedRef.current) {
				try {
					const buffer = serializeAddon.serialize({ scrollback: 500 })
					if (buffer) {
						scrollbackStore(embedded).setTerminalState(storageKey, {
							buffer,
							cols: terminal.cols,
							rows: terminal.rows,
						})
					}
				} catch {
					// Ignore serialization errors during disposal
				}
			}
			if (ptyIdRef.current) {
				void detachPty(ptyIdRef.current)
				ptyIdRef.current = null
			}
			ptyExitedRef.current = false
			terminal.dispose()
			terminalRef.current = null
			setIsLoading(true)
		}
	})

	return { containerRef, isLoading, isConnecting, restart }
}
