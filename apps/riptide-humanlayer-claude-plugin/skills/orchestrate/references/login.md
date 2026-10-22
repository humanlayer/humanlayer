# Pick the environment and log in

| Flag | Environment |
| --- | --- |
| none | production |
| `--beta` | beta |
| `--dev` | dev cloud |

Check the CLI and whether it already has a working session:

```bash
humanlayer --version
humanlayer --dev api sync online-hosts --limit 1
```

If this prints `Not logged in`, run the login in a tmux window, because it waits for a browser and then asks for an organization:

```bash
tmux new-window -d -n hl-login 'humanlayer --dev login; echo EXIT=$?; sleep 600'
sleep 4; tmux capture-pane -p -t hl-login | grep -v '^$' | tail -10
```

Give the user the verification URL and code from the output. When they confirm, capture the pane again. If it shows `Select an organization`, ask the user which one, then send the number:

```bash
tmux send-keys -t hl-login '<number>' Enter
sleep 4; tmux capture-pane -p -t hl-login | grep -v '^$' | tail -5
```

You are done when the pane shows `Login successful.` and `EXIT=0`.
