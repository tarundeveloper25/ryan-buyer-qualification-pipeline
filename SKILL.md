---
name: pipeline-builder
description: >
  Build, validate, and maintain Git-backed Gabriel Operator pipeline state
  machines by editing assets/pipeline.json. Use this skill when defining
  pipeline columns as persisted actor context, stages as machine states, and
  transitions as Gabriel workflow executions with guards and persistence
  contracts that create, patch, or upsert records.
metadata:
  author: gabriel-operator
  version: "1.0"
  compatibility: Requires Node.js 16+ for validation scripts.
---

# Pipeline Builder

## Portable Git contract (schema v2)

New and cross-environment pipeline assets must use stable resource keys:

```json
{
  "schemaVersion": 2,
  "resourceKey": "pipeline.example.orders-v2",
  "storage": {
    "listRef": { "kind": "list", "resourceKey": "list.example.orders-v2" }
  },
  "pipeline": {
    "name": "Orders",
    "columns": [],
    "stages": [],
    "transitions": []
  }
}
```

- Never commit `pipelineId`, `listId`, `collectionId`, `pageId`, `userId`, record IDs, or run IDs to portable definitions or generated diagrams.
- Use `storage.listRef` for durable storage. Gabriel allocates the environment-local Pipeline, List, and shared collection during bundle import.
- Keep column, stage, transition, recipe, policy, task, and guard IDs stable; these are logical model identifiers.
- Do not export records, runs, evidence, audit logs, or snapshots with a definition.
- Require a schema-v2 dependency manifest and portability validation before publishing.
- A Persona bundle manifest must pin the exact Pipeline commit `revision` and SHA-256 `definitionFingerprint` of `assets/pipeline.json`; a moving branch without a matching fingerprint is invalid.
- Legacy schema v1 is same-environment compatibility only; never copy it across environments and never generate new v1 exports.

Root `gabriel.workspace.json` declares `assets/pipeline.json` and its required validator.
Keep the marker and script in every new scaffold. In a Persona workspace, commit and push
this child first; parent publish checks the configured origin and declared branch before
pinning it. The registry contains exactly one shared Pipeline.
Unmarked legacy children fall back to a conventional validator with a prominent warning;
new marked children fail if required validator files are missing. Parent `prune` is
non-destructive: it unlinks validated Git metadata and preserves the physical checkout.

## Git-backed pipeline repositories

When this skill is materialized as a Git repository for one pipeline, the repo
contains the scaffold plus `assets/pipeline.json`. The live Gabriel runtime uses
the synced default branch/database projection; non-default branches are for
authoring and review.

Use this skill when editing `assets/pipeline.json` for a Git-backed pipeline.

### Inside a Persona workspace

This repository is usually a **git submodule** of an AI Persona repository, at
`references/pipelines/<resource-key>/`. When it is, the parent owns
`references/registry.json`, which pins this repo's commit `revision` and the SHA-256
`definitionFingerprint` of `assets/pipeline.json`. Two consequences:

- After changing `assets/pipeline.json`, commit and push here **first**, then publish the
  parent workspace (`node scripts/publish-workspace.js publish` from the persona root, or
  Gabriel **Publish workspace**). Until you do, the Persona still resolves the previous
  commit. A persona-root commit is not an atomic multi-repo publish.
- A transition whose `workflowEndpointId` points at a **team agent** is a workspace graph
  edge, not a portable registry row. Do **not** add `team_agent` or `dependsOn` to
  `references/registry.json`. Bind the team agent in Gabriel; workspace publish writes a
  depth-1 gitlink under `references/team-agents/`. `schema-form:*` endpoints are built-ins
  and are not git dependencies.

## Mental Model

