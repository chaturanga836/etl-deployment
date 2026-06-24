# ELT Deployment

Official **self-host install** package and **customer SDK** for the ELT Platform.

## Platform install (ops / self-host)

See **[docs/INSTALL.md](docs/INSTALL.md)** for Compose, Helm, distributed VMs, and upgrades.

Quick start:

```bash
cp .env.platform.example .env
./scripts/install.sh monolith full
```

Release manifest: [VERSION](VERSION)

## SDK (app developers)

Embed the ELT API in your application — no need to clone this repo for install.

### Node / React / Angular

```bash
npm install @elt/sdk
```

```typescript
import { EltClient } from '@elt/sdk';

const client = new EltClient({
  baseUrl: 'https://api.example.com',
  getAccessToken: () => keycloakToken,
});
```

Package source: [`sdk/javascript/`](sdk/javascript/)

### Python

```bash
pip install elt-sdk
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
| `compose/`, `charts/`, `terraform/`, `schema/`, `scripts/` | Platform install |
| `sdk/`, `cli/` | Application developers |

## Application source repos

| Repo | Role |
|------|------|
| [etl-back](https://github.com/chaturanga836/etl-back) | API + Celery worker image |
| [elt-frontend](https://github.com/chaturanga836/elt-frontend) | Next.js UI image |
| [platform-infra-repo](https://github.com/chaturanga836/platform-infra-repo) | Infra provisioning service image |

## License

MIT (SDK). Platform licensing terms apply to self-host deployments separately.
