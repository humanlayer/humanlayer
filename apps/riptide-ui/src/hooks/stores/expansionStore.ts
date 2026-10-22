import { create } from 'zustand'

interface ExpansionState {
	expandedAgents: Set<string>
	/** Expanded "working" blocks (contiguous thinking/tool-call runs), keyed by block id. */
	expandedWorkBlocks: Set<string>
	/** Expanded compaction rows: the folded history (`compacted-<boundary id>`) and the summary (`<boundary id>`). */
	expandedCompactions: Set<string>
	/** How many of the newest folded events an expanded history reveals, keyed by fold id; absent means one page. */
	compactionRevealCounts: Map<string, number>
	toggle: (agentId: string) => void
	expand: (agentId: string) => void
	collapse: (agentId: string) => void
	toggleWorkBlock: (blockId: string) => void
	expandWorkBlock: (blockId: string) => void
	collapseWorkBlock: (blockId: string) => void
	toggleCompaction: (id: string) => void
	expandCompaction: (id: string) => void
	collapseCompaction: (id: string) => void
	setCompactionRevealCount: (id: string, count: number) => void
	clear: () => void
}

const toggled = (set: Set<string>, id: string) => {
	const next = new Set(set)
	if (next.has(id)) {
		next.delete(id)
	} else {
		next.add(id)
	}
	return next
}

export const useExpansionStore = create<ExpansionState>((set) => ({
	expandedAgents: new Set(),
	expandedWorkBlocks: new Set(),
	expandedCompactions: new Set(),
	compactionRevealCounts: new Map(),

	toggle: (agentId) => set((state) => ({ expandedAgents: toggled(state.expandedAgents, agentId) })),

	expand: (agentId) =>
		set((state) => {
			const next = new Set(state.expandedAgents)
			next.add(agentId)
			return { expandedAgents: next }
		}),

	collapse: (agentId) =>
		set((state) => {
			const next = new Set(state.expandedAgents)
			next.delete(agentId)
			return { expandedAgents: next }
		}),

	toggleWorkBlock: (blockId) => set((state) => ({ expandedWorkBlocks: toggled(state.expandedWorkBlocks, blockId) })),

	expandWorkBlock: (blockId) =>
		set((state) => {
			const next = new Set(state.expandedWorkBlocks)
			next.add(blockId)
			return { expandedWorkBlocks: next }
		}),

	collapseWorkBlock: (blockId) =>
		set((state) => {
			const next = new Set(state.expandedWorkBlocks)
			next.delete(blockId)
			return { expandedWorkBlocks: next }
		}),

	toggleCompaction: (id) => set((state) => ({ expandedCompactions: toggled(state.expandedCompactions, id) })),

	expandCompaction: (id) =>
		set((state) => {
			const next = new Set(state.expandedCompactions)
			next.add(id)
			return { expandedCompactions: next }
		}),

	collapseCompaction: (id) =>
		set((state) => {
			const next = new Set(state.expandedCompactions)
			next.delete(id)
			return { expandedCompactions: next }
		}),

	setCompactionRevealCount: (id, count) =>
		set((state) => {
			const next = new Map(state.compactionRevealCounts)
			next.set(id, count)
			return { compactionRevealCounts: next }
		}),

	clear: () =>
		set({
			expandedAgents: new Set(),
			expandedWorkBlocks: new Set(),
			expandedCompactions: new Set(),
			compactionRevealCounts: new Map(),
		}),
}))
