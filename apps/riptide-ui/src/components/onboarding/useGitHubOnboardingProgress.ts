import { useGitHubStatus } from '@/hooks/useGitHubStatus'

import type { GitHubProgress } from './onboarding-progress'

/** Only an organization admin can install the GitHub App, so only an admin gets the step. */
export function useGitHubOnboardingProgress(): GitHubProgress {
	const github = useGitHubStatus()
	if (github === null || !github.isAdmin) return 'hidden'
	return github.status === 'connected' ? 'complete' : 'incomplete'
}
