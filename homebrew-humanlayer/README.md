# HumanLayer Homebrew Tap

This is a public Homebrew tap for easy installation of HumanLayer tools. No authentication is required.

## Installation

```bash
# Add the public tap
brew tap humanlayer/humanlayer

# Install with --no-quarantine to bypass Gatekeeper
brew install --cask --no-quarantine humanlayer/humanlayer/codelayer
```

## PATH Configuration

Homebrew automatically handles PATH setup by creating symlinks for the bundled binaries:
- `/usr/local/bin/humanlayer` → `/Applications/HumanLayer.app/Contents/Resources/bin/humanlayer`
- `/usr/local/bin/hld` → `/Applications/HumanLayer.app/Contents/Resources/bin/hld`

This means:
- Claude Code can execute `humanlayer mcp claude_approvals` directly (no npx needed)
- Power users can run `hld` commands if needed
- No manual PATH configuration required

## Verifying PATH Setup

After installation, verify the binaries are accessible:

```bash
# Check if humanlayer is in PATH
which humanlayer
# Should output: /usr/local/bin/humanlayer

# Verify it's a symlink to the app bundle
ls -la /usr/local/bin/humanlayer
# Should show: /usr/local/bin/humanlayer -> /Applications/HumanLayer.app/Contents/Resources/bin/humanlayer

# Test the binary works
humanlayer --version
```

## Updating

```bash
brew update
brew upgrade --cask codelayer
```

When upgrading, Homebrew automatically updates the symlinks to point to the new app version.

## Set --no-quarantine as default

```bash
export HOMEBREW_CASK_OPTS="--no-quarantine"
```

## Troubleshooting PATH Issues

### Binary not found after installation

If `humanlayer` command is not found after installation:

1. **Check if `/usr/local/bin` is in your PATH:**
   ```bash
   echo $PATH | grep -q "/usr/local/bin" && echo "Path is correct" || echo "Path needs updating"
   ```

2. **If PATH needs updating, add to your shell profile:**
   ```bash
   # For zsh (default on macOS):
   echo 'export PATH="/usr/local/bin:$PATH"' >> ~/.zshrc
   source ~/.zshrc
   
   # For bash:
   echo 'export PATH="/usr/local/bin:$PATH"' >> ~/.bash_profile
   source ~/.bash_profile
   ```

3. **Verify Homebrew created the symlinks:**
   ```bash
   ls -la /usr/local/bin/ | grep -E "humanlayer|hld"
   ```

4. **If symlinks are missing, reinstall the cask:**
   ```bash
   brew uninstall --cask codelayer
   brew install --cask --no-quarantine humanlayer/humanlayer/codelayer
   ```

### Claude Code can't find humanlayer

If Claude Code shows errors about `humanlayer` not being found:

1. **Ensure Claude Code was restarted after installation**
2. **Check Claude Code's PATH environment:**
   - Claude Code inherits PATH from how it was launched
   - If launched from Dock/Spotlight, it may have a limited PATH
   - Try launching Claude Code from Terminal: `open -a "Claude Code"`

### Development vs Production Binaries

- **Production**: Uses bundled binaries from `/Applications/HumanLayer.app/Contents/Resources/bin/`
- **Development**: Should use globally installed `humanlayer` (via npm/bun)
- **Never mix**: Don't try to use production binaries in development