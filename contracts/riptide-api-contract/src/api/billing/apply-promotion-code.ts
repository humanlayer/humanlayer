import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const ApplyPromotionCodeInputSchema = z.object({
	code: z.string().trim().nonempty(),
})

export const ApplyPromotionCodeOutputSchema = z.object({
	subscriptionId: z.string(),
	promotionCodeId: z.string(),
	code: z.string(),
	discountId: z.string().nullable(),
})

export const applyPromotionCodeContract = contractBuilder
	.input(ApplyPromotionCodeInputSchema)
	.output(ApplyPromotionCodeOutputSchema)
	.errors({
		INVALID_PROMO_CODE: {
			status: StatusCodes.BAD_REQUEST,
			data: z.object({ message: z.string() }),
		},
	})
