import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import chalk from 'chalk'
import { ContactChannel } from '@humanlayer/sdk'

// Load environment variables
dotenv.config()

// Configuration value types
export interface ConfigValue<T = string> {
  value: T
  source: 'flag' | 'env' | 'config' | 'default' | 'none'
  sourceName?: string // Specific env var name or file path
}

// Configuration schema
export interface ConfigSchema {
  api_key: string | undefined
  api_base_url: string
  app_base_url: string
  daemon_socket: string
  run_id: string | undefined
  contact_channel: ContactChannel
  thoughts?: ThoughtsConfig
}

export interface ThoughtsConfig {
  thoughtsRepo: string
  reposDir: string
  globalDir: string
  user: string
  repoMappings: Record<string, string>
}

// Configuration file structure
export interface ConfigFile {
  channel?: ContactChannel
  api_key?: string
  api_base_url?: string
  app_base_url?: string
  daemon_socket?: string
  run_id?: string
  thoughts?: ThoughtsConfig
}

// Configuration validation schema
interface ConfigFieldDef {
  envVar?: string
  configKey: keyof ConfigFile
  flagKey?: string
  defaultValue?: string
  required: boolean
  validate?: (value: string) => boolean
}

const CONFIG_FIELD_DEFS: Record<
  keyof Omit<ConfigSchema, 'contact_channel' | 'thoughts'>,
  ConfigFieldDef
> = {
  api_key: {
    envVar: 'HUMANLAYER_API_KEY',
    configKey: 'api_key',
    flagKey: 'apiKey',
    required: false,
  },
  api_base_url: {
    envVar: 'HUMANLAYER_API_BASE',
    configKey: 'api_base_url',
    flagKey: 'apiBase',
    defaultValue: 'https://api.humanlayer.dev/humanlayer/v1',
    required: true,
    validate: value => value.startsWith('http'),
  },
  app_base_url: {
    envVar: 'HUMANLAYER_APP_URL',
    configKey: 'app_base_url',
    flagKey: 'appBase',
    defaultValue: 'https://app.humanlayer.dev',
    required: true,
    validate: value => value.startsWith('http'),
  },
  daemon_socket: {
    envVar: 'HUMANLAYER_DAEMON_SOCKET',
    configKey: 'daemon_socket',
    flagKey: 'daemonSocket',
    defaultValue: '~/.humanlayer/daemon.sock',
    required: true,
  },
  run_id: {
    envVar: 'HUMANLAYER_RUN_ID',
    configKey: 'run_id',
    flagKey: 'runId',
    required: false,
  },
}

// Singleton configuration manager
export class ConfigManager {
  private static instance: ConfigManager | null = null
  private configCache: Map<string, ConfigFile> = new Map()
  private resolvedCache: Map<string, ConfigSchema> = new Map()

