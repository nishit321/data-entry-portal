# NCA Data Collection Portal — Backend

NestJS API for the NCA Data Collection Portal / ICT Indicators Data Hub. It covers
authentication and user administration, entity and agent registration, the digitised
questionnaire (templates, reporting periods, submissions), reference data, and an
append-only audit trail.

This is a production-grade foundation rather than throwaway demo code: configuration is
validated at boot, errors follow one envelope, requests are logged and correlated, rate
limits and security headers are on by default, credentials are hashed, and the schema is
normalised.

The frontend lives in a separate repository: **nca-frontend**.

---

## Tech stack

| Concern    | Technology                              |
| ---------- | --------------------------------------- |
| Framework  | NestJS 10 (Node.js 20+, TypeScript 5.6) |
| Database   | PostgreSQL 14+ via Prisma ORM 5         |
| Auth       | Passport JWT, bcrypt, OTP-based MFA     |
| Validation | class-validator / class-transformer     |
| Config     | @nestjs/config + Joi schema validation  |
| Email      | SendGrid (console fallback in demo)     |
| Tests      | Jest (unit), Supertest (e2e)            |

---

## Prerequisites

- Node.js 20 or newer, and npm
- PostgreSQL 14 or newer — local install, Docker, or a managed instance

PostgreSQL via Docker, if you don't have one running:

```bash
docker run --name nca-postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=nca_portal -p 5432:5432 -d postgres:16
```

---

## Setup

```bash
git clone https://github.com/NCA-Data-Portal/nca-backend.git
cd nca-backend
cp .env.example .env          # then edit the values — see the table below
npm install
npm run prisma:generate       # generate the Prisma client
npm run prisma:migrate        # apply the schema (first run: name the migration "init")
npm run prisma:seed           # create the initial admin and demo data
npm run start:dev             # http://localhost:4000/api/v1
```

The app refuses to start if any required environment variable is missing or malformed —
the check lives in `src/config/env.validation.ts`, so a bad config fails loudly at boot
rather than quietly at runtime.

### Environment variables

Full annotated list is in [.env.example](.env.example). The ones you will actually change:

