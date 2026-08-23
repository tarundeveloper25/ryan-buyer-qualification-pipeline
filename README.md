# pipeline-builder

Gabriel Operator pipeline-builder skill pack for Git-backed pipeline state machines.

Published from: [go-code-bot/pipeline-builder](https://github.com/go-code-bot/pipeline-builder).

## Install

```bash
npx github:go-code-bot/pipeline-builder
npx github:go-code-bot/pipeline-builder add ./my-pipeline
npx github:go-code-bot/pipeline-builder sync ./my-pipeline
```

Or:

```bash
curl -fsSL https://raw.githubusercontent.com/go-code-bot/pipeline-builder/main/install.sh | bash -s -- ./my-pipeline
```

Omit `./my-pipeline` to install into the current directory.

## What gets installed

```text
SKILL.md
gabriel.workspace.json
assets/pipeline.json
scripts/validate-pipeline.js
```

`gabriel.workspace.json` marks the definition validator as required. The shipped
`assets/pipeline.json` is a portable schema-v2 example and the canonical machine definition. It stores columns,
stages, transitions, workflow endpoint bindings, guards, and persistence
contracts. It must not store live records, `_workflowState`, or list row data.

In a Persona workspace, commit and push this child before parent publish. The parent checks
the canonical origin and reachability from the declared branch. Unmarked legacy repos use a
loud fallback; marked repos require their declared validator. Parent `prune` removes only
stale Git metadata and preserves the checkout. The portable registry has one shared Pipeline.

## Validate

```bash
node scripts/validate-pipeline.js assets/pipeline.json
```
