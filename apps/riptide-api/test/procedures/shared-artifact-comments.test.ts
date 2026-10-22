import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { anonymousArtifactCommenters, artifactComments } from '@humanlayer/db/tables/artifact-comments'
import { artifactVersions } from '@humanlayer/db/tables/artifact-versions'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { organizations } from '@humanlayer/db/tables/organizations'
import { publicCommentUndoAuthorizations } from '@humanlayer/db/tables/public-comment-undo-authorizations'
import { tasks } from '@humanlayer/db/tables/tasks'
import type { ArtifactCommentAnchor } from '@humanlayer/db/zodschemas/artifact-comment-anchor'
import { call } from '@orpc/server'
import { and, eq, inArray } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect, Layer } from 'effect'
import { hash } from 'ohash'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { WorkosService } from '../../src/effects/services/workos/workos.service'
import { publicCommentGuestIdentityProcedure as liveGuestIdentity } from '../../src/orpc/api/comments/public-comment-guest-identity.effect'
import { sharedArtifactCommentAuthorsProcedure as liveAuthors } from '../../src/orpc/api/public/artifacts/comment-authors.effect'
import { createPublicArtifactCommentProcedure as liveCreate } from '../../src/orpc/api/public/artifacts/create-comment.effect'
import { undoPublicArtifactCommentProcedure as liveUndo } from '../../src/orpc/api/public/artifacts/undo-comment.effect'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import {
	bindProcedureToRuntime,
	createRuntimeWithTestPostgresLayer,
	makeTestWorkosService,
} from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const anchor: ArtifactCommentAnchor = {
	v: 2,
	scope: 'block',
	selectedText: 'Shared comments',
	start: {
		blockType: 'heading',
		blockText: 'Shared comments',
		previousBlockText: null,
		nextBlockText: null,
		offset: 0,
	},
	end: {
		blockType: 'heading',
		blockText: 'Shared comments',
		previousBlockText: null,
		nextBlockText: null,
		offset: 15,
	},
}

