export type WorkspaceFocusSearch = Record<string, unknown> & { focus?: 'workspace' }

export function consumeWorkspaceFocusRequest(
	focus: 'workspace' | undefined,
	handleWorkspaceFocus: () => void,
	navigate: (options: {
		to: '/tasks/$taskId'
		params: { taskId: string }
		search: (previous: WorkspaceFocusSearch) => WorkspaceFocusSearch
		replace: true
	}) => void,
	taskId: string,
): boolean {
	if (focus !== 'workspace') return false
	handleWorkspaceFocus()
	navigate({
		to: '/tasks/$taskId',
		params: { taskId },
		search: (previous) => ({ ...previous, focus: undefined }),
		replace: true,
	})
	return true
}
