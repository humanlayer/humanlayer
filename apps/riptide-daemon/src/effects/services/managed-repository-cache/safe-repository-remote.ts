import { Data, Effect } from 'effect'

export class RepositoryRemoteCredentialsRejected extends Data.TaggedError('RepositoryRemoteCredentialsRejected')<{
	readonly message: string
}> {}

interface RepositoryRemoteInput {
	readonly remoteUrl: string
}

export const assertSafeRepositoryRemote = Effect.fn('repository_remote.assert_safe')(function* (
	input: RepositoryRemoteInput,
) {
	if (/^https?:\/\/[^/?#]*@/i.test(input.remoteUrl.trim())) {
		return yield* new RepositoryRemoteCredentialsRejected({
			message: 'HTTP repository URLs must not contain credentials; configure a Git credential helper instead',
		})
	}
})
