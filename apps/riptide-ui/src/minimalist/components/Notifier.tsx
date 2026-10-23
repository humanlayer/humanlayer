import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import type { DiffComment } from '@humanlayer/db/tables/diff-comments'
import type { Session, SessionStatus } from '@humanlayer/db/tables/sessions'
import { and, eq, queryOnce } from '@tanstack/react-db'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { useEffectEvent, useState } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { useMountEffect } from '@/hooks/useMountEffect'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { memberFirstName } from '@/minimalist/lib/access'
import { artifactName } from '@/minimalist/lib/artifacts'
import { alertSnippet, alertTitle, isNewComment } from '@/minimalist/lib/comment-alerts'
import { basename } from '@/minimalist/lib/format'
import { notifyAway } from '@/minimalist/lib/os-notifications'
import { sessionName } from '@/minimalist/lib/session-name'
import { useOpenInTask } from '@/minimalist/lib/thread-panel'
import { useUi } from '@/minimalist/lib/ui-state'

const EVENTS: Partial<Record<SessionStatus, string>> = {
	needs_approval: 'Needs approval',
	ready_for_input: 'Finished',
	failed: 'Failed',
	lost: 'Stalled',
}

type Change<T> = { type: string; value: T; previousValue?: T }

/** Comments already alerted: Electric can replay rows as inserts after a reconnect, and a new subscription starts over. */
const alerted = new Set<string>()

/**
 * Tells you when something needs you:
 * - your session finishes, fails or needs approval while the window is in the
 *   background (in the app, the sidebar dots cover that);
 * - a teammate or an agent comments on your document or diff. In the app that's
 *   a toast with Open; in the background, a sound and an OS notification.
 */
export function Notifier() {
	const { sessionsCollection, artifactCommentsCollection, diffCommentsCollection } = useSync()
	// Sync can swap a collection for another (a fallback to polling, a new organization);
	// a new key subscribes to the new one.
	return (
		<Subscriptions key={`${sessionsCollection.id}:${artifactCommentsCollection.id}:${diffCommentsCollection.id}`} />
	)
}

function Subscriptions() {
	const {
		sessionsCollection,
		tasksCollection,
		artifactCommentsCollection,
		diffCommentsCollection,
		artifactsMetadataCollection,
	} = useSync()
	const { user } = useAuth()
	const navigate = useNavigate()
	const openInTask = useOpenInTask()
	const { showToast } = useUi()
	const { membersMap } = useOrgMembers()
	// Comments from before these collections started are history, not news; another organization's are too.
	const [openedAt] = useState(() => Date.now())

	const onSessions = useEffectEvent((changes: Change<Session>[]) => {
		if (document.hasFocus()) return
		for (const { type, value: session, previousValue: previous } of changes) {
			if (type !== 'update') continue
			const label = EVENTS[session.status]
			if (!label || previous?.status === session.status || session.created_by !== user?.id) continue
			const task = session.task_id ? tasksCollection.state.get(session.task_id) : undefined
			notifyAway(label, task?.name ?? sessionName(session, 'Session'), session.id, () => {
				if (session.task_id)
					void navigate({
						to: '/tasks/$taskId',
						params: { taskId: session.task_id },
						search: { session: session.id },
					})
				else void navigate({ to: '/sessions/$sessionId', params: { sessionId: session.id } })
			})
		}
	})

	// Rows these read may not have synced yet, so each asks for just what it needs.
	const yours = async (comment: ArtifactComment | DiffComment, me: string) =>
		comment.resource_owner_user_id === me ||
		(await queryOnce((q) =>
			q
				.from({ session: sessionsCollection })
				.where(({ session }) =>
					and(eq(session.task_id, comment.task_id), eq(session.resource_owner_user_id, me)),
				)
				.findOne(),
		)) !== undefined
	// The file the title names (a reply sits on its thread's root), and the link Open follows.
	const placeOf = async (kind: 'document' | 'diff', comment: ArtifactComment | DiffComment) => {
		if (kind === 'diff') {
			const rootId = comment.reply_to_comment_id ?? comment.id
			const root = await queryOnce((q) =>
				q
					.from({ root: diffCommentsCollection })
					.where(({ root }) => eq(root.id, rootId))
					.findOne(),
			)
			const path = root?.anchor_json?.path
			return { file: path ? basename(path) : 'the diff', search: { diffCommentId: comment.id } }
		}
		const { artifact_id } = comment as ArtifactComment
		const doc = await queryOnce((q) =>
			q
				.from({ doc: artifactsMetadataCollection })
				.where(({ doc }) => eq(doc.id, artifact_id))
				.findOne(),
		)
		return {
			file: doc ? artifactName(doc.file_name) : 'a document',
			search: { artifactId: artifact_id, commentId: comment.id },
		}
	}
	const alert = async (kind: 'document' | 'diff', comment: ArtifactComment | DiffComment, me: string) => {
		if (!(await yours(comment, me))) return
		const { file, search } = await placeOf(kind, comment)
		const title = alertTitle(comment, { me, name: authorOf(comment, membersMap), file })
		const open = () => void openInTask(comment.task_id, search)
		if (document.hasFocus()) showToast(title, { label: 'Open', run: open })
		else notifyAway(title, alertSnippet(comment.content_text), `comments:${comment.task_id}`, open)
	}

	const onComments = useEffectEvent((kind: 'document' | 'diff', changes: Change<ArtifactComment | DiffComment>[]) => {
		const me = user?.id
		if (!me) return
		for (const { type, value: comment } of changes) {
			if (type !== 'insert' || alerted.has(comment.id)) continue
			if (!isNewComment(comment, { me, openedAt, now: Date.now() })) continue
			alerted.add(comment.id)
			void alert(kind, comment, me)
		}
	})

	useMountEffect(() => {
		const subscriptions = [
			sessionsCollection.subscribeChanges((changes) => onSessions(changes as Change<Session>[])),
			artifactCommentsCollection.subscribeChanges((changes) =>
				onComments('document', changes as Change<ArtifactComment>[]),
			),
			diffCommentsCollection.subscribeChanges((changes) => onComments('diff', changes as Change<DiffComment>[])),
		]
		return () => {
			for (const subscription of subscriptions) subscription.unsubscribe()
		}
	})

	return null
}

function authorOf(
	comment: ArtifactComment | DiffComment,
	members: ReturnType<typeof useOrgMembers>['membersMap'],
): string {
	if (!comment.created_by_user_id && 'anonymous_guest_name' in comment)
		return comment.anonymous_guest_name || 'A guest'
	return memberFirstName(members.get(comment.created_by_user_id))
}
