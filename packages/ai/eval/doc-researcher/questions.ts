import type { EvalQuestion } from './types'

export const EVAL_QUESTIONS: EvalQuestion[] = [
	// Claude Agent SDK
	{
		slug: '001-claude-sdk-tools',
		question:
			'How do I define custom tools with input schema validation using @anthropic-ai/claude-agent-sdk in TypeScript?',
		category: 'Claude Agent SDK',
		packageName: '@anthropic-ai/claude-agent-sdk',
		language: 'typescript',
		answer: `Use \`tool()\` and \`createSdkMcpServer()\` from the Claude Agent SDK:

\`\`\`typescript
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk"
import z from "zod/v4"

// 1. Create an in-process MCP server with custom tools
const customServer = createSdkMcpServer({
  name: "my-tools",
  version: "1.0.0",
  tools: [
    tool(
      "get_weather",
      "Get current temperature for a location",
      {
        latitude: z.number().describe("Latitude coordinate"),
        longitude: z.number().describe("Longitude coordinate"),
      },
      async (args) => {
        const response = await fetch(\`https://api.weather.com?lat=\${args.latitude}&lon=\${args.longitude}\`)
        const data = await response.json()
        return {
          content: [{ type: "text", text: \`Temperature: \${data.temp}°F\` }]
        }
      }
    ),
  ],
})

// 2. MCP tools require streaming input (async generator)
async function* generateMessages() {
  yield {
    type: "user" as const,
    message: { role: "user" as const, content: "What's the weather in SF?" },
  }
}

// 3. Use in query with mcpServers option
for await (const message of query({
  prompt: generateMessages(),  // Must be async generator, NOT string
  options: {
    mcpServers: { "my-tools": customServer },
    allowedTools: ["mcp__my-tools__get_weather"],  // Tool name format: mcp__{server}__{tool}
  },
})) {
  if (message.type === "result" && message.subtype === "success") {
    console.log(message.result)
  }
}
\`\`\`

Key points:
- Use \`tool(name, description, zodSchema, handler)\` to define tools with Zod validation
- Use \`createSdkMcpServer()\` to create an in-process MCP server
- MCP tools require streaming input - use an async generator, not a string prompt
- Tool names become \`mcp__{serverName}__{toolName}\` when exposed to Claude`,
	},

	// oRPC
	{
		slug: '002-orpc-contract-definition',
		question: 'How do I define an oRPC contract with input and output schemas using @orpc/contract?',
		category: 'oRPC',
		packageName: '@orpc/contract',
		language: 'typescript',
		answer: `\`\`\`typescript
import { oc } from '@orpc/contract'
import z from 'zod/v4'

const contractBuilder = oc.errors({ UNAUTHORIZED: { status: 401 }, NOT_FOUND: { status: 404 } })

const InputSchema = z.object({ name: z.string().min(1) })
const OutputSchema = z.object({ id: z.uuid(), name: z.string() })

export const createItemContract = contractBuilder.input(InputSchema).output(OutputSchema)
\`\`\``,
	},
	{
		slug: '003-orpc-middleware',
		question: 'How do I create and chain middleware using @orpc/server?',
		category: 'oRPC',
		packageName: '@orpc/server',
		language: 'typescript',
		answer: `\`\`\`typescript
import { implement } from '@orpc/server'

const os = implement(Contract).$context<{ auth: AuthContext | null }>()

// Reusable middleware
const requireAuth = os.middleware(async ({ context, next, errors }) => {
  if (!context.auth) throw errors.UNAUTHORIZED()
  return next({ context: { auth: context.auth } })
})

// Chain middleware with .use()
const base = os
  .use(async ({ context, next, errors }) => {
    if (!context.auth) throw errors.UNAUTHORIZED()
    return next({ context: { auth: context.auth } })
  })
  .use(requireAuth)
\`\`\``,
	},
	{
		slug: '004-orpc-context',
		question: 'How do I define context interfaces and pass context through into routes using @orpc/server?',
		category: 'oRPC',
		packageName: '@orpc/server',
		language: 'typescript',
		answer: `\`\`\`typescript
// Define context type
type AuthContext = { userId: string; organizationId: string }

// Create implementer with context
const os = implement(Contract).$context<{ auth: AuthContext | null }>()

// Middleware narrows context type
const base = os.use(async ({ context, next, errors }) => {
  if (!context.auth) throw errors.UNAUTHORIZED()
  return next({ context: { auth: context.auth } })  // auth is now non-null
})

// Handler receives narrowed context
const procedure = base.myRoute.handler(async ({ input, context }) => {
  const { userId } = context.auth  // TypeScript knows auth exists
})

// Pass context from HTTP layer
apiHandler.handle(request, { context: { auth: await getAuth(request) } })
\`\`\``,
	},
	{
		slug: '005-orpc-testing',
		question: 'How do I test existing oRPC procedures without a running server using @orpc/server?',
		category: 'oRPC',
		packageName: '@orpc/server',
		language: 'typescript',
		answer: `\`\`\`typescript
import { describe, expect, test } from 'vitest'
import { call, ORPCError } from '@orpc/server'
import { router } from '../src/orpc/router'  // Import existing router
import { createMockAuthContext } from './utils'

describe('Task creation', () => {
  test('unauthorized request fails', async () => {
    await expect(
      call(
        router.tasks.create,           // Reference existing procedure
        { name: 'My Task' },           // Input matching schema
        { context: { auth: null } }    // Context with null auth
      )
    ).rejects.toThrowError(new ORPCError('UNAUTHORIZED'))
  })

  test('authenticated request succeeds', async () => {
    const result = await call(
      router.tasks.create,
      { name: 'My Task' },
      {
        context: {
          auth: createMockAuthContext({
            userId: 'user-123',
            organizationId: 'org-456'
          })
        }
      }
    )

    expect(result.task.name).toBe('My Task')
  })
})
\`\`\`

Key pattern: Import the procedure from your router (\`router.tasks.create\`), then use \`call(procedure, input, { context })\` to invoke it directly.`,
	},
	{
		slug: '006-orpc-errors',
		question: 'How do I implement type-safe errors using @orpc/contract and @orpc/server?',
		category: 'oRPC',
		packageName: '@orpc/server',
		language: 'typescript',
		answer: `\`\`\`typescript
// Define errors in contract builder
const contractBuilder = oc.errors({
  NOT_FOUND: { status: 404 },
  BAD_REQUEST: { status: 400, data: z.object({ message: z.string() }) },
  RATE_LIMITED: { status: 429, data: z.object({ retryAfterMs: z.number() }) },
})

// Throw in handlers/middleware
export const myProcedure = base.handler(async ({ input, errors }) => {
  if (!item) throw errors.NOT_FOUND()
  if (!valid) throw errors.BAD_REQUEST({ data: { message: 'Invalid input' } })
  throw errors.RATE_LIMITED({ data: { retryAfterMs: 5000 } })
})
\`\`\``,
	},

	// Electric SQL / TanStack DB
	{
		slug: '007-electric-tanstack-db',
		question:
			'How do I subscribe to an Electric SQL shape stream using @electric-sql/client and query it with @tanstack/react-db and @tanstack/electric-db-collection in React?',
		category: 'Electric SQL',
		packageName: '@electric-sql/client',
		language: 'typescript',
		answer: `\`\`\`typescript
// 1. Create collection OUTSIDE component (e.g., collections/sessions.ts)
import { sessionSelectSchema } from '@humanlayer/db/tables/sessions'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { createCollection } from '@tanstack/react-db'

export const sessionsCollection = createCollection(
  electricCollectionOptions({
    schema: sessionSelectSchema,
    shapeOptions: {
      url: \`\${SYNC_ORIGIN}/v1/sessions\`,
      headers: { Authorization: async () => \`Bearer \${await getToken()}\` },
    },
    getKey: (item) => item.id,
    syncMode: 'on-demand',
  })
)

// 2. Use in component with useLiveQuery
import { eq, useLiveQuery } from '@tanstack/react-db'
import { sessionsCollection } from '@/collections/sessions'

function MyComponent() {
  const { data, isReady } = useLiveQuery(
    (q) => q
      .from({ sessions: sessionsCollection })
      .where(({ sessions }) => eq(sessions.archived, false))
      .orderBy(({ sessions }) => sessions.created_at, 'desc')
  )

  if (!isReady) return <Loading />
  return <SessionList sessions={data} />
}
\`\`\``,
	},

	// Drizzle ORM
	{
		slug: '008-drizzle-defaults',
		question: 'How do I define default values and default functions using drizzle-orm with SQL and TypeScript?',
		category: 'Drizzle ORM',
		packageName: 'drizzle-orm',
		language: 'typescript',
		answer: `\`\`\`typescript
import { sql } from 'drizzle-orm'
import { pgTable, uuid, bigint, boolean, text } from 'drizzle-orm/pg-core'
import { uuidv7 } from 'uuidv7'

export const myTable = pgTable('my_table', {
  // UUID with SQL + TS default
  id: uuid().primaryKey().default(sql\`uuidv7()\`).$defaultFn(() => uuidv7()),

  // Timestamp with SQL expression
  created_at: bigint({ mode: 'bigint' }).notNull()
    .default(sql\`(extract(epoch from now()) * 1000)::bigint\`)
    .$defaultFn(() => BigInt(Date.now())),

  // Auto-update on modification
  updated_at: bigint({ mode: 'bigint' }).notNull()
    .default(sql\`(extract(epoch from now()) * 1000)::bigint\`)
    .$defaultFn(() => BigInt(Date.now()))
    .$onUpdateFn(() => BigInt(Date.now())),

  // Simple static defaults
  archived: boolean().notNull().default(false),
  status: text().$type<'draft' | 'active'>().default('draft'),
})
\`\`\``,
	},
	{
		slug: '009-drizzle-migrations',
		question: 'How do I generate and apply migrations using drizzle-kit for PostgreSQL?',
		category: 'Drizzle ORM',
		packageName: 'drizzle-kit',
		language: 'typescript',
		answer: `Configure \`drizzle.config.ts\`:
\`\`\`typescript
import { defineConfig } from 'drizzle-kit'
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/index.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL },
})
\`\`\`

Generate migrations: \`drizzle-kit generate\` (creates SQL files in \`./drizzle/\`).
Apply locally: \`drizzle-kit push\` (interactive, compares schema to DB directly).
Production: use a migrator that applies generated SQL files.`,
	},

	// Tauri
	{
		slug: '010-tauri-commands',
		question: 'How do I define and invoke Tauri commands from the frontend using @tauri-apps/api with React?',
		category: 'Tauri',
		packageName: '@tauri-apps/api',
		language: 'typescript',
		answer: `**Rust:**
\`\`\`rust
#[tauri::command]
async fn open_in_editor(path: String, editor: Option<String>) -> Result<(), String> {
    // implementation
    Ok(())
}

// Register in Builder
.invoke_handler(tauri::generate_handler![open_in_editor])
\`\`\`

**React:**
\`\`\`typescript
import { invoke } from '@tauri-apps/api/core'

const result = await invoke('open_in_editor', { path: '/my/path', editor: 'code' })
\`\`\``,
	},
	{
		slug: '011-tauri-state',
		question: 'How do I manage shared state across Tauri commands using the tauri crate in Rust?',
		category: 'Tauri',
		packageName: 'tauri',
		language: 'rust',
		answer: `\`\`\`rust
use std::sync::Mutex;  // NOT Arc<Mutex> - Tauri wraps in Arc internally

#[derive(Default)]
struct AppState {
    counter: u32,
}

#[tauri::command]
fn get_counter(state: tauri::State<'_, Mutex<AppState>>) -> u32 {
    state.lock().unwrap().counter
}

#[tauri::command]
fn increment(state: tauri::State<'_, Mutex<AppState>>) -> u32 {
    let mut guard = state.lock().unwrap();
    guard.counter += 1;
    guard.counter
}

// Register in main
tauri::Builder::default()
    .manage(Mutex::new(AppState::default()))
    .invoke_handler(tauri::generate_handler![get_counter, increment])
\`\`\`

Note: Use \`tokio::sync::Mutex\` for async commands where you hold the lock across \`.await\` points.`,
	},

	// Hono
	{
		slug: '012-hono-middleware',
		question: 'How do I create custom middleware using the hono npm package?',
		category: 'Hono',
		packageName: 'hono',
		language: 'typescript',
		answer: `\`\`\`typescript
import { createMiddleware } from 'hono/factory'

// Simple middleware
export const authMiddleware = createMiddleware(async (c, next) => {
  const token = c.req.header('authorization')
  if (!token) return c.newResponse(null, 401)

  c.set('userId', await validateToken(token))
  await next()
})

// Parameterized factory
export const withTable = (table: PgTable) => createMiddleware(async (c, next) => {
  c.set('tableName', getTableName(table))
  await next()
})

// Usage
app.use('/api/*', authMiddleware)
app.use('/v1/sessions', withTable(sessions))
\`\`\``,
	},

	// Vercel AI SDK
	{
		slug: '013-vercel-ai-structured',
		question: 'How do I get structured output with Zod schemas using the ai npm package (Vercel AI SDK)?',
		category: 'Vercel AI SDK',
		packageName: 'ai',
		language: 'typescript',
		answer: `\`\`\`typescript
import { anthropic } from '@ai-sdk/anthropic'
import { generateText, Output } from 'ai'
import z from 'zod/v4'

const MySchema = z.object({
  answer: z.string().describe('The answer'),
  confidence: z.enum(['high', 'medium', 'low']),
})

const { output } = await generateText({
	model: anthropic('claude-sonnet-5'),
  prompt: 'Your prompt here',
  output: Output.object({ schema: MySchema }),
})

// output is typed according to MySchema
\`\`\``,
	},
	{
		slug: '014-vercel-ai-streaming',
		question: 'How do I stream AI responses from a Hono server using the ai npm package (Vercel AI SDK)?',
		category: 'Vercel AI SDK',
		packageName: 'ai',
		language: 'typescript',
		answer: `\`\`\`typescript
import { streamText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { Hono } from 'hono'

const app = new Hono()

// Full-featured streaming (supports tool calls, metadata)
app.post('/api/chat', async (c) => {
  const { messages } = await c.req.json()

  const result = streamText({
		model: anthropic('claude-sonnet-5'),
    messages,
  })

  return result.toUIMessageStreamResponse()
})

// Simple text streaming
app.post('/api/generate', async (c) => {
  const { prompt } = await c.req.json()

  const result = streamText({
		model: anthropic('claude-sonnet-5'),
    prompt,
  })

  return result.toTextStreamResponse()
})
\`\`\`

Note: \`toDataStreamResponse()\` was renamed to \`toUIMessageStreamResponse()\` in AI SDK 4.0+.`,
	},

	// TanStack Router
	{
		slug: '015-tanstack-router-navigate',
		question: 'How do I imperatively navigate to a page with query parameters using @tanstack/react-router?',
		category: 'TanStack Router',
		packageName: '@tanstack/react-router',
		language: 'typescript',
		answer: `\`\`\`typescript
import { useNavigate } from '@tanstack/react-router'

const navigate = useNavigate()

// With route params and search params
navigate({
  to: '/tasks/$taskId',
  params: { taskId: 'abc-123' },
  search: { tab: 'details', filter: 'active' },
  replace: true,  // optional: replace history instead of push
})
\`\`\``,
	},
	{
		slug: '016-tanstack-router-search',
		question:
			'How do I do type-safe query parameters for routes using @tanstack/react-router and @tanstack/zod-adapter?',
		category: 'TanStack Router',
		packageName: '@tanstack/react-router',
		language: 'typescript',
		answer: `\`\`\`typescript
import { createFileRoute } from '@tanstack/react-router'
import { zodValidator } from '@tanstack/zod-adapter'
import z from 'zod/v4'

const searchSchema = z.object({
  tab: z.enum(['tasks', 'sessions']).default('tasks'),
  filter: z.string().optional(),
})

export const Route = createFileRoute('/my-route')({
  validateSearch: zodValidator(searchSchema),
  component: MyComponent,
})

function MyComponent() {
  const { tab, filter } = Route.useSearch()  // Fully typed!
}
\`\`\``,
	},
]
