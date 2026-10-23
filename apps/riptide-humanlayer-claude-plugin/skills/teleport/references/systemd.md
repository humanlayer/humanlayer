# Run the daemon as a systemd user service

Use this on a Linux host with a user systemd. The service uses the credentials from `humanlayer login`, restarts after a failure, and stops the daemon cleanly.

It needs a saved `humanlayer login` for the same user that runs the service. It does not work with `--launch-token`: a launch token yields credentials that last only for one daemon process, so a restarted process cannot sign in.

## 1. Find the paths

```bash
command -v humanlayer
command -v claude codex node bun 2>/dev/null
```

## 2. Write the service file

Create `~/.config/systemd/user/humanlayer-daemon.service`. Use the full `humanlayer` path from step 1. Put the stage flag before `daemon`: none for prod, `--dev` for dev, `--beta` for beta.

The daemon and the agents inherit the service's `PATH`. Build it from the directories found in step 1, so `claude`, `codex`, `node`, and `bun` resolve.

```ini
[Unit]
Description=HumanLayer daemon
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
ExecStart=/absolute/path/to/humanlayer daemon launch
Environment="PATH=/home/<user>/.local/bin:/home/<user>/.bun/bin:/usr/local/bin:/usr/bin:/bin"
Restart=on-failure
RestartSec=5
TimeoutStopSec=60

[Install]
WantedBy=default.target
```

## 3. Start it

```bash
systemctl --user daemon-reload
systemctl --user enable --now humanlayer-daemon.service
```

User services normally start only when the user logs in. To start the daemon at boot and keep it running after logout, enable lingering (needs sudo):

```bash
sudo loginctl enable-linger "$USER"
```

## 4. Check it

```bash
systemctl --user status humanlayer-daemon.service --no-pager
journalctl --user -u humanlayer-daemon.service -n 100 --no-pager
```

Do not use `journalctl -f` from the skill; it never exits.

## Stop it

```bash
systemctl --user disable --now humanlayer-daemon.service
```
