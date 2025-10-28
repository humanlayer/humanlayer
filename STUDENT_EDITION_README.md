# CodeLayer Student Edition 🎓

> A student-optimized fork of [HumanLayer](https://github.com/humanlayer/humanlayer) with support for 13+ free AI providers and OpenCode Zen integration.

## 🌟 What's Different?

This fork extends the original HumanLayer/CodeLayer with:

- **13+ Student AI Providers**: GitHub Copilot, DeepSeek, Groq, Together AI, Fireworks AI, and more
- **Auto-Fallback System**: Automatically switches to free providers when primary credits run out
- **OpenCode Zen Integration**: Seamless integration with OpenCode TUI
- **Cost Tracking**: Monitor your API usage across all providers
- **Student Credits Manager**: Keep track of your free credits and student programs

## 🎯 Supported Providers

### Free Tier Providers
- **GitHub Copilot** - Free for students via GitHub Education
- **DeepSeek** - Free tier via OpenRouter
- **Groq** - Free tier (600 RPM)
- **GitHub Models** - Free tier with multiple models
- **HuggingFace** - Free inference API

### Student Credit Programs
- **Together AI** - $200-600 research credits
- **Fireworks AI** - $500 student credits
- **Azure OpenAI** - $100/year via GitHub Student Pack
- **AWS Bedrock** - $25-300 via AWS Educate
- **Vertex AI** - $300 GCP free trial + student credits
- **Mistral AI** - Student plan ($6.99/mo for $120 credits)

### OpenCode Zen
- Curated models optimized for coding agents
- Models: Claude Sonnet 4.5, GPT-5, Qwen3 Coder 480B

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/chindris-mihai-alexandru/humanlayer.git
cd humanlayer
git checkout student-providers
npm install
npm run build
```

### 2. Configure Your API Keys

Create a `.env` file:

```bash
# Primary provider (GitHub Copilot - Free for students)
GITHUB_TOKEN=your_github_token

# Free tier backups
DEEPSEEK_API_KEY=your_deepseek_key
GROQ_API_KEY=your_groq_key
HUGGINGFACE_API_KEY=your_hf_key

# Student credit providers
TOGETHER_API_KEY=your_together_key
FIREWORKS_API_KEY=your_fireworks_key
MISTRAL_API_KEY=your_mistral_key

# Cloud providers (optional)
AZURE_OPENAI_KEY=your_azure_key
AZURE_OPENAI_ENDPOINT=https://your-endpoint.openai.azure.com
AWS_ACCESS_KEY_ID=your_aws_key
AWS_SECRET_ACCESS_KEY=your_aws_secret
GOOGLE_APPLICATION_CREDENTIALS=/path/to/gcp-credentials.json

# OpenCode Zen (if you have access)
OPENCODE_API_KEY=your_opencode_key
```

### 3. Configure Student Settings

Copy the default student config:

```bash
cp student-config.json ~/.codelayer/student-config.json
```

Edit `~/.codelayer/student-config.json` to customize:

```json
{
  "providers": {
    "primary": "github-copilot",
    "fallback": ["deepseek", "groq", "github-models"],
    "cloud": ["azure-openai", "aws-bedrock", "vertex-ai"]
  },
  "autoFallback": true,
  "studentMode": true,
  "costTracking": true
}
```

### 4. Run CodeLayer

```bash
npm run dev
```

## 📚 Usage Examples

### Basic Usage

```typescript
import { createOpenCodeSessionWithFallback } from './humanlayer-wui/src/lib/integrations/opencode'

// Automatically tries github-copilot, then falls back to free providers
const session = await createOpenCodeSessionWithFallback(
  'github-copilot',
  'gpt-4',
  '/path/to/your/project'
)
```

### Custom Fallback Order

```typescript
const session = await createOpenCodeSessionWithFallback(
  'together-ai',
  'meta-llama/Llama-3-70b-chat-hf',
  '/path/to/your/project',
  ['together-ai', 'fireworks-ai', 'groq', 'deepseek'] // Custom order
)
```

### Check Provider Availability

```typescript
import { OpenCodeIntegration } from './humanlayer-wui/src/lib/integrations/opencode'

const integration = new OpenCodeIntegration()
const available = await integration.listAvailableProviders()
console.log('Available providers:', available)
```

## 🎓 Getting Student Credits

### GitHub Education Pack
1. Visit [education.github.com](https://education.github.com/pack)
2. Verify your student status
3. Get free GitHub Copilot, Azure credits, and more

### AWS Educate
1. Visit [aws.amazon.com/education/awseducate](https://aws.amazon.com/education/awseducate)
2. Sign up with your .edu email
3. Get $25-300 in AWS credits

### GCP Student Credits
1. Visit [cloud.google.com/edu](https://cloud.google.com/edu)
2. Apply with your university email
3. Get $300 in free credits

### Together AI Research Credits
1. Visit [together.ai](https://www.together.ai/)
2. Sign up and mention you're doing research
3. Request research credits ($200-600)

### Fireworks AI Student Program
1. Visit [fireworks.ai](https://fireworks.ai/)
2. Apply for student program
3. Get $500 in credits

## 🔄 Auto-Fallback System

The auto-fallback system automatically tries providers in this order:

1. **Primary Provider** (e.g., github-copilot)
2. **DeepSeek** (Free tier)
3. **Groq** (Free tier, fast inference)
4. **GitHub Models** (Free tier)
5. **HuggingFace** (Free inference)
6. **Together AI** (If you have credits)
7. **Fireworks AI** (If you have credits)
8. **OpenRouter** (Free tier for some models)
9. **Baseten** (If configured)

### How It Works

When your primary provider hits a rate limit or fails:

```
🔄 Starting auto-fallback with order: github-copilot → deepseek → groq → github-models
❌ github-copilot failed: Rate limit exceeded
🔄 Trying deepseek with model deepseek-coder...
✅ Successfully used deepseek
```

## 📊 Cost Tracking

Enable cost tracking in your config:

```json
{
  "costTracking": true,
  "notifications": {
    "onProviderSwitch": true,
    "onLimitApproaching": true,
    "limitThreshold": 80
  }
}
```

You'll get notifications when:
- You switch providers (rate limit hit)
- You're approaching your monthly limit (80% threshold)
- A provider fails and falls back

## 🔗 OpenCode Integration

This fork includes native OpenCode TUI integration:

```bash
# Launch OpenCode with auto-fallback
opencode --provider github-copilot --model gpt-4 --project .

# If github-copilot fails, automatically tries:
# → deepseek → groq → github-models → ...
```

## 🤝 Contributing Back to Upstream

This is a fork of [humanlayer/humanlayer](https://github.com/humanlayer/humanlayer). To contribute:

1. Work on features in the `student-providers` branch
2. Pull upstream changes regularly:
   ```bash
   git fetch upstream
   git merge upstream/main
   ```
3. Submit PRs to upstream for features that benefit all users

## 📝 Differences from Official HumanLayer

| Feature | Official HumanLayer | Student Edition |
|---------|---------------------|-----------------|
| Supported Providers | 3 (Anthropic, OpenRouter, Baseten) | 13+ |
| Auto-Fallback | ❌ | ✅ |
| Student Credits | ❌ | ✅ Tracked |
| Cost Tracking | ❌ | ✅ |
| OpenCode Integration | ❌ | ✅ |
| Free Tier Focus | ❌ | ✅ |

## 🛠️ Development

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run in development mode
npm run dev

# Run tests
npm test

# Lint code
npm run lint
```

## 📜 License

Same as upstream: [LICENSE](./LICENSE)

## 🙏 Acknowledgments

- Original [HumanLayer](https://github.com/humanlayer/humanlayer) by [@dexhorthy](https://github.com/dexhorthy)
- All the amazing AI providers offering student programs
- The open source community

## 🐛 Issues & Feedback

- For Student Edition specific issues: [Open an issue](https://github.com/chindris-mihai-alexandru/humanlayer/issues)
- For upstream HumanLayer issues: [humanlayer/humanlayer](https://github.com/humanlayer/humanlayer/issues)

---

**Made with 💚 for students who want to learn AI without breaking the bank**

*Student Edition maintained by [@chindris-mihai-alexandru](https://github.com/chindris-mihai-alexandru)*
