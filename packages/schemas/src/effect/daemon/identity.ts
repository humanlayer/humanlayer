import * as Schema from 'effect/Schema'

import { DaemonStage } from './stage'

export const DaemonIdentity = Schema.Struct({
	userId: Schema.NonEmptyString,
	organizationId: Schema.NonEmptyString,
	hostId: Schema.NonEmptyString,
})
export interface DaemonIdentity extends Schema.Schema.Type<typeof DaemonIdentity> {}

export const DaemonLeaseIdentity = Schema.Struct({
	...DaemonIdentity.fields,
	stage: DaemonStage,
})
export interface DaemonLeaseIdentity extends Schema.Schema.Type<typeof DaemonLeaseIdentity> {}

export const DaemonLockOwner = Schema.Struct({
	pid: Schema.Int.check(Schema.isGreaterThan(0)),
	...DaemonLeaseIdentity.fields,
	generationId: Schema.NullOr(Schema.NonEmptyString),
})
export interface DaemonLockOwner extends Schema.Schema.Type<typeof DaemonLockOwner> {}
