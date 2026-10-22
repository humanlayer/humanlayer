import type { PullRequestRowType } from '@humanlayer/streams/pr-status'

import type { GitHubPanelState } from './panel-state'

/**
 * Whether a branch may be offered a pull request. Only `live` counts: it is the one state where
 * GitHub was asked and answered. Under `recorded` and `unavailable` an absent pull request is an
 * absence of information, and offering the control there opens a second pull request on a branch
 * that already has one.
 */
export const offersOpenPullRequest = (
	state: GitHubPanelState,
	hasPullRequest: boolean,
	pullRequest: PullRequestRowType | null,
): boolean => state === 'live' && !hasPullRequest && pullRequest === null

/** The GitHub tab also offers one after the branch's pull request merged: later work on the branch needs a new one. */
export const offersOpenPullRequestInPanel = (
	state: GitHubPanelState,
	hasPullRequest: boolean,
	pullRequest: PullRequestRowType | null,
): boolean =>
	offersOpenPullRequest(state, hasPullRequest, pullRequest) || (state === 'live' && pullRequest?.state === 'merged')
