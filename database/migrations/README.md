# migrations/

Ordered SQL migrations for ServiceConnect will live here, e.g.:

```
001_create_users.sql
002_create_providers.sql
003_create_services_and_availability.sql
004_create_bookings.sql
```

Rules (see `database/README.md`): append-only, idempotent, versioned in git,
applied by a single runner script (tool choice deferred to the schema step).
