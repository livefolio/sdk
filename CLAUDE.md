@AGENTS.md

## Project Conventions

- **ES Modules**: Extensionless imports (`import { Foo } from './foo'`), bundled with tsup
- **Strict TypeScript**: `strict: true`, `noUncheckedIndexedAccess: true`
- **Tests**: Co-located `*.test.ts` files, run with `npm test` (Vitest)
- **Formatting**: Prettier on save, ESLint with typescript-eslint rules
- **Pre-commit**: Husky + lint-staged runs `eslint --fix` and `prettier --write` on staged `.ts` files

## Key Commands

| Command | Purpose |
|---------|---------|
| `npm test` | Run all tests |
| `npm run build` | Bundle with tsup to `dist/` |
| `npm run lint` | Check ESLint rules |
| `npm run lint:fix` | Auto-fix ESLint issues |
| `npm run format` | Format with Prettier |
| `npm run format:check` | Check formatting |

## Do Not

- Re-export v0.3 surfaces from `src/index.ts` — v0.3 lives in `parity/src/v3/` as the regression target and is not part of the public API
- Edit files under `parity/src/v3/` casually — that's frozen v0.3 source. Changes there must keep `parity/src/parity.test.ts` (the v0.4↔v0.3 allocation-history gate) passing
- Add network calls in unit tests — mock `DataFeed` / `Executor` with `vi.fn()` or use the in-memory reference impls (`MemoryFeatureCache`, `BacktestExecutor`)
