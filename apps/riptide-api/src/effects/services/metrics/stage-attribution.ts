import { sql } from 'drizzle-orm'

/**
 * RPI stage labels in progression order (least → most progressed). Mirrors
 * `RPI_LABELS` in `packages/ui/src/constants/rpi-skills.ts` — duplicated here
 * the same way `daemon/sessions/events/create.ts` duplicates `skillToLabel`,
 * because riptide-api does not depend on @humanlayer/ui. `rpi:todo` is omitted:
 * it is never appended by a Skill call, so it cannot appear on a session.
 */
export const RPI_STAGE_PROGRESSION = [
	'rpi:research-questions',
	'rpi:research',
	'rpi:design',
	'rpi:design-prd',
	'rpi:design-tdd',
	'rpi:structure',
	'rpi:plan',
	'rpi:worktree-setup',
	'rpi:implementation',
	'rpi:describe-pr',
	'rpi:review',
] as const

/**
 * SQL scalar subquery resolving a session's stage: its most-progressed RPI
 * label, or NULL when it has none. Expects the sessions table to be aliased
 * `s` in the enclosing query.
 *
 * - `jsonb_typeof` guard: a handful of pre-labels-era rows carry a scalar
 *   jsonb in `labels`; `jsonb_array_elements` on a scalar is an ERROR, not an
 *   empty set, so the CASE swaps those for '[]'.
 * - Most-progressed tie-break: ~4% of labeled sessions carry more than one
 *   RPI label (one session spanned two skills); ranking by position in
 *   {@link RPI_STAGE_PROGRESSION} matches how the sidebar and task table pick
 *   a session's phase (`getMostProgressedLabel`).
 * - `DESC NULLS LAST` is load-bearing: DESC defaults to NULLS FIRST in
 *   Postgres, which would let an unknown/legacy label beat every known one.
 *   As written, unknown rpi:* labels only win when no known label exists —
 *   and then reporting the legacy label beats reporting nothing.
 */
export function mostProgressedStageSql() {
	const progression = sql.join(
		RPI_STAGE_PROGRESSION.map((name) => sql`${name}`),
		sql`, `,
	)
	return sql`(
		SELECT l->>'name'
		FROM jsonb_array_elements(
			CASE WHEN jsonb_typeof(s.labels) = 'array' THEN s.labels ELSE '[]'::jsonb END
		) l
		WHERE l->>'name' LIKE 'rpi:%'
		ORDER BY array_position(ARRAY[${progression}]::text[], l->>'name') DESC NULLS LAST
		LIMIT 1
	)`
}
