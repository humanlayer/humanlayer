export interface ProviderConfig {
  name: string
  apiKeyEnv: string
  models: string[]
  endpoint: string
  free?: boolean
  studentProgram?: string
  description?: string
}

export const STUDENT_PROVIDERS: Record<string, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'],
    endpoint: 'https://api.anthropic.com/v1',
  },

  openrouter: {
    name: 'OpenRouter',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    models: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o-mini', 'google/gemini-pro'],
    endpoint: 'https://openrouter.ai/api/v1',
    free: true,
  },

  baseten: {
    name: 'Baseten',
    apiKeyEnv: 'BASETEN_API_KEY',
    models: ['deepseek-ai/DeepSeek-V3.1', 'qwen/qwen-2.5-coder-32b-instruct'],
    endpoint: 'https://bridge.baseten.co/v1',
  },

  'github-copilot': {
    name: 'GitHub Copilot',
    apiKeyEnv: 'GITHUB_TOKEN',
    models: ['gpt-4', 'gpt-3.5-turbo'],
    endpoint: 'https://api.githubcopilot.com/v1',
    free: true,
    studentProgram: 'GitHub Education (Free for students)',
  },

  deepseek: {
    name: 'DeepSeek',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    models: ['deepseek-coder', 'deepseek-chat'],
    endpoint: 'https://api.deepseek.com/v1',
    free: true,
    studentProgram: 'Free tier via OpenRouter',
  },

  groq: {
    name: 'Groq',
    apiKeyEnv: 'GROQ_API_KEY',
    models: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768', 'deepseek-r1-distill-llama-70b'],
    endpoint: 'https://api.groq.com/openai/v1',
    free: true,
    studentProgram: 'Free tier (600 RPM)',
  },

  'together-ai': {
    name: 'Together AI',
    apiKeyEnv: 'TOGETHER_API_KEY',
    models: ['meta-llama/Llama-3-70b-chat-hf', 'codellama/CodeLlama-34b-Instruct'],
    endpoint: 'https://api.together.xyz/v1',
    studentProgram: 'Research Credits ($200-600)',
  },

  'fireworks-ai': {
    name: 'Fireworks AI',
    apiKeyEnv: 'FIREWORKS_API_KEY',
    models: ['accounts/fireworks/models/llama-v3p1-70b-instruct', 'accounts/fireworks/models/deepseek-coder-34b'],
    endpoint: 'https://api.fireworks.ai/inference/v1',
    studentProgram: 'Student Program ($500 credits)',
  },

  mistral: {
    name: 'Mistral AI',
    apiKeyEnv: 'MISTRAL_API_KEY',
    models: ['mistral-large-latest', 'codestral-latest'],
    endpoint: 'https://api.mistral.ai/v1',
    studentProgram: 'Student Plan ($6.99/mo for $120 credits)',
  },

  'azure-openai': {
    name: 'Azure OpenAI',
    apiKeyEnv: 'AZURE_OPENAI_KEY',
    endpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
    models: ['gpt-4', 'gpt-35-turbo'],
    studentProgram: 'GitHub Student Pack ($100/year)',
  },

  'aws-bedrock': {
    name: 'Amazon Bedrock',
    apiKeyEnv: 'AWS_ACCESS_KEY_ID',
    models: ['anthropic.claude-v2', 'meta.llama2-70b-chat-v1'],
    endpoint: 'https://bedrock-runtime.us-east-1.amazonaws.com',
    studentProgram: 'AWS Educate ($25-300 credits)',
  },

  'vertex-ai': {
    name: 'Google Vertex AI',
    apiKeyEnv: 'GOOGLE_APPLICATION_CREDENTIALS',
    models: ['gemini-1.5-pro', 'gemini-1.5-flash'],
    endpoint: 'https://us-central1-aiplatform.googleapis.com',
    studentProgram: 'GCP Free Trial + Student Credits ($300)',
  },

  huggingface: {
    name: 'HuggingFace',
    apiKeyEnv: 'HUGGINGFACE_API_KEY',
    models: ['bigcode/starcoder2-15b', 'codellama/CodeLlama-13b-hf'],
    endpoint: 'https://api-inference.huggingface.co',
    free: true,
  },

  'github-models': {
    name: 'GitHub Models',
    apiKeyEnv: 'GITHUB_TOKEN',
    models: ['gpt-4o', 'meta-llama-3.1-70b-instruct', 'deepseek-r1'],
    endpoint: 'https://models.inference.ai.azure.com',
    free: true,
    studentProgram: 'GitHub Free Tier',
    description: 'Free AI models through GitHub',
  },

  'opencode-zen': {
    name: 'OpenCode Zen',
    apiKeyEnv: 'OPENCODE_API_KEY',
    models: ['claude-sonnet-4.5', 'gpt-5', 'qwen3-coder-480b'],
    endpoint: 'https://opencode.ai/api/v1',
    description: 'Curated models optimized for coding agents',
  },
}

export function getProviderByName(name: string): ProviderConfig | undefined {
  return STUDENT_PROVIDERS[name]
}

export function getAvailableProviders(): string[] {
  return Object.keys(STUDENT_PROVIDERS)
}

export function getFreeProviders(): string[] {
  return Object.entries(STUDENT_PROVIDERS)
    .filter(([_, config]) => config.free)
    .map(([name, _]) => name)
}

export function getStudentProviders(): Record<string, ProviderConfig> {
  return Object.entries(STUDENT_PROVIDERS)
    .filter(([_, config]) => config.studentProgram || config.free)
    .reduce(
      (acc, [name, config]) => {
        acc[name] = config
        return acc
      },
      {} as Record<string, ProviderConfig>,
    )
}

export const DEFAULT_FALLBACK_ORDER = [
  'github-copilot',
  'deepseek',
  'groq',
  'github-models',
  'huggingface',
  'together-ai',
  'fireworks-ai',
  'openrouter',
  'baseten',
]
