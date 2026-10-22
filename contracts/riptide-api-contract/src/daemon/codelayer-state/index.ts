import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const GetCodelayerStateInputSchema = z.object({
	sessionId: z.string().uuid(),
})

// AgentState is any JSON object
export const GetCodelayerStateOutputSchema = z.record(z.string(), z.unknown()).nullable()

export const getCodelayerStateContract = contractBuilder
	.input(GetCodelayerStateInputSchema)
	.output(GetCodelayerStateOutputSchema)

export const GetCodelayerStateSnapshotInputSchema = z.object({
	sessionId: z.string().uuid(),
	runIndex: z.number().int().nonnegative(),
})

export const GetCodelayerStateSnapshotOutputSchema = z.record(z.string(), z.unknown()).nullable()

export const getCodelayerStateSnapshotContract = contractBuilder
	.input(GetCodelayerStateSnapshotInputSchema)
	.output(GetCodelayerStateSnapshotOutputSchema)

export const UpsertCodelayerStateInputSchema = z.object({
	sessionId: z.string().uuid(),
	state: z.record(z.string(), z.unknown()),
})

export const UpsertCodelayerStateOutputSchema = z.object({})

export const upsertCodelayerStateContract = contractBuilder
	.input(UpsertCodelayerStateInputSchema)
	.output(UpsertCodelayerStateOutputSchema)
