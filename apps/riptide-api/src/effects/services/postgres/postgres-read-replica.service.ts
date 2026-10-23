import { Context, Layer } from 'effect'

import { type EffectPostgresDbService, makeEffectPostgresDbService, type PostgresDbClient } from './postgres-db.service'

/**
 * The analytics read replica, as a service tag of its own.
 *
 * It carries the SAME shape as {@link PostgresDb} but a DIFFERENT connection
 * pool, and that distinction is load-bearing. The Advanced Metrics queries scan
 * whole-org ranges of `session_usage_events`; running them on the primary would
 * queue an interactive request behind a table scan. `READ_REPLICA_DATABASE_URL`
 * is required in every environment for exactly this reason (see src/db/db.ts).
 *
 * A second tag rather than a constructor argument, so no procedure can reach
 * the wrong pool by accident: asking for the replica is a type-level decision,
 * and code that must read its own writes keeps yielding `PostgresDb`. Replica
 * lag is the price — never yield this for a gate or a post-write read.
 */
export class PostgresReadReplicaDb extends Context.Service<PostgresReadReplicaDb, EffectPostgresDbService>()(
	'PostgresReadReplicaDb',
) {}

export const PostgresReadReplicaDbLive = (client: PostgresDbClient) =>
	Layer.succeed(PostgresReadReplicaDb, makeEffectPostgresDbService(client))
