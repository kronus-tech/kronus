# Installation

See [SETUP.md](SETUP.md) for the full setup guide.

## Quick Install

```bash
git clone https://github.com/kronus-tech/kronus.git
cd kronus
./scripts/install.sh
```

## Docker

```bash
cp config/.env.example .env
docker-compose up -d
```

## Options

```bash
./scripts/install.sh                # Full install (agents + skills + daemon)
./scripts/install.sh --skip-daemon  # Agents and skills only (no Telegram)
./scripts/install.sh --dry-run      # Preview without changes
./scripts/install.sh --uninstall    # Remove installation
```