- One pipeline is one state-machine definition.
- `pipeline.columns[]` is the persisted record/context schema. Each key is a field that can appear on a table row and in actor context.
- `storage.listRef` names the portable List definition. Runtime materialization resolves it to an environment-local collection before execution.
- `pipeline.stages[]` is state metadata only: stable `id`, user-facing `name`, `type`, color, and description.
- `pipeline.transitions[]` is where behavior lives. A transition owns the optional workflow binding, source state, target state, trigger, outcome guards, and persistence contract.
- Cross-machine communication is modeled declaratively with transition outcome `effects[]`; do not hardcode sibling pipeline calls in workflow instructions.
- Records, `_workflowState`, runtime snapshots, and table row data never belong in Git.
- Keep ids stable. Rename labels freely, but do not regenerate stage, transition, or column keys unless you intentionally migrate existing records and mappings.

## Canonical Files

```text
assets/pipeline.json          ← machine definition (stages, transitions, columns)
assets/blueprint.json         ← read-only simulation blueprints (optional)
tasks/<taskId>.json           ← one file per pipeline task (see Tasks section)
```

### `assets/pipeline.json`

Portable wrapper:

```json
{
  "schemaVersion": 2,
  "resourceKey": "pipeline.grocery.automation-v2",
  "storage": {
    "listRef": { "kind": "list", "resourceKey": "list.grocery.items-v2" }
  },
  "pipeline": {
    "name": "Grocery Automation",
    "columns": [],
    "stages": [],
    "transitions": []
  },
  "commitMessage": "Update pipeline machine definition"
}
```

Any separate task definition uses `pipelineRef`, never a local `pipelineId`.

Optional documentation metadata:

- `blueprints[]` may be stored at the top level for read-only simulation docs.
- This is documentation-only and must not alter runtime machine behavior.
- Runtime still executes from `pipeline.stages[]` + `pipeline.transitions[]`.

## Columns

Columns are the machine context schema and the table schema.

```json
{
  "id": "col_total_eur",
  "key": "total_eur",
  "label": "Total EUR",
  "type": "number",
  "required": false,
  "order": 3
}
```

Allowed types are `text`, `number`, `boolean`, `select`, `date`, `datetime`, and `json`.

## Stages

Stages are state cards. They should not own workflow execution long-term, but
they may own trigger configuration used by the coordinator.

```json
{
  "id": "reserve_order_slot",
  "name": "Reserve Order Slot",
  "type": "intermediate",
  "description": "Reserve a pickup or delivery slot.",
  "triggerKind": "scheduled",
  "scheduledConfig": { "cronExpression": "0 21 * * *" },
  "colorToken": "#3b82f6",
  "order": 1
}
```

Use `type: "initial"` for the first state and `type: "terminal"` for final states.
Allowed `triggerKind` values are `manual`, `scheduled`, `reactive`, and
`data_change`.

For data-change stages, store the watch predicate on the stage:

```json
{
  "triggerKind": "data_change",
  "dataChangeConfig": {
    "guardText": "{{usage}} >= 80",
    "guardAst": {
      "type": "clause",
      "field": "usage",
      "op": ">=",
      "value": 80
    }
  }
}
```

`dataChangeConfig.guardAst` decides whether a row change should fire the
transition. `transition.success.guardAst` and `transition.failure.guardAst`
remain outcome guards evaluated after the trigger fires.

## Tasks

Pipeline tasks are named run configurations for a pipeline. Each task defines a set of input fields, how those inputs are sourced (manual, text prompt, or image), and how they are mapped to workflow start inputs.

Tasks are stored in the `tasks/` folder — one JSON file per task. The file name must match the `pipelineTaskConfig.id`.

### Task file format (`tasks/<taskId>.json`)

