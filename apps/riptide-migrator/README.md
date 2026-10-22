# riptide-migrator

This is a simple lambda function that handles running database migrations. 
This is NOT done in packages/db, since:
* by convention, all top-level applications, functions, services, etc. should live in `apps/`
* we do NOT want to introduce the `postgres` or `pg` dependency into the `packages/db` package since it is intended to be isomorphic for client & server so that schemas can be used on the client and server
* the `bun-sql` drizzle-orm driver which uses `bun:sql` which is normally available if an application is running with bun is not available in AWS lambda, which is where the migrations are run.