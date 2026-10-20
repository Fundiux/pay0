'use strict';

// Inert enforcement core. A separately reviewed launcher must supply fresh
// baseline checks, pinned CLI modules and dotenv restoration before activation.
const assert = require('node:assert/strict');
const create = require('./dispersion-notes-create-only.cjs');
const NAME = 'listClientDispersionNotes';
const SERVICE = 'projects/pay-0-system/locations/us-central1/services/listclientdispersionnotes';
const MANAGED = ['FUNCTION_TARGET', 'LOG_EXECUTION_ID'];

function assertPlan(plan) {
  assert.ok(plan && typeof plan === 'object' && !Array.isArray(plan), 'PLAN_SHAPE');
  let count = 0;
  for (const row of Object.values(plan)) {
    for (const key of ['endpointsToCreate', 'endpointsToUpdate', 'endpointsToDelete', 'endpointsToSkip']) {
      assert.ok(Array.isArray(row?.[key]), 'PLAN_SHAPE');
    }
    assert.equal(row.endpointsToCreate.length + row.endpointsToDelete.length + row.endpointsToSkip.length, 0, 'UPDATE_ONLY');
    for (const change of row.endpointsToUpdate) {
      assert.ok(change && !change.deleteAndRecreate && !change.deleteAndRecreateEndpoint, 'RECREATE_FORBIDDEN');
      // Reuse the exact public-callable endpoint contract, never an HTTPS shim.
      create.assertPlan({ only: { endpointsToCreate: [change.endpoint], endpointsToUpdate: [], endpointsToDelete: [], endpointsToSkip: [] } });
      assert.ok(change.endpoint.codebase === undefined || change.endpoint.codebase === 'default', 'CODEBASE');
      count++;
    }
  }
  assert.equal(count, 1, 'EXACTLY_ONE_UPDATE');
}

function normalizedEnv(value) {
  const env = { ...value };
  if (Object.hasOwn(env, 'FUNCTION_TARGET')) assert.equal(env.FUNCTION_TARGET, NAME, 'MANAGED_TARGET');
  if (Object.hasOwn(env, 'LOG_EXECUTION_ID')) assert.equal(env.LOG_EXECUTION_ID, 'true', 'MANAGED_LOG');
  // The CLI inserts these two deterministic values after function conversion.
  env.FUNCTION_TARGET = NAME;
  env.LOG_EXECUTION_ID = 'true';
  return env;
}

function assertApi(input, baseline) {
  assert.equal(baseline?.name, create.RESOURCE, 'BASELINE_SCOPE');
  assert.equal(baseline.state, 'ACTIVE', 'BASELINE_ACTIVE');
  const normalized = structuredClone(input);
  assert.ok(normalized.serviceConfig, 'API_CONFIG');
  for (const key of MANAGED) delete normalized.serviceConfig.environmentVariables?.[key];
  create.assertApi(normalized);
  assert.equal(input.labels?.['firebase-functions-codebase'] ?? 'default', 'default', 'API_CODEBASE');
  const actual = input.serviceConfig, expected = baseline.serviceConfig;
  for (const key of ['timeoutSeconds', 'availableMemory', 'maxInstanceRequestConcurrency']) {
    assert.equal(actual[key], expected[key], 'API_CONFIG_' + key);
  }
  assert.equal(String(actual.availableCpu), String(expected.availableCpu), 'API_CPU');
  for (const key of ['maxInstanceCount', 'vpcConnector', 'vpcConnectorEgressSettings']) {
    assert.equal(actual[key] ?? null, expected[key] ?? null, 'API_CONFIG_' + key);
  }
  assert.equal(actual.minInstanceCount ?? 0, expected.minInstanceCount ?? 0, 'API_MIN');
  assert.equal(actual.serviceAccountEmail ?? '751158244178-compute@developer.gserviceaccount.com', expected.serviceAccountEmail, 'API_IDENTITY');
  assert.equal(actual.ingressSettings ?? 'ALLOW_ALL', expected.ingressSettings, 'API_INGRESS');
  assert.deepEqual(normalizedEnv(actual.environmentVariables), normalizedEnv(expected.environmentVariables), 'API_ENV_EXACT');
}

