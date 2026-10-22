/**
 * Domain shapes for GitHub access. Field names deliberately match `gh`'s
 * `--json` keys — the token (GraphQL/REST) backend maps its responses into the
 * same shapes, so every consumer stays backend-agnostic.
 */

/** Shape of the viewer identity we consume, matching `gh api user`'s REST fields. */
export interface GithubViewer {
	login?: unknown
	id?: unknown
	email?: unknown
}

/** An `owner`/`repo` pair resolved from a github.com remote. */
export interface GithubRepoRef {
	owner: string
	repo: string
}
