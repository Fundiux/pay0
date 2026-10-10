# IQ scaling server reconciliation

2026-10-10 UTC. Read-only investigation of processIQPagoDepositAutomaticTask in pay-0-system/us-central1. No deployment, configuration change, provider call, queue action, or financial operation was performed by this investigation.

## Decision

The observed change from an omitted maximum to an explicit 20 is confirmed. Its origin remains unresolved. The actual caller PATCH does not request a maximum change; the current Cloud Run representation has settled at 20. Neither the old omitted field nor public default documentation establishes the previous effective service limit. Keep this discrepancy open separately from the coordinator-confirmed completion and postflight of the three IQ executors.

This supplements IQ-SCALING-PATCH-DIAGNOSTIC.md. Its final paragraph predates recovery of the actual PATCH projection: that request is now available. The missing evidence is the earlier Run service-level configuration, not the GCF request.

## Evidence and limits

| Evidence | Verified result | What it does not establish |
| --- | --- | --- |
| Preserved predeploy GCF metadata | maxInstanceCount absent | Previous effective limit |
| Original GCF CreateFunction audit, October 7 | max_instance_count omitted | A requested limit of 20, 100, or unlimited |
| Actual GCF UpdateFunction audit, 00:03:46.334347111Z | max_instance_count absent; explicit mask excludes both that child and service_config parent | Provider reconciliation internals |
| Completion audit, 00:03:58.168242800Z | Response maximum 20 | Why 20 was selected |
| Old Run revision 00001-gox | Scaling maximum absent | Earlier service-level maximum |
| Earlier Run service snapshot | Not available | Any historical service-level baseline |
| Four Run internal audit records | Request and response absent | Internal mutation fields |
| Installed CLI synthetic PATCH boundary | Four cases pass; absent stays omitted in body and mask, null is explicitly masked | A simulation of server defaults |

Two additional read-only Run v2 GETs used restricted field projections, credentials in memory, and no environment, token, URL, header, or financial payload output:

- At 00:43:37.950Z, service generation and observedGeneration were both 2. updateTime was 00:03:46.884980Z. Service-level and template-level maxInstanceCount were both 20; template concurrency was 80. terminalCondition.state was CONDITION_SUCCEEDED. latestReadyRevision and latestCreatedRevision both ended in 00002-tud; trafficStatuses assigned it 100%.
- At 00:43:38.528Z, revision 00001-gox returned createTime 2026-10-07T10:51:24.403921Z and concurrency 80. Requested scaling was omitted again.

The first projection requested reconciling, but the response omitted it; this is not a captured explicit false. The matching generations, ready revision, successful condition and traffic nevertheless support a settled current state rather than a read taken only during deployment. They cannot reconstruct prior service settings.

## Meaning of omission and the two scaling layers

