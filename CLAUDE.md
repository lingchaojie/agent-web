# CLAUDE.md

- Development environment: use `./start-dev.sh` or `npm run dev`; it listens on port 8787 and uses `./webagent-dev.db`.
- Production/mobile environment: use `./start-prod.sh` or `npm run dev:local`; it listens on port 8877 and uses `./webagent.db`.
- Do not modify `start-prod.sh` without explicit user permission.
- Tailscale access expects Windows portproxy rules for both `100.123.174.109:8787` and `100.123.174.109:8877` to `127.0.0.1`; refresh them with elevated PowerShell: `./scripts/setup-tailscale-portproxy.ps1`.
