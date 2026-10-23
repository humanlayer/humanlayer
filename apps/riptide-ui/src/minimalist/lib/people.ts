import type { OrgMember } from '@/hooks/useOrgMembers'

/** Who wrote a comment: a name, their picture if there is one, and whether their agent wrote it for them. */
export type CommentPerson = { name: string; src?: string | null; agent: boolean }

/** A member's full name, else their email, else the start of their id. */
export function personName(userId: string, member: Pick<OrgMember, 'firstName' | 'lastName' | 'email'> | undefined) {
	if (!member) return userId.slice(0, 8)
	return [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email
}

/** Everyone but the owner who created the task, started a session or commented, in first-seen order. */
export function taskPeople(owner: string, userIds: ReadonlyArray<string | null | undefined>): string[] {
	return [...new Set(userIds.filter((id): id is string => Boolean(id) && id !== owner))]
}
