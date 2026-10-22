import { Layer } from 'effect'

import { GitCliLive } from './git-cli.service'
import { GithubAccessLive } from './github-access.service'

/**
 * The GitHub access services, provided once by `createDaemonRuntime`. The per-backend auth
 * latches and the gh availability cache live inside {@link GithubAccessLive}'s layer state, so
 * the identity probe, the refresh loop, and the post-run PR scan all share one latch: a
 * credential the probe finds broken stays skipped until the refresh loop resets it.
 */
export const GithubRuntimeLive = Layer.provideMerge(GithubAccessLive, GitCliLive)
