import { ValidationError } from '@orpc/contract'
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { ORPCError, onError } from '@orpc/server'
import { CORSPlugin } from '@orpc/server/plugins'
import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { apiRouter, daemonRouter } from './router'

/** Enriches contract validation failures without changing unrelated errors. */
const enrichValidationError = (error: unknown) => {
	if (error instanceof ORPCError && error.code === 'BAD_REQUEST' && error.cause instanceof ValidationError) {
		const zodError = new z.ZodError(error.cause.issues as z.core.$ZodIssue[])
		throw new ORPCError('INPUT_VALIDATION_FAILED', {
			status: StatusCodes.BAD_REQUEST,
			message: z.prettifyError(zodError),
			data: z.flattenError(zodError),
			cause: error.cause,
		})
	}
}

export const apiHandler = new OpenAPIHandler(apiRouter, {
	plugins: [
		new CORSPlugin({
			origin: (origin) => origin,
			allowMethods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH'],
		}),
	],
	clientInterceptors: [onError(enrichValidationError)],
})

export const daemonApiHandler = new OpenAPIHandler(daemonRouter, {
	plugins: [
		new CORSPlugin({
			origin: (origin) => origin,
			allowMethods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH'],
		}),
	],
	clientInterceptors: [onError(enrichValidationError)],
})
