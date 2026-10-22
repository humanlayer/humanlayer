import * as Schema from 'effect/Schema'

export const DaemonStage = Schema.Literals(['local', 'dev', 'beta', 'prod'])
export type DaemonStage = typeof DaemonStage.Type
