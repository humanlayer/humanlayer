import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'

import { DaemonStartError } from './daemon.errors'

/**
 * Parse the renderer-supplied Claude path once, at the RPC boundary.
 *
 * A null (or empty) path means "no explicit selection": the daemon falls back
 * to discovering Claude on PATH, so we return null and let it decide. A present
 * path is strict — it must be absolute and point at a file that exists right
 * now, so the launch fails here with a clear error instead of much later inside
 * the daemon. Downstream code receives a plain `string | null` and never
 * re-validates it.
 */
export const parseVerifiedClaudePath = Effect.fn('daemon.parse_verified_claude_path')(function* (
	verifiedClaudePath: string | null,
) {
	if (!verifiedClaudePath) return null
	const path = yield* Path.Path
	if (!path.isAbsolute(verifiedClaudePath)) {
		return yield* Effect.fail(new DaemonStartError({ message: 'Verified Claude path must be absolute' }))
	}
	const fileSystem = yield* FileSystem.FileSystem
	yield* fileSystem
		.access(verifiedClaudePath)
		.pipe(
			Effect.mapError(
				() =>
					new DaemonStartError({ message: `Claude was not found at the exact path: ${verifiedClaudePath}` }),
			),
		)
	return verifiedClaudePath
})
