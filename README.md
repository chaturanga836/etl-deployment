# ELT SDK

Customer SDK libraries for embedding the ELT Engine API in your application.

Production services (API, UI, infra) deploy via **Jenkins** from their own repos — not from this repo.

| Repo | Jenkins deploy |
|------|----------------|
| [etl-back](https://github.com/chaturanga836/etl-back) | API + worker |
| [elt-frontend](https://github.com/chaturanga836/elt-frontend) | Next.js UI |
| [platform-infra-repo](https://github.com/chaturanga836/platform-infra-repo) | Database provisioning service |

## Install

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

const { items } = await client.listProjects();
```

Package source: [`sdk/javascript/`](sdk/javascript/)

### Python

```bash
pip install elt-sdk
# or from source:
pip install ./sdk/python
```

```python
from elt_sdk import EltClient

client = EltClient("https://api.example.com", get_access_token=lambda: token)
projects = client.list_projects()
```

Package source: [`sdk/python/`](sdk/python/)

### PHP / Laravel

```bash
composer require elt/sdk
```

```php
use Elt\Sdk\EltClient;

$client = new EltClient('https://api.example.com', fn () => $token);
$projects = $client->listProjects();
```

Package source: [`sdk/php/`](sdk/php/)

## Configuration

| Variable | Description |
|----------|-------------|
| `ELT_API_URL` / `DTORCH_API_URL` | Base URL of your deployed etl-back API (e.g. `https://api.example.com`) |
| `DTORCH_ACCESS_TOKEN` | Keycloak JWT for CLI and scripts (`workspace_admin` for `db push`) |
| `ELT_ACCESS_TOKEN` | Alias for `DTORCH_ACCESS_TOKEN` (legacy) |
| Bearer token | Keycloak JWT from your auth flow — passed to the client constructor |

## SDK scope (v1)

Thin HTTP clients for public etl-back routes:

- **Auth** — `POST /api/v1/auth/signup`
- **Studio** — account, projects, service catalog
- **Workspaces** — list workspaces
- **Database migrations** — list/apply versioned SQL (`GET/POST .../databases/{id}/migrations`)

Protected routes require a valid Keycloak bearer token.

### Database migrations (CLI)

Supabase-style workflow via [`cli/`](cli/):

```bash
pip install ./sdk/python ./cli
export DTORCH_ACCESS_TOKEN="your-jwt"
dtorch init
dtorch link --api-url https://api.example.com --workspace 42 --database 1
dtorch migration new create_users
dtorch db push
```

See [`cli/README.md`](cli/README.md) for full documentation.

## Legacy orchestration files

This repo previously held Docker Compose orchestration. That role now lives in each service repo (`docker-compose.yml` + `deploy.sh` + `Jenkinsfile`). Legacy compose/nginx/renderer files may remain for reference but are **not** the supported production path.

## License

MIT
