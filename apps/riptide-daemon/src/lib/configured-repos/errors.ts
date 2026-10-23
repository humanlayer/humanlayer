import { Data } from 'effect'

export class ClaudeSettingsFileParseWarning extends Data.TaggedError('ClaudeSettingsFileParseWarning')<{
	path: string
	cause: string
}> {}

export class ClaudeSettingsFileUnreadableWarning extends Data.TaggedError('ClaudeSettingsFileUnreadableWarning')<{
	path: string
	cause: string
}> {}

export class ConfiguredDirectoryWarning extends Data.TaggedError('ConfiguredDirectoryWarning')<{
	path: string
	reason: string
}> {}

export class GitRootResolutionWarning extends Data.TaggedError('GitRootResolutionWarning')<{
	cwd: string
	cause: string
}> {}

export class RepoMetadataWarning extends Data.TaggedError('RepoMetadataWarning')<{
	root: string
	cause: string
}> {}

export type ConfiguredRepoWarning =
	| ClaudeSettingsFileParseWarning
	| ClaudeSettingsFileUnreadableWarning
	| ConfiguredDirectoryWarning
	| GitRootResolutionWarning
	| RepoMetadataWarning
