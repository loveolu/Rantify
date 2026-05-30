# Claude Code — Scaffold Prompt (Phase 1)

You are a senior TypeScript/Node.js engineer implementing a developer tool from a
formal specification. Work in the current directory.

## Your task

1. Read `specs/devtool-loop/spec.md` in full.
2. Before writing any code, produce a step-by-step plan in `PLAN.md`.
3. Implement the minimal viable tool described in the `build_suggestion` section:
   - Match `key_capabilities` exactly — use the exact CLI flag names listed.
   - Respect every item in `tech_constraints` (language, runtime, storage, auth).
   - Write unit tests covering the `Acceptance Criteria` section of the spec.
   - Write a `README.md` containing: what the tool does, install instructions, one
     fully worked example, and a "Known Limitations" section.
4. Do not add dependencies that are not implied by the spec unless strictly required.
   If you must add one, add a comment in `package.json` explaining why.
5. Keep the initial scaffold under **400 lines of source** (excluding tests). This is a
   reviewable scaffold, not a finished product.

## Hard constraints

- No database. No network calls other than the GitHub API.
- All secrets are read from environment variables. Never hardcode a secret or token.
- Exit codes: `0` = success, `1` = user error (bad args/input), `2` = system error.
- The public CLI interface must match the spec's `key_capabilities` precisely.

## When done

Write `AI_NOTES.md` at the repo root summarizing:
- What you built.
- What you deliberately left out, and why.
- Any assumptions you made that a human should validate.
- Anything in the spec that was ambiguous or underspecified.

Run the test suite and the build before finishing. Do not consider the task complete
if the build or tests fail — fix them or document clearly in `AI_NOTES.md` why a test
cannot pass given the current spec.
