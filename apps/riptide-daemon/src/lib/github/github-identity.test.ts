import { Effect, Layer } from 'effect'
import { describe, expect, test } from 'vitest'

import type { ORPCClient } from '@/orpc/client'

import { GithubAccess, type GithubAccessService } from './github-access.service'
import { captureGithubIdentity } from './github-identity'
import { GithubUnavailableError } from './github.errors'
import type { GithubViewer } from './github.types'

const makeLayer = (fetchViewer: GithubAccessService['fetchViewer']) =>
	Layer.succeed(GithubAccess, {
		isAvailable: Effect.succeed(true),
		isAuthBroken: Effect.succeed(false),
		resetAuthLatches: Effect.void,
		fetchViewer,
	})

const makeOrpcFake = (opts?: { reject?: boolean }) => {
	const reports: unknown[] = []
	const orpc = {
		users: {
			setGithubIdentity: (input: unknown) => {
				if (opts?.reject) return Promise.reject(new Error('api down'))
				reports.push(input)
				return Promise.resolve({ ok: true })
			},
		},
	} as unknown as ORPCClient
	return { orpc, reports }
}

describe('captureGithubIdentity', () => {
	const run = (orpc: ORPCClient, fetchViewer: GithubAccessService['fetchViewer']) =>
		Effect.runPromise(captureGithubIdentity(orpc).pipe(Effect.provide(makeLayer(fetchViewer))))

	test('reports the viewer identity: numeric id becomes externalId, email passes through', async () => {
		const { orpc, reports } = makeOrpcFake()
		const viewer: GithubViewer = { login: 'octocat', id: 583231, email: 'octo@example.com' }

		await run(orpc, () => Effect.succeed(viewer))

		expect(reports).toEqual([{ login: 'octocat', externalId: '583231', email: 'octo@example.com' }])
	})

	test('a null email (token without email scope) is omitted, not sent', async () => {
		const { orpc, reports } = makeOrpcFake()

		await run(orpc, () => Effect.succeed({ login: 'octocat', id: 583231, email: null }))

		expect(reports).toEqual([{ login: 'octocat', externalId: '583231', email: undefined }])
	})

	test('skips quietly when no GitHub backend is usable — no report attempted', async () => {
		const { orpc, reports } = makeOrpcFake()

		await run(orpc, () => Effect.fail(new GithubUnavailableError({ operation: 'fetch_viewer' })))

		expect(reports).toHaveLength(0)
	})

	test('skips when the viewer carries no usable login/id', async () => {
		const { orpc, reports } = makeOrpcFake()

		await run(orpc, () => Effect.succeed({ login: '', id: undefined }))

		expect(reports).toHaveLength(0)
	})

	test('a failed identity report is swallowed — the startup hook never rejects', async () => {
		const { orpc } = makeOrpcFake({ reject: true })

		await expect(run(orpc, () => Effect.succeed({ login: 'octocat', id: 583231 }))).resolves.toBeUndefined()
	})
})