```json
{
  "schemaVersion": 2,
  "resourceKey": "pipeline.grocery.automation-v2",
  "id": "tpl_abc",
  "title": "Weekly Grocery Run",
  "icon": "🛒",
  "description": "Run the full grocery automation for one household.",
  "visibility": "public",
  "pipelineTaskConfig": {
    "id": "task_abc",
    "pipelineRef": { "kind": "pipeline", "resourceKey": "pipeline.grocery.automation-v2" },
    "name": "Weekly Grocery Run",
    "description": "Automated weekly shop.",
    "icon": "🛒",
    "inputDefinitions": [
      {
        "key": "supermarket",
        "label": "Supermarket",
        "type": "choice",
        "required": true,
        "options": [
          { "label": "Albert Heijn", "value": "albert_heijn" },
          { "label": "Jumbo", "value": "jumbo" }
        ]
      }
    ],
    "inputSources": [],
    "inputMappings": [],
    "inputBindings": [
      {
        "id": "bind_1",
        "inputKey": "supermarket",
        "target": {
          "kind": "start_input",
          "stageId": "stage_shop",
          "transitionId": "trans_shop__default",
          "workflowEndpointId": "workflow_abc",
          "fieldKey": "supermarket"
        }
      }
    ]
  }
}
```

### Task file fields

| Field | Required | Description |
|-------|----------|-------------|
| `schemaVersion` | yes | Must be `2` for a portable task. |
| `resourceKey` | yes | Stable Pipeline resource key. |
| `id` | no | The task template record id (stable; do not change after creation) |
| `title` | yes | Display name shown in the UI |
| `icon` | no | Emoji or icon string |
| `description` | no | Short description shown in the task picker |
| `visibility` | no | `"public"` (default) or `"private"` |
| `pipelineTaskConfig` | yes | The full task configuration (see below) |

### `pipelineTaskConfig` fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Stable unique id — must match the file name (`tasks/<id>.json`) |
| `pipelineRef` | yes | Typed portable reference to the owning Pipeline. |
| `name` | yes | Internal name |
| `inputDefinitions` | yes | Array of input field definitions |
| `inputSources` | yes | Array of input sources (task prompt, image) |
| `inputMappings` | yes | Array of prompt/image → field mappings |
| `inputBindings` | yes | How each input field maps to workflow start inputs or connector inputs |

### `inputDefinitions` field types

Allowed `type` values: `text`, `number`, `boolean`, `choice`, `date`, `email`, `url`, `rich-text`, `image`, `array`, `object`, `json`, `task_prompt`, `task_prompt_with_image`.

For `choice` fields, include an `options` array:

```json
{ "key": "supermarket", "label": "Supermarket", "type": "choice", "required": true,
  "options": [{ "label": "Albert Heijn", "value": "albert_heijn" }] }
```

### `inputBindings` target kinds

| `target.kind` | Description |
|---------------|-------------|
| `start_input` | Binds to a workflow start node input field |
| `human_choice` | Binds to a `human_choice` node's `outputKey` (pre-answers the choice) |
| `member_input` | Binds to a connector step input |
| `member_variable` | Binds to a connector step variable |
| `stage_context` | Stores the value as stage context for that stage |

### Managing tasks

- To **add** a task: create `tasks/<newTaskId>.json` and add `"newTaskId"` to `taskIds` in `pipeline.json`.
- To **remove** a task: delete `tasks/<taskId>.json` and remove the id from `taskIds` in `pipeline.json`.
- To **rename** a task: update `title` in the task file. Do **not** change `pipelineTaskConfig.id` or the file name — that breaks existing saved runs.
- Keep `pipelineTaskConfig.id`, the file name, and the `taskIds` entry all in sync.

## Team-agent pages and first-step routing

**Default:** Prefer **one** manual transition from the **initial** stage with a single `workflowEndpointId` (the team-agent / page-builder workflow). Model parallel work (many repos or categories) **inside** `assets/team-agent.json` using **fork** and **join** in the workflow graph, not by creating one pipeline transition per branch.

**Multiple initial transitions:** Add two or more manual transitions from the same initial stage, each with `workflowEndpointId`, only when you need **different first workflows** or explicit route labels. The Results tab shows a route dropdown and sends `selectedTransitionId` on pipeline start and on stage **Resume** when multiple manual workflow transitions exist from that stage.

**N transitions does not require N Git repositories.** You may reuse the same `workflowEndpointId` on several transitions if you only need distinct transition ids and labels.

