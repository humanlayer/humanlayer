/**
 * Turning what a checkout or an API says about a repository into the one spelling everything else
 * keys on: a lowercased `owner/repo`. Nothing here is specific to pull requests.
 */

// `git@github.com:owner/repo` is scp syntax, not a URL, so it needs an explicit scheme before
// `URL` will accept it.
const scpSyntaxToSshUrl = (remote: string): string =>
	/^[a-z][a-z0-9+.-]*:\/\//i.test(remote) ? remote : `ssh://${remote.replace(':', '/')}`

/** `owner/repo` for a github.com remote, lowercased; null for any other host or shape. */
export const parseGitHubRemoteUrl = (remoteUrl: string): string | null => {
	const candidate = scpSyntaxToSshUrl(remoteUrl.trim())
	if (!URL.canParse(candidate)) return null
	const url = new URL(candidate)
	if (url.hostname.toLowerCase() !== 'github.com') return null
	const segments = url.pathname.split('/').filter((segment) => segment.length > 0)
	if (segments.length !== 2) return null
	const [owner, lastSegment] = segments
	const repo = lastSegment?.replace(/\.git$/, '')
	if (!owner || !repo) return null
	return `${owner}/${repo}`.toLowerCase()
}

/** The two halves of an `owner/repo`, for the API calls that address them separately. */
export const splitRepoFullName = (repoFullName: string): { owner: string; repo: string } | null => {
	const parts = repoFullName.split('/')
	if (parts.length !== 2) return null
	const [owner, repo] = parts
	if (!owner || !repo) return null
	return { owner, repo }
}
