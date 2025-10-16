import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

console.log(`loading drizzle config...`, __dirname)

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) throw new Error('Unable to load migration DATABASE_URL')

export default defineConfig({
	dialect: 'postgresql',
	schema: ['./schema/index.ts'],
	dbCredentials: {
		url: dbUrl,
	},
	out: './drizzle',
})
