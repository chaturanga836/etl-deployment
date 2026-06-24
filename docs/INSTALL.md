# ELT Platform — Self-Host Install Guide

This repo is the **official install surface** for licensed self-host deployments. Application source lives in separate repos; this repo pins image versions and provides Compose, Helm, and Terraform (skeleton).

| Path | Purpose |
|------|---------|
| [compose/monolith.yml](compose/monolith.yml) | Single-VM full stack |
| [compose/roles/](compose/roles/) | Distributed multi-VM roles |
| [charts/elt-platform/](charts/elt-platform/) | Kubernetes Helm chart |
| [schema/](schema/) | Deployment JSON schema + examples |
| [renderer/render.py](renderer/render.py) | Generate `.env` from JSON |
| [sdk/](sdk/) | Customer app SDKs (separate audience) |

## Prerequisites

- Docker 24+ with Compose v2
- For customer installs: access to private registry (`REGISTRY_URL`)
- For dev builds: sibling repos `etl-back`, `elt-frontend`, `platform-infra-repo` checked out next to this repo

## Quick start — monolith (PoC)

```bash
cp .env.platform.example .env
# Edit registry URL and secrets

./scripts/install.sh monolith full
# Or with local builds:
./scripts/install.sh --dev monolith full
```

## Config-driven install

```bash
./scripts/install.sh --config schema/examples/monolith-bundled.json full
```

## Distributed roles (multi-VM)

1. Render config:

```bash
python renderer/render.py --config schema/examples/distributed-aws-vm.json --out . --helm-values
```

2. On each host, copy `.env` and run the role:

```bash
docker compose -f compose/networks.yml up -d   # once
./scripts/install.sh --role api
./scripts/install.sh --role worker --scale 3
./scripts/install.sh --role frontend
./scripts/install.sh --role infra              # Docker socket host
```

## Kubernetes (Helm)

```bash
helm install elt-platform ./charts/elt-platform \
  -f charts/elt-platform/values.yaml \
  -f charts/elt-platform/values-external-db.yaml \
  --set global.imageTag=v1.0.0 \
  --set global.registry=registry.example.com/elt \
  --set secrets.internalServiceToken="$(openssl rand -hex 32)" \
  --set secrets.fernetKey="$(openssl rand -base64 32)" \
  --set database.url="postgresql://..."
```

Generate Helm values from deployment JSON:

```bash
python renderer/render.py --config schema/examples/distributed-aws-vm.json --out /tmp/elt --helm-values
# Use /tmp/elt/helm-values.json to override chart values
```

## Upgrade

```bash
# Bump IMAGE_TAG in .env or re-render from config
./scripts/upgrade.sh full
```

## Release coordination

1. Tag `vX.Y.Z` on `etl-back`, `elt-frontend`, `platform-infra-repo` → CI pushes images
2. Update [VERSION](VERSION) and [charts/elt-platform/Chart.yaml](charts/elt-platform/Chart.yaml)
3. Tag `etl-deployment` `vX.Y.Z`

## Internal SaaS deploy

Vendor production still uses Jenkins per app repo. This repo is for **customer self-host** and local PoC.

## Terraform (AWS)

Skeleton at [terraform/examples/aws-standard/](terraform/examples/aws-standard/). Expand with VPC, EKS, RDS, ElastiCache modules, then `helm_release`.
