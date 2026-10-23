import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const GetUserInfoInputSchema = z.object({}).optional()

export const GetUserInfoOutputSchema = z.object({
	userId: z.string(),
	workosOrganizationId: z.string(),
	organizationId: z.string(),
	role: z.string(),
	roles: z.array(z.string()),
	advancedMetricsAvailable: z.boolean(),
	advancedMetricsVisible: z.boolean(),
	commitTrackingEnabled: z.boolean(),
	prTrackingEnabled: z.boolean(),
})

export const getUserInfoContract = contractBuilder.input(GetUserInfoInputSchema).output(GetUserInfoOutputSchema)
