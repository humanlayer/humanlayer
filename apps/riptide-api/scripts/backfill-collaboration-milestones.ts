import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { Console, Effect, Option } from 'effect'
import { Command, Flag } from 'effect/cli'

import {
	CollaborationBackfillDatabase,
	runCollaborationBackfillCommand,
} from '../src/effects/services/onboarding/backfill-collaboration-command'

const organizationId = Flag.String('organization-id').pipe(
	Flag.withDescription('Only recover collaboration milestones for this organization'),
	Flag.optional,
)
const allOrganizations = Flag.Boolean('all-organizations').pipe(
	Flag.withDescription('Explicitly recover collaboration milestones for every organization'),
	Flag.withDefault(false),
)
const apply = Flag.Boolean('apply').pipe(
	Flag.withDescription('Write recovered timestamps; omission previews changes only'),
	Flag.withDefault(false),
)

const command = Command.make(
	'backfill-collaboration-milestones',
	{ organizationId, allOrganizations, apply },
	({ organizationId, allOrganizations, apply }) =>
		Effect.gen(function* () {
			const summary = yield* runCollaborationBackfillCommand({
				organizationId: Option.getOrNull(organizationId),
				allOrganizations,
				apply,
			})

			yield* Console.log(
				JSON.stringify({
					mode: apply ? 'apply' : 'preview',
					...summary,
				}),
			)
		}),
).pipe(Command.withDescription('Recover first inbound collaboration timestamps from existing plan-document comments'))

command.pipe(
	Command.run({ version: '1.0.0' }),
	Effect.provide(CollaborationBackfillDatabase.layer),
	Effect.provide(NodeServices.layer),
	NodeRuntime.runMain,
)