GCF ServiceConfig declares max_instance_count as a proto3 int32 without explicit optional presence. ProtoJSON normally omits implicit-presence scalar defaults. Consequently absence in a JSON projection is not an operational assertion of unlimited capacity, nor proof that 100 or 20 applied. API behavior and the other configuration layers must also be considered. Sources: [GCF protocol definition](https://raw.githubusercontent.com/googleapis/googleapis/master/google/cloud/functions/v2/functions.proto), [ProtoJSON presence and defaults](https://protobuf.dev/programming-guides/json/).

The Functions PATCH API uses updateMask to select modified fields; omission of the entire mask means all fields. Here the nonempty actual mask excludes the maximum and its parent, so this is not a caller-requested full ServiceConfig replacement. [Functions v2 PATCH](https://docs.cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/patch).

Cloud Run exposes separate service-level and revision-level limits. Service settings apply across revisions; revision settings belong to the revision template. An old revision alone therefore cannot recover the earlier service-level limit. Public guidance documents a default of 100 per revision, not a universal default of 20. That general default is insufficient to infer this resource's historical effective limit. [Cloud Run maximum instances](https://docs.cloud.google.com/run/docs/configuring/max-instances). Functions quotas likewise document 100 for second-generation HTTP functions; they do not explain this transition. [Functions quotas](https://docs.cloud.google.com/functions/quotas).

Run v2 exposes desired generation, observedGeneration, readiness, traffic status and service scaling independently of its revision template. A successful reconciliation brings observedGeneration into agreement with generation. The observed agreement supports current convergence, not historical equivalence. Service maximum is allocated across revisions according to traffic. [Run Service reference](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services).

App Engine defaults are a different product. Regional resource quotas can constrain achievable capacity but do not, without additional evidence, explain an explicit configuration field becoming 20. Neither is used as a root cause here.

## Hypotheses, not findings

| Hypothesis | Evidence consistent with it | Missing discriminator |
| --- | --- | --- |
| A previous service-level 20 was projected into GCF and the new template | Old revision omission does not exclude service-level 20 | Historical Run service configuration before 00:03:46Z |
| Provider reconciliation or migration materialized a value of 20 | Caller body and mask omit maximum; response includes it | Provider explanation or internal trace identifying the selection rule |
| Another writer contributed a setting | Available internal audit records lack mutation bodies | Historical service snapshot or restricted audit projection identifying that change |
| The response was only transient during deployment | Initially plausible | Weakened by the later converged service and unchanged explicit 20 |
| Firebase CLI explicitly sent 20 or reset null | Contradicted by recovered request and focused CLI boundary test | No supporting evidence in the captured request |

Do not label any surviving hypothesis as proven. Current generation 2 and its deployment-time updateTime are corroborating observations, not a complete history of provider actions.

## Bounded route to closure

1. Preserve the current observation and discrepancy. Do not normalize missing to 20 in drift checks or reset to null, zero, 100, or an assumed unlimited state.
2. If an existing historical configuration export or asset-history record is available, inspect only this Run service immediately before 00:03:46Z. Project timestamp, generation and service/template scaling. Check availability and retention first; do not assume a history backend exists or contains every change. No such additional query was performed here.
3. If that evidence is unavailable or insufficient, prepare a Google Cloud support case containing the resource, timestamps, masked field-name projection, omitted maximum, response 20 and converged generation 2. Ask which reconciliation rule selected 20 and whether the prior service-level value can be established. Do not include raw environments, credentials, payloads or secret values. No case has been sent.
4. Operational configuration can be closed independently only after a responsible owner chooses an explicit desired maximum based on capacity and financial-provider concurrency requirements. A future reviewed change may encode that target and verify it, but must be described as a new configuration decision, not restoration of an unproven baseline. Historical root cause remains unresolved unless supporting evidence arrives.
5. Before any later deployment, preserve named presence/value pairs for GCF maximum, Run service maximum, template maximum and ready-revision maximum, together with CPU, minimum, concurrency, generation, observedGeneration, readiness and traffic. Do not use positional arrays that erase absent values. Compare each layer separately after convergence.

Moving traffic to the old revision would not establish or necessarily restore the former service-level limit, and would also revert financial-runtime code. It is not a diagnostic or rollback recommendation for this discrepancy.

## Validation and scope

Reviewed the retained diagnostic and current official API/protobuf documentation; performed only the two projected metadata GETs above. No new build, tests, emulators, support submission or cloud mutation. The coordinator reports all three IQ executors deployed with postflight passing; automatic maximum drift remains open. No claim is made about historical throughput, instance use, provider calls or financial outcomes.

## Proposed deliberate target: automatic maximum 20

The coordinator proposes adopting the currently observed 20 as the new deliberate target, while preserving the automatic queue's maxConcurrentDispatches=1 and maxDispatchesPerSecond=1. This is a new limit decision, not proof of preservation or an explanation of history. No source option or remote setting was changed in this investigation.

A narrowly reviewed addition of maxInstances:20 to processIqPagoDepositAutomaticTask alongside its existing preserveExternalChanges:true would make the GCF/revision maximum explicit in the SDK manifest and masked PATCH. Explicit source settings take precedence; preservation applies to omitted settings. Existing synthetic CLI cases already cover explicit 20, but the exact future source manifest still needs its focused check. Do not change scheduler or on-demand options incidentally.

That option alone does not declare the independent Run service-level cap. Auditability therefore also requires a recorded target of service20/template20/ready-revision20 and separate pre/postflight comparisons. A service-level drift must not be silently accepted just because the GCF option matches.

With the existing single-concurrent-dispatch queue, adopting 20 does not itself raise queue throughput or parallelize dispatches. Preserve the effective burst10 and retry settings as well: 1/s is a token-bucket rate, not a guarantee of one-second spacing. Rate limits govern first attempts and retries from that queue. [Cloud Tasks queue rate limits](https://docs.cloud.google.com/tasks/docs/reference/rest/v2/projects.locations.queues#RateLimits).

Concrete residual risks remain. The instance cap does not impose single financial execution: current per-instance concurrency is 80, other authorized invocation paths are outside this queue's limit, and distributed task delivery can duplicate executions. A timeout also cannot be treated as proof that a provider effect failed. Keep IAM, generation checks, transactional claims/fencing and UNKNOWN protections unchanged. Cloud Tasks explicitly requires duplicate-tolerant handlers. [Cloud Tasks limitations](https://docs.cloud.google.com/tasks/docs/common-pitfalls).

The proposal adds no capacity relative to the current observed 20. Its effect relative to the unknown historical limit cannot be quantified from available evidence. Maximum settings are not guaranteed hard financial or billing bounds, and should not be used instead of application idempotency. Operational closure can mean a deliberate documented target plus verified source/remote agreement; historical causality must remain marked UNKNOWN until separately established.
