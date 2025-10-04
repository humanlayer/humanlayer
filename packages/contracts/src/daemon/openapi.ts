import { OpenAPIGenerator } from '@orpc/openapi'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import { daemonRouterContract } from './'

const openAPIGenerator = new OpenAPIGenerator({
	schemaConverters: [new ZodToJsonSchemaConverter()],
})

export const openApiSpecFromRouter = await openAPIGenerator.generate(
	daemonRouterContract,
	{
		info: {
			title: 'My App',
			version: '0.0.0',
		},
	},
)
