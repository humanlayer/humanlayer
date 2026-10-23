import z from 'zod/v4'

/**
 * The Projects V2 experiment group PostHog first chose for a member. Stored as `v1`/`v2` so
 * readers never need PostHog's `control`/`test` variant keys.
 */
export const PROJECTS_V2_VARIANTS = ['v1', 'v2'] as const
export const ProjectsV2VariantSchema = z.enum(PROJECTS_V2_VARIANTS)
export type ProjectsV2Variant = z.infer<typeof ProjectsV2VariantSchema>
