import { Data } from 'effect'

export class MachineInfoReadError extends Data.TaggedError('MachineInfoReadError')<{ readonly cause: unknown }> {
	override get message() {
		return 'Could not read the machine hardware and OS'
	}
}

export class HostLoadReadError extends Data.TaggedError('HostLoadReadError')<{ readonly cause: unknown }> {
	override get message() {
		return 'Could not read host cpu, memory or disk'
	}
}

export type HostMachineSampleKind = 'machine info' | 'host load'

/** The API validates heartbeats with the same schema, so an invalid sample would cost the whole beat. */
export class HostMachineSampleInvalidError extends Data.TaggedError('HostMachineSampleInvalidError')<{
	readonly kind: HostMachineSampleKind
	readonly issues: unknown
}> {
	override get message() {
		return `Discarded ${this.kind} that failed schema validation`
	}
}
