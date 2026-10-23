import { DaemonIdentity } from '@humanlayer/schemas/effect/daemon/identity'
import type { DaemonLaunchResult } from '@humanlayer/schemas/effect/daemon/process-event'
import { DaemonStage } from '@humanlayer/schemas/effect/daemon/stage'
import * as Context from 'effect/Context'
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import type { DaemonInstanceAlreadyRunning } from './effects/services/daemon-instance-lock/errors'
import type { LoadedDaemonIdentity } from './lib/auth'
import type { AutomationDaemonResult } from './lifecycle/automation-lifecycle'

const NonEmptyString = Schema.String.check(Schema.isMinLength(1))

export const AutomationDaemonLifecycle = Schema.Struct({
	shutdownOn: Schema.Literals(['inactivity', 'stop']),
	inactivityMs: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
	onFailure: Schema.Literals(['inactivity', 'stop']),
})
export interface AutomationDaemonLifecycle extends Schema.Schema.Type<typeof AutomationDaemonLifecycle> {}

export const AutomationDaemonLaunch = Schema.Struct({
	targetSessionId: NonEmptyString,
	lifecycle: AutomationDaemonLifecycle,
})
export interface AutomationDaemonLaunch extends Schema.Schema.Type<typeof AutomationDaemonLaunch> {}

export const ExpectedDaemonIdentity = Schema.Struct({
	userId: DaemonIdentity.fields.userId,
	hostId: DaemonIdentity.fields.hostId,
	organizationId: Schema.optionalKey(DaemonIdentity.fields.organizationId),
})
export interface ExpectedDaemonIdentity extends Schema.Schema.Type<typeof ExpectedDaemonIdentity> {}

export const DaemonSelfUpdateCapability = Schema.Struct({
	packageSpecifier: NonEmptyString,
	restart: Schema.Struct({ command: NonEmptyString, args: Schema.Array(Schema.String) }),
	supervisor: Schema.Literals(['systemd', 'shim', 'none']),
})
export interface DaemonSelfUpdateCapability extends Schema.Schema.Type<typeof DaemonSelfUpdateCapability> {}

export const ManagedDaemonConfig = Schema.Struct({
	token: Schema.NullOr(NonEmptyString),
	apiOrigin: NonEmptyString,
	syncOrigin: NonEmptyString,
	stage: DaemonStage,
	generationId: Schema.NullOr(NonEmptyString),
	expectedIdentity: Schema.NullOr(ExpectedDaemonIdentity),
	automation: Schema.optionalKey(AutomationDaemonLaunch),
	/** Absent marks a daemon shipped inside the desktop app; null marks a CLI daemon that cannot update itself. */
	selfUpdate: Schema.optionalKey(Schema.NullOr(DaemonSelfUpdateCapability)),
})
export interface ManagedDaemonConfig extends Schema.Schema.Type<typeof ManagedDaemonConfig> {}

export const ManagedDaemonRuntimeConfig = Schema.Struct({
	token: NonEmptyString,
	apiOrigin: NonEmptyString,
	syncOrigin: NonEmptyString,
	stage: DaemonStage,
	generationId: Schema.NullOr(NonEmptyString),
	automation: Schema.NullOr(AutomationDaemonLaunch),
	selfUpdate: Schema.optional(Schema.NullOr(DaemonSelfUpdateCapability)),
})
export interface ManagedDaemonRuntimeConfig extends Schema.Schema.Type<typeof ManagedDaemonRuntimeConfig> {}

export class ManagedDaemonConfigurationError extends Data.TaggedError('ManagedDaemonConfigurationError')<{
	readonly message: string
	readonly cause?: unknown
}> {}

export class ManagedDaemonIdentityError extends Data.TaggedError('ManagedDaemonIdentityError')<{
	readonly message: string
	readonly cause: unknown
}> {}

export class ManagedDaemonStartupError extends Data.TaggedError('ManagedDaemonStartupError')<{
	readonly message: string
	readonly cause: unknown
}> {}

