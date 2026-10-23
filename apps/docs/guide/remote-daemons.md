# Run a Remote Daemon

This guide shows you how to install, authenticate, and launch a remote daemon.

<div class="youtube-video">
  <iframe src="https://www.youtube-nocookie.com/embed/q2spCwf02lg" title="Run HumanLayer on a remote daemon" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; encrypted-media; picture-in-picture; web-share" allowfullscreen></iframe>
</div>

For one guided launch-token path, use the [remote daemon tutorial](/tutorials/remote-daemon). For host choices, persistence, capabilities, and security, read [how remote daemons work](/explanation/remote-daemons). To learn the local macOS path, use the [first-session tutorial](/tutorials/first-session).

## Install the CLI

Install the HumanLayer CLI on the daemon host. Then check the installation.

```bash
npm install -g @humanlayer/cli@latest
humanlayer --help
```

## Option 1: Use interactive login

Use interactive login when the daemon host has an interactive terminal. The command stores credentials on that host. You can restart the daemon without a new launch token.

Run the login command.

```bash
humanlayer login
```

The CLI prints a verification URL and a user code. Open the URL. Complete authentication. Select the organization if the browser prompts you. Then return to the terminal.

After login succeeds, launch the daemon.

```bash
humanlayer daemon launch
```

For beta, add the beta environment flag to both commands.

```bash
humanlayer --beta login
humanlayer --beta daemon launch
```

## Option 2: Use a launch token

Use a launch token for one non-interactive command. Examples include a shell without an interactive PTY and a one-time remote bootstrap script.

Open [app.humanlayer.com](https://app.humanlayer.com) on a machine or phone. Go to **Settings -> Daemons**. Generate a daemon launch token. Copy it to the daemon host.

Launch tokens are short-lived credentials. If a token expires before the daemon starts, generate a new token in the app.

```bash
humanlayer daemon launch --launch-token <TOKEN>
```

For beta, add the beta environment flag.

```bash
humanlayer daemon launch --launch-token <TOKEN> --beta
```

## Check the connection

Open [app.humanlayer.com](https://app.humanlayer.com) after the daemon connects. Create and manage sessions on the daemon host from a machine or phone. You can send messages to the coding agent from the same website while it works.

The native app is optional for this workflow. Read [browser and native app capabilities](/explanation/remote-daemons#browser-and-native-app-capabilities) before you depend on a native app feature.

## Keep the daemon running

The launch command does not create a managed background service. On a Linux host that uses systemd, run the daemon as a user service. The service uses the credentials from `humanlayer login`, restarts after a failure, and stops the daemon cleanly.

This setup requires the interactive `humanlayer login` flow. It does not work with `--launch-token`: the CLI exchanges a launch token for credentials that last only for the current daemon process, so systemd cannot authenticate a restarted process. Run `humanlayer login` as the same user that will run the service before you continue.

First, find the full path to the CLI. You will use this path in the service file.

```bash
command -v humanlayer
```

Create `~/.config/systemd/user/humanlayer-daemon.service`. Replace `/absolute/path/to/humanlayer` with the path from the prior command.

```ini
[Unit]
Description=HumanLayer daemon
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
ExecStart=/absolute/path/to/humanlayer daemon launch
Restart=on-failure
RestartSec=5
TimeoutStopSec=60

[Install]
WantedBy=default.target
```

The daemon and the coding agents inherit the service's `PATH`. If `claude`, `codex`, or another required command is outside the default systemd user path, add an `Environment` line under `[Service]`. Use full paths for your host.

```ini
Environment="PATH=/home/your-user/.local/bin:/usr/local/bin:/usr/bin:/bin"
```

Reload the user service configuration, enable the service, and start it.

```bash
systemctl --user daemon-reload
systemctl --user enable --now humanlayer-daemon.service
```

Check its state and follow its logs.

```bash
systemctl --user status humanlayer-daemon.service
journalctl --user -u humanlayer-daemon.service -f
```

User services normally start when the user logs in. To start the daemon at boot and keep it running after logout, an administrator can enable lingering for the daemon user.

```bash
sudo loginctl enable-linger "$USER"
```

To stop the daemon and prevent it from starting again, disable the service.

```bash
systemctl --user disable --now humanlayer-daemon.service
```

On a host without systemd, use `tmux`, `screen`, or another process supervisor to keep the daemon running after you disconnect.

## Update a remote daemon

The app shows which daemons run an older version than the daemon it shipped with. Open **Settings -> Daemons**. A daemon that is behind shows its version and an update action. The target is the CLI version that matches this app build, so the app never pushes a daemon ahead of itself, even when a newer CLI has been published.

The app can push the update to a daemon that was installed with npm. The daemon installs that target version, stops its sessions cleanly, and comes back on the new version. You do not open a shell on the host.

A daemon under systemd needs two things for this to work. Set `Restart=on-failure` or `Restart=always` in the unit, because the daemon exits with a failure code to make systemd start the new version. Run `humanlayer login` on the host first, because a restarted unit authenticates with the stored credentials and not with a launch token.

A daemon that was not installed with npm, or any daemon on Windows, updates by hand. Run the install command on the host, then restart the daemon.

```bash
npm install -g @humanlayer/cli@latest
```

### Turn off in-app updates

If you build the CLI into an image, such as a sandbox or a Kubernetes pod, the image should own the CLI version. Start the daemon with `--no-self-update`, or set `HUMANLAYER_DISABLE_SELF_UPDATE=1`, so the app never installs a different version on the host.

```bash
humanlayer daemon launch --no-self-update
# or
HUMANLAYER_DISABLE_SELF_UPDATE=1 humanlayer daemon launch
```

When a newer version ships, **Settings -> Daemons** marks the daemon as outdated but shows no update action. To update it, rebuild the image with the new CLI version and restart the daemon.

## Troubleshooting

- If a launch token expires before startup, generate a new token in **Settings -> Daemons**.
- If you restart a daemon that used `--launch-token`, provide another valid launch token or run `humanlayer login` first.
- If saved authentication no longer refreshes, run `humanlayer login` again.
- If a recreated container loses authentication, read [container persistence](/explanation/remote-daemons#containers).
- If a resumed container or VM shows up as a new host, read [disposable and suspended hosts](/explanation/remote-daemons#disposable-and-suspended-hosts).
- If a firewall blocks the daemon, read [network access](/explanation/remote-daemons#network-access).
