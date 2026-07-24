# Monitoring (Grafana + Prometheus)

Optional stack for container metrics on the monolith Compose install. Choose install / connect / skip in the setup wizard (or set `EXTRA_COMPOSE_PROFILES` manually).

| Service | Role | Default port |
|---------|------|--------------|
| **Grafana** | Dashboards UI | `3002` |
| **Prometheus** | Metrics store / scrape | `9090` (loopback only) |
| **cAdvisor** | Per-container CPU / memory / network | `8082` (loopback only) |

## Enable from the setup wizard

In the installer UI, the **Grafana** step offers:

| Choice | Result |
|--------|--------|
| **Install Grafana for me** | Adds compose profile `monitoring` (Prometheus + Grafana + cAdvisor) |
| **Connect to existing Grafana** | Stores `GRAFANA_URL` / `NEXT_PUBLIC_GRAFANA_URL` only (no local stack) |
| **Skip for now** | No monitoring |

## Enable manually (existing install)

Add `monitoring` to `.env`:

```bash
EXTRA_COMPOSE_PROFILES=monitoring
GRAFANA_ADMIN_PASSWORD=change-me
```

If you already use other extra profiles (e.g. MySQL), comma-separate them:

```bash
EXTRA_COMPOSE_PROFILES=workspace-mysql,monitoring
```

Then restart:

```bash
./scripts/install.sh monolith full
# or:
docker compose -f compose/monolith.yml -f compose/monitoring.yml \
  --profile full --profile monitoring --env-file .env up -d
```

### Fresh install

Set `EXTRA_COMPOSE_PROFILES=monitoring` in the rendered `.env` (or `.env.platform.example` copy) before install, or enable after install as above.

## Open Grafana

```
http://<host>:3002
```

Default login: `admin` / `changeme` (override with `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD`).

**In Studio:** open the project sidebar → **Monitor** → **Grafana**. Studio loads the URL from the
API (`GRAFANA_URL` / `GRAFANA_SOURCE` in the platform `.env`, written by the installer). No frontend
rebuild is required when you enable or change Grafana after install.

A starter dashboard **DT Orch containers** is provisioned under folder **DT Orch**. Prometheus is pre-configured as the default datasource.

## Security

- Change `GRAFANA_ADMIN_PASSWORD` before exposing port `3002` on a public security group.
- Prometheus and cAdvisor bind to `127.0.0.1` only; use an SSH tunnel if you need them from your laptop.
- Prefer not to put Grafana behind the public nginx proxy until auth / TLS are decided.

## Files

| Path | Purpose |
|------|---------|
| [compose/monitoring.yml](../compose/monitoring.yml) | Prometheus, Grafana, cAdvisor services |
| [monitoring/prometheus.yml](../monitoring/prometheus.yml) | Scrape targets |
| [monitoring/grafana/provisioning/](../monitoring/grafana/provisioning/) | Datasource + dashboards |

## App metrics (next step)

The API does not expose `/metrics` yet. When it does, uncomment the `dt-orch-api` job in `monitoring/prometheus.yml`.

## Cleanup

`scripts/clean-platform.sh` tears down the monitoring profile and its volumes with the rest of the stack.
