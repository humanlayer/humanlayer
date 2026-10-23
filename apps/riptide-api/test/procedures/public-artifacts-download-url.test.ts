import { randomUUID } from 'node:crypto'

import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { organizations } from '@humanlayer/db/tables/organizations'
import { call, ORPCError } from '@orpc/server'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { hash } from 'ohash'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { sharedArtifactDownloadUrlProcedure } from '../../src/orpc/api/public/artifacts/download-url'
import { createMockApiContext } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const uuid = () => randomUUID() as `${string}-${string}-${string}-${string}-${string}`

describe('public shared artifact download url', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string

	beforeAll(async () => {
		const testDb = await createTestDb('public_artifacts_download_url')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'Share Org', workos_organization_id: 'workos-share-download' })
			.returning()
		if (!org) throw new Error('Failed to create organization')
		organizationId = org.id
	}, 60000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	const context = () => createMockApiContext({ auth: null, services: { db, dbReadReplica: db } })

	test('returns a presigned URL for a shared S3 artifact', async () => {
		const shareKey = uuid()
		const [s3Artifact] = await db
			.insert(artifacts)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: 'artifact-owner',
				file_name: 'walkthrough.html',
				content: '',
				content_hash: hash(''),
				created_by: 'artifact-owner',
				storage_type: 's3',
				s3_key: 'org/artifact/walkthrough.html',
				content_type: 'text/html',
				share_key: shareKey,
				share_enabled: true,
			})
			.returning()
		if (!s3Artifact) throw new Error('Failed to create s3 artifact')

		const result = await call(
			sharedArtifactDownloadUrlProcedure,
			{ artifactId: s3Artifact.id, shareKey },
			{ context: context() },
		)

		expect(result.downloadUrl).toBe('https://mock-s3.example.com/download/org/artifact/walkthrough.html')
	})

	test('throws NOT_FOUND for an invalid share key', async () => {
		const shareKey = uuid()
		const [s3Artifact] = await db
			.insert(artifacts)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: 'artifact-owner',
				file_name: 'invalid-key.html',
				content: '',
				content_hash: hash(''),
				created_by: 'artifact-owner',
				storage_type: 's3',
				s3_key: 'org/artifact/invalid-key.html',
				share_enabled: true,
			})
			.returning()
		if (!s3Artifact) throw new Error('Failed to create s3 artifact')

		try {
			await call(
				sharedArtifactDownloadUrlProcedure,
				{ artifactId: s3Artifact.id, shareKey },
				{ context: context() },
			)
			expect.unreachable('Expected NOT_FOUND')
		} catch (error) {
			expect(error).toBeInstanceOf(ORPCError)
			expect((error as ORPCError<any, any>).code).toBe('NOT_FOUND')
		}
	})

	test('throws NOT_FOUND for a nonexistent artifact', async () => {
		const shareKey = uuid()

		try {
			await call(sharedArtifactDownloadUrlProcedure, { artifactId: uuid(), shareKey }, { context: context() })
			expect.unreachable('Expected NOT_FOUND')
		} catch (error) {
			expect(error).toBeInstanceOf(ORPCError)
			expect((error as ORPCError<any, any>).code).toBe('NOT_FOUND')
		}
	})

	test('throws BAD_REQUEST for a Postgres-stored artifact', async () => {
		const shareKey = uuid()
		const content = '# Shared markdown'
		const [postgresArtifact] = await db
			.insert(artifacts)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: 'artifact-owner',
				file_name: 'notes.md',
				content,
				content_hash: hash(content),
				created_by: 'artifact-owner',
				share_key: shareKey,
				share_enabled: true,
			})
			.returning()
		if (!postgresArtifact) throw new Error('Failed to create postgres artifact')

		try {
			await call(
				sharedArtifactDownloadUrlProcedure,
				{ artifactId: postgresArtifact.id, shareKey },
				{ context: context() },
			)
			expect.unreachable('Expected BAD_REQUEST')
		} catch (error) {
			expect(error).toBeInstanceOf(ORPCError)
			expect((error as ORPCError<any, any>).code).toBe('BAD_REQUEST')
		}
	})

	test('throws NOT_FOUND while the org disallows public links', async () => {
		const [policyOrg] = await db
			.insert(organizations)
			.values({ name: 'Links off org', workos_organization_id: 'workos-share-download-links-off' })
			.returning()
		if (!policyOrg) throw new Error('Failed to create organization')
		await db
			.insert(organizationSettings)
			.values({ organization_id: policyOrg.id, enable_creating_publicly_shareable_links: false })
		const shareKey = uuid()
		// Leave the artifact row shared so only the org policy can deny access.
		const [shared] = await db
			.insert(artifacts)
			.values({
				organization_id: policyOrg.id,
				resource_owner_user_id: 'artifact-owner',
				file_name: 'links-off.html',
				content: '',
				content_hash: hash(''),
				created_by: 'artifact-owner',
				storage_type: 's3',
				s3_key: 'org/artifact/links-off.html',
				share_key: shareKey,
				share_enabled: true,
			})
			.returning()
		if (!shared) throw new Error('Failed to create shared artifact')

		try {
			await call(sharedArtifactDownloadUrlProcedure, { artifactId: shared.id, shareKey }, { context: context() })
			expect.unreachable('Expected NOT_FOUND')
		} catch (error) {
			expect(error).toBeInstanceOf(ORPCError)
			expect((error as ORPCError<any, any>).code).toBe('NOT_FOUND')
		}
	})

	test('throws NOT_FOUND when sharing is disabled', async () => {
		const disabledKey = uuid()
		const [disabled] = await db
			.insert(artifacts)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: 'artifact-owner',
				file_name: 'disabled.html',
				content: '',
				content_hash: hash(''),
				created_by: 'artifact-owner',
				storage_type: 's3',
				s3_key: 'org/artifact/disabled.html',
				share_key: disabledKey,
				share_enabled: false,
			})
			.returning()
		if (!disabled) throw new Error('Failed to create disabled artifact')

		try {
			await call(
				sharedArtifactDownloadUrlProcedure,
				{ artifactId: disabled.id, shareKey: disabledKey },
				{ context: context() },
			)
			expect.unreachable('Expected NOT_FOUND')
		} catch (error) {
			expect(error).toBeInstanceOf(ORPCError)
			expect((error as ORPCError<any, any>).code).toBe('NOT_FOUND')
		}
	})
})
