-- All application databases are created here on first container startup.
-- POSTGRES_DB=postgres is only the Postgres bootstrap catalog (see docker-compose.yml).

CREATE DATABASE dtorc_metadata;
CREATE DATABASE keycloak;
CREATE DATABASE dtorc_workspace;