| Variable                                    | Purpose                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| `DATABASE_URL`                              | PostgreSQL connection string                                                |
| `PORT`                                      | API port (default `4000`)                                                   |
| `CORS_ORIGIN`                               | Comma-separated allowed frontend origins                                    |
| `JWT_SECRET`                                | Long random string, minimum 16 characters                                   |
| `JWT_EXPIRES_IN`                            | Token lifetime (default `1d`)                                               |
| `SENDGRID_API_KEY`                          | Leave **empty** in demo — emails print to the console instead of being sent |
| `MAIL_FROM`                                 | Must be a SendGrid-verified sender, otherwise sends fail with a 403         |
| `FRONTEND_RESET_URL` / `FRONTEND_LOGIN_URL` | Links embedded in outgoing mail                                             |
| `MFA_ENABLED`                               | `false` skips the OTP step in local development                             |
| `OTP_STATIC_CODE`                           | Fixed demo code until an SMS provider is wired in (default `123456`)        |
| `MAX_LOGIN_ATTEMPTS` / `LOCKOUT_MINUTES`    | Account lockout policy (default 5 attempts, 15 minutes)                     |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`  | The first admin account created by the seed                                 |

Never commit a real `.env` — it is gitignored. `.env.example` is the tracked template and
should be updated whenever a new variable is introduced.

---

## Seeded accounts

After `npm run prisma:seed`:

```
Admin      admin@nca.gov.ss          Admin@12345
Operator   operator@demo-telecom.ss  Operator@12345
```

The operator belongs to the seeded "Demo Telecom (MNO)" entity and has one sample agent,
so data segregation can be exercised against the admin account.

### Two-step login (MFA)

Login is a two-call flow: `POST /auth/login` verifies the password and returns an OTP
challenge; `POST /auth/verify-otp` exchanges the code for a JWT. There is no SMS provider
yet, so the code is the fixed `OTP_STATIC_CODE` (`123456` by default), also printed to the
backend console. Set `MFA_ENABLED=false` to skip the OTP step during local development.

OTP codes are stored SHA-256-hashed, are single-use, and expire after `OTP_TTL_MIN`.
Five consecutive wrong passwords lock the account for 15 minutes.

---

## Project structure

```
nca-backend/
├── prisma/
│   ├── schema.prisma           # models — snake_case columns, indexes, audit log
│   ├── migrations/             # applied migration history
│   ├── seed.ts                 # admin, demo entity, demo operator
│   ├── seed-demo-templates.ts  # sample questionnaire templates
│   └── demo-templates/         # template definitions used by the seed
├── src/
│   ├── config/                 # typed config + fail-fast env validation
│   ├── common/                 # decorators, guards, filters, interceptors, utils
│   ├── prisma/                 # Prisma module and service
│   ├── audit/                  # append-only audit trail
│   ├── mail/                   # SendGrid with console fallback
│   ├── auth/                   # signup, login, MFA, forgot/reset, JWT strategy
│   ├── users/                  # admin user management (CRUD + role assignment)
│   ├── entities/               # regulated entity onboarding
│   ├── agents/                 # agents registered under an entity
│   ├── reference-data/         # managed lookup lists
│   ├── templates/              # questionnaire templates, sections, fields, rules
│   ├── reporting-periods/      # reporting windows against published templates
│   ├── submissions/            # operator returns: draft, validate, submit
│   └── health/                 # liveness and database health checks
└── test/                       # e2e specs (run against a dedicated test database)
```

---

## API

Routes are versioned under `/api/v1` — for example `POST /api/v1/auth/login`. Only
`/api/health` stays unversioned. Every response carries an `X-Request-Id` header, and
error envelopes repeat it as `requestId` for support correlation.

The `/api` prefix below is shorthand for `/api/v1`.

### Authentication

| Method | Endpoint                    | Access | Purpose                                             |
| ------ | --------------------------- | ------ | --------------------------------------------------- |
| POST   | `/api/auth/signup`          | Public | Self-register with the default role                 |
| POST   | `/api/auth/login`           | Public | Password step — returns a token or an OTP challenge |
| POST   | `/api/auth/verify-otp`      | Public | Exchange the OTP for a token                        |
| POST   | `/api/auth/resend-otp`      | Public | Re-issue the OTP challenge                          |
| POST   | `/api/auth/forgot-password` | Public | Request a reset link                                |
| POST   | `/api/auth/reset-password`  | Public | Set a new password using the token                  |
| GET    | `/api/auth/me`              | Auth   | Current user profile                                |

### Users

| Method | Endpoint              | Access | Purpose                           |
| ------ | --------------------- | ------ | --------------------------------- |
| GET    | `/api/users`          | Admin  | List users                        |
| POST   | `/api/users`          | Admin  | Create a user, assign a role      |
| PATCH  | `/api/users/:id`      | Admin  | Update name, role, or active flag |
| PATCH  | `/api/users/:id/role` | Admin  | Change role                       |
| DELETE | `/api/users/:id`      | Admin  | Delete a user                     |

### Entities and agents

| Method | Endpoint                   | Access                 | Purpose                   |
| ------ | -------------------------- | ---------------------- | ------------------------- |
| GET    | `/api/entities`            | Authority              | List entities (paginated) |
| POST   | `/api/entities`            | Admin                  | Onboard an entity         |
| GET    | `/api/entities/me`         | Operator               | The caller's own entity   |
| GET    | `/api/entities/:id`        | Authority              | Entity detail             |
| PATCH  | `/api/entities/:id`        | Admin                  | Update an entity          |
| PATCH  | `/api/entities/:id/status` | Admin                  | Change entity status      |
| DELETE | `/api/entities/:id`        | Admin                  | Soft-delete an entity     |
| GET    | `/api/agents`              | Operator / Authority   | List agents (scoped)      |
| POST   | `/api/agents`              | Operator-admin / Admin | Register an agent         |
| PATCH  | `/api/agents/:id`          | Operator-admin / Admin | Update an agent           |
| DELETE | `/api/agents/:id`          | Operator-admin / Admin | Soft-delete an agent      |

### Reference data

| Method                | Endpoint                               | Access                  | Purpose                      |
| --------------------- | -------------------------------------- | ----------------------- | ---------------------------- |
| GET                   | `/api/reference-data/lookup/:category` | Auth                    | Lookup values for a category |
| GET/POST/PATCH/DELETE | `/api/reference-data...`               | Auth read / Admin write | Manage lookup lists          |

### Questionnaire templates

| Method            | Endpoint                                     | Access    | Purpose                                |
| ----------------- | -------------------------------------------- | --------- | -------------------------------------- |
| GET               | `/api/templates`                             | Authority | List templates                         |
| GET               | `/api/templates/:id`                         | Authority | Full template with sections and fields |
| POST              | `/api/templates`                             | Admin     | Create a draft                         |
| PATCH             | `/api/templates/:id`                         | Admin     | Edit draft metadata                    |
| POST              | `/api/templates/:id/publish`                 | Admin     | Publish and lock the template          |
| POST              | `/api/templates/:id/new-version`             | Admin     | Clone into a new draft version         |
| POST/PATCH/DELETE | `/api/templates/:id/sections...`             | Admin     | Manage sections (draft only)           |
| POST/PATCH/DELETE | `/api/templates/:id/sections/:sid/fields...` | Admin     | Manage fields (draft only)             |
| POST/PATCH/DELETE | `/api/templates/:id/rules...`                | Admin     | Manage cross-field rules (draft only)  |

### Reporting periods

| Method | Endpoint                           | Access | Purpose                                    |
| ------ | ---------------------------------- | ------ | ------------------------------------------ |
| GET    | `/api/reporting-periods`           | Auth   | List periods with computed deadline phase  |
| POST   | `/api/reporting-periods`           | Admin  | Open a period against a published template |
| PATCH  | `/api/reporting-periods/:id`       | Admin  | Edit dates or grace window                 |
| POST   | `/api/reporting-periods/:id/open`  | Admin  | Open or re-open                            |
| POST   | `/api/reporting-periods/:id/close` | Admin  | Close                                      |
| DELETE | `/api/reporting-periods/:id`       | Admin  | Soft-delete a period                       |

### Submissions

| Method | Endpoint                             | Access               | Purpose                                                                                                       |
| ------ | ------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/submissions`                   | Operator / Authority | List returns (scoped); filter by status, entity, period, template, late flag, submitted-date range, reference |
| GET    | `/api/submissions/startable-periods` | Operator             | Open periods the operator can still start                                                                     |
| GET    | `/api/submissions/:id`               | Operator / Authority | A return with its template and values                                                                         |
| POST   | `/api/submissions`                   | Operator             | Open or resume a draft for a period                                                                           |
| PUT    | `/api/submissions/:id/values`        | Operator             | Save answered values (draft)                                                                                  |
| POST   | `/api/submissions/:id/validate`      | Operator / Authority | Dry-run validation — hard and soft issues, no submit                                                          |
| POST   | `/api/submissions/:id/submit`        | Operator             | Validate, e-sign, and submit                                                                                  |
| DELETE | `/api/submissions/:id`               | Operator / Admin     | Soft-delete a draft                                                                                           |

