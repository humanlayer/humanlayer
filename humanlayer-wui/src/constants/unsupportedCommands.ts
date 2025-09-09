export interface UnsupportedCommand {
  command: string
  message: string
  alternative?: string
}

export const UNSUPPORTED_COMMANDS: UnsupportedCommand[] = [
  {
    command: '/clear',
    message: '/clear is not supported',
    alternative: 'This command disrupts session state. Use Cmd+K to open a new session instead.',
  },
  {
    command: '/compact',
    message: '/compact is not supported',
    alternative: 'This command breaks session tracking. Start a fresh session for a clean context.',
  },
  {
    command: '/help',
    message: '/help is not supported',
    alternative: 'Check the documentation at docs.humanlayer.dev',
  },
  {
    command: '/bug',
    message: '/bug is not supported',
    alternative: 'Use Cmd+Shift+F to report a bug or issue',
  },
  {
    command: '/add-dir',
    message: '/add-dir is not supported',
    alternative: undefined,
  },
  {
    command: '/agents',
    message: '/agents is not supported',
    alternative: undefined,
  },
  {
    command: '/config',
    message: '/config is not supported',
    alternative: undefined,
  },
  {
    command: '/cost',
    message: '/cost is not supported',
    alternative: undefined,
  },
  {
    command: '/doctor',
    message: '/doctor is not supported',
    alternative: undefined,
  },
  {
    command: '/init',
    message: '/init is not supported',
    alternative: undefined,
  },
  {
    command: '/login',
    message: '/login is not supported',
    alternative: undefined,
  },
  {
    command: '/logout',
    message: '/logout is not supported',
    alternative: undefined,
  },
  {
    command: '/mcp',
    message: '/mcp is not supported',
    alternative: undefined,
  },
  {
    command: '/memory',
    message: '/memory is not supported',
    alternative: undefined,
  },
  {
    command: '/model',
    message: '/model is not supported',
    alternative: undefined,
  },
  {
    command: '/permissions',
    message: '/permissions is not supported',
    alternative: undefined,
  },
  {
    command: '/pr_comments',
    message: '/pr_comments is not supported',
    alternative: undefined,
  },
  {
    command: '/review',
    message: '/review is not supported',
    alternative: undefined,
  },
  {
    command: '/status',
    message: '/status is not supported',
    alternative: undefined,
  },
  {
    command: '/terminal-setup',
    message: '/terminal-setup is not supported',
    alternative: undefined,
  },
  {
    command: '/vim',
    message: '/vim is not supported',
    alternative: undefined,
  },
]

export function checkUnsupportedCommand(input: string): UnsupportedCommand | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null

  const commandPart = trimmed.split(' ')[0]
  return UNSUPPORTED_COMMANDS.find(cmd => commandPart === cmd.command) || null
}
