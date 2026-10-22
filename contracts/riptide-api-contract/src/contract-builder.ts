import { oc } from '@orpc/contract'
import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

/**
 * Import and use this when defining methods to get type-safe error handling
 * The server can throw this, and it will be returned as a HTTP error response with the defined HTTP status code and data JSON,
 *
 * The error code e.g. IM_A_TEAPOT and the data will be available to the client in a type-safe manner
 */
export const contractBuilder = oc.errors({
	UNAUTHORIZED: {
		status: StatusCodes.UNAUTHORIZED,
	},
	FORBIDDEN: {
		status: StatusCodes.FORBIDDEN,
	},
	BILLING_REQUIRED: {
		status: StatusCodes.PAYMENT_REQUIRED,
	},
	UPGRADE_REQUIRED: {
		status: StatusCodes.PAYMENT_REQUIRED,
		data: z.object({
			message: z.string(),
			currentActiveSeats: z.number().int().nonnegative(),
			pendingInvitations: z.number().int().nonnegative(),
			freeCapacity: z.number().int().nonnegative(),
			actionLabel: z.string().optional(),
		}),
	},
	SYNC_SETTINGS_ORG_POLICY_VIOLATION: {
		status: StatusCodes.FORBIDDEN,
		data: z.object({
			message: z.string(),
		}),
	},
	ORGANIZATION_REQUIRED: {
		status: StatusCodes.FORBIDDEN,
		data: z.object({
			message: z.string().optional(),
		}),
	},
	NOT_FOUND: {
		status: StatusCodes.NOT_FOUND,
		data: z
			.object({
				message: z.string().optional(),
				resolutionHint: z
					.object({
						text: z.string(),
						anchorText: z.string(),
					})
					.optional(),
			})
			.loose()
			.optional(),
	},
	BAD_REQUEST: {
		status: StatusCodes.BAD_REQUEST,
		data: z.object({
			message: z.string().optional(),
		}),
	},
	INPUT_VALIDATION_FAILED: {
		status: StatusCodes.BAD_REQUEST,
		data: z.any(),
	},
	INTERNAL_SERVER_ERROR: {
		status: StatusCodes.INTERNAL_SERVER_ERROR,
	},
	SERVICE_UNAVAILABLE: {
		status: StatusCodes.SERVICE_UNAVAILABLE,
	},
})

// This method is done so that errors are passed through properly - do NOT remove it.
export const testContract = contractBuilder.input(z.object({})).output(z.object({}))
