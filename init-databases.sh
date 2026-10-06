#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-EOSQL
    CREATE DATABASE scaler_db;
    CREATE DATABASE icm_db;
    GRANT ALL PRIVILEGES ON DATABASE scaler_db TO scaler;
    GRANT ALL PRIVILEGES ON DATABASE icm_db TO scaler;
EOSQL
