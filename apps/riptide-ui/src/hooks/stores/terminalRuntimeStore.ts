import { create } from 'zustand'

interface TerminalSessionState {
	buffer: string
	cols: number
	rows: number
}

export type PtyRuntimeState =
	| { state: 'creating'; buffer: Uint8Array[] }
	| { state: 'active'; ptyId: string; buffer: Uint8Array[] }

interface TerminalRuntimeState {
	ptyStates: Record<string, PtyRuntimeState>
	terminalStates: Record<string, TerminalSessionState>
	beginPtyCreate: (key: string) => boolean
	setPtyActive: (key: string, ptyId: string) => void
	clearPty: (key: string) => void
	getPty: (key: string) => PtyRuntimeState | undefined
	appendPtyOutput: (key: string, data: Uint8Array) => void
	getPtyBuffer: (key: string) => Uint8Array[]
	setTerminalState: (key: string, state: TerminalSessionState) => void
	getTerminalState: (key: string) => TerminalSessionState | undefined
	clearTerminalState: (key: string) => void
}

export const useTerminalRuntimeStore = create<TerminalRuntimeState>()((set, get) => ({
	ptyStates: {},
	terminalStates: {},

	beginPtyCreate: (key) => {
		const current = get().ptyStates[key]
		if (current) return false
		set((state) => ({ ptyStates: { ...state.ptyStates, [key]: { state: 'creating', buffer: [] } } }))
		return true
	},

	setPtyActive: (key, ptyId) =>
		set((state) => {
			const current = state.ptyStates[key]
			return {
				ptyStates: {
					...state.ptyStates,
					[key]: { state: 'active', ptyId, buffer: current?.buffer ?? [] },
				},
			}
		}),

	clearPty: (key) =>
		set((state) => {
			const { [key]: _, ...rest } = state.ptyStates
			return { ptyStates: rest }
		}),

	getPty: (key) => get().ptyStates[key],

	appendPtyOutput: (key, data) =>
		set((state) => {
			const current = state.ptyStates[key]
			if (!current) return state
			return {
				ptyStates: {
					...state.ptyStates,
					[key]: { ...current, buffer: [...current.buffer, data] },
				},
			}
		}),

	getPtyBuffer: (key) => get().ptyStates[key]?.buffer ?? [],

	setTerminalState: (key, terminalState) =>
		set((state) => ({ terminalStates: { ...state.terminalStates, [key]: terminalState } })),

	getTerminalState: (key) => get().terminalStates[key],

	clearTerminalState: (key) =>
		set((state) => {
			const { [key]: _, ...rest } = state.terminalStates
			return { terminalStates: rest }
		}),
}))
