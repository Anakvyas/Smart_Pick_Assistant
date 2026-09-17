# Smart Picker API (FastAPI) — Phase 1

This is a parallel FastAPI implementation of picker signup/login, migrated from the
existing Express backend in `../backend`. Both services can run side by side against
the same PostgreSQL database. **The Express backend has not been modified or removed.**

Scope of this phase: signup, login, JWT cookie issuance, health check. No `/auth/me`,
logout, orders, or other future features are implemented here.

## Setup

```bash
cd fastapi-backend
uv sync
cp .env.example .env
# edit .env with your real DATABASE_URL / JWT_SECRET
```

If you already ran the Express backend's SQL migration against your database, the
`users` table already exists. Point `DATABASE_URL` at that same database and stamp
the migration instead of creating the table again:

```bash
uv run alembic stamp 0001_create_users_table
```

Otherwise, for a fresh database, run:

```bash
uv run alembic upgrade head
```

## Run the API

```bash
uv run uvicorn app.main:app --reload --port 8001
```

- Swagger UI: http://localhost:8001/docs
- ReDoc: http://localhost:8001/redoc
- Health check: http://localhost:8001/health

## Run tests

```bash
uv run pytest
```

## Lint

```bash
uv run ruff check .
```

## Manual curl testing

Signup:

```bash
curl -i -c cookies.txt -X POST http://localhost:8001/api/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Aarav Sharma",
    "email": "aarav@example.com",
    "password": "Password@123",
    "confirmPassword": "Password@123"
  }'
```

Login (reuses the cookie jar):

```bash
curl -i -c cookies.txt -X POST http://localhost:8001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "aarav@example.com",
    "password": "Password@123"
  }'
```

Duplicate signup (expect 409):

```bash
curl -i -X POST http://localhost:8001/api/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Aarav Sharma",
    "email": "aarav@example.com",
    "password": "Password@123",
    "confirmPassword": "Password@123"
  }'
```

Invalid login (expect 401):

```bash
curl -i -X POST http://localhost:8001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "aarav@example.com", "password": "WrongPassword@123"}'
```

Health check:

```bash
curl -i http://localhost:8001/health
```

## Compatibility notes

- Passwords are hashed and verified with **bcrypt** (not Argon2) to stay compatible
  with accounts created by the existing Express backend. Both backends can read and
  write the same `password_hash` values.
- JWT payload, cookie name, `SameSite=Lax`, `HttpOnly`, and `Secure`-in-production
  behavior mirror the Express implementation so cookies issued by either backend
  follow the same rules (they still use separate `JWT_SECRET` values unless you set
  the same secret in both `.env` files).
- Response envelope (`{ success, message, data }` / `{ success, error: { code, message, fields } }`)
  matches the existing Express API contract.
