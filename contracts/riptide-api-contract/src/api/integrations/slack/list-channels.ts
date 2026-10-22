import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const ListSlackChannelsInputSchema = z.object({}).optional()
export const SlackChannelSchema = z.object({
	id: z.string(),
	name: z.string(),
	isPrivate: z.boolean(),
})
export const ListSlackChannelsOutputSchema = z.object({
	channels: z.array(SlackChannelSchema),
})

export const listSlackChannelsContract = contractBuilder
	.input(ListSlackChannelsInputSchema)
	.output(ListSlackChannelsOutputSchema)
