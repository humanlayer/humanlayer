const MAX_STACK_ID_LENGTH = 63

export type StackIdentity = {
	id: string
	displayName: string
	dockerName: string
	tauriSuffix: string
}

export function sanitizeStackId(value: string): string {
	const sanitized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, MAX_STACK_ID_LENGTH)
		.replace(/-+$/g, '')

	if (!sanitized) throw new Error(`Stack ID "${value}" does not contain any route-safe characters`)
	return sanitized
}

export function createStackIdentity(value: string): StackIdentity {
	const id = sanitizeStackId(value)
	return {
		id,
		displayName: id.replaceAll('-', ' '),
		dockerName: `devstk-${id}`,
		tauriSuffix: id.replaceAll('-', '_').slice(0, 48),
	}
}