Example fragment (replace stage ids and endpoint uuid with yours):

```json
"transitions": [
  {
    "id": "ingest__route_alpha",
    "name": "Route Alpha",
    "fromStageId": "ingest",
    "toStageId": "enrich",
    "trigger": "manual",
    "workflowEndpointId": "00000000-0000-4000-8000-000000000001",
    "success": {
      "advanceToStageId": "enrich",
      "persistMode": "shared_patch",
      "fieldMappings": []
    }
  },
  {
    "id": "ingest__route_beta",
    "name": "Route Beta",
    "fromStageId": "ingest",
    "toStageId": "enrich",
    "trigger": "manual",
    "workflowEndpointId": "00000000-0000-4000-8000-000000000001",
    "success": {
      "advanceToStageId": "enrich",
      "persistMode": "shared_patch",
      "fieldMappings": []
    }
  }
]
```

## Transitions

A transition is the software contract between a state, a workflow, and persisted records.

Existing-case policies use `answersField` as their preferred reusable answer payload.
When older rows stored compatible answers under another declared column, list those
columns in ordered `fallbackAnswersFields`. The runtime still revalidates every value
against the current trusted schema; never use approval, receipt, or submission fields
as answer fallbacks.

Use `reusableCaseFields` for durable discovery data, such as a trusted form schema and
question list, that makes an answerless case worth reusing. All listed fields must be
present and non-empty. Reusing such a case does not invent answers; collection resumes
with every unanswered current-schema question.

```json
{
  "id": "reserve_order_slot__default",
  "name": "Reserve delivery slot",
  "fromStageId": "reserve_order_slot",
  "toStageId": "search_and_add_groceries",
  "workflowEndpointId": "workflow_abc",
  "trigger": "manual",
  "selectionMode": "all_in_stage",
  "batchMode": "none",
  "success": {
    "advanceToStageId": "search_and_add_groceries",
    "persistMode": "shared_patch",
    "fieldMappings": [
      { "targetField": "slot_time", "sourcePath": "slot.time" },
      { "targetField": "store_name", "sourcePath": "store.name" }
    ]
  },
  "failure": {
    "advanceToStageId": "reserve_order_slot",
    "persistMode": "shared_patch",
    "fieldMappings": [
      { "targetField": "last_error", "sourcePath": "message" }
    ]
  }
}
```

`workflowEndpointId` is optional. Workflowless `scheduled`, `reactive`, and
`data_change` transitions are advanced directly through the row event path. When
`workflowEndpointId` is present, the workflow runs first and its success/failure
output is applied by the transition outcome contract.

Allowed `trigger` values are `manual`, `scheduled`, `reactive`, and
`data_change`.

## Shared data acquisition (preferred for discovery and scraping)

External reads belong in `acquisitionRecipes[]`, not in an ad-hoc workflow or a
persona page tool. A transition may declare exactly one of `acquisition` or
`workflowEndpointId`. The pipeline remains the only layer that commits the
normalized result to List records.

Use this fixed read-through order:

1. fresh scoped acquisition snapshot or compatible List data;
2. configured `official_api` sources;
3. `public_browser` only when the API failure category is explicitly allowed;
4. normalize and validate required fields before pipeline `create_or_upsert`.

```json
{
  "acquisitionRecipes": [{
    "schemaVersion": 1,
    "id": "public-form-schema-v1",
    "resourceType": "public_form_schema",
    "cardinality": "one",
    "outputSchemaVersion": "form_schema.v1",
    "locatorField": "form_url",
    "cache": { "ttlSeconds": 3600, "staleIfErrorSeconds": 86400 },
    "sources": [{
      "id": "public-form-browser",
      "type": "public_browser",
      "extractor": "form_schema.v1",
      "goalFallback": true
    }],
    "requiredFields": ["form_url", "form_ref", "form_fields", "form_fingerprint"]
  }],
  "transitions": [{
    "id": "analyze-form",
    "fromStageId": "intake",
    "acquisition": { "recipeId": "public-form-schema-v1", "locatorField": "form_url" },
    "trigger": "manual",
    "automation": { "autoFireOnEntry": false }
  }]
}
```

