/**
 * Configuration System v2 Wrapper
 *
 * This file maintains backward compatibility while delegating to the new
 * high-performance configuration system in configV2.ts
 *
 * Key improvements in v2:
 * - Singleton pattern eliminates repeated file reads
 * - In-memory caching of parsed configurations
 * - Configuration validation at load time
 * - Better error messages
 * - Consistent path expansion
 *
 * @deprecated Use configV2.ts directly for new code
 */

import {
  ConfigFile as ConfigFileV2,
  ConfigValue as ConfigValueV2,
  ConfigManager,
  ContactChannel,
} from './configV2.js'

// Re-export types for backward compatibility
export type ConfigFile = ConfigFileV2
export type ConfigSource = ConfigValueV2<unknown>['source']
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ConfigValue<T = string> extends ConfigValueV2<T> {}

// Legacy ConfigSchema interface - not used in v2 but kept for compatibility
export interface ConfigSchema {
  api_key: {
    envVar: 'HUMANLAYER_API_KEY'
    configKey: 'api_key'
    flagKey: 'apiKey'
    defaultValue?: string
    required: boolean
  }
  api_base_url: {
    envVar: 'HUMANLAYER_API_BASE'
    configKey: 'api_base_url'
    flagKey: 'apiBase'
    defaultValue: string
    required: boolean
  }
  app_base_url: {
    envVar: 'HUMANLAYER_APP_URL'
    configKey: 'app_base_url'
    flagKey: 'appBase'
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

/**
 * Legacy ConfigResolver class - maintained for backward compatibility
 *
 * @deprecated Use ConfigManager from configV2.ts instead
 */
export class ConfigResolver {
  public configFile: ConfigFile
  private manager: ConfigManager
  private options: Record<string, unknown>

  constructor(options: { configFile?: string } = {}) {
    this.manager = ConfigManager.getInstance()
    this.options = options

    // Load config through v2 system and extract the file content
    const resolved = this.manager.resolve(options)
    this.configFile = {
      channel: resolved.contact_channel || {},
      api_key: resolved.api_key,
      api_base_url: resolved.api_base_url,
      app_base_url: resolved.app_base_url,
      daemon_socket: resolved.daemon_socket,
      run_id: resolved.run_id,
      thoughts: resolved.thoughts,
    }
  }

  /**
   * @deprecated Internal method - use ConfigManager directly
   */
  loadConfigFile(configFile?: string): ConfigFile {
    const resolved = this.manager.resolve({ ...this.options, configFile })
    return {
      channel: resolved.contact_channel || {},
      api_key: resolved.api_key,
      api_base_url: resolved.api_base_url,
      app_base_url: resolved.app_base_url,
      daemon_socket: resolved.daemon_socket,
      run_id: resolved.run_id,
      thoughts: resolved.thoughts,
    }
  }

  /**
   * @deprecated Use ConfigManager.resolveWithSources instead
   */
  resolveValue<K extends keyof ConfigSchema>(
    key: K,
    options: Record<string, unknown> = {},
  ): ConfigValue<string | undefined> {
    const sources = this.manager.resolveWithSources({ ...this.options, ...options })
    const mappedKey = key as keyof typeof sources
    return sources[mappedKey] || { value: undefined, source: 'none' }
  }

  /**
   * @deprecated Use ConfigManager.resolveWithSources instead
   */
  resolveAll(options: Record<string, unknown> = {}) {
    return this.manager.resolveWithSources({ ...this.options, ...options })
  }

  /**
   * @deprecated Use ConfigManager.resolve instead
   */
  resolveFullConfig(options: Record<string, unknown> = {}) {
    return this.manager.resolve({ ...this.options, ...options })
  }
}

/**
 * @deprecated Use ConfigManager.getInstance().resolve() instead
 */
export function loadConfigFile(configFile?: string): ConfigFile {
  const config = ConfigManager.getInstance().resolve({ configFile })
  return {
    channel: config.contact_channel || {},
    api_key: config.api_key,
    api_base_url: config.api_base_url,
    app_base_url: config.app_base_url,
    daemon_socket: config.daemon_socket,
    run_id: config.run_id,
    thoughts: config.thoughts,
  }
}

/**
 * @deprecated Contact channel resolution is now handled internally by ConfigManager
 */
interface ContactChannelOptions {
  slackChannel?: string
  slackBotToken?: string
  slackContext?: string
  slackThreadTs?: string
  slackBlocks?: boolean
  email?: string
  emailAddress?: string
  emailContext?: string
}

/**
 * @deprecated Use ConfigManager.resolve().contact_channel instead
 */
export function buildContactChannel(
  options: ContactChannelOptions,
  _config: ConfigFile,
): ContactChannel {
  // Delegate to v2 system which handles all the resolution logic
  const resolved = ConfigManager.getInstance().resolve(options)
  return resolved.contact_channel
}

/**
 * @deprecated Use ConfigManager.getInstance().saveConfig() instead
 */
export function saveConfigFile(config: ConfigFile, configFile?: string): void {
  ConfigManager.getInstance().saveConfig(config, configFile)
}

/**
 * @deprecated Import from configV2.js instead
 */
export { getDefaultConfigPath } from './configV2.js'

// Re-export types from v2
export type ResolvedConfig = {
  api_key?: string
  api_base_url: string
  app_base_url: string
  daemon_socket: string
  run_id?: string
  contact_channel: ContactChannel
}

export type ConfigWithSources = {
  api_key?: ConfigValue<string | undefined>
  api_base_url: ConfigValue<string>
  app_base_url: ConfigValue<string>
  daemon_socket: ConfigValue<string>
  run_id?: ConfigValue<string | undefined>
  contact_channel: ConfigValue<ContactChannel>
}

/**
 * @deprecated Import from configV2.js instead
 */
export { resolveConfigWithSources, resolveFullConfig, maskSensitiveValue } from './configV2.js'
