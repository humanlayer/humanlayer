import { normalizeRepositoryIdentity } from '@humanlayer/schemas/effect/project-workspace'
import { Effect, Exit, FileSystem, Path } from 'effect'

import {
	ManagedRepositoryCacheError,
	type ManagedRepositoryInput,
	type PrepareManagedRepositoryInput,
} from './managed-repository-cache.service'
import { RepositorySourceContext } from './repository-source-context'
import { observeRepositorySourceFailure, runRepositoryGit, validateRepositoryCheckout } from './repository-source-git'
import { assertSafeRepositoryRemote } from './safe-repository-remote'

interface CompletedRepositoryAttemptInput extends ManagedRepositoryInput {
	readonly attemptDirectory: string
	readonly destinationPath: string
}

export const repositoryPath = Effect.fn('repository_source.repository_path')(function* (input: ManagedRepositoryInput) {
	const { root } = yield* RepositorySourceContext
	const path = yield* Path.Path
	yield* assertSafeRepositoryRemote(input).pipe(
		Effect.catchTag('RepositoryRemoteCredentialsRejected', (error) =>
			Effect.fail(
				new ManagedRepositoryCacheError({
					message: error.message,
					repositoryIdentity: input.repositoryIdentity,
					path: root,
				}),
			),
		),
	)
	const segments = input.repositoryIdentity.split('/')
	if (
		segments.length < 2 ||
		!/^[a-z0-9][a-z0-9.-]*$/.test(segments[0] ?? '') ||
		normalizeRepositoryIdentity(input.remoteUrl) !== input.repositoryIdentity ||
		segments.some((segment) => segment === '.' || segment === '..' || !/^[a-zA-Z0-9._~-]+$/.test(segment))
	) {
		return yield* new ManagedRepositoryCacheError({
			message: 'Managed repository identity cannot be mapped to a cache path',
			repositoryIdentity: input.repositoryIdentity,
			path: root,
		})
	}
	return path.join(
		root,
		...segments.map((segment) =>
			segment
				.toLowerCase()
				.replace(/~/g, '~7e')
				.replace(/^\.(?=repository$)/, '~2e'),
		),
		'.repository',
	)
})

const validatePublication = Effect.fn('repository_source.validate_publication')(function* (
	input: CompletedRepositoryAttemptInput,
) {
	const fs = yield* FileSystem.FileSystem
	if (!(yield* fs.exists(input.destinationPath)))
		return yield* new ManagedRepositoryCacheError({
			message: 'Unable to publish the managed repository checkout; completed attempt retained for retry',
			repositoryIdentity: input.repositoryIdentity,
			path: input.destinationPath,
		})
	yield* validateRepositoryCheckout({ ...input, path: input.destinationPath })
})

const publishCompletedAttempt = Effect.fn('repository_source.publish_completed_attempt')(function* (
	input: CompletedRepositoryAttemptInput,
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const checkout = path.join(input.attemptDirectory, 'checkout')
	return yield* Effect.gen(function* () {
		yield* validateRepositoryCheckout({ ...input, path: checkout })
		// Nonempty Git directories cannot replace an already-published checkout.
		yield* fs.rename(checkout, input.destinationPath)
	}).pipe(
		observeRepositorySourceFailure,
		Effect.catchTags({
			PlatformError: () => validatePublication(input),
			ManagedRepositoryCacheError: () => validatePublication(input),
		}),
	)
})

export const prepareRepositorySource = Effect.fn('repository_source.prepare')(function* (
	input: PrepareManagedRepositoryInput,
) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const { root, cloneTimeout, gitEnvironment } = yield* RepositorySourceContext
	const canonicalPath = yield* repositoryPath(input)
	const destination = input.sourcePath ?? canonicalPath
	if (!path.isAbsolute(destination))
		return yield* new ManagedRepositoryCacheError({
			message: 'Managed source path is not absolute',
			repositoryIdentity: input.repositoryIdentity,
			path: destination,
		})
	if (yield* fs.exists(destination)) return yield* validateRepositoryCheckout({ ...input, path: destination })
	if (destination !== canonicalPath)
		return yield* new ManagedRepositoryCacheError({
			message: 'Persisted managed source no longer exists',
			repositoryIdentity: input.repositoryIdentity,
			path: destination,
		})
	yield* fs.makeDirectory(path.dirname(destination), { recursive: true })
	const attempts = yield* fs.readDirectory(root)
	for (const name of attempts.filter((name) => name.startsWith('.clone-')).sort()) {
		const attemptDirectory = path.join(root, name)
		const marker = path.join(attemptDirectory, 'completed')
		const identity = yield* Effect.gen(function* () {
			if (!(yield* fs.exists(marker))) return undefined
			return yield* fs.readFileString(marker)
		}).pipe(
			observeRepositorySourceFailure,
			Effect.catchTag('PlatformError', (error) =>
				Effect.gen(function* () {
					if (!(yield* fs.exists(marker))) return undefined
					return yield* error
				}),
			),
		)
		if (identity !== input.repositoryIdentity) continue
		yield* publishCompletedAttempt({ ...input, attemptDirectory, destinationPath: destination })
		return destination
	}
	if (yield* fs.exists(destination)) return yield* validateRepositoryCheckout({ ...input, path: destination })
	yield* Effect.acquireUseRelease(
		fs.makeTempDirectory({ directory: root, prefix: '.clone-' }),
		(attemptDirectory) =>
			Effect.gen(function* () {
				const checkout = path.join(attemptDirectory, 'checkout')
				yield* runRepositoryGit({
					...input,
					path: path.dirname(destination),
					argv: ['clone', '--no-checkout', input.remoteUrl, checkout],
					options: { env: gitEnvironment, timeout: cloneTimeout, nonInteractive: true },
				})
				yield* validateRepositoryCheckout({ ...input, path: checkout })
				// Marker visibility transfers permission to publish, never permission to delete another attempt.
				const temporaryMarker = path.join(attemptDirectory, 'completed.tmp')
				yield* fs.writeFileString(temporaryMarker, input.repositoryIdentity)
				yield* Effect.scoped(
					Effect.gen(function* () {
						const marker = yield* fs.open(temporaryMarker, { flag: 'r+' })
						yield* marker.sync
					}),
				)
				yield* fs.rename(temporaryMarker, path.join(attemptDirectory, 'completed'))
				yield* publishCompletedAttempt({ ...input, attemptDirectory, destinationPath: destination })
			}),
		(attemptDirectory, exit) =>
			Effect.gen(function* () {
				if (
					!Exit.isSuccess(exit) &&
					(yield* fs.exists(path.join(attemptDirectory, 'completed'))) &&
					(yield* fs.exists(path.join(attemptDirectory, 'checkout')))
				)
					return
				yield* fs.remove(attemptDirectory, { recursive: true, force: true })
			}).pipe(observeRepositorySourceFailure, Effect.ignore),
	)
	return destination
})