`form_schema.v1` is for public forms. `structured_collection.v1` requires an
item selector and field selectors and is suitable for public catalogues. Never
put passwords, payment data, CAPTCHA solutions, signatures, or mutating HTTP
methods in an acquisition recipe. Authenticated profile browsing is a separate
future adapter, not something to approximate with browser steps.

`data._acquisition` is protected provenance written by the runtime. Do not add
it as a List column, map it as a Canvas artifact, or accept it from workflow
output.

### Existing-case identity and safe reuse

When a command must detect prior cases, define `pipeline.existingCasePolicies[]`
and reference its id from the workflow Canvas `existingCasePolicyId`. Never add
a Canvas task or transition that searches for previous submissions: the command
launcher performs this lookup before it creates a goal, Canvas session, binding,
pipeline run, or row.

In the product UI, author these policies under **Pipeline → Manage → Config →
Existing-case detection**. The editor is intentionally column-driven: select the
locator, canonical identity, answer, discovery, and lineage columns from the
Pipeline schema. Do not put `locatorField` or identity rules in Persona slash-command
configuration. The Persona/Canvas model selects only `existingCasePolicyId`.

`locatorField` is configurable and is not intrinsically `form_url`. Use the stable
resource locator appropriate to the machine, such as `form_url`, `product_url`, or
`listing_url`. With `canonical_url_sha256_v1`, the runtime canonicalizes that URL and
writes its SHA-256 identity to `identityField`. The locator must also be supplied by
the command intake and by the relevant acquisition/start transition; cross-asset
validation must fail rather than silently comparing a different field.

The Analyze transition must declare the policy's identity, attempt, mode, source
record/run, and reused-key fields in `acquisition.passthroughInputFields`. These
values are server-issued metadata and do not participate in acquisition cache
identity. Map them into Pipeline/List columns and use the policy's
`caseAttemptField` as the `create_or_upsert` success correlation. Recovery must
retain the same attempt id.

Reuse always creates a new case row. Previous answers are reloaded through
page/user ownership checks only after the current form schema is acquired, then
reconciled against current types and choices. Never copy approval state,
submission keys/receipts, evidence, errors, or pipeline state. Do not author the
legacy `resubmissionGuard` field or a `canvas_pipeline_resubmission_check` UI.

## Schema-form transition endpoints

Besides a workflow id, `workflowEndpointId` accepts four built-in endpoints that
drive an external form through its lifecycle. They need no workflow repository.

| Endpoint | Does |
|---|---|
| `schema-form:discover:<urlFieldKey>` | **Deprecated compatibility syntax.** Delegates to `form_schema.v1`; do not author it in new pipelines |
| `schema-form:dryrun:<formId>` | Fills and verifies the real form but stops before submitting |
| `schema-form:external:<formId>` | Fills and submits the real form |
| `schema-form:intake:<formId>` | Confirms answers without an external submission |

**Referencing a discovered form.** A form found during the run has no id when the
pipeline is authored, so prefix the segment with `@` to read the ref off the case
instead: `schema-form:external:@form_ref` uses the `form_ref` that
`schema-form:discover:` wrote. A plain id is accepted only when an explicit
runtime-discovery binding for that id already exists. Using `@` before any
discover transition has run fails with `SCHEMA_FORM_REF_UNRESOLVED`.

### Discovery compatibility

New pipelines must use an acquisition recipe. For an existing model only,
`schema-form:discover:<urlFieldKey>` names the case field holding the URL —
`schema-form:discover:form_url` reads `form_url`. On success it writes:

| Output | Use |
|---|---|
| `form_ref` | The bound form id, used by later `dryrun`/`external` transitions |
| `form_fields` | Question set for a `suspend_resume` node's `resumeFieldsFrom` |
| `form_title`, `form_fingerprint` | Display and drift detection |
| `unsupported_controls`, `discovery_warnings` | Fields that could not be modelled |

