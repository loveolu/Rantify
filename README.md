# DevTool Discovery & Build Loop

A traceable pipeline that turns real developer complaints into scaffolded dev-tool repos:

> **pain observed in public** → **spec stored in Box** → **scaffolded repo ready for human review**

The authoritative design lives in [`specs/devtool-loop/SPEC.md`](specs/devtool-loop/SPEC.md).
If all code disappeared, the system should be regenerable from that spec, the Build Card
data model, the prompt files, and the content in Box.

## Repository layout

```
.
├── README.md
├── .env.example                       # copy to .env; never commit secrets
├── config/
│   ├── idea-miner.json                # scrape/score/cluster config
│   └── themes.json                    # controlled theme vocabulary
└── specs/
    └── devtool-loop/
        ├── SPEC.md                    # ← the authoritative specification
        └── prompts/
            ├── scaffold.md            # Claude Code Phase 1 prompt
            └── refine.md              # Claude Code Phase 2 prompt
```

## The three components

| Component | Responsibility | Spec section |
|-----------|----------------|--------------|
| **Idea Miner** | Scrape Reddit, score/cluster complaints, write Build Cards to Box | §6 |
| **Box Content Hub** | Authoritative storage, status events (webhooks), approval tasks | §7 |
| **AI Builder Orchestrator** | Drive lifecycle, run Claude Code, manage GitHub, update Box | §8–§9 |

## Build Card lifecycle

```
inbox → ready-for-build → building → building-approved → completed
                                   ↘ failed (terminal, from any state)
```

Status changes are the only triggers in the system. The human approval gate is the
transition to `building-approved`. See §4.2 of the spec for the full state machine.

## Getting started (hackathon)

1. Read `specs/devtool-loop/SPEC.md`.
2. `cp .env.example .env` and fill in credentials.
3. Follow the phased plan in §14 of the spec (Phase 0 → 3).

## Guarantees this system makes

- **Traceability** — every repo commits the exact spec it was built from; every Build
  Card links to its source Reddit threads.
- **Human control** — no AI code reaches a main branch without a human PR approval.
- **Reproducibility** — re-running the orchestrator on the same Build Card produces a
  functionally equivalent scaffold.

See §12 of the spec for the full non-functional requirements.
