export function canReassignTaskOwner(isOwner: boolean, role: string | null, roles: readonly string[]): boolean {
	return isOwner || role === 'admin' || roles.includes('admin')
}
