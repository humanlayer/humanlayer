import { requireEnvironment } from './environment'

// Lazy-loaded values (loaded on first use to avoid requiring env vars at module load)
let _jiraClientId: string | null = null
let _jiraClientSecret: string | null = null

export function getJiraClientId(): string {
	if (!_jiraClientId) {
		_jiraClientId = requireEnvironment('JIRA_CLIENT_ID')
	}
	return _jiraClientId
}

export function getJiraClientSecret(): string {
	if (!_jiraClientSecret) {
		_jiraClientSecret = requireEnvironment('JIRA_CLIENT_SECRET')
	}
	return _jiraClientSecret
}

export function getJiraOAuthRedirectUrl(): string {
	const override = process.env.JIRA_OAUTH_REDIRECT_URL
	if (override) return override

	const apiOrigin = requireEnvironment(
		'RIPTIDE_API_ORIGIN',
		process.env.VITE_PUBLIC_RIPTIDE_API_ORIGIN ?? 'http://localhost:8700',
	)
	const url = new URL(apiOrigin)
	url.pathname = '/integrations/jira/callback'
	url.search = ''
	url.hash = ''
	return url.toString()
}
