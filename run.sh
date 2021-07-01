#!/bin/sh

PGUSER=postgres \
PGPASSWORD=12345678 \
PGHOST=localhost \
PGPORT=5432 \
PGDATABASE=smtp \
node index.js