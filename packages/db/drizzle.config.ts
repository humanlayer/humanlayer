import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'

import { defineConfig } from 'drizzle-kit'

function rootDatabaseUrl(): string | undefined {
	try {
		return parseEnv(readFileSync(resolve(import.meta.dirname, '../../.env'), 'utf8')).DATABASE_URL
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
		throw error
	}
}

export const DATABASE_URL = process.env.DATABASE_URL ?? rootDatabaseUrl()
if (!DATABASE_URL) throw new Error('Missing DATABASE_URL')
export default defineConfig({
	dialect: 'postgresql',
	schema: './src/schema.ts',
	out: './drizzle',

	dbCredentials: {
		url: DATABASE_URL,
	},
})
