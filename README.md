# DT Orch — deployment & SDK

Official **self-host install** package and **customer SDK** for **DT Orch** (self-hosted BaaS).

## Platform install (ops / self-host)

See **[docs/INSTALL.md](docs/INSTALL.md)** for Compose, Helm, distributed VMs, and upgrades.

Optional **Grafana / Prometheus** monitoring: **[docs/MONITORING.md](docs/MONITORING.md)**.

**AI assistants:** see **[docs/AI_REFERENCE.md](docs/AI_REFERENCE.md)** for architecture, known failures, and debugging playbooks.

Quick start:

```bash
cp .env.platform.example .env
./scripts/install.sh monolith full
```

Release manifest: [VERSION](VERSION)

Image publishing: [docs/RELEASE.md](docs/RELEASE.md)

## SDK (app developers)

Embed the DT Orch API in your application — no need to clone this repo for install.

### Node / React / Angular

```bash
npm install @dtorch/sdk
```

```typescript
import { DtorchClient } from '@dtorch/sdk';

const client = new DtorchClient({
  baseUrl: 'https://api.example.com',
  getAccessToken: () => keycloakToken,
});
```

Package source: [`sdk/javascript/`](sdk/javascript/)

### Python

```bash
pip install dtorch-sdk
# or from source:
pip install ./sdk/python
```

Package source: [`sdk/python/`](sdk/python/)

### PHP / Laravel

```bash
composer require elt/sdk
```

Package source: [`sdk/php/`](sdk/php/)

### CLI (database migrations)

```bash
pip install ./sdk/python ./cli
dtorch init
dtorch link --api-url https://api.example.com --workspace 42 --database 1
dtorch db push
```

See [`cli/README.md`](cli/README.md).

## Repository layout

| Directory | Audience |
|-----------|----------|
| `compose/`, `charts/`, `terraform/`, `schema/`, `scripts/` | DT Orch platform install |
| `sdk/`, `cli/` | Application developers |

## Application source repos

| Repo | Role |
|------|------|
| [etl-back](https://github.com/chaturanga836/etl-back) | API + Celery worker image |
| [elt-frontend](https://github.com/chaturanga836/elt-frontend) | Next.js UI image |
| [platform-infra-repo](https://github.com/chaturanga836/platform-infra-repo) | BaaS infra provisioning service image |

## License

MIT (SDK). Platform licensing terms apply to self-host deployments separately.
