# Local SQL seed

Use this SQL seed to reset deterministic local test data without touching
application code.

## Run with Docker Compose

From the repo root:

```bash
cat infrastructure/supabase/seeds/dev_seed.sql | \
docker compose -f infrastructure/docker-compose.yml exec -T db \
  psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-drivesense}"
```
