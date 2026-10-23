import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const MAX_BUFFER_SIZE = 100_000 // 100KB per session
const MAX_ENTRIES = 30

interface TerminalSessionState {
	buffer: string
	cols: number
	rows: number
}

interface TerminalState {
	terminalStates: Record<string, TerminalSessionState>
	setTerminalState: (key: string, state: TerminalSessionState) => void
	getTerminalState: (key: string) => TerminalSessionState | undefined
	clearTerminalState: (key: string) => void
}

export const useTerminalStore = create<TerminalState>()(
	persist(
		(set, get) => ({
			terminalStates: {},

			setTerminalState: (key, state) =>
				set((prev) => {
					const updated = { ...prev.terminalStates, [key]: state }

					// Enforce max entries — drop oldest by insertion order
					const keys = Object.keys(updated)
					if (keys.length > MAX_ENTRIES) {
						const keysToRemove = keys.slice(0, keys.length - MAX_ENTRIES)
						for (const k of keysToRemove) {
							delete updated[k]
						}
					}

					return { terminalStates: updated }
				}),

			getTerminalState: (key) => get().terminalStates[key],

			clearTerminalState: (key) =>
				set((prev) => {
					const { [key]: _, ...rest } = prev.terminalStates
					return { terminalStates: rest }
				}),
		}),
		{
			name: 'riptide-terminal-state',
			partialize: (state) => ({
				terminalStates: Object.fromEntries(
					Object.entries(state.terminalStates).map(([k, v]) => {
						let buffer = v.buffer
						if (buffer && buffer.length > MAX_BUFFER_SIZE) {
							const lastNewline = buffer.lastIndexOf('\r\n', MAX_BUFFER_SIZE)
							buffer = lastNewline > 0 ? buffer.slice(0, lastNewline) : buffer.slice(0, MAX_BUFFER_SIZE)
						}
						return [k, { ...v, buffer }]
					}),
				),
			}),
			storage: {
				getItem: (name) => {
					const str = localStorage.getItem(name)
					return str ? JSON.parse(str) : null
				},
				setItem: (name, value) => {
					try {
						localStorage.setItem(name, JSON.stringify(value))
					} catch (e) {
						if (e instanceof DOMException && e.name === 'QuotaExceededError') {
							// Clear oldest entries and retry
							const state = JSON.parse(localStorage.getItem(name) || '{}')
							if (state?.state?.terminalStates) {
								const keys = Object.keys(state.state.terminalStates)
								// Remove oldest half
								const removeCount = Math.max(1, Math.floor(keys.length / 2))
								for (const k of keys.slice(0, removeCount)) {
									delete state.state.terminalStates[k]
								}
								try {
									localStorage.setItem(name, JSON.stringify(state))
									localStorage.setItem(name, JSON.stringify(value))
								} catch {
									// Give up — clear all terminal state
									localStorage.removeItem(name)
								}
							}
						}
					}
				},
				removeItem: (name) => localStorage.removeItem(name),
			},
		},
	),
)
