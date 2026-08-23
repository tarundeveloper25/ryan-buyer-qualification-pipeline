#!/usr/bin/env node
const fs = require('fs');

function fail(message) {
  throw new Error(message);
}

const FORBIDDEN_PORTABLE_KEYS = new Set(['appId', 'endpointId', 'actionId', 'pageId', 'userId', 'pipelineId', 'listId', 'collectionId']);

function validateNoLocalIds(value, pathLabel = '$') {
  if (Array.isArray(value)) {
    value.forEach((child, index) => validateNoLocalIds(child, `${pathLabel}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PORTABLE_KEYS.has(key)) fail(`${pathLabel}.${key} is environment-local`);
    validateNoLocalIds(child, `${pathLabel}.${key}`);
  }
}

function assertNoDuplicates(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) fail(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function validateMappings(mappings, columnKeys, label) {
  for (const mapping of mappings || []) {
    if (!mapping.targetField || !columnKeys.has(mapping.targetField)) {
      fail(`${label} maps to missing column: ${mapping.targetField || '(empty)'}`);
    }
    if (!String(mapping.sourcePath || '').trim()) {
      fail(`${label} has an empty sourcePath for ${mapping.targetField}`);
    }
  }
}

const ALLOWED_TRIGGERS = new Set(['manual', 'scheduled', 'reactive', 'data_change']);
const ALLOWED_GUARD_OPERATORS = new Set(['=', '!=', '>', '>=', '<', '<=', 'contains', 'is_empty', 'is_not_empty']);
const ALLOWED_PERSIST_MODES = new Set(['shared_patch', 'per_record_match', 'create_or_upsert', 'replace']);
const ALLOWED_EFFECT_OPERATIONS = new Set(['create', 'upsert', 'patch', 'create_or_upsert']);
const ALLOWED_EFFECT_DISPATCH = new Set(['none', 'run_target_transition']);
const ALLOWED_COLUMN_TYPES = new Set(['text', 'number', 'boolean', 'date', 'select', 'json']);

function validateGuardAst(ast, columnKeys, label) {
  if (!ast) return;
  if (ast.type === 'clause') {
    if (!ast.field || (!columnKeys.has(ast.field) && ast.field !== '_stage')) {
      fail(`${label} guard references missing field: ${ast.field || '(empty)'}`);
    }
    if (!ALLOWED_GUARD_OPERATORS.has(ast.op)) {
      fail(`${label} guard uses invalid operator: ${ast.op || '(empty)'}`);
    }
    return;
  }
  if (ast.type === 'group') {
    if (ast.combinator !== 'and' && ast.combinator !== 'or') {
      fail(`${label} guard group has invalid combinator: ${ast.combinator || '(empty)'}`);
    }
    for (const clause of ast.clauses || []) validateGuardAst(clause, columnKeys, label);
    return;
  }
  fail(`${label} guardAst has invalid type: ${ast.type || '(empty)'}`);
}

function validateEffectMappings(mappings, label, { requireSourceColumnKeys } = {}) {
  for (const mapping of mappings || []) {
    if (!String(mapping.targetField || '').trim()) {
      fail(`${label} has an empty targetField`);
    }
    if (requireSourceColumnKeys && !requireSourceColumnKeys.has(mapping.targetField)) {
      fail(`${label} maps to missing source column: ${mapping.targetField}`);
    }
    const hasSourcePath = String(mapping.sourcePath || '').trim().length > 0;
    const hasValue = Object.prototype.hasOwnProperty.call(mapping, 'value');
    const hasDefault = Object.prototype.hasOwnProperty.call(mapping, 'defaultValue');
    if (!hasSourcePath && !hasValue && !hasDefault) {
      fail(`${label} mapping for ${mapping.targetField} needs sourcePath, value, or defaultValue`);
    }
  }
}

function validateEffects(effects, { label, pipelineId, transitionIds, columnKeys }) {
  for (const effect of effects || []) {
    if (effect.type !== 'pipeline_transition') {
      fail(`${label} effect has invalid type: ${effect.type || '(empty)'}`);
    }
    if (!String(effect.targetPipelineId || '').trim()) {
      fail(`${label} effect is missing targetPipelineId`);
    }
    if (effect.operation && !ALLOWED_EFFECT_OPERATIONS.has(effect.operation)) {
      fail(`${label} effect has invalid operation: ${effect.operation}`);
    }
    if (effect.dispatch && !ALLOWED_EFFECT_DISPATCH.has(effect.dispatch)) {
      fail(`${label} effect has invalid dispatch: ${effect.dispatch}`);
    }
    if (effect.targetPipelineId === pipelineId && effect.targetTransitionId && !transitionIds.has(effect.targetTransitionId)) {
      fail(`${label} effect references missing targetTransitionId ${effect.targetTransitionId}`);
    }
    if (effect.correlation) {
      if (!String(effect.correlation.targetField || '').trim()) {
        fail(`${label} effect correlation is missing targetField`);
      }
      if (!String(effect.correlation.sourcePath || '').trim()) {
        fail(`${label} effect correlation is missing sourcePath`);
      }
    }
    validateEffectMappings(effect.mappings, `${label} effect mappings`);
    validateEffectMappings(effect.sourcePatches, `${label} effect sourcePatches`, { requireSourceColumnKeys: columnKeys });
  }
}

function validateBlueprints(blueprints, { pipelineId, stageIds, transitionIds }) {
  if (blueprints === undefined) return;
  if (!Array.isArray(blueprints)) fail('blueprints must be an array');
  assertNoDuplicates(blueprints.map((blueprint) => blueprint?.id || ''), 'blueprint id');

  for (const blueprint of blueprints) {
    const blueprintId = blueprint?.id || '(missing id)';
    if (!blueprint?.id || !blueprint.id.trim()) fail('Blueprint is missing id');
    if (!blueprint?.name || !String(blueprint.name).trim()) fail(`Blueprint ${blueprintId} is missing name`);
    if (blueprint.kind !== 'simulation') fail(`Blueprint ${blueprintId} must use kind \"simulation\"`);
    if (blueprint.sourcePipelineId !== pipelineId) fail(`Blueprint ${blueprintId} sourcePipelineId must match pipeline.id`);
    if (!blueprint.scenario || typeof blueprint.scenario !== 'object') fail(`Blueprint ${blueprintId} is missing scenario`);
    if (!blueprint.scenario.id || !String(blueprint.scenario.id).trim()) fail(`Blueprint ${blueprintId} scenario.id is required`);
    if (!blueprint.scenario.name || !String(blueprint.scenario.name).trim()) fail(`Blueprint ${blueprintId} scenario.name is required`);
    if (!blueprint.scenario.inputs || typeof blueprint.scenario.inputs !== 'object' || Array.isArray(blueprint.scenario.inputs)) {
      fail(`Blueprint ${blueprintId} scenario.inputs must be an object`);
    }
    if (!Array.isArray(blueprint.nodes) || blueprint.nodes.length === 0) {
      fail(`Blueprint ${blueprintId} requires at least one node`);
    }
    if (!Array.isArray(blueprint.connections)) {
      fail(`Blueprint ${blueprintId} connections must be an array`);
    }

    const nodeIds = new Set();
    for (const node of blueprint.nodes) {
      if (!node.id || !String(node.id).trim()) fail(`Blueprint ${blueprintId} has a node without id`);
      if (nodeIds.has(node.id)) fail(`Blueprint ${blueprintId} has duplicate node id ${node.id}`);
      nodeIds.add(node.id);
      if (!node.position || typeof node.position.x !== 'number' || typeof node.position.y !== 'number') {
        fail(`Blueprint ${blueprintId} node ${node.id} needs numeric position`);
      }
      const label = node?.data?.label;
      if (!label || !String(label).trim()) fail(`Blueprint ${blueprintId} node ${node.id} needs data.label`);
      if (node.pipelineId === pipelineId && node.stageId && !stageIds.has(node.stageId)) {
        fail(`Blueprint ${blueprintId} node ${node.id} references missing stage ${node.stageId}`);
      }
      if (node.pipelineId === pipelineId && node.transitionId && !transitionIds.has(node.transitionId)) {
        fail(`Blueprint ${blueprintId} node ${node.id} references missing transition ${node.transitionId}`);
      }
    }

    for (const connection of blueprint.connections) {
      const source = connection.source || connection.fromNodeId;
      const target = connection.target || connection.toNodeId;
      if (!connection.id || !String(connection.id).trim()) fail(`Blueprint ${blueprintId} has a connection without id`);
      if (!source || !nodeIds.has(source)) fail(`Blueprint ${blueprintId} connection ${connection.id} references missing source ${source || '(empty)'}`);
      if (!target || !nodeIds.has(target)) fail(`Blueprint ${blueprintId} connection ${connection.id} references missing target ${target || '(empty)'}`);
      if (connection.pipelineId === pipelineId && connection.transitionId && !transitionIds.has(connection.transitionId)) {
        fail(`Blueprint ${blueprintId} connection ${connection.id} references missing transition ${connection.transitionId}`);
      }
    }
  }
}

function validate(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const schemaVersion = Number(parsed.schemaVersion);
  if (schemaVersion === 2) {
    if (!parsed.resourceKey) fail('resourceKey is required for schemaVersion 2');
    if (!parsed.storage || parsed.storage.listRef?.kind !== 'list' || !String(parsed.storage.listRef?.resourceKey || '').trim()) {
      fail('storage.listRef must be a portable list reference');
    }
    if (!parsed.pipeline || typeof parsed.pipeline !== 'object') fail('pipeline object is required');
    if (!parsed.pipeline.name) fail('pipeline.name is required');
    if (!Array.isArray(parsed.pipeline.columns)) fail('pipeline.columns must be an array');
    if (!Array.isArray(parsed.pipeline.stages)) fail('pipeline.stages must be an array');
    if (!Array.isArray(parsed.pipeline.transitions)) fail('pipeline.transitions must be an array');
    validateNoLocalIds(parsed);
  } else if (schemaVersion !== 1) {
    fail('schemaVersion must be 1 or 2');
  } else {
    if (!parsed.pageId || !parsed.pipelineId) fail('pageId and pipelineId are required');
    if (!parsed.pipeline || typeof parsed.pipeline !== 'object') fail('pipeline object is required');
  }

  const columns = Array.isArray(parsed.pipeline.columns) ? parsed.pipeline.columns : [];
  const stages = Array.isArray(parsed.pipeline.stages) ? parsed.pipeline.stages : [];
  const transitions = Array.isArray(parsed.pipeline.transitions) ? parsed.pipeline.transitions : [];
  const columnKeys = new Set(columns.map((column) => column.key).filter(Boolean));
  const stageIds = new Set(stages.map((stage) => stage.id).filter(Boolean));
  const transitionIds = new Set(transitions.map((transition) => transition.id).filter(Boolean));
  validateBlueprints(parsed.blueprints, {
    pipelineId: parsed.pipeline.id || parsed.pipelineId,
    stageIds,
    transitionIds,
  });

  assertNoDuplicates(columns.map((column) => column.key || ''), 'column key');
  assertNoDuplicates(stages.map((stage) => stage.id || ''), 'stage id');
  assertNoDuplicates(transitions.map((transition) => transition.id || ''), 'transition id');

  for (const column of columns) {
    if (!String(column.key || '').trim()) fail('Every pipeline column requires a key');
    if (!String(column.label || '').trim()) fail(`Column ${column.key} requires a label`);
    const type = String(column.type || 'text').toLowerCase();
    if (!ALLOWED_COLUMN_TYPES.has(type)) fail(`Column ${column.key} has invalid type ${column.type}`);
    if (type === 'select' && column.options !== undefined && !Array.isArray(column.options)) {
      fail(`Column ${column.key} options must be an array`);
    }
  }
  for (const stage of stages) {
    if (!String(stage.id || '').trim() || !String(stage.name || '').trim()) {
      fail('Every pipeline stage requires an id and name');
    }
  }
  for (const transition of transitions) {
    if (!String(transition.id || '').trim()) fail('Every pipeline transition requires an id');
  }

  const existingCasePolicies = Array.isArray(parsed.pipeline.existingCasePolicies)
    ? parsed.pipeline.existingCasePolicies
    : [];
  assertNoDuplicates(existingCasePolicies.map((policy) => policy.id || ''), 'existing-case policy id');
  for (const policy of existingCasePolicies) {
    const id = policy.id || '(missing id)';
    if (policy.schemaVersion !== 1 || policy.identityStrategy !== 'canonical_url_sha256_v1') {
      fail(`Existing-case policy ${id} has an invalid schemaVersion or identityStrategy`);
    }
    if (policy.fallbackAnswersFields !== undefined && !Array.isArray(policy.fallbackAnswersFields)) {
      fail(`Existing-case policy ${id} fallbackAnswersFields must be an array`);
    }
    if (policy.reusableCaseFields !== undefined && !Array.isArray(policy.reusableCaseFields)) {
      fail(`Existing-case policy ${id} reusableCaseFields must be an array`);
    }
    const fields = [
      policy.locatorField,
      policy.identityField,
      policy.answersField,
      ...(policy.fallbackAnswersFields || []),
      ...(policy.reusableCaseFields || []),
      policy.formFingerprintField,
      policy.caseAttemptField,
      policy.caseModeField,
      policy.sourceRecordField,
      policy.sourceRunField,
      policy.reusedAnswerKeysField,
    ].filter(Boolean);
    assertNoDuplicates([policy.answersField, ...(policy.fallbackAnswersFields || [])], `answer field in existing-case policy ${id}`);
    for (const field of fields) {
      if (!columnKeys.has(field)) fail(`Existing-case policy ${id} references missing column ${field}`);
    }
  }

  for (const stage of stages) {
    const id = stage.id || '(missing id)';
    if (stage.triggerKind && !ALLOWED_TRIGGERS.has(stage.triggerKind)) {
      fail(`Stage ${id} has invalid triggerKind ${stage.triggerKind}`);
    }
    if (stage.scheduledConfig && stage.scheduledConfig.cronExpression !== undefined && typeof stage.scheduledConfig.cronExpression !== 'string') {
      fail(`Stage ${id} scheduledConfig.cronExpression must be a string`);
    }
    validateGuardAst(stage.dataChangeConfig && stage.dataChangeConfig.guardAst, columnKeys, `Stage ${id} dataChangeConfig`);
  }

  for (const transition of transitions) {
    const id = transition.id || '(missing id)';
    if (transition.trigger && !ALLOWED_TRIGGERS.has(transition.trigger)) {
      fail(`Transition ${id} has invalid trigger ${transition.trigger}`);
    }
    if (!transition.fromStageId) fail(`Transition ${id} is missing fromStageId`);
    if (!stageIds.has(transition.fromStageId)) {
      fail(`Transition ${id} references missing fromStageId ${transition.fromStageId}`);
    }
    for (const target of [
      transition.toStageId,
      transition.failureStageId,
      transition.success && transition.success.advanceToStageId,
      transition.failure && transition.failure.advanceToStageId,
    ]) {
      if (target && target !== 'self' && !stageIds.has(target)) {
        fail(`Transition ${id} references missing target stage ${target}`);
      }
    }
    validateMappings(transition.fieldMappings, columnKeys, `Transition ${id}`);
    validateMappings(transition.success && transition.success.fieldMappings, columnKeys, `Transition ${id} success`);
    validateMappings(transition.failure && transition.failure.fieldMappings, columnKeys, `Transition ${id} failure`);
    validateGuardAst(transition.success && transition.success.guardAst, columnKeys, `Transition ${id} success`);
    validateGuardAst(transition.failure && transition.failure.guardAst, columnKeys, `Transition ${id} failure`);
    for (const [name, outcome] of [['success', transition.success], ['failure', transition.failure]]) {
      if (outcome && outcome.persistMode && !ALLOWED_PERSIST_MODES.has(outcome.persistMode)) {
        fail(`Transition ${id} ${name} has invalid persistMode ${outcome.persistMode}`);
      }
      const recordField = outcome && outcome.correlation && outcome.correlation.recordField;
      if (recordField && !columnKeys.has(recordField)) {
        fail(`Transition ${id} ${name} correlation uses missing record field ${recordField}`);
      }
      if (outcome && outcome.correlation && !String(outcome.correlation.outputPath || '').trim()) {
        fail(`Transition ${id} ${name} correlation is missing outputPath`);
      }
      validateEffects(outcome && outcome.effects, {
        label: `Transition ${id} ${name}`,
        pipelineId: parsed.pipeline.id || parsed.pipelineId,
        transitionIds,
        columnKeys,
      });
    }
  }
}

const filePath = process.argv[2] || 'assets/pipeline.json';
try {
  validate(filePath);
  console.log(`Valid pipeline definition: ${filePath}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