The URL is untrusted input, so discovery keeps full SSRF validation (initial URL,
every subresource host, and the post-redirect destination) and refuses forms
requiring passwords, payment, captcha, or signature. It is rate limited per user
and per persona. A discovered form is only ever resolvable through the binding
created in the same call.

### Optional live dry run before submit

A `schema_form_dry_run` transition post-processor performs exactly what a submission does — locator
resolution, blocked-capability checks, fingerprint verification — and returns
`resolved_fields` plus the values that would be sent, with `submission_status:
"dry_run"`. Nothing is written and no approval is consumed. It opens a real
browser session and therefore must not be added to the standard Filer
Collect/review transition: the later Fill/submit transition would otherwise run
the same form automation a second time. Use it only when the product explicitly
calls for a separate live conditional-discovery pass and exposes that extra
browser pass to the user.

### Reviewing answers before approving

For Filer-style Canvas, render the committed questions and normalized answers
with `schema_form_answer_review`. The Canvas
task declares `requiresApproval: true`, `autoApprove: false`, and
`artifactPolicy: "none"`. The following submission transition still needs
`approvalGuard.required: true`; Canvas approval alone is not a pipeline grant.

For `responseCollection.mode: "channels_only"`, the validated response submit is
also the user's explicit answer confirmation. Canvas waits for the Collect
transition to commit, writes the same fingerprinted pipeline approval, and then
starts the guarded submit task without presenting a duplicate Looks good card.
Never remove `requiresApproval` or `approvalGuard` to achieve this. A failure to
persist the approval must fall back to a separate approval gate.

When the Canvas task declares `responseCollection.mode: "channels_only"`, make
the answer transition workflowless: omit `workflowEndpointId` and
`inputBindings`, omit the live `schema_form_dry_run` post-processor, and map the
validated response output into the List. Canvas creates the task-scoped voice, phone,
email, Slack, Discord, Telegram, or WhatsApp response session before requesting
the transition. Do not route this through a collection team agent and never add
`chat` as an allowed response channel; Persona Chat apps only deliver the secure
single-use questionnaire link.

When existing-case reconciliation finds compatible prior answers, expose them
only as prefilled draft values. Show the complete current Q&A—including reused,
new, and invalidated fields—and require a fresh confirmation before committing
Collect/review. Reuse must never synthesize a completed human response or reuse
an earlier approval.

Submission evidence is terminal evidence, not proof of transition success.
Map `submission_screenshots` to the List's screenshot field and
`browser_recording` to its video field on successful execution, and preserve
the same fields in structured failure output. Canvas may display that explicit
media while the run remains in `needs_attention`; it must not advance the stage
or imply that the external action succeeded.

Do not expose form URLs, question schemas, answer bags, fingerprints, dry-run
objects, or transition summaries as user artifacts.

### Human approval is enforced, not assumed

When the form's workflow contract sets `confirmationRequired`, a
`schema-form:external:` submission requires a recorded approval for **that run**
and **those exact answers**. Without one it fails closed with
`SCHEMA_FORM_SUBMISSION_FAILED`.

Two consequences when authoring:

- A submit transition reached with no human involved — an auto-advance job, a
  scheduled or reactive trigger, or cross-pipeline effect dispatch — will not
  submit. Put the approval on the path (a `manual` transition, or a confirmation
  step) before the submit stage.
- The approval is fingerprinted over the form's own fields. Enriching unrelated
  case data between approval and submit is fine, but a pipeline that **rewrites a
  form field** after approval will fail closed: the human approved different
  values than the ones being sent. Map values before the approval, not after.

Note that `transition.automation.requireHumanConfirmation` does **not** satisfy
this. It is evaluated after the transition workflow has run, so it gates stage
advancement rather than the outside-world action.

## Opening a case from outside (webhook trigger)

