import { ORPCTaggedError } from '@humanlayer/effect-orpc'
import z from 'zod/v4'

export class ORPCNotFoundError extends ORPCTaggedError('ORPCNotFoundError', {
	code: 'NOT_FOUND',
	status: 404,
}) {}

export class ORPCBadRequestError extends ORPCTaggedError('ORPCBadRequestError', {
	code: 'BAD_REQUEST',
	status: 400,
}) {}

export class ORPCForbiddenError extends ORPCTaggedError('ORPCForbiddenError', {
	code: 'FORBIDDEN',
	status: 403,
}) {}

export class ORPCQueuedMessageSendFailedError extends ORPCTaggedError('ORPCQueuedMessageSendFailedError', {
	code: 'QUEUED_MESSAGE_SEND_FAILED',
	status: 409,
	message: 'Could not send queued message',
	schema: z.object({ reason: z.enum(['already_delivered', 'not_pending']) }),
}) {}

export class ORPCQueuedMessageUpdateFailedError extends ORPCTaggedError('ORPCQueuedMessageUpdateFailedError', {
	code: 'QUEUED_MESSAGE_UPDATE_FAILED',
	status: 400,
	message: 'Could not update queued message',
	schema: z.object({ reason: z.enum(['already_delivered']) }),
}) {}
