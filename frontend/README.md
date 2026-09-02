# NCA Data Collection Portal — Frontend

React single-page application for the NCA Data Collection Portal / ICT Indicators Data Hub.
It is the operator- and authority-facing client for the platform: authentication, user and
entity administration, agent registration, questionnaire authoring, reporting periods, and
the submission workflow.

The API it talks to lives in a separate repository: **nca-backend**. The frontend does not
run usefully on its own — start the backend first.

---

## Tech stack

| Concern      | Technology                       |
| ------------ | -------------------------------- |
| Framework    | React 18 + TypeScript 5.6        |
| Build tool   | Vite 5                           |
| Styling      | Tailwind CSS 3                   |
| Routing      | React Router 6                   |
| Server state | TanStack Query 5                 |
| Forms        | React Hook Form + Zod            |
| HTTP         | Axios                            |
| Icons        | lucide-react                     |
| Tests        | Vitest + Testing Library + jsdom |

---

## Prerequisites

- Node.js 20 or newer, and npm
- A running instance of the backend API (default `http://localhost:4000/api/v1`)

---

## Setup

```bash
git clone https://github.com/NCA-Data-Portal/nca-frontend.git
cd nca-frontend
cp .env.example .env          # VITE_API_URL points at the backend
npm install
npm run dev                   # http://localhost:5173
```

### Environment variables

| Variable       | Purpose                     | Default                        |
| -------------- | --------------------------- | ------------------------------ |
| `VITE_API_URL` | Base URL of the backend API | `http://localhost:4000/api/v1` |

Vite only exposes variables prefixed with `VITE_` to client code, and everything exposed
this way ends up in the shipped bundle — never put a secret in here. The real `.env` is
gitignored; `.env.example` is the tracked template and should be updated whenever a new
variable is introduced.

Note that the backend's `CORS_ORIGIN` must include this app's origin, otherwise every
request fails in the browser even though the API itself is healthy.

---

## Signing in

With the backend seeded (`npm run prisma:seed` there):

```
Admin      admin@nca.gov.ss          Admin@12345
Operator   operator@demo-telecom.ss  Operator@12345
```

Login is two steps. After the password, the API issues a one-time-code challenge and the
session token is granted only once that code is verified. There is no SMS provider yet, so
the code is the fixed demo value **`123456`**, shown as an on-screen hint in demo mode and
printed to the backend console. The backend can skip this step entirely with
`MFA_ENABLED=false`.

Five consecutive wrong passwords lock the account for 15 minutes — worth knowing before
you assume the form is broken.

---

## Project structure

```
nca-frontend/
├── index.html
├── vite.config.ts
├── vitest.config.ts
├── tailwind.config.js
└── src/
    ├── lib/                  # API client, typed endpoint modules, shared types,
    │                         # query client, formatters, status helpers
    ├── context/              # auth state and session handling
    ├── components/
    │   ├── ui/               # design-system primitives (buttons, inputs, dialogs, …)
    │   ├── layout/           # shell, navigation, page chrome
    │   ├── auth/             # auth-specific pieces
    │   ├── DataTable.tsx     # shared table with sorting, paging, empty states
    │   ├── Layout.tsx        # top-level application layout
    │   ├── ProtectedRoute.tsx # route guard — auth plus role checks
    │   └── ErrorBoundary.tsx # catches render failures below the shell
    ├── pages/                # one file per route (see the table below)
    └── test/                 # test setup and shared helpers
```

Every backend module has a matching typed client in `src/lib/*.api.ts` — `auth.api.ts`,
`entities.api.ts`, `agents.api.ts`, `templates.api.ts`, `reporting-periods.api.ts`,
`submissions.api.ts`, `reference.api.ts`, `operator-users.api.ts`, `audit.api.ts`. Route
components call these, never Axios directly, so request shapes and error handling stay in
one place.

---

## Screens

| Page                   | Route                    | Who sees it             |
| ---------------------- | ------------------------ | ----------------------- |
| `LoginPage`            | `/login`                 | Public                  |
| `SignupPage`           | `/signup`                | Public                  |
| `ForgotPasswordPage`   | `/forgot-password`       | Public                  |
| `ResetPasswordPage`    | `/reset-password`        | Public (token link)     |
| `DashboardPage`        | `/`                      | All signed-in users     |
| `UsersPage`            | `/users`                 | Admin                   |
| `OperatorUsersPage`    | operator user management | Operator admin          |
| `EntitiesPage`         | `/entities`              | Authority / Admin       |
| `AgentsPage`           | `/agents`                | Operator / Authority    |
| `TemplatesPage`        | `/templates`             | Authority               |
| `TemplateEditorPage`   | template detail          | Admin                   |
| `ReportingPeriodsPage` | `/reporting-periods`     | Authority / Admin       |
| `SubmissionsPage`      | `/submissions`           | Operator / Authority    |
| `SubmissionEditorPage` | submission detail        | Operator / Authority    |
| `ReferenceDataPage`    | `/reference-data`        | Auth read / Admin write |
| `AuditLogPage`         | `/audit`                 | Admin                   |
| `ForbiddenPage`        | `/403`                   | Any                     |
| `NotFoundPage`         | `*`                      | Any                     |

Access is enforced by `ProtectedRoute` on the client and, authoritatively, by role guards
on the API. The client-side check is a navigation convenience — it hides what a user
cannot use; it is not the security boundary.

---

## Scripts

| Script                 | What it does                                |
| ---------------------- | ------------------------------------------- |
| `npm run dev`          | Vite dev server with hot reload             |
| `npm run build`        | Typecheck, then production build to `dist/` |
| `npm run preview`      | Serve the production build locally          |
| `npm run typecheck`    | `tsc --noEmit` (strict)                     |
| `npm run lint`         | ESLint over `src/`                          |
| `npm run lint:fix`     | ESLint with autofix                         |
| `npm run format:check` | Prettier check                              |
| `npm test`             | Vitest, single run                          |
| `npm run test:watch`   | Vitest in watch mode                        |

---

## Testing

```bash
npm test                 # single run
npm run test:watch       # watch mode
```

The harness is wired — Vitest in a jsdom environment with Testing Library, setup and
shared helpers in [src/test/](src/test/) — but **no specs have been written yet**, so
`npm test` currently passes by finding nothing. CI runs it regardless, which means the
test step is green without proving anything. Treat that as a gap to close, not as
coverage.

When specs do get written, exercise components the way a user meets them — by role,
label, and visible text — rather than by internal implementation detail, so a refactor
that keeps behaviour intact keeps the tests green.

---

## Branching

- `main` — release branch. Nothing lands here directly.
- `develop` — integration branch. All day-to-day work is committed or merged here.

Feature branches are cut from `develop` and merged back into it. `develop` is promoted
into `main` only for a release.

## Continuous integration

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs typecheck, lint, format check,
tests, and a production build. It fires on every push to `main` and `develop`, and on
every pull request. Nothing merges red.

A pre-commit hook (Husky + lint-staged) formats and lints staged files, so CI is a
backstop rather than the first place a formatting problem shows up.

## Project documentation

The development plan, coding standards, validation specification, and source requirements
are maintained outside this repository, alongside it in the working directory. They are
not distributed with the code — ask the project lead for access.
