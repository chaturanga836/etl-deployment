# Ollama in the ELT Docker stack

Optional local LLM service for **Workspace Settings → AI & Agent**.

## Start with the full stack

```bash
cd etl-deployment
docker compose --profile full --profile ollama up -d --build
docker exec elt-ollama ollama pull llama3.2
```

## UI settings (per workspace)

| Field | Value |
|--------|--------|
| Provider | `ollama` |
| Model | `llama3.2` |
| API key | `ollama` (any non-empty string) |
| Base URL | `http://ollama:11434/v1` |

## Files changed for Ollama

- `docker-compose.yml` — `ollama` service + `ollama_data` volume
- `.env.example` — Ollama env comments
- `README.md` — `ollama` compose profile

## Requirements

- **16 GB+ RAM** on the host recommended when running Ollama with Keycloak, API, Celery, etc.
- Do not expose port `11434` on a public security group.
