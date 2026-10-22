import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { createStore } from 'zustand/vanilla'

export interface ProjectSidebarOrder {
	projects: string[]
	tasks: Record<string, string[]>
}

export const emptyProjectSidebarOrder = (): ProjectSidebarOrder => ({ projects: [], tasks: {} })

function strings(value: unknown): string[] {
	return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string'))] : []
}

export function parseProjectSidebarOrder(value: unknown): ProjectSidebarOrder {
	if (!value || typeof value !== 'object') return emptyProjectSidebarOrder()
	const input = value as Partial<ProjectSidebarOrder>
	return {
		projects: strings(input.projects),
		tasks: Object.fromEntries(
			input.tasks && typeof input.tasks === 'object' && !Array.isArray(input.tasks)
				? Object.entries(input.tasks).map(([group, ids]) => [group, strings(ids)])
				: [],
		),
	}
}

/** Unknown IDs are new, not deleted: preserve hidden IDs and insert new arrivals first. */
export function reconcileOrder(saved: readonly string[], visible: readonly string[]): string[] {
	const savedIds = new Set(saved)
	return [...visible.filter((id) => !savedIds.has(id)), ...saved]
}

/** Reorder visible slots only. Filters must not rewrite the order of hidden items. */
export function moveInOrder(saved: readonly string[], visible: readonly string[], id: string, target: string) {
	const all = reconcileOrder(saved, visible)
	const visibleIds = new Set(visible)
	if (id === target || !visibleIds.has(id) || !visibleIds.has(target)) return all
	const ordered = all.filter((item) => visibleIds.has(item))
	const from = ordered.indexOf(id)
	const to = ordered.indexOf(target)
	ordered.splice(from, 1)
	ordered.splice(to, 0, id)
	let index = 0
	return all.map((item) => (visibleIds.has(item) ? (ordered[index++] ?? item) : item))
}

interface ProjectSidebarState {
	order: ProjectSidebarOrder
	observe: (groups: ReadonlyArray<{ id: string; taskIds: string[] }>) => void
	archive: (ids: readonly string[]) => void
	move: (group: string | null, visible: string[], id: string, target: string) => void
}

// Storage denial/quota exhaustion must not break navigation or in-memory reordering.
const browserStorage: StateStorage = {
	getItem: (key) => {
		try {
			return localStorage.getItem(key)
		} catch {
			return null
		}
	},
	setItem: (key, value) => {
		try {
			localStorage.setItem(key, value)
		} catch {
			console.warn('Project sidebar order could not be saved locally')
		}
	},
	removeItem: (key) => {
		try {
			localStorage.removeItem(key)
		} catch {
			console.warn('Project sidebar order could not be cleared locally')
		}
	},
}

/** A separate store instance/key per authenticated user and organization. No records are persisted. */
export function createProjectSidebarStore(userId: string, organizationId: string, storage?: StateStorage) {
	return createStore<ProjectSidebarState>()(
		persist(
			(set) => ({
				order: emptyProjectSidebarOrder(),
				observe: (groups) =>
					set((state) => {
						const order = {
							projects: reconcileOrder(
								state.order.projects,
								groups.filter((g) => g.id !== 'other').map((g) => g.id),
							),
							tasks: { ...state.order.tasks },
						}
						for (const group of groups)
							order.tasks[group.id] = reconcileOrder(order.tasks[group.id] ?? [], group.taskIds)
						return JSON.stringify(order) === JSON.stringify(state.order) ? state : { order }
					}),
				archive: (ids) =>
					set((state) => {
						const archivedIds = new Set(ids)
						if (!Object.values(state.order.tasks).some((items) => items.some((id) => archivedIds.has(id))))
							return state
						return {
							order: {
								...state.order,
								tasks: Object.fromEntries(
									Object.entries(state.order.tasks).map(([group, items]) => [
										group,
										items.filter((id) => !archivedIds.has(id)),
									]),
								),
							},
						}
					}),
				move: (group, visible, id, target) =>
					set((state) => ({
						order:
							group === null
								? { ...state.order, projects: moveInOrder(state.order.projects, visible, id, target) }
								: {
										...state.order,
										tasks: {
											...state.order.tasks,
											[group]: moveInOrder(state.order.tasks[group] ?? [], visible, id, target),
										},
									},
					})),
			}),
			{
				name: `project-sidebar:v1:${encodeURIComponent(organizationId)}:${encodeURIComponent(userId)}`,
				storage: createJSONStorage(() => storage ?? browserStorage),
				partialize: (state) => ({ order: state.order }),
				merge: (persisted, current) => ({
					...current,
					order: parseProjectSidebarOrder((persisted as { order?: unknown } | undefined)?.order),
				}),
			},
		),
	)
}

export type ProjectSidebarStore = ReturnType<typeof createProjectSidebarStore>
