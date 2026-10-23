import { readGitPrefs } from '@/minimalist/lib/git-prefs'

/** Settings → Git instructions ride along under their own heading so the agent can tell them from the request. */
function withStanding(base: string, standing: string): string {
	return standing.trim() ? `${base}\n\nFollow these instructions from my settings:\n${standing.trim()}` : base
}

export function commitPrompt(message: string, push: boolean, standing = readGitPrefs().commitInstructions): string {
	const what = message.trim()
		? `Commit all changes with the message: ${message.trim()}`
		: 'Commit all changes with a message that describes them.'
	return withStanding(push ? `${what}${message.trim() ? '\n\n' : ' '}Then push the branch.` : what, standing)
}

export function pullRequestPrompt(
	draft: boolean,
	instructions: string,
	standing = readGitPrefs().pullRequestInstructions,
): string {
	const base = `Push the branch and open a ${draft ? 'draft ' : ''}pull request for it. Commit anything uncommitted first.`
	return withStanding(instructions.trim() ? `${base}\n\n${instructions.trim()}` : base, standing)
}