export interface DaemonIdentityLoaderShape {
	readonly load: (input: {
		readonly token: string | null
	}) => Effect.Effect<LoadedDaemonIdentity, ManagedDaemonIdentityError>
}

export class DaemonIdentityLoader extends Context.Service<DaemonIdentityLoader, DaemonIdentityLoaderShape>()(
	'DaemonIdentityLoader',
) {}

export interface ManagedDaemonRuntimeLauncherShape {
	readonly launch: (input: {
		readonly config: ManagedDaemonRuntimeConfig
		readonly identity: LoadedDaemonIdentity
	}) => Effect.Effect<void | AutomationDaemonResult, ManagedDaemonStartupError | DaemonInstanceAlreadyRunning>
}

export type ManagedDaemonLaunchResult = DaemonLaunchResult | AutomationDaemonResult

export class ManagedDaemonRuntimeLauncher extends Context.Service<
	ManagedDaemonRuntimeLauncher,
	ManagedDaemonRuntimeLauncherShape
>()('ManagedDaemonRuntimeLauncher') {}

export const resolveManagedDaemonLaunchRequestAtHostBoundary = Effect.fn(
	'managed_daemon.resolve_launch_request_at_host_boundary',
)(function* (input: unknown) {
	const parsed = yield* Schema.decodeUnknownEffect(ManagedDaemonConfig)(input).pipe(
		Effect.mapError(
			(cause) =>
				new ManagedDaemonConfigurationError({ message: 'Managed daemon configuration is invalid', cause }),
		),
	)
	return {
		config: {
			token: parsed.token,
			apiOrigin: parsed.apiOrigin,
			syncOrigin: parsed.syncOrigin,
			stage: parsed.stage,
			generationId: parsed.generationId,
			automation: parsed.automation ?? null,
			selfUpdate: parsed.selfUpdate,
		},
		expectedIdentity: parsed.expectedIdentity,
	}
})

export interface ResolvedManagedDaemonLaunchRequest {
	readonly config: ManagedDaemonRuntimeConfig
	readonly identity: LoadedDaemonIdentity
}

export const loadResolvedManagedDaemonLaunchRequestAtHostBoundary = Effect.fn(
	'managed_daemon.load_resolved_launch_request_at_host_boundary',
)(function* (input: unknown) {
	const parsed = yield* resolveManagedDaemonLaunchRequestAtHostBoundary(input)
	const config = parsed.config
	const identityLoader = yield* DaemonIdentityLoader
	const identity = yield* identityLoader.load({ token: config.token })
	if (identity.authenticationMode === 'authenticated' && parsed.expectedIdentity !== null) {
		const actualIdentity = identity.identity
		const expectedIdentity = parsed.expectedIdentity
		// Organization ids are not compared: launchers know the org by its WorkOS
		// `org_…` id, while the token's organizationId claim is the internal org
		// UUID, so the two never match.
		if (actualIdentity.userId !== expectedIdentity.userId || actualIdentity.hostId !== expectedIdentity.hostId) {
			return yield* new ManagedDaemonIdentityError({
				message: 'Authenticated daemon identity does not match the identity requested by the launcher',
				cause: { expectedIdentity, actualIdentity },
			})
		}
	}
	return { config: { ...config, token: identity.token }, identity } satisfies ResolvedManagedDaemonLaunchRequest
})

export const runManagedDaemonStart = Effect.fn('managed_daemon.start')(function* (
	input: ResolvedManagedDaemonLaunchRequest,
) {
	const runtimeLauncher = yield* ManagedDaemonRuntimeLauncher
	return yield* runtimeLauncher.launch(input).pipe(
		Effect.map((result): ManagedDaemonLaunchResult => result ?? { type: 'daemon_ready' }),
		Effect.catchTag('DaemonInstanceAlreadyRunning', () =>
			Effect.succeed<DaemonLaunchResult>({
				type: 'daemon_already_running',
				message: 'A daemon is already running for this user, organization, host, and stage',
			}),
		),
	)
})
