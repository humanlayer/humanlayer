import { OpenAPIGenerator } from '@orpc/openapi'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'

import { RiptideApiContract } from './contract-router'

const openAPIGenerator = new OpenAPIGenerator({
	schemaConverters: [new ZodToJsonSchemaConverter()],
})

export const openApiSpecFromRouter = await openAPIGenerator.generate(RiptideApiContract, {
	info: {
		title: 'Riptide API',
		version: '0.0.0',
	},
})
