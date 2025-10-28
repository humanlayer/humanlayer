import { spawn } from 'child_process'
import { DEFAULT_FALLBACK_ORDER, getProviderByName } from '../providers/student-providers'

export interface OpenCodeSessionConfig {
  provider: string
  model: string
  projectPath: string
  apiKey?: string
}

export class OpenCodeIntegration {
  private currentProvider: string | null = null

  async spawnSession(config: OpenCodeSessionConfig): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ['--provider', config.provider, '--model', config.model, '--project', config.projectPath]

      if (config.apiKey) {
        args.push('--api-key', config.apiKey)
      }

      const opencode = spawn('opencode', args, {
        stdio: 'pipe',
        env: {
          ...process.env,
        },
      })

      let output = ''
      let errorOutput = ''

      opencode.stdout?.on('data', (data) => {
        const message = data.toString()
        output += message
        console.log(`OpenCode (${config.provider}): ${message}`)
      })

      opencode.stderr?.on('data', (data) => {
        const message = data.toString()
        errorOutput += message
        console.error(`OpenCode Error: ${message}`)
      })

      opencode.on('close', (code) => {
        if (code === 0) {
          this.currentProvider = config.provider
          resolve(`Session completed successfully with ${config.provider}`)
        } else {
          reject(new Error(`OpenCode exited with code ${code}: ${errorOutput || output}`))
        }
      })

      opencode.on('error', (error) => {
        reject(new Error(`Failed to spawn OpenCode: ${error.message}`))
      })
    })
  }

  async autoFallback(
    primaryProvider: string,
    model: string,
    projectPath: string,
    customFallbackOrder?: string[],
  ): Promise<string> {
    const fallbackOrder = customFallbackOrder || [primaryProvider, ...DEFAULT_FALLBACK_ORDER]

    const uniqueProviders = Array.from(new Set(fallbackOrder))

    console.log(`Starting auto-fallback with order: ${uniqueProviders.join(' → ')}`)

    for (const provider of uniqueProviders) {
      const providerConfig = getProviderByName(provider)

      if (!providerConfig) {
        console.log(`Provider ${provider} not found in configuration, skipping...`)
        continue
      }

      const apiKey = process.env[providerConfig.apiKeyEnv]
      if (!apiKey) {
        console.log(`API key for ${provider} (${providerConfig.apiKeyEnv}) not found, skipping...`)
        continue
      }

      const providerModel = providerConfig.models[0] || model

      try {
        console.log(`Trying ${provider} with model ${providerModel}...`)
        const result = await this.spawnSession({
          provider,
          model: providerModel,
          projectPath,
          apiKey,
        })

        console.log(`✅ Successfully used ${provider}`)
        return result
      } catch (error) {
        console.log(`❌ ${provider} failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
        continue
      }
    }

    throw new Error('All free providers exhausted. Please add API keys or try again later.')
  }

  async checkProviderAvailability(provider: string): Promise<boolean> {
    const providerConfig = getProviderByName(provider)

    if (!providerConfig) {
      return false
    }

    const apiKey = process.env[providerConfig.apiKeyEnv]
    return !!apiKey
  }

  async listAvailableProviders(): Promise<string[]> {
    const providers = DEFAULT_FALLBACK_ORDER
    const available: string[] = []

    for (const provider of providers) {
      if (await this.checkProviderAvailability(provider)) {
        available.push(provider)
      }
    }

    return available
  }

  getCurrentProvider(): string | null {
    return this.currentProvider
  }
}

export async function createOpenCodeSession(
  provider: string,
  model: string,
  projectPath: string,
): Promise<OpenCodeIntegration> {
  const integration = new OpenCodeIntegration()

  await integration.spawnSession({
    provider,
    model,
    projectPath,
  })

  return integration
}

export async function createOpenCodeSessionWithFallback(
  primaryProvider: string,
  model: string,
  projectPath: string,
  customFallbackOrder?: string[],
): Promise<OpenCodeIntegration> {
  const integration = new OpenCodeIntegration()

  await integration.autoFallback(primaryProvider, model, projectPath, customFallbackOrder)

  return integration
}
