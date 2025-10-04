# AWS Bedrock Configuration for CodeLayer

CodeLayer supports using Claude models running on AWS Bedrock or other Anthropic-compatible endpoints.

## The Challenge: macOS App Launching

When you launch CodeLayer from Spotlight, Raycast, or the Dock, macOS doesn't load your shell environment variables from `.zshrc` or `.bashrc`. This means environment variables like `ANTHROPIC_BASE_URL` and `ANTHROPIC_API_KEY` won't be available to the app.

## Solution: Configuration File

The recommended way to configure Bedrock or custom endpoints is through CodeLayer's configuration file.

### Quick Setup

1. Create the configuration directory:
   ```bash
   mkdir -p ~/.config/humanlayer
   ```

2. Create or edit `~/.config/humanlayer/humanlayer.json`:
   ```json
   {
     "env": {
       "ANTHROPIC_BASE_URL": "https://bedrock-runtime.us-east-1.amazonaws.com",
       "ANTHROPIC_API_KEY": "your-aws-credentials-or-api-key"
     }
   }
   ```

3. Set appropriate file permissions to protect your API key:
   ```bash
   chmod 600 ~/.config/humanlayer/humanlayer.json
   ```

4. Launch CodeLayer normally (from Spotlight, Raycast, or Dock)

### Configuration Options

The configuration file supports environment variables through the `env` section. Any environment variables set here will be inherited by Claude sessions:

- `ANTHROPIC_BASE_URL`: The base URL for the Anthropic API or compatible endpoint
  - For AWS Bedrock: `https://bedrock-runtime.<region>.amazonaws.com`
  - For custom endpoints: Your custom API endpoint
  - Leave unset to use default Anthropic API

- `ANTHROPIC_API_KEY`: The API key to use
  - For AWS Bedrock: Your AWS access credentials (formatted appropriately)
  - For custom endpoints: Your API key
  - Leave unset if using system credentials

- Any other environment variables: You can set additional environment variables that will be inherited by all Claude sessions (e.g., `AWS_REGION`, `AWS_PROFILE`, etc.)

### Alternative: Environment Variables (Terminal Launch Only)

If you always launch CodeLayer from a terminal, you can still use environment variables:

```bash
# Set in your terminal
export ANTHROPIC_BASE_URL=https://bedrock-runtime.us-east-1.amazonaws.com
export ANTHROPIC_API_KEY=your-key

# Launch CodeLayer from the same terminal
open /Applications/CodeLayer-Nightly.app
```

**Note**: This only works when launching from a terminal that has the environment variables set. It won't work if you later launch CodeLayer from Spotlight or Raycast.

### Configuration Priority

CodeLayer uses the following priority order (highest to lowest):

1. Per-session configuration (if explicitly set)
2. Environment variables (if app was launched with them)
3. Configuration file (`~/.config/humanlayer/humanlayer.json`)
4. Default Anthropic API

### AWS Bedrock Specific Configuration

When using AWS Bedrock, you'll typically need to:

1. Set up AWS credentials (via AWS CLI or environment variables)
2. Configure the Bedrock endpoint for your region
3. Ensure your AWS IAM role has permissions to invoke Bedrock models

Example configuration for AWS Bedrock in `us-west-2`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://bedrock-runtime.us-west-2.amazonaws.com",
    "AWS_REGION": "us-west-2"
  }
}
```

Then ensure your AWS credentials are available (via `~/.aws/credentials` or environment variables that CodeLayer will inherit).

### Troubleshooting

#### Configuration file not found
The daemon looks for configuration in these locations (in order):
1. `./humanlayer.json` (current directory)
2. `$XDG_CONFIG_HOME/humanlayer/humanlayer.json`
3. `~/.config/humanlayer/humanlayer.json`

#### Changes not taking effect
Restart CodeLayer after modifying the configuration file:
1. Quit CodeLayer completely
2. Relaunch the app

#### Verify configuration is loaded
Check the daemon logs to see if your configuration was loaded:
```bash
# The daemon logs show configuration loading
tail -f ~/Library/Logs/CodeLayer/daemon.log
```

Look for debug messages about "inherited generic env var from daemon configuration" for keys like "ANTHROPIC_BASE_URL".

### Security Considerations

**Important**: The configuration file contains sensitive credentials. Always:

1. Set restrictive file permissions:
   ```bash
   chmod 600 ~/.config/humanlayer/humanlayer.json
   ```

2. Never commit the configuration file to version control

3. Consider using AWS IAM roles or credential management systems for production use

### Full Configuration Example

Here's a complete example configuration file with all available options:

```json
{
  "socket_path": "~/.humanlayer/daemon.sock",
  "database_path": "~/.humanlayer/daemon.db",
  "log_level": "info",
  "http_port": 7777,
  "http_host": "127.0.0.1",
  "claude_path": "/opt/homebrew/bin/claude",
  "env": {
    "ANTHROPIC_BASE_URL": "https://bedrock-runtime.us-west-2.amazonaws.com",
    "AWS_REGION": "us-west-2",
    "AWS_PROFILE": "my-profile"
  }
}
```

### Related Documentation

- [AWS Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [Anthropic API Documentation](https://docs.anthropic.com/)
- [CodeLayer Configuration](./configuration.md)

### Getting Help

If you encounter issues with Bedrock configuration:

1. Check that your AWS credentials are valid
2. Verify the Bedrock endpoint URL is correct for your region
3. Ensure your IAM role has necessary permissions
4. Check CodeLayer daemon logs for error messages

For additional support, open an issue on GitHub with:
- Your configuration file (with API keys redacted)
- Relevant error messages from logs
- AWS region and model you're trying to use
