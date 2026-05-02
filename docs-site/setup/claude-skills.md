# Setting up Claude Code skills

The SDK ships three Claude Code skills under `.claude/skills/` in the repo. They give Claude focused procedural knowledge about authoring strategies, implementing custom adapters, and debugging — beyond what reading the types and docs alone provides.

This page explains what each skill does, how to install them on your own machine for use across projects, and how to verify they're loaded.

## What's in the box

| Skill | When it fires | What it does |
|---|---|---|
| `livefolio-tactical-author` | You're authoring or modifying a `TacticalSpec` | Loads the dialect cheat sheet, common patterns (rebalance gate / hysteresis / synthetics), and a validation checklist. |
| `livefolio-custom-adapter` | You're implementing a custom `DataFeed`, `Executor`, `Calendar`, or `FeatureCache` | Loads each interface contract, semantic gotchas (TZ handling, range inclusivity, idempotency, eviction), and a pre-ship checklist. |
| `livefolio-debug-strategy` | You're investigating unexpected backtest output | Symptom-to-cause troubleshooting checklist (warmup window, undefined feature handling, calendar mismatch, hysteresis state, parity allowances). |

Each skill body is short (~80–100 lines). They reference this docs site for depth — they're procedural checklists, not duplicated prose.

## In-repo: already wired

If you're working **inside this repo**, the skills are already loaded automatically by Claude Code (it scans `.claude/skills/` at session start). No setup needed. You can verify by running `/skills` in Claude Code and looking for the three `livefolio-*` entries.

## On your own machine: cross-project install

If you want the skills available **outside this repo** (e.g. a separate strategy authoring repo that imports `@livefolio/sdk`), install them into your user-level skills directory.

### Option 1 — Symlink (recommended; stays in sync with the SDK)

```bash
mkdir -p ~/.claude/skills
for skill in livefolio-tactical-author livefolio-custom-adapter livefolio-debug-strategy; do
  ln -sf "$(pwd)/.claude/skills/$skill" ~/.claude/skills/
done
```

When the SDK ships new skill versions, your symlinks pick them up automatically (after a `git pull`).

### Option 2 — Copy (snapshot at install time; manual refresh)

```bash
mkdir -p ~/.claude/skills
cp -r .claude/skills/livefolio-* ~/.claude/skills/
```

Use this if you want a frozen copy that won't change if the upstream skill is updated.

## Verify they're loaded

In Claude Code (in any project), run:

```
/skills
```

You should see entries like:

```
- livefolio-tactical-author: Use when authoring or modifying a TacticalSpec for @livefolio/sdk...
- livefolio-custom-adapter: Use when implementing a custom DataFeed, Executor, Calendar, or FeatureCache...
- livefolio-debug-strategy: Use when investigating unexpected output from a @livefolio/sdk strategy...
```

If they don't appear, check `~/.claude/skills/livefolio-*/SKILL.md` exists and has valid frontmatter (the `name` and `description` fields are required).

## What triggers each skill

Skills auto-fire based on their `description` field. The triggers Claude looks for:

- **`livefolio-tactical-author`**: imports of `TacticalSpec` / `fromSpec` / mentions of "tactical strategy", "rule tree", "rebalance schedule".
- **`livefolio-custom-adapter`**: `implements DataFeed` / `implements Executor` / `implements Calendar` / `implements FeatureCache` declarations, or mentions of "custom data feed", "broker adapter", "exchange calendar".
- **`livefolio-debug-strategy`**: debugging questions about `runBacktest`, `fromSpec`, or unexpected strategy output.

You can also invoke a skill manually with `/<skill-name>` (e.g. `/livefolio-tactical-author`).

## Updating skills

The skills live in `.claude/skills/` of this repo and are versioned alongside the SDK. When the SDK ships changes that affect the skill checklists (e.g. a new dialect version, a new interface method), the skill files update too.

If you symlinked, `git pull` is enough. If you copied, re-run the copy command.

## Removing a skill

```bash
rm -rf ~/.claude/skills/livefolio-tactical-author  # etc.
```

No restart needed — Claude Code re-scans skills on each new session.
