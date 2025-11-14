import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import chalk from 'chalk'
import { getInvocationName, getDefaultSocketPath } from './utils/invocation.js'

// Load environment variables
dotenv.config()

export type RepoMappingObject = {
  repo: string
  profile?: string
}

export type ProfileConfig = {
  thoughtsRepo: string
  reposDir: string
  globalDir: string
}

export type ConfigFile = {
  www_base_url?: string
  daemon_socket?: string
  run_id?: string
  thoughts?: {
    thoughtsRepo: string
    reposDir: string
    globalDir: string
    user: string
    repoMappings: Record<string, string | RepoMappingObject>
    profiles?: Record<string, ProfileConfig>
  }
}

export type ConfigSource = 'flag' | 'env' | 'config' | 'default' | 'none'

export interface ConfigValue<T = string> {
  value: T
  source: ConfigSource
  sourceName?: string // Specific env var name or file path
}

export interface ConfigSchema {
  www_base_url: {
    envVar: 'HUMANLAYER_WWW_BASE_URL'
    configKey: 'www_base_url'
    flagKey: 'wwwBase'
    defaultValue: string
    required: boolean
  }
  daemon_socket: {
    envVar: 'HUMANLAYER_DAEMON_SOCKET'
    configKey: 'daemon_socket'
    flagKey: 'daemonSocket'
    defaultValue: string
    required: boolean
  }
  run_id: {
    envVar: 'HUMANLAYER_RUN_ID'
    configKey: 'run_id'
    flagKey: 'runId'
    defaultValue?: string
    required: boolean
  }
}

const CONFIG_SCHEMA: ConfigSchema = {
  www_base_url: {
    envVar: 'HUMANLAYER_WWW_BASE_URL',
    configKey: 'www_base_url',
    flagKey: 'wwwBase',
    defaultValue: 'https://www.humanlayer.dev',
    required: true,
  },
  daemon_socket: {
    envVar: 'HUMANLAYER_DAEMON_SOCKET',
    configKey: 'daemon_socket',
    flagKey: 'daemonSocket',
    defaultValue: getDefaultSocketPath(getInvocationName()),
    required: true,
  },
  run_id: {
    envVar: 'HUMANLAYER_RUN_ID',
    configKey: 'run_id',
    flagKey: 'runId',
    required: false,
  },
}

export class ConfigResolver {
  public configFile: ConfigFile
  private configFilePath: string

  constructor(options: { configFile?: string } = {}) {
    this.configFile = this.loadConfigFile(options.configFile)
    this.configFilePath = this.getConfigFilePath(options.configFile)
  }

  private loadConfigFile(configFile?: string): ConfigFile {
    if (configFile) {
      const configContent = fs.readFileSync(configFile, 'utf8')
      return JSON.parse(configContent)
    }

    // these do not merge today
    const configPaths = ['humanlayer.json', getDefaultConfigPath()]

    for (const configPath of configPaths) {
      try {
        if (fs.existsSync(configPath)) {
          const configContent = fs.readFileSync(configPath, 'utf8')
          return JSON.parse(configContent)
        }
      } catch (error) {
        console.error(chalk.yellow(`Warning: Could not parse config file ${configPath}: ${error}`))
      }
    }

    return {}
  }

  private getConfigFilePath(configFile?: string): string {
    if (configFile) return configFile

    const configPaths = ['humanlayer.json', getDefaultConfigPath()]
    for (const configPath of configPaths) {
      try {
        if (fs.existsSync(configPath)) {
          return configPath
        }
      } catch {
        // Continue to next path
      }
    }
    return getDefaultConfigPath() // fallback
  }

  resolveValue<K extends keyof ConfigSchema>(
    key: K,
    options: Record<string, unknown> = {},
  ): ConfigValue<string | undefined> {
    const schema = CONFIG_SCHEMA[key]

    // Check flag
    if (options[schema.flagKey]) {
      return {
        value: options[schema.flagKey],
        source: 'flag',
        sourceName: 'flag',
      }
    }

    // Check environment
    const envValue = process.env[schema.envVar]
    if (envValue) {
      return {
        value: envValue,
        source: 'env',
        sourceName: schema.envVar,
      }
    }

    // Check config file
    const configValue = this.configFile[schema.configKey]
    if (configValue) {
      return {
        value: configValue,
        source: 'config',
        sourceName: this.configFilePath,
      }
    }

    // Use default
    if (schema.defaultValue) {
      return {
        value: schema.defaultValue,
        source: 'default',
        sourceName: 'default',
      }
    }

    // Not set
    return {
      value: undefined,
      source: 'none',
      sourceName: 'none',
    }
  }

  resolveAll(options: Record<string, unknown> = {}) {
    const www_base_url = this.resolveValue('www_base_url', options)
    const daemon_socket = this.resolveValue('daemon_socket', options)
    const run_id = this.resolveValue('run_id', options)

    return {
      www_base_url,
      daemon_socket,
      run_id,
    }
  }

  // Legacy compatibility
  resolveFullConfig(options: Record<string, unknown> = {}) {
    const resolved = this.resolveAll(options)
    return {
      www_base_url: resolved.www_base_url.value!,
      daemon_socket: resolved.daemon_socket.value!,
      run_id: resolved.run_id.value,
    }
  }
}

export function loadConfigFile(configFile?: string): ConfigFile {
  const resolver = new ConfigResolver({ configFile })
  return resolver.loadConfigFile(configFile)
}

export function saveConfigFile(config: ConfigFile, configFile?: string): void {
  const configPath = configFile || getDefaultConfigPath()

  console.log(chalk.yellow(`Writing config to ${configPath}`))

  // Create directory if it doesn't exist
  const configDir = path.dirname(configPath)
  fs.mkdirSync(configDir, { recursive: true })

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))

  console.log(chalk.green('Config saved successfully'))
}

export function getDefaultConfigPath(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || '', '.config')
  return path.join(xdgConfigHome, 'humanlayer', 'humanlayer.json')
}

export type ResolvedConfig = {
  www_base_url: string
  daemon_socket: string
  run_id?: string
}

export type ConfigWithSources = {
  www_base_url: ConfigValue<string>
  daemon_socket: ConfigValue<string>
  run_id?: ConfigValue<string | undefined>
}

// Legacy compatibility functions
export function resolveConfigWithSources(options: Record<string, unknown> = {}): ConfigWithSources {
  const resolver = new ConfigResolver(options)
  const resolved = resolver.resolveAll(options)

  return {
    www_base_url: resolved.www_base_url as ConfigValue<string>,
    daemon_socket: resolved.daemon_socket as ConfigValue<string>,
    run_id: resolved.run_id,
  }
}

export function resolveFullConfig(options: Record<string, unknown> = {}): ResolvedConfig {
  const resolver = new ConfigResolver(options)
  return resolver.resolveFullConfig(options)
}