`reactive`, `scheduled`, and `data_change` only advance a run that already
exists — none of them creates one. To let an external system open a case, create
a webhook trigger with `targetType: "pipeline"`:

```json
{
  "name": "New filing request",
  "targetType": "pipeline",
  "targetPipelineId": "pl_filer",
  "targetTransitionId": "tr_open_case",
  "authMethod": "hmac",
  "payloadMapping": [
    { "sourceField": "data.form_url", "targetInput": "form_url" }
  ]
}
```

`targetPipelineId` is required; `targetTransitionId` is optional and selects the
starting transition. The payload is mapped through `payloadMapping` into the
run's `initialInput`, so `form_url` above lands where a
`schema-form:discover:form_url` transition expects it.

HMAC signature verification, secret generation, and outbound notifications are
the same as every other webhook target.

**Redeliveries are deduplicated.** Senders retry, so an identical delivery would
otherwise open a second case. Pass `X-Idempotency-Key` to control this
explicitly; without it the request body is hashed. A duplicate returns the
original `runId` with `status: "duplicate"` instead of starting a run. The record
is written only after the run starts, so a failed start can still be retried.

## Transition audit trail

Every advance appends an entry to
`data._workflowState.<pipelineId>.activity` on the record. Entries are appended,
never rewritten, so the list is the record's history.

| Field | Meaning |
|---|---|
| `at` | ISO timestamp |
| `fromStageId` / `stageId` | Stage moved from, and landed in |
| `transitionId` | Stable id of the transition that ran |
| `title` | Human-readable summary including the transition name |
| `status` | `success` or `failed` |
| `actorKind` | `user` when a person acted, `system` otherwise |
| `actorUserId` | The person, when `actorKind` is `user` |
| `data` | Transition output, plus `workflowRunId` when a workflow ran |

`actorKind` distinguishes a person clicking through a manual transition from a
scheduler, monitor tick, or cross-pipeline effect advancing the record. It is set
from the calling path rather than inferred, so an automated advance is never
attributed to the pipeline's owner — treat `system` as "nobody approved this".

## Guards

Use deterministic guard AST, not free-form instructions.

```json
{
  "guardText": "{{total_eur}} >= 50",
  "guardAst": {
    "type": "clause",
    "field": "total_eur",
    "op": ">=",
    "value": 50
  }
}
```

Supported operators are `=`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `is_empty`, and `is_not_empty`.

## Persistence Modes

- `shared_patch`: one workflow output object is mapped to every eligible record.
- `per_record_match`: workflow returns an array and each item is matched to one existing record.
- `create_or_upsert`: workflow returns an array and records are created or updated by correlation.
- `replace`: workflow returns an array that hard-deletes all records in the associated pipeline list and inserts the new mapped records.

For matching array modes, define correlation:

```json
{
  "persistMode": "per_record_match",
  "arrayKey": "records",
  "correlation": {
    "recordField": "sku",
    "outputPath": "sku"
  }
}
```

For full replacement, define `arrayKey` and omit correlation:

```json
{
  "persistMode": "replace",
  "arrayKey": "records"
}
```

## Cross-Pipeline Effects

Use `success.effects[]` or `failure.effects[]` when one state machine must
create, upsert, patch, or run a transition in another pipeline.

```json
{
  "success": {
    "advanceToStageId": "monitor_usage",
    "effects": [
      {
        "type": "pipeline_transition",
        "targetPipelineId": "pl_grocery_order",
        "targetTransitionId": "reserve_slot__default",
        "targetCollectionId": "coll_grocery_orders",
        "operation": "create_or_upsert",
        "dispatch": "run_target_transition",
        "correlation": {
          "targetField": "order_key",
          "sourcePath": "source.record.reorder_key"
        },
        "mappings": [
          { "targetField": "items", "sourcePath": "source.records" },
          { "targetField": "status", "value": "draft" }
        ],
        "sourcePatches": [
          { "targetField": "current_order_id", "sourcePath": "target.record.id" }
        ]
      }
    ]
  }
}
```