function installGuard({ Fabricator, v1, v2, run, poller, baseline, beforeUpdate, assertUploadSource, emit = () => {} }) {
  assert.equal(typeof beforeUpdate, 'function', 'FRESH_PREFLIGHT_REQUIRED');
  assert.equal(typeof assertUploadSource, 'function', 'VERIFIED_UPLOAD_BINDING_REQUIRED');
  assert.equal(typeof emit, 'function', 'RECEIPT_REQUIRED');
  const apply = Fabricator.prototype.applyPlan, update = v2.updateFunction, poll = poller.pollOperation;
  for (const fn of [apply, update, poll, run.getIamPolicy]) assert.equal(typeof fn, 'function', 'CLI_CONTRACT');
  let planned = false, dispatched = false, operation = null, completed = null, iamChecked = false;
  const deny = () => { emit('MUTATION_BLOCKED'); throw Error('NOTES_UPDATE_SCOPE_BLOCKED'); };
  for (const owner of [v1, v2]) for (const key of ['createFunction', 'deleteFunction']) {
    assert.equal(typeof owner[key], 'function', 'CLI_CONTRACT'); owner[key] = deny;
  }
  assert.equal(typeof v1.updateFunction, 'function', 'CLI_CONTRACT'); v1.updateFunction = deny;
  for (const key of ['setInvokerCreate', 'setInvokerUpdate', 'setIamPolicy', 'updateService', 'replaceService']) {
    assert.equal(typeof run[key], 'function', 'CLI_CONTRACT'); run[key] = deny;
  }
  Fabricator.prototype.applyPlan = async function (plan) {
    assert.ok(!planned, 'PLAN_REPLAY'); assertPlan(plan); planned = true;
    emit('PLAN_UPDATE_ONLY'); return apply.call(this, plan);
  };
  v2.updateFunction = async function (input) {
    assert.ok(planned && !dispatched, 'UPDATE_ORDER_OR_REPLAY');
    dispatched = true; // Reserve before asynchronous preflight or transport.
    await beforeUpdate(); assertApi(input, baseline);
    await assertUploadSource(input.buildConfig?.source?.storageSource);
    // CLI15.3.1 updateV2Function has no callable invoker branch. Verify the
    // existing binding ourselves; all IAM setters remain forbidden.
    const policy = await run.getIamPolicy(SERVICE);
    const rows = (policy.bindings || []).filter(x => x.role === 'roles/run.invoker');
    assert.equal(rows.length, 1, 'IAM_BINDING_COUNT');
    assert.deepEqual(rows[0].members, ['allUsers'], 'IAM_BINDING_MEMBERS');
    assert.ok(!rows[0].condition, 'IAM_CONDITION');
    iamChecked = true; emit('INVOKER_UNCHANGED');
    emit('UPDATE_DISPATCHED');
    const result = await update.call(this, input);
    assert.match(result?.name || '', /^projects\/(?:pay-0-system|751158244178)\/locations\/us-central1\/operations\/[^/]+$/, 'OPERATION_SCOPE');
    operation = result.name; emit('UPDATE_ACCEPTED'); return result;
  };
  poller.pollOperation = async function (options) {
    const result = await poll.call(this, options);
    if (operation && options.operationResourceName === operation) {
      assert.ok(!completed, 'COMPLETION_REPLAY'); assertApi(result, baseline);
      assert.equal(result.state, 'ACTIVE', 'OPERATION_ACTIVE');
      assert.match(result.serviceConfig.revision || '', /^listclientdispersionnotes-[a-z0-9-]+$/, 'REVISION_SCOPE');
      assert.notEqual(result.serviceConfig.revision, baseline.serviceConfig.revision, 'OLD_REVISION');
      const source = result.buildConfig?.source?.storageSource, old = baseline.buildConfig?.source?.storageSource;
      assert.equal(source?.bucket, old?.bucket, 'SOURCE_BUCKET');
      assert.equal(source?.object, old?.object, 'SOURCE_OBJECT');
      assert.match(source?.generation || '', /^[1-9][0-9]*$/, 'SOURCE_GENERATION');
      assert.notEqual(source.generation, old.generation, 'OLD_SOURCE');
      completed = structuredClone(result);
      emit('UPDATE_COMPLETED', { revision: result.serviceConfig.revision, source });
    }
    return result;
  };
  emit('GUARD_ACTIVE');
  return { status: () => ({ planned, dispatched, operation, completed, iamChecked }) };
}

module.exports = { assertPlan, assertApi, installGuard };