  private constructor() {}

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager()
    }
    return ConfigManager.instance
  }

  static reset(): void {
    ConfigManager.instance = null
  }

  private getCacheKey(options: Record<string, unknown>): string {
    const configFile = options.configFile as string | undefined
    return configFile || 'default'
  }

  private loadConfigFile(configFile?: string): ConfigFile {
    const cacheKey = configFile || 'default'

    // Check cache
    if (this.configCache.has(cacheKey)) {
      return this.configCache.get(cacheKey)!
    }

    let config: ConfigFile = { channel: {} }

    if (configFile) {
      // Load specific file
      try {
        if (fs.existsSync(configFile)) {
          const content = fs.readFileSync(configFile, 'utf8')
          config = JSON.parse(content)
          this.validateConfig(config)
        }
      } catch (error) {
        throw new Error(`Failed to load config from ${configFile}: ${error}`)
      }
    } else {
      // Try default locations
      const configPaths = ['humanlayer.json', this.getDefaultConfigPath()]

      for (const configPath of configPaths) {
        try {
          if (fs.existsSync(configPath)) {
            const content = fs.readFileSync(configPath, 'utf8')
            config = JSON.parse(content)
            this.validateConfig(config)
            break
          }
        } catch (error) {
          console.warn(chalk.yellow(`Warning: Could not parse config file ${configPath}: ${error}`))
        }
      }
    }

    // Cache the loaded config
    this.configCache.set(cacheKey, config)
    return config
  }

  private validateConfig(config: ConfigFile): void {
    // Basic structure validation
    if (typeof config !== 'object' || config === null) {
      throw new Error('Config must be an object')
    }

    // Validate URL fields if present
    if (config.api_base_url && !config.api_base_url.startsWith('http')) {
      throw new Error('api_base_url must be a valid URL')
    }
    if (config.app_base_url && !config.app_base_url.startsWith('http')) {
      throw new Error('app_base_url must be a valid URL')
    }
  }

  private getDefaultConfigPath(): string {
    const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || '', '.config')
    return path.join(xdgConfigHome, 'humanlayer', 'humanlayer.json')
  }

  private expandPath(filePath: string): string {
    if (filePath.startsWith('~/')) {
      return path.join(process.env.HOME || '', filePath.slice(2))
    }
    return path.resolve(filePath)
  }

  private resolveValue<K extends keyof typeof CONFIG_FIELD_DEFS>(
    key: K,
    options: Record<string, unknown>,
    config: ConfigFile,
  ): ConfigValue<string | undefined> {
    const def = CONFIG_FIELD_DEFS[key]

    // 1. Check command line flags
    if (def.flagKey && options[def.flagKey]) {
      const value = String(options[def.flagKey])
      if (def.validate && !def.validate(value)) {
        throw new Error(`Invalid value for ${key}: ${value}`)
      }
      return { value, source: 'flag', sourceName: `--${def.flagKey}` }
    }

    // 2. Check environment variables
    if (def.envVar && process.env[def.envVar]) {
      const value = process.env[def.envVar]!
      if (def.validate && !def.validate(value)) {
        throw new Error(`Invalid value for ${key} from ${def.envVar}: ${value}`)
      }
      return { value, source: 'env', sourceName: def.envVar }
    }

    // 3. Check config file
    const configValue = config[def.configKey]
    if (configValue !== undefined) {
      const value = String(configValue)
      if (def.validate && !def.validate(value)) {
        throw new Error(`Invalid value for ${key} in config file: ${value}`)
      }
      return { value, source: 'config', sourceName: 'config file' }
    }

    // 4. Use default
    if (def.defaultValue !== undefined) {
      return { value: def.defaultValue, source: 'default', sourceName: 'default' }
    }

    // 5. Not set
    return { value: undefined, source: 'none' }
  }

  private resolveContactChannel(options: Record<string, unknown>, config: ConfigFile): ContactChannel {
    const channel: ContactChannel = {}

    // Resolve Slack configuration
    const slackChannelId =
      (options.slackChannel as string) ||
      process.env.HUMANLAYER_SLACK_CHANNEL ||
      config.channel?.slack?.channel_or_user_id

    const slackBotToken =
      (options.slackBotToken as string) ||
      process.env.HUMANLAYER_SLACK_BOT_TOKEN ||
      config.channel?.slack?.bot_token

    const slackContext =
      (options.slackContext as string) ||
      process.env.HUMANLAYER_SLACK_CONTEXT ||
      config.channel?.slack?.context_about_channel_or_user

    const slackThreadTs =
      (options.slackThreadTs as string) ||
      process.env.HUMANLAYER_SLACK_THREAD_TS ||
      config.channel?.slack?.thread_ts

    const slackBlocks =
      options.slackBlocks !== undefined
        ? Boolean(options.slackBlocks)
        : process.env.HUMANLAYER_SLACK_BLOCKS === 'true' ||
          config.channel?.slack?.experimental_slack_blocks ||
          true

    if (slackChannelId || slackBotToken) {
      channel.slack = {
        channel_or_user_id: slackChannelId || '',
        experimental_slack_blocks: slackBlocks,
      }
      if (slackBotToken) channel.slack.bot_token = slackBotToken
      if (slackContext) channel.slack.context_about_channel_or_user = slackContext
      if (slackThreadTs) channel.slack.thread_ts = slackThreadTs
    }

    // Resolve Email configuration
    const emailAddress =
      (options.emailAddress as string) ||
      process.env.HUMANLAYER_EMAIL_ADDRESS ||
      config.channel?.email?.address

    const emailContext =
      (options.emailContext as string) ||
      process.env.HUMANLAYER_EMAIL_CONTEXT ||
      config.channel?.email?.context_about_user

    if (emailAddress) {
      channel.email = { address: emailAddress }
      if (emailContext) channel.email.context_about_user = emailContext
    }

    return channel
  }

  resolve(options: Record<string, unknown> = {}): ConfigSchema {
    const cacheKey = this.getCacheKey(options)

    // Check resolved cache
    if (this.resolvedCache.has(cacheKey)) {
      return this.resolvedCache.get(cacheKey)!
    }

    // Load config file
    const config = this.loadConfigFile(options.configFile as string | undefined)

    // Resolve all values
    const resolved: ConfigSchema = {
      api_key: this.resolveValue('api_key', options, config).value,
      api_base_url: this.resolveValue('api_base_url', options, config).value!,
      app_base_url: this.resolveValue('app_base_url', options, config).value!,
      daemon_socket: this.expandPath(this.resolveValue('daemon_socket', options, config).value!),
      run_id: this.resolveValue('run_id', options, config).value,
      contact_channel: this.resolveContactChannel(options, config),
      thoughts: config.thoughts,
    }

    // Validate required fields
    for (const [key, def] of Object.entries(CONFIG_FIELD_DEFS)) {
      if (def.required && !resolved[key as keyof ConfigSchema]) {
        throw new Error(`Required configuration field '${key}' is not set`)
      }
    }

    // Cache the resolved config
    this.resolvedCache.set(cacheKey, resolved)
    return resolved
  }

  resolveWithSources(
    options: Record<string, unknown> = {},
  ): Record<keyof ConfigSchema, ConfigValue<unknown>> {
    const config = this.loadConfigFile(options.configFile as string | undefined)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = {}

    // Resolve standard fields
    for (const key of Object.keys(CONFIG_FIELD_DEFS) as Array<keyof typeof CONFIG_FIELD_DEFS>) {
      result[key] = this.resolveValue(key, options, config)
      // Expand paths for daemon_socket
      if (key === 'daemon_socket' && result[key].value) {
        result[key].value = this.expandPath(result[key].value)
      }
    }

    // Add contact channel and thoughts
    result.contact_channel = {
      value: this.resolveContactChannel(options, config),
      source: 'computed',
      sourceName: 'multiple sources',
    }

    if (config.thoughts) {
      result.thoughts = {
        value: config.thoughts,
        source: 'config',
        sourceName: 'config file',
      }
    }

    return result
  }

  saveConfig(config: ConfigFile, configFile?: string): void {
    const configPath = configFile || this.getDefaultConfigPath()

    // Validate before saving
    this.validateConfig(config)

    // Create directory if needed
    const configDir = path.dirname(configPath)
    fs.mkdirSync(configDir, { recursive: true })

    // Write config
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))

    // Clear caches
    this.configCache.clear()
    this.resolvedCache.clear()

    console.log(chalk.green(`Config saved to ${configPath}`))
  }
}

// Legacy compatibility exports
export function resolveFullConfig(options: Record<string, unknown> = {}): ConfigSchema {
  return ConfigManager.getInstance().resolve(options)
}

export function resolveConfigWithSources(
  options: Record<string, unknown> = {},
): Record<keyof ConfigSchema, ConfigValue<unknown>> {
  return ConfigManager.getInstance().resolveWithSources(options)
}

export function saveConfigFile(config: ConfigFile, configFile?: string): void {
  ConfigManager.getInstance().saveConfig(config, configFile)
}

export function getDefaultConfigPath(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || '', '.config')
  return path.join(xdgConfigHome, 'humanlayer', 'humanlayer.json')
}

export function maskSensitiveValue(value: string | undefined): string {
  if (!value) return '<not set>'
  if (value.length <= 6) return value + '...'
  return value.substring(0, 6) + '...'
}

// Re-export types for compatibility
export type { ConfigFile, ContactChannel }
