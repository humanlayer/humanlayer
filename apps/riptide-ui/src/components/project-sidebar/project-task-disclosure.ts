import type { SidebarTask } from '@humanlayer/ui/components/sidebar/types'
import { create } from 'zustand'

/** V2-only explicit intent. Route selection may open a preview, but cannot undo a collapse. */
export const useProjectTaskDisclosure = create<{
	manual: Record<string, boolean>
	setOpen: (id: string, open: boolean) => void
}>((set) => ({
	manual: {},
	setOpen: (id, open) => set((state) => ({ manual: { ...state.manual, [id]: open } })),
}))

export function projectTaskDisclosure(
	task: SidebarTask & { historySessions?: SidebarTask['sessions'] },
	manual: boolean | undefined,
	automatic: boolean,
) {
	return {
		open: manual ?? (automatic && task.sessions.length > 0),
		sessions: manual === true ? (task.historySessions ?? task.sessions) : task.sessions,
	}
}
