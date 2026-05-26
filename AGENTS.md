# Repository Guidelines

## Project Structure & Module Organization

The backend lives in `snp-analyzer/app/`: `main.py` wires FastAPI, `routers/` contains API endpoints, `parsers/` handles instrument formats, `processing/` contains analysis logic, and `reporting/` builds charts/PDF output. Static browser assets are in `snp-analyzer/app/static/`.

A Vite/React frontend is under `snp-analyzer/frontend/`, with source in `src/`, UI in `src/components/`, state in `src/stores/`, and types in `src/types/`. Playwright tests are in root `tests/`. Format research and specs are in `CFX-opus/` and `docs/`.

## Build, Test, and Development Commands

- `cd snp-analyzer && docker compose up --build`: build and run the full app on `http://localhost:8002`.
- `cd snp-analyzer && python -m venv venv && source venv/bin/activate && pip install -r requirements.txt`: prepare Python dependencies.
- `cd snp-analyzer && uvicorn app.main:app --reload --port 8002`: run the FastAPI backend locally.
- `npm install && npx playwright install chromium && npx playwright test`: install and run root Playwright E2E tests against port `8002`.
- `cd snp-analyzer/frontend && npm run dev`: run the Vite frontend during UI development.
- `cd snp-analyzer/frontend && npm run build && npm run lint`: type-check, build, and lint the React frontend.
- `cd snp-analyzer && pytest`: run backend Python tests.

## Coding Style & Naming Conventions

Use Python 3.12-compatible code with 4-space indentation, type hints for new public functions, and snake_case module/function names. Keep parsing code in `app/parsers/` and analysis logic in `app/processing/`.

Frontend TypeScript/React code follows the existing ESLint flat config. Use PascalCase for React components, camelCase for variables/functions, and colocate component-specific helpers unless reused across screens.

## Testing Guidelines

Name backend tests `test_*.py` in `snp-analyzer/tests/`. Name Playwright specs `NN-feature.spec.ts` in root `tests/`, matching the current numbered convention. For parser or upload changes, add focused backend tests plus an E2E path when browser behavior changes. Playwright uses `http://localhost:8002`, so start the app first.

## Commit & Pull Request Guidelines

Recent commits use concise imperative subjects such as `Harden SNP analyzer authentication` and `Add SNP ASG result save flow`. Keep subjects short and group related changes.

Pull requests should include a clear summary, test results, linked issue when applicable, and screenshots or recordings for UI changes. Call out authentication, upload-limit, parser, or Docker/runtime changes explicitly.

## Security & Configuration Tips

Treat uploaded PCR files as untrusted input. Preserve ZIP hardening, upload limits, authentication checks, and path-prefix behavior. Do not commit virtualenvs, generated Playwright reports, secrets, or private sample identifiers.
