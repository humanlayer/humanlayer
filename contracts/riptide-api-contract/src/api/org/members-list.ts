import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const ListOrgMembersInputSchema = z.object({})

export const ListOrgMembersOutputSchema = z.object({
	members: z.array(
		z.object({
			id: z.string(),
			email: z.string(),
			firstName: z.string().optional(),
			lastName: z.string().optional(),
			profilePictureUrl: z.string().optional(),
		}),
	),
})

export const listOrgMembersContract = contractBuilder
	.input(ListOrgMembersInputSchema)
	.output(ListOrgMembersOutputSchema)

export const listActiveOrgMembersContract = contractBuilder
	.input(ListOrgMembersInputSchema)
	.output(ListOrgMembersOutputSchema)