Effect fields:

- `targetPipelineId`: required id of the sibling pipeline/state machine.
- `targetCollectionId`: optional override; defaults to the target pipeline's `collectionId`.
- `targetTransitionId`: optional transition to run after the target record exists.
- `operation`: `create`, `upsert`, `patch`, or `create_or_upsert`.
- `dispatch`: use `run_target_transition` to execute `targetTransitionId`; otherwise use `none`.
- `correlation.targetField`: field on the target list used to find an existing target record.
- `correlation.sourcePath`: scoped path that supplies the match value.
- `mappings[]`: writes target list columns.
- `sourcePatches[]`: writes columns back on the source list after the target record is created or updated.

Scoped source paths:

- `source.output.foo`: workflow output field from the source transition.
- `source.record.foo`: current source row field.
- `source.records`: all source rows selected/finalized by the source transition.
- `source.context.foo`: source actor snapshot context.
- `target.record.foo`: target row field after create/upsert/patch; use `target.record.id` for the target record id.

When mapping fields, qualify the intended list mentally even if the JSON stores
only the field key: target mappings must be columns on the target pipeline/list,
and `sourcePatches` must be columns on the source pipeline/list.

## Common Edits

Add a task:

1. Create `tasks/<taskId>.json` with `schemaVersion: 2`, `resourceKey`, and `pipelineTaskConfig.pipelineRef`.
2. Add the task id to `taskIds[]` in `assets/pipeline.json`.
3. Wire `inputBindings` to the relevant stage transitions and workflow start input keys.

Remove a task:

1. Delete `tasks/<taskId>.json`.
2. Remove the id from `taskIds[]` in `assets/pipeline.json`.

Add a stage:

1. Append a new object to `pipeline.stages[]`.
2. Use a stable lowercase id.
3. Add or update transitions that point to it.

Add a transition:

1. Add a `pipeline.transitions[]` entry.
2. Set `fromStageId` to an existing stage id.
3. Set `success.advanceToStageId` and/or `toStageId` to an existing stage id.
4. Bind `workflowEndpointId` only if the workflow should run for this transition.
5. Add field mappings only to existing column keys.

Add a workflowless automatic transition:

1. Add a `pipeline.transitions[]` entry with `trigger` set to `scheduled`,
   `reactive`, or `data_change`.
2. Leave `workflowEndpointId` unset.
3. Set `success.advanceToStageId` to the next stage, and optionally add a
   success guard.
4. For `scheduled`, put `scheduledConfig.cronExpression` on the source stage.
5. For `data_change`, put the watch condition in the source stage's
   `dataChangeConfig.guardAst`.

Change mappings:

1. Keep `targetField` equal to a `pipeline.columns[].key`.
2. Set `sourcePath` to a structured JSON path returned by the workflow End node.
3. Do not map plain text output; expose named JSON fields in the workflow first.

Connect two pipelines:

1. Keep each machine in its own pipeline JSON with its own `resourceKey` and `storage.listRef`.
2. Add an outcome `effects[]` entry on the source transition.
3. Set the target pipeline/list/transition ids explicitly.
4. Map source data into target columns.
5. Add `sourcePatches[]` only for fields that should be written back to the source list.
6. Use `dispatch: "run_target_transition"` only when the target transition should run immediately.

## Validation

Run:

```bash
node scripts/validate-pipeline.js assets/pipeline.json
```

The validator rejects duplicate columns, duplicate ids, missing stage references,
invalid persist modes, invalid mappings, invalid correlation fields, and
malformed cross-pipeline effects.

Task files are validated at sync time by the runtime. Each `tasks/<taskId>.json` must:
- Have `schemaVersion: 2`
- Have a `resourceKey` matching the owning pipeline model
- Have `pipelineTaskConfig.pipelineRef` matching the owning pipeline resource key
- Have a non-empty `pipelineTaskConfig.id` that matches the file name (without `.json`)
