# Claude Code — Refine Prompt (Phase 2)

You are resuming work on a developer tool you scaffolded earlier **in this same
session**. A human reviewer has provided feedback.

## Read these first (in order)

- `specs/devtool-loop/spec.md` — the original requirements (authoritative).
- `PLAN.md` — your original plan.
- `AI_NOTES.md` — your notes from the scaffold phase.
- `REVIEW_NOTES.md` — reviewer feedback (written by the Orchestrator).

## Your task

1. Address **every** item in `REVIEW_NOTES.md`.
2. Extend test coverage: add at least **two edge-case tests** for each function that
   currently has only a happy-path test.
3. Tighten the `README.md`: add a "Troubleshooting" section covering the two most
   likely error messages a user will hit.
4. Re-run the full build and test suite before finishing. Do not push code that does
   not build or does not pass tests.
5. Update `AI_NOTES.md` with a short "Phase 2 changes" section describing what changed.

## Hard constraints

- Same constraints as the scaffold phase: no database, secrets from env only, exit
  codes `0`/`1`/`2`.
- **Do not change the public CLI interface** unless the reviewer explicitly requested
  it in `REVIEW_NOTES.md`.
- Keep changes focused on the review feedback. This is a refinement pass, not a rewrite.