describe('shared artifact comment reads', () => {
	let cleanup: (() => Promise<void>) | undefined
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer>
	let db: PostgresJsDatabase
	let organizationId: string
	let artifactId: string
	let currentCommentId: string
	let currentVersionId: string
	let taskId: string
	const shareKey = randomUUID()
	const ownerId = 'shared-comments-owner'

	beforeAll(async () => {
		const testDb = await createTestDb('shared_artifact_comments')
		cleanup = testDb.cleanup
		db = testDb.db
		const [org] = await db
			.insert(organizations)
			.values({ name: 'Shared comments', workos_organization_id: 'workos-shared-comments' })
			.returning()
		if (!org) throw new Error('Could not seed organization')
		organizationId = org.id
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: org.id,
				name: 'Shared comments',
				resource_owner_user_id: ownerId,
				created_by: ownerId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
			})
			.returning()
		if (!task) throw new Error('Could not seed task')
		taskId = task.id
		const content = '# Shared comments'
		const [artifact] = await db
			.insert(artifacts)
			.values({
				task_id: task.id,
				organization_id: org.id,
				resource_owner_user_id: ownerId,
				created_by: ownerId,
				file_name: 'comments.md',
				content,
				content_hash: hash(content),
				share_key: shareKey,
				share_enabled: true,
				public_permission: 'comment',
			})
			.returning()
		if (!artifact) throw new Error('Could not seed artifact')
		artifactId = artifact.id
		const [oldVersion, currentVersion] = await db
			.insert(artifactVersions)
			.values([
				{
					artifact_id: artifact.id,
					task_id: task.id,
					resource_owner_user_id: ownerId,
					organization_id: org.id,
					content: '# Old',
					content_hash: hash('# Old'),
					created_by: ownerId,
					version_number: 1,
				},
				{
					artifact_id: artifact.id,
					task_id: task.id,
					resource_owner_user_id: ownerId,
					organization_id: org.id,
					content,
					content_hash: hash(content),
					created_by: ownerId,
					version_number: 2,
				},
			])
			.returning()
		if (!oldVersion || !currentVersion) throw new Error('Could not seed versions')
		currentVersionId = currentVersion.id
		const base = {
			artifact_id: artifact.id,
			task_id: task.id,
			organization_id: org.id,
			resource_owner_user_id: ownerId,
			created_by_user_id: ownerId,
			content_text: 'Review this',
			anchor_json: anchor,
		}
		const [current] = await db
			.insert(artifactComments)
			.values([
				{ ...base, created_at_artifact_version_id: currentVersion.id },
				{ ...base, created_at_artifact_version_id: oldVersion.id },
				{ ...base, created_at_artifact_version_id: currentVersion.id, is_deleted: true },
			])
			.returning()
		if (!current) throw new Error('Could not seed comments')
		currentCommentId = current.id

		const workos = Layer.succeed(
			WorkosService,
			makeTestWorkosService({
				getUser: ({ userId }) =>
					Effect.succeed({
						userId,
						email: 'owner@example.test',
						firstName: 'Ada',
						lastName: 'Lovelace',
						avatarUrl: 'https://example.test/ada.png',
					}),
			}),
		)
		runtime = createRuntimeWithTestPostgresLayer(db, { workos })
	}, 60_000)

	afterAll(async () => {
		await runtime?.dispose()
		await cleanup?.()
	})

	test('returns display-safe visible authors', async () => {
		const context = createMockApiContext({ auth: null, services: { db, dbReadReplica: db } })
		const authors = await call(bindProcedureToRuntime(liveAuthors, runtime), { artifactId, shareKey }, { context })
		expect(authors).toEqual({
			authors: [
				{
					userId: ownerId,
					displayName: 'Ada Lovelace',
					avatarUrl: 'https://example.test/ada.png',
				},
			],
		})
		expect(JSON.stringify(authors)).not.toContain('owner@example.test')
	})

	test('rejects a wrong capability', async () => {
		const context = createMockApiContext({ auth: null, services: { db, dbReadReplica: db } })
		await expect(
			call(bindProcedureToRuntime(liveAuthors, runtime), { artifactId, shareKey: 'wrong' }, { context }),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
	})

	test('allows organization members to inspect a guest email', async () => {
		const guestId = uuidv7()
		const commentId = uuidv7()
		await call(
			bindProcedureToRuntime(liveCreate, runtime),
			{
				artifactId,
				shareKey,
				id: commentId,
				contentText: 'Private identity review',
				anchorJson: anchor,
				guestIdentity: {
					anonymousAuthorId: guestId,
					guestName: 'Private guest',
					guestEmail: 'private@example.test',
				},
			},
			{
				context: {
					...createMockApiContext({ auth: null, services: { db, dbReadReplica: db } }),
					requestIp: `identity-${guestId}`,
				},
			},
		)

		const ownerContext = createMockApiContext({
			auth: createMockApiAuth({ userId: ownerId, organizationId }),
			services: { db, dbReadReplica: db },
		})
		await expect(
			call(bindProcedureToRuntime(liveGuestIdentity, runtime), { commentId }, { context: ownerContext }),
		).resolves.toEqual({ name: 'Private guest', email: 'private@example.test', unverified: true })

		const editorContext = createMockApiContext({
			auth: createMockApiAuth({ userId: 'non-owner-editor', organizationId }),
			services: { db, dbReadReplica: db },
		})
		await expect(
			call(bindProcedureToRuntime(liveGuestIdentity, runtime), { commentId }, { context: editorContext }),
		).resolves.toEqual({ name: 'Private guest', email: 'private@example.test', unverified: true })

		const otherOrganizationContext = createMockApiContext({
			auth: createMockApiAuth({ userId: 'other-member', organizationId: uuidv7() }),
			services: { db, dbReadReplica: db },
		})
		await expect(
			call(
				bindProcedureToRuntime(liveGuestIdentity, runtime),
				{ commentId },
				{ context: otherOrganizationContext },
			),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
	})

	test('stores every public comment as a guest, even from a signed-in caller', async () => {
		const guestId = uuidv7()
		const guestCommentId = uuidv7()
		await call(
			bindProcedureToRuntime(liveCreate, runtime),
			{
				artifactId,
				shareKey,
				id: guestCommentId,
				contentText: 'Guest review',
				anchorJson: anchor,
				guestIdentity: {
					anonymousAuthorId: guestId,
					guestName: 'Grace Hopper',
					guestEmail: 'grace@example.test',
				},
			},
			{
				context: {
					...createMockApiContext({ auth: null, services: { db, dbReadReplica: db } }),
					requestIp: `guest-${guestId}`,
				},
			},
		)
		const [guestComment] = await db.select().from(artifactComments).where(eq(artifactComments.id, guestCommentId))
		const [guest] = await db
			.select()
			.from(anonymousArtifactCommenters)
			.where(
				and(
					eq(anonymousArtifactCommenters.id, guestId),
					eq(anonymousArtifactCommenters.artifact_id, artifactId),
				),
			)
		expect(guestComment).toMatchObject({
			created_by_user_id: null,
			anonymous_author_id: guestId,
			anonymous_guest_name: 'Grace Hopper',
			created_via_public_share: true,
			created_at_artifact_version_id: currentVersionId,
		})
		expect(guest).toMatchObject({ display_name: 'Grace Hopper', email: 'grace@example.test' })

		const signedGuestId = uuidv7()
		const signedCommentId = uuidv7()
		const signed = await call(
			bindProcedureToRuntime(liveCreate, runtime),
			{
				artifactId,
				shareKey,
				id: signedCommentId,
				contentText: 'Signed review',
				anchorJson: anchor,
				guestIdentity: {
					anonymousAuthorId: signedGuestId,
					guestName: 'Signed Outsider',
					guestEmail: 'outsider@example.test',
				},
			},
			{
				context: {
					...createMockApiContext({
						auth: { userId: 'external-signed-user' },
						services: { db, dbReadReplica: db },
					}),
					requestIp: `signed-${signedCommentId}`,
				},
			},
		)
		const [signedComment] = await db.select().from(artifactComments).where(eq(artifactComments.id, signedCommentId))
		expect(signedComment).toMatchObject({
			created_by_user_id: null,
			anonymous_author_id: signedGuestId,
			anonymous_guest_name: 'Signed Outsider',
			created_via_public_share: true,
		})
		expect(signed.undoToken).toEqual(expect.any(String))
	})

	test('rejects guest identity mutation and view-only capabilities', async () => {
		const guestId = uuidv7()
		const input = {
			artifactId,
			shareKey,
			contentText: 'First identity use',
			anchorJson: anchor,
			guestIdentity: { anonymousAuthorId: guestId, guestName: 'Original name' },
		}
		const context = {
			...createMockApiContext({ auth: null, services: { db, dbReadReplica: db } }),
			requestIp: guestId,
		}
		await call(bindProcedureToRuntime(liveCreate, runtime), input, { context })
		await expect(
			call(
				bindProcedureToRuntime(liveCreate, runtime),
				{ ...input, guestIdentity: { ...input.guestIdentity, guestName: 'Changed name' } },
				{ context },
			),
		).rejects.toMatchObject({ code: 'GUEST_IDENTITY_CONFLICT' })

		await db.update(artifacts).set({ public_permission: 'view' }).where(eq(artifacts.id, artifactId))
		await expect(
			call(bindProcedureToRuntime(liveCreate, runtime), { ...input, id: uuidv7() }, { context }),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
		await db.update(artifacts).set({ public_permission: 'comment' }).where(eq(artifacts.id, artifactId))
	})

	test('attaches a reply to the root, reopens the whole thread, and records the version', async () => {
		const memberId = uuidv7()
		await db.insert(artifactComments).values({
			id: memberId,
			artifact_id: artifactId,
			task_id: taskId,
			organization_id: organizationId,
			resource_owner_user_id: ownerId,
			created_by_user_id: ownerId,
			content_text: 'Earlier reply',
			reply_to_comment_id: currentCommentId,
		})
		await db
			.update(artifactComments)
			.set({ is_resolved: true, resolved_by_user_id: ownerId })
			.where(inArray(artifactComments.id, [currentCommentId, memberId]))
		const replyId = uuidv7()
		await call(
			bindProcedureToRuntime(liveCreate, runtime),
			{
				artifactId,
				shareKey,
				rootCommentId: memberId,
				id: replyId,
				contentText: 'Public reply',
				guestIdentity: { anonymousAuthorId: uuidv7(), guestName: 'Reply guest' },
			},
			{
				context: {
					...createMockApiContext({ auth: null, services: { db, dbReadReplica: db } }),
					requestIp: replyId,
				},
			},
		)
		const thread = await db
			.select()
			.from(artifactComments)
			.where(inArray(artifactComments.id, [currentCommentId, memberId]))
		const [reply] = await db.select().from(artifactComments).where(eq(artifactComments.id, replyId))
		expect(thread).toHaveLength(2)
		expect(thread.every((row) => !row.is_resolved && row.resolved_by_user_id === null)).toBe(true)
		expect(reply).toMatchObject({
			reply_to_comment_id: currentCommentId,
			anchor_json: null,
			kind: 'comment',
			created_at_artifact_version_id: currentVersionId,
		})
	})

	test('issues a one-use anonymous undo capability without persisting the raw token', async () => {
		const commentId = uuidv7()
		const guestId = uuidv7()
		const context = {
			...createMockApiContext({ auth: null, services: { db, dbReadReplica: db } }),
			requestIp: commentId,
		}
		const created = await call(
			bindProcedureToRuntime(liveCreate, runtime),
			{
				artifactId,
				shareKey,
				rootCommentId: currentCommentId,
				id: commentId,
				contentText: 'Undo this',
				guestIdentity: { anonymousAuthorId: guestId, guestName: 'Undo guest' },
			},
			{ context },
		)
		expect(created.undoToken).toEqual(expect.any(String))
		expect(created.undoExpiresAt).toBeGreaterThan(Date.now())
		const [authorization] = await db
			.select()
			.from(publicCommentUndoAuthorizations)
			.where(eq(publicCommentUndoAuthorizations.comment_id, commentId))
		expect(authorization?.token_digest).not.toBe(created.undoToken)

		await call(
			bindProcedureToRuntime(liveUndo, runtime),
			{ artifactId, shareKey, commentId, undoToken: created.undoToken! },
			{ context },
		)
		await expect(
			call(
				bindProcedureToRuntime(liveUndo, runtime),
				{ artifactId, shareKey, commentId, undoToken: created.undoToken! },
				{ context },
			),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })

		const [comment] = await db.select().from(artifactComments).where(eq(artifactComments.id, commentId))
		expect(comment?.is_deleted).toBe(true)
	})

	test('rejects expired undo and undoing a root after another author replies', async () => {
		const guestId = uuidv7()
		const rootId = uuidv7()
		const context = {
			...createMockApiContext({ auth: null, services: { db, dbReadReplica: db } }),
			requestIp: rootId,
		}
		const root = await call(
			bindProcedureToRuntime(liveCreate, runtime),
			{
				artifactId,
				shareKey,
				id: rootId,
				contentText: 'Guest root with reply',
				anchorJson: anchor,
				guestIdentity: { anonymousAuthorId: guestId, guestName: 'Root guest' },
			},
			{ context },
		)
		await call(
			bindProcedureToRuntime(liveCreate, runtime),
			{
				artifactId,
				shareKey,
				rootCommentId: rootId,
				id: uuidv7(),
				contentText: 'Another author replied',
				guestIdentity: { anonymousAuthorId: uuidv7(), guestName: 'Other guest' },
			},
			{
				context: {
					...createMockApiContext({ auth: null, services: { db, dbReadReplica: db } }),
					requestIp: uuidv7(),
				},
			},
		)
		await expect(
			call(
				bindProcedureToRuntime(liveUndo, runtime),
				{ artifactId, shareKey, commentId: rootId, undoToken: root.undoToken! },
				{ context },
			),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' })

		const replyId = uuidv7()
		const expired = await call(
			bindProcedureToRuntime(liveCreate, runtime),
			{
				artifactId,
				shareKey,
				rootCommentId: currentCommentId,
				id: replyId,
				contentText: 'Expired undo',
				guestIdentity: { anonymousAuthorId: guestId, guestName: 'Root guest' },
			},
			{ context: { ...context, requestIp: replyId } },
		)
		await db
			.update(publicCommentUndoAuthorizations)
			.set({ expires_at: 0n })
			.where(eq(publicCommentUndoAuthorizations.comment_id, replyId))
		await expect(
			call(
				bindProcedureToRuntime(liveUndo, runtime),
				{ artifactId, shareKey, commentId: replyId, undoToken: expired.undoToken! },
				{ context },
			),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })
	})

	test('denies guest comments, undo, and authors while the org disallows public links', async () => {
		const commentId = uuidv7()
		const context = {
			...createMockApiContext({ auth: null, services: { db, dbReadReplica: db } }),
			requestIp: commentId,
		}
		const created = await call(
			bindProcedureToRuntime(liveCreate, runtime),
			{
				artifactId,
				shareKey,
				rootCommentId: currentCommentId,
				id: commentId,
				contentText: 'Written before the org turned links off',
				guestIdentity: { anonymousAuthorId: uuidv7(), guestName: 'Org policy guest' },
			},
			{ context },
		)

		// Leave the artifact row shared so only the org policy can deny access.
		await db
			.insert(organizationSettings)
			.values({ organization_id: organizationId, enable_creating_publicly_shareable_links: false })
		try {
			await expect(
				call(
					bindProcedureToRuntime(liveCreate, runtime),
					{
						artifactId,
						shareKey,
						rootCommentId: currentCommentId,
						contentText: 'Should be denied',
						guestIdentity: { anonymousAuthorId: uuidv7(), guestName: 'Denied guest' },
					},
					{ context: { ...context, requestIp: uuidv7() } },
				),
			).rejects.toMatchObject({ code: 'NOT_FOUND' })
			await expect(
				call(
					bindProcedureToRuntime(liveUndo, runtime),
					{ artifactId, shareKey, commentId, undoToken: created.undoToken! },
					{ context },
				),
			).rejects.toMatchObject({ code: 'NOT_FOUND' })
			await expect(
				call(bindProcedureToRuntime(liveAuthors, runtime), { artifactId, shareKey }, { context }),
			).rejects.toMatchObject({ code: 'NOT_FOUND' })
		} finally {
			await db.delete(organizationSettings).where(eq(organizationSettings.organization_id, organizationId))
		}
	})

	test('rate limits by request IP and artifact even when guest identity changes', async () => {
		const context = {
			...createMockApiContext({ auth: null, services: { db, dbReadReplica: db } }),
			requestIp: `rate-${uuidv7()}`,
		}
		const anchorJson = anchor
		for (let index = 0; index < 10; index += 1) {
			await call(
				bindProcedureToRuntime(liveCreate, runtime),
				{
					artifactId,
					shareKey,
					contentText: `Rate comment ${index}`,
					anchorJson,
					guestIdentity: { anonymousAuthorId: uuidv7(), guestName: `Guest ${index}` },
				},
				{ context },
			)
		}
		await expect(
			call(
				bindProcedureToRuntime(liveCreate, runtime),
				{
					artifactId,
					shareKey,
					contentText: 'One too many',
					anchorJson,
					guestIdentity: { anonymousAuthorId: uuidv7(), guestName: 'Another guest' },
				},
				{ context },
			),
		).rejects.toMatchObject({ code: 'PUBLIC_COMMENT_RATE_LIMITED' })
	})
})
