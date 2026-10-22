import { normalizeSubpath } from './normalize-subpath'

export function buildS3Key(organizationId: string, taskId: string, subpath: string): string {
	const normalizedSubpath = normalizeSubpath(subpath)
	return `${organizationId}/${taskId}/${normalizedSubpath}`
}
