# Contributing to HumanLayer

If you're looking to contribute, please:

- fork the repository.
- create a new branch for your feature.
- add your feature or improvement.
- send a pull request.
- we appreciate your input!

## Running CodeLayer

```
make setup
make codelayer-dev
```

When the Web UI launches in dev mode, you'll need to launch a managed daemon with it - click the 🐞 icon in the bottom right and launch a managed daemon.

### Linux Development

On Linux, you'll need Tauri dependencies installed. The setup script handles this automatically for most distributions:

```bash
# Debian/Ubuntu
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev

# Arch Linux (and derivatives like EndeavourOS, Manjaro, Garuda)
sudo pacman -S webkit2gtk-4.1 base-devel curl wget openssl gtk3 libappindicator-gtk3 librsvg

# Fedora
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file gcc gcc-c++ make gtk3-devel libappindicator-gtk3-devel librsvg2-devel
```

#### Wayland/WebKitGTK Issues

If you're developing on Wayland (especially with Nvidia GPUs), you may encounter rendering issues. Try these environment variables:

```bash
# Disable DMABUF renderer (recommended first try)
WEBKIT_DISABLE_DMABUF_RENDERER=1 make codelayer-dev

# Or force X11 backend
GDK_BACKEND=x11 make codelayer-dev

# Or disable compositing
WEBKIT_DISABLE_COMPOSITING_MODE=1 make codelayer-dev
```

## Commands cheat sheet

1. `/research_codebase`
2. `/create_plan`
3. `/implement_plan`
4. `/commit`
5. `gh pr create --fill`
6. `/describe_pr`

## Running Tests

Before submitting a pull request, please run the tests and linter:

```shell
make check test
```

Right now the linting rules are from an off-the-shelf config, and many rules are still being refined/removed. Well-justified per-file or per-rule ignores are welcome.

You can run

```shell
make githooks
```

to install a git pre-push hook that will run the checks before pushing.
