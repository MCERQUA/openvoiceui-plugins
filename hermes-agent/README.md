# Hermes Agent Plugin for OpenVoiceUI

Self-improving AI agent with auto-generated skills, deep memory search, and autonomous tasks. Powered by [Hermes Agent](https://github.com/NousResearch/hermes-agent) (MIT, Nous Research).

## What It Adds

- **Self-Improving Skills** — Agent automatically creates reusable skills from successful tasks
- **Deep Memory Search** — FTS5 full-text search across all past sessions
- **Autonomous Tasks** — Delegate long-running research, content generation, data processing
- **Natural Language Scheduling** — "Check rankings every Monday at 9am"
- **Two New Framework Modes** — Hermes standalone or OpenClaw+Hermes hybrid

## Framework Modes

| Mode | How It Works | RAM |
|------|-------------|-----|
| **OpenClaw Only** | Current default, unchanged | 3GB |
| **OpenClaw + Hermes** | Voice via OpenClaw, long tasks delegated to Hermes | 5GB |
| **Hermes Only** | Full voice via REST API. Lightweight, self-improving. | 2GB |

All modes support full voice. The voice pipeline (STT -> text -> agent -> text -> TTS) is identical.

## Install (JamBot)

Click "Install" in Admin Dashboard > Plugins. The provisioning service handles container creation automatically.

## Install (Self-Hosted)

```bash
# 1. Copy plugin to your plugins directory
cp -r plugin-catalog/hermes-agent plugins/

# 2. Add hermes service to your docker-compose.yml
#    (see docker-compose fragment below)

# 3. Start hermes container
docker compose up -d hermes

# 4. Restart OpenVoiceUI to activate the plugin
docker compose restart openvoiceui
```

### Docker Compose Fragment

```yaml
hermes:
  image: jambot/hermes:latest
  container_name: hermes
  mem_limit: 2g
  cpus: 1.0
  volumes:
    - ./hermes-data:/opt/data
  environment:
    - HERMES_API_PORT=18790
  restart: unless-stopped
```

## Canvas Page

Once installed, an "Agent Skills" page appears in your canvas with:
- Learned skills list with success rates
- Memory search across all sessions
- Active/completed autonomous tasks
- Scheduled recurring tasks
- Framework mode selector

## Plugin Structure

```
hermes-agent/
  plugin.json          - Manifest (gateway type + lifecycle hooks)
  gateway.py           - HermesGateway + HermesBridgeGateway classes
  pages/hermes.html    - Agent Skills dashboard
  routes/hermes.py     - /api/hermes/* endpoints
  README.md            - This file
```
