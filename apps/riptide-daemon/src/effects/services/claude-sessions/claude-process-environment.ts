import { Context } from 'effect'

export class ClaudeProcessEnvironment extends Context.Service<ClaudeProcessEnvironment, Readonly<NodeJS.ProcessEnv>>()(
	'ClaudeProcessEnvironment',
) {}
