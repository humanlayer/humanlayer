import { publicArtifactSelectSchema } from '@humanlayer/db/tables/artifacts'
import { DEFAULT_BACKOFF_OPTIONS } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'
import { BasicIndex } from '@tanstack/db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { createCollection } from '@tanstack/react-db'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Schema from 'effect/Schema'
import { useRef, useState } from 'react'

import { VITE_PUBLIC_SYNC_ORIGIN } from '@/collections/config'
import { useMountEffect } from '@/hooks/useMountEffect'
import { logger } from '@/lib/logger'

const ElectricFetchError = Schema.Struct({
	name: Schema.Literal('FetchError'),
	status: Schema.Finite,
	url: Schema.String,
})

export function createSharedArtifactCollection(input: { artifactId: string; shareKey: string }) {
	return createCollection(
		electricCollectionOptions({
			schema: publicArtifactSelectSchema,
			shapeOptions: {
				url: `${VITE_PUBLIC_SYNC_ORIGIN}/v1/shared/artifacts/${input.artifactId}`,
				subsetMethod: 'POST',
				headers: { 'x-share-key': input.shareKey },
				onError: (error) => {
					const fetchError = Option.getOrUndefined(Schema.decodeUnknownOption(ElectricFetchError)(error))
					if (fetchError && [401, 403, 404].includes(fetchError.status)) return
					if (fetchError?.status === 409) return {}
					const failure = Predicate.isError(error)
						? error
						: new Error('Could not synchronize the shared artifact', { cause: error })
					logger.error('Shared artifact synchronization failed', error)
					Sentry.captureException(failure, { tags: { collection: 'shared-artifact' } })
				},
				backoffOptions: { ...DEFAULT_BACKOFF_OPTIONS, maxRetries: 3 },
			},
			autoIndex: 'eager',
			defaultIndexType: BasicIndex,
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export type SharedArtifactCollection = ReturnType<typeof createSharedArtifactCollection>

export function useSharedArtifactCollection(input: { artifactId: string; shareKey: string }) {
	const [collection] = useState(() => createSharedArtifactCollection(input))
	const mounted = useRef(false)
	useMountEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
			queueMicrotask(() => {
				if (!mounted.current) void collection.cleanup()
			})
		}
	})
	return collection
}