### Health

| Method | Endpoint           | Access | Purpose                   |
| ------ | ------------------ | ------ | ------------------------- |
| GET    | `/api/health`      | Public | Health and database check |
| GET    | `/api/health/live` | Public | Liveness probe            |

---

## Data segregation

Operator users only ever see their own entity's data. An operator's `agents` list is
forced to its own `entityId` regardless of any query parameter, and operators cannot read
or manage another entity's records. This is enforced centrally in
`src/common/utils/data-scope.util.ts` rather than being repeated per endpoint, so a new
controller inherits the rule instead of having to remember it.

---

## Security

- Passwords hashed with bcrypt (cost 12); only hashes are stored.
- Password-reset tokens stored as SHA-256 hashes; the raw token goes only to the user.
- MFA on login: password, then OTP challenge, then token. Codes are hashed, single-use,
  and time-limited; delivery is provider-abstracted.
- Account lockout after consecutive failed passwords, for a configurable window.
- JWT auth behind a global guard — routes are private by default, `@Public()` opts out.
- Role authorisation via the `@Roles()` decorator and its guard.
- Rate limiting globally, with stricter limits on auth endpoints.
- Helmet security headers; CORS restricted to configured origins.
- One JSON error envelope; internal errors never leak to clients.
- Append-only audit log for logins, user changes, and password resets.

---

## Testing

```bash
npm test                 # unit tests — services, validation, utils
npm run test:e2e:setup   # one-time: create and migrate the test database
npm run test:e2e         # integration tests over real HTTP
```

Unit specs sit beside the file they cover (`src/**/*.spec.ts`). Integration specs live in
[test/](test/) and run against a dedicated `nca_portal_test` database — never dev or prod.
The e2e suite boots the app through the same `configureApp()` used in production, so it
exercises the real guard, validation, and error pipeline rather than a stripped-down
test harness.

---

## Scripts

| Script                    | What it does                                     |
| ------------------------- | ------------------------------------------------ |
| `npm run start:dev`       | Watch-mode dev server                            |
| `npm run start:prod`      | Run the compiled build from `dist/`              |
| `npm run build`           | Compile to `dist/`                               |
| `npm run typecheck`       | `tsc --noEmit` (strict)                          |
| `npm run lint`            | ESLint over `src/` and `test/`                   |
| `npm run format:check`    | Prettier check                                   |
| `npm test`                | Jest unit tests                                  |
| `npm run test:e2e`        | Supertest integration suite                      |
| `npm run prisma:generate` | Regenerate the Prisma client after a schema edit |
| `npm run prisma:migrate`  | Create and apply a migration                     |
| `npm run prisma:seed`     | Seed admin, demo entity, demo operator           |
| `npm run db:setup`        | First-time migrate + seed in one step            |

---

## Branching

- `main` — release branch. Nothing lands here directly.
- `develop` — integration branch. All day-to-day work is committed or merged here.

Feature branches are cut from `develop` and merged back into it. `develop` is promoted
into `main` only for a release.

## Continuous integration

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs typecheck, lint, format check,
unit tests, a Prisma migrate check, and the e2e suite against a real PostgreSQL service
container. It fires on every push to `main` and `develop`, and on every pull request.
Nothing merges red.

A pre-commit hook (Husky + lint-staged) formats and lints staged files, so CI is a
backstop rather than the first place a formatting problem shows up.

## Project documentation

The development plan, coding standards, validation specification, and source requirements
are maintained outside this repository, alongside it in the working directory. They are
not distributed with the code — ask the project lead for access.
