import { RuleTester } from 'oxlint/plugins-dev'

import { noKnownValueWideningRule } from './no-known-value-widening.ts'

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } })

const error = { messageId: 'widening' }
const broadSatisfiesError = { messageId: 'broadSatisfies' }

const prelude = 'type Command = () => void; const startCommand = () => {};'

tester.run('anti-slop/no-known-value-widening', noKnownValueWideningRule, {
	valid: [
		`${prelude} const commands: Record<string, Command> = {};`,
		`${prelude} type Index<T> = Record<string, T>; const commands: Index<Command> = {};`,
		`${prelude} class Registry { commands: Record<string, Command> = {}; }`,
		`${prelude} class Registry { accessor commands: Record<string, Command> = {}; }`,
		`${prelude} let commands: Record<string, Command>; commands = {};`,
		`${prelude} function create(): Record<string, Command> { return {}; }`,
		`${prelude} function create(): Record<string, Command> { const commands: Record<string, Command> = {}; commands.start = startCommand; return commands; }`,
		`${prelude} function create(name: string): Record<string, Command> { const commands: Record<string, Command> = { start: startCommand }; commands[name] = startCommand; return commands; }`,
		`${prelude} function create(name: string): Record<string, Command> { return { [name]: startCommand }; }`,
		`${prelude} function merge(base: Record<string, Command>, extra: Record<string, Command>): Record<string, Command> { const commands: Record<string, Command> = { ...base, ...extra }; commands.start = startCommand; return commands; }`,
		`${prelude} function create(extra: Record<string, Command>): Record<string, Command> { const commands: Record<string, Command> = { start: startCommand, ...extra }; commands.stop = startCommand; return commands; }`,
		`${prelude} function assign(commands: object, name: string) { (commands as Record<string, Command>)[name] = startCommand; }`,
		"function scrub(value: unknown): unknown { if (typeof value === 'string') return 'redacted'; if (Array.isArray(value)) return value.map(scrub); return value; }",
		"function parseJson(raw: string | null): unknown { if (!raw) return null; try { return JSON.parse(raw) as unknown; } catch { return null; } }",
		`${prelude} const create = (): Record<string, Command> => ({});`,
		`${prelude} const commands = {} as Record<string, Command>;`,
		`${prelude} const commands = <Record<string, Command>>{};`,
		`${prelude} const commands = { start: startCommand };`,
		`${prelude} const commands = { start: startCommand } as const;`,
		`${prelude} interface Commands { readonly start: Command } const commands: Commands = { start: startCommand };`,
		`${prelude} type Commands = { readonly start: Command }; const commands: Commands = { start: startCommand };`,
		`${prelude} const commands: { start: Command } = { start: startCommand };`,
		`${prelude} function create(): { start: Command } { return { start: startCommand }; }`,
		"type Permission = 'read' | 'write'; const ranks: Record<Permission, number> = { read: 1, write: 2 };",
		"const ranks: Record<'read' | 'write', number> = { read: 1, write: 2 };",
		"type Permission = 'read' | 'write'; const ranks = { read: 1, write: 2 } satisfies Record<Permission, number>;",
		`${prelude} interface Commands { readonly start: Command } const commands = { start: startCommand } satisfies Commands;`,
		`${prelude} type PermissionLevels = { readonly [Level in Permission]: number }; const levels: PermissionLevels = { admin: 1 };`,
		`${prelude} function create() { return { start: startCommand }; }`,
		`${prelude} interface Commands { readonly start: Command } function create(): Commands { return { start: startCommand }; }`,
		`${prelude} declare function make(): Record<string, Command>; const commands: Record<string, Command> = make();`,
		`${prelude} import { Commands } from './types'; const commands: Commands = { start: startCommand };`,
		"interface ProviderInput { readonly channel: string; readonly cursor?: string } type Mutable<T> = { -readonly [Key in keyof T]: T[Key] }; const input: Mutable<ProviderInput> = { channel: 'alerts' }; input.cursor = 'next';",
	],
	invalid: [
		{ code: 'const value: unknown = {};', errors: [error] },
		{ code: 'const value: object = {};', errors: [error] },
		{ code: 'let value: unknown; value = {};', errors: [error] },
		{ code: 'function create(): unknown { return {}; }', errors: [error] },
		{
			code: `${prelude} const commands: Record<string, Command> = { start: startCommand };`,
			errors: [error],
		},
		{
			code: `${prelude} const commands: Record<string, Command> = { start: startCommand }; commands.start = startCommand;`,
			errors: [error],
		},
		{
			code: `${prelude} const commands: Record<string, Command> = { start: startCommand }; commands.stop = startCommand;`,
			errors: [error],
		},
		{
			code: `${prelude} const commands: Record<string, Command> = { start: startCommand }; commands['stop'] = startCommand;`,
			errors: [error],
		},
		{
			code: `${prelude} const commands: Record<string, Command> = { start: startCommand }; commands['st' + 'op'] = startCommand;`,
			errors: [error],
		},
		{
			code: `${prelude} const key = 'stop'; const commands: Record<string, Command> = { start: startCommand }; commands[key] = startCommand;`,
			errors: [error],
		},
		{
			code: `${prelude} const commands: Record<string, Command> = { start: startCommand }; if (true) commands.start = startCommand;`,
			errors: [error],
		},
		{
			code: `${prelude} const commands = { start: startCommand } satisfies Record<string, Command>;`,
			errors: [broadSatisfiesError],
		},
		{
			code: `${prelude} type Commands = Record<string, Command>; const commands = { start: startCommand } as const satisfies Commands;`,
			errors: [broadSatisfiesError],
		},
		{
			code: `${prelude} type CommandName = string; const commands: Record<CommandName, Command> = { start: startCommand };`,
			errors: [error],
		},
		{
			code: `${prelude} const commands: { [key: string]: Command } = { start: startCommand };`,
			errors: [error],
		},
		{
			code: `${prelude} const commands: { [K in string]: Command } = { start: startCommand };`,
			errors: [error],
		},
		{
			code: `${prelude} interface Commands { readonly [key: string]: Command } const commands: Commands = { start: startCommand };`,
			errors: [error],
		},
		{
			code: `${prelude} interface Commands { readonly [key: string]: Command; readonly __owner?: never } const commands: Commands = { start: startCommand };`,
			errors: [error],
		},
		{
			code: `${prelude} const commands: { [key: string]: Command; start: Command } = { start: startCommand, stop: startCommand };`,
			errors: [error],
		},
		{
			code: `${prelude} interface Commands { readonly [key: string]: Command } const commands = { start: startCommand } satisfies Commands;`,
			errors: [broadSatisfiesError],
		},
		{
			code: `${prelude} const commands = { start: startCommand } as Record<string, Command>;`,
			errors: [error],
		},
		{
			code: `${prelude} const commands = ({ start: startCommand } as Record<string, Command>) as object;`,
			errors: 1,
		},
		{
			code: `${prelude} class Registry { commands: Record<string, Command> = { start: startCommand }; }`,
			errors: [error],
		},
		{
			code: `${prelude} let commands: Record<string, Command>; commands = { start: startCommand };`,
			errors: [error],
		},
		{
			code: `${prelude} function create(): Record<string, Command> { return { start: startCommand }; }`,
			errors: [error],
		},
		{
			code: `${prelude} function create(): Record<string, Command> { const commands: Record<string, Command> = { start: startCommand }; return commands; }`,
			errors: [error, error],
		},
		{
			code: `${prelude} function create(base: { stop: Command }): Record<string, Command> { return { start: startCommand, ...base }; }`,
			errors: [error],
		},
		{
			code: `${prelude} function create(): Record<string, Command> { return { ['start']: startCommand }; }`,
			errors: [error],
		},
		{
			code: `${prelude} function makeExtra(): { stop: Command } { return { stop: startCommand }; } const extra = true ? makeExtra() : {}; const commands: Record<string, Command> = { start: startCommand, ...extra };`,
			errors: [error],
		},
		{ code: "function create(value: unknown): unknown { return 'known'; }", errors: [error] },
		{
			code: 'function create(value: unknown): unknown { if (value) return value as unknown; return { known: true }; }',
			errors: [error],
		},
		{
			code: 'function create(): unknown { void create; return { known: true }; }',
			errors: [error],
		},
		{
			code: "function create(): unknown { create(); return 'known'; }",
			errors: [error],
		},
		{
			code: "function create(): unknown { [1].map(create); return 'known'; }",
			errors: [error],
		},
		{
			code: 'declare function consume(value: unknown): unknown; function create(): unknown { return { known: true, callback: consume(create) }; }',
			errors: [error],
		},
		{
			code: 'function create(): unknown { create(); const known = { value: true }; return known; }',
			errors: [error],
		},
		{
			code: 'function scrub(value: unknown): unknown { if (value) return scrub(value); return { known: true }; }',
			errors: [error],
		},
		{
			code: "function create(value: unknown): unknown { const boundary = value as unknown; return 'known'; }",
			errors: [error],
		},
		{
			code: `${prelude} const source = { start: startCommand }; const commands: Record<string, Command> = source;`,
			errors: [error],
		},
		{
			code: `${prelude} type Open = Record<string, Command>; const source = { start: startCommand }; const commands: Open = source;`,
			errors: [error],
		},
		{
			code: `${prelude} type Open = { [key: string]: Command }; const source = { start: startCommand }; const commands: Open = source;`,
			errors: [error],
		},
		{
			code: `${prelude} type Open = { [key in string]: Command }; const source = { start: startCommand }; const commands: Open = source;`,
			errors: [error],
		},
		{
			code: `${prelude} type Open = Readonly<Record<string, Command>>; const source = { start: startCommand }; const commands: Open = source;`,
			errors: [error],
		},
		{
			code: `${prelude} type Open = Record<string, Command> & { readonly __owner?: never }; const commands: Open = { start: startCommand };`,
			errors: [error],
		},
		{
			code: `${prelude} type Index<T> = Record<string, T>; const commands: Index<Command> = { start: startCommand };`,
			errors: [error],
		},
		{
			code: `${prelude} type Index<T> = Record<string, T>; type CommandsByName = Index<Command>; const commands: CommandsByName = { start: startCommand };`,
			errors: [error],
		},
		{
			code: `${prelude} type Index<T = Command> = Record<string, T>; const commands: Index = { start: startCommand };`,
			errors: [error],
		},
		{
			code: `${prelude} type Mutable<T> = { -readonly [Key in keyof T]: T[Key] }; const commands: Mutable<Record<string, Command>> = { start: startCommand };`,
			errors: [error],
		},
		{ code: 'const value: unknown = 1;', errors: [error] },
		{ code: 'const value: object = [];', errors: [error] },
	],
})
