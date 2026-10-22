import { BuildVersionMacro, CommitHashMacro } from './_macros-do-not-import' with { type: 'macro' }

export const BUILD_VERSION = BuildVersionMacro()
export const COMMIT_HASH = CommitHashMacro()
