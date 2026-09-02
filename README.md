# NCA Data Collection Portal

Regulatory data collection platform for the National Communication Authority — the
ICT Indicators Data Hub. Operators file periodic returns against digitised
questionnaires; the Authority reviews, verifies and approves them, and reports on
the results.

This repository holds both halves of the system.

```
data-entry-portal/
├── backend/     NestJS API on PostgreSQL (Prisma)
├── frontend/    React + Vite single-page client
└── tools/       shared local tooling, including the custom ESLint copy plugin
```

Each project is a standalone npm workspace with its own dependencies, scripts,
lint and test configuration, and README. Run npm commands from inside `backend/`
or `frontend/`, not from the repository root.

`tools/` is not optional. Both projects depend on it through
`"eslint-plugin-copy": "file:../tools/eslint-plugin-copy"`, so `npm install`
fails in either project if that folder is missing.

---

## Prerequisites

- Node.js 20 or newer, and npm
- PostgreSQL 14 or newer — local install, Docker, or a managed instance

PostgreSQL via Docker, if you don't have one running:

```bash
docker run --name nca-postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=nca_portal -p 5432:5432 -d postgres:16
```

## Getting started

Start the backend first — the frontend is a client and does nothing useful
without it.

```bash
cd backend
cp .env.example .env          # edit the values; see backend/README.md
npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run start:dev             # http://localhost:4000/api/v1
```

```bash
cd frontend
cp .env.example .env          # VITE_API_URL points at the backend
npm install
npm run dev                   # http://localhost:5173
```

Full detail — environment variables, seeded accounts, the two-step login, the
API reference, project structure and testing — is in
[backend/README.md](backend/README.md) and [frontend/README.md](frontend/README.md).

Optionally, install the root tooling once to activate the shared pre-commit hook
that formats staged files:

```bash
npm install                   # at the repository root
```

---

## Branches

- `main` — release branch.
- `develop` — integration branch. Day-to-day work is committed or merged here.

Feature branches are cut from `develop` and merged back into it. `develop` is
promoted into `main` for a release.

## Continuous integration

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs two jobs on every push
to `main` and `develop` and on every pull request:

- **Backend** — typecheck, lint, format check, a Prisma migrate check, unit tests,
  and the e2e suite against a real PostgreSQL service container.
- **Frontend** — typecheck, lint, format check, tests, and a production build.

Nothing merges red.

## What is not in this repository

Environment files (`.env`) are never committed; `.env.example` in each project is
the tracked template. Uploaded attachments (`backend/storage/`) and database
backups (`backend/backups/`) hold real filings and are excluded.

Project documentation — the development plan, engineering standards, the
validation specification and the source requirements — is maintained outside this
repository and is not distributed with the code.
