# HumanLayer Daemon (hld)

## Configuration

The daemon supports the following environment variables:

- `HUMANLAYER_DAEMON_HTTP_PORT`: HTTP server port (default: 7777, set to 0 to disable)
- `HUMANLAYER_DAEMON_HTTP_HOST`: HTTP server host (default: 127.0.0.1)

### Disabling HTTP Server

To disable the HTTP server (for example, if you only want to use Unix sockets):

```bash
export HUMANLAYER_DAEMON_HTTP_PORT=0
hld start
```
