# Find an online host

```bash
humanlayer --dev api sync online-hosts --limit 20 > /tmp/hl-hosts.json
jq -r '.rows[] | select(.status == "online") | [.host_id, .host_name, .daemon_version] | @tsv' /tmp/hl-hosts.json
```

Show the user each online host and ask which to use if there is more than one. This machine's host ID is in `~/.humanlayer/riptide/host_id`. It shows as online only while a daemon or the desktop app for that environment runs.

If no host is online, the user must start one: open the desktop app for that environment, or run `humanlayer --dev daemon launch` on the host.
