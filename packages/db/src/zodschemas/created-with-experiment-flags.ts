import z from 'zod/v4'

export const CreatedWithExperimentFlagsSchema = z.strictObject({
	task_composer: z.strictObject({
		assigned_group: z.enum(['v2_form', 'v3_composer']),
		actual_form: z.enum(['v2_form', 'v3_composer', 'v2_form_mobile']),
	}),
})
export type CreatedWithExperimentFlags = z.infer<typeof CreatedWithExperimentFlagsSchema>
