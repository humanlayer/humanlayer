import { sessionSelectSchema } from '@humanlayer/db/tables/sessions'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import type { SessionChangeMessage } from '@/collections/types'

const sessionVirtualPropsSchema = Schema.Struct({
	$synced: Schema.optionalKey(Schema.Boolean),
	$origin: Schema.optionalKey(Schema.Union([Schema.Literal('local'), Schema.Literal('remote')])),
	$key: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number])),
	$collectionId: Schema.optionalKey(Schema.String),
})

/**
 * Parse a synced collection row into the session shape the launch handlers accept. Returns
 * undefined for rows that do not decode as sessions, so callers can skip them by name.
 */
export const parseSessionLaunchCandidate = (value: unknown): SessionChangeMessage['value'] | undefined => {
	const session = sessionSelectSchema.safeParse(value)
	if (!session.success) return undefined
	const virtualProps = Option.getOrUndefined(Schema.decodeUnknownOption(sessionVirtualPropsSchema)(value))
	return {
		...session.data,
		$synced: virtualProps?.$synced ?? true,
		$origin: virtualProps?.$origin ?? 'remote',
		$key: virtualProps?.$key ?? session.data.id,
		$collectionId: virtualProps?.$collectionId ?? 'daemon-session-launch',
	}
}
