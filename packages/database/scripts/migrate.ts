import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { db } from '..'

migrate(db, { migrationsFolder: 'drizzle' })
	.then(() => {
		console.log('migrations finished!')
		process.exit(0)
	})
	.catch((err) => {
		console.log(err)
		process.exit(1)
	})
