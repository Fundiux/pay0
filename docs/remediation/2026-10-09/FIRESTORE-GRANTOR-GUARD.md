> **FINAL STATUS: NON-DEPLOYABLE EXPERIMENT / DO NOT INTEGRATE.** Candidate054362 failed the complete emulator gate. Preserve this commit as diagnostic evidence only; published/integration rules remain separate. Final result: compatibility36 PASS/budget0; full707 =658PASS/49FAIL/68 budget errors. No518 run, no deployment, no S10 closure.

# Firestore: candidato de guarda del otorgante inmediato

Fecha: 2026-10-10. Fuente de trabajo: `remediation/pay0-integral-20261009`. No desplegado por este lote. Las reglas publicadas por el coordinador (ruleset `76fda1a0?`, hash LF `7863811b85a57ff7dde6e9d3c5925253a90371dfdf4c63fc3a60bebf5ed31876`) son el baseline, independiente de este candidato. No se modifica Storage, la pol?tica JSON ni el backend generado.

## Contrato y l?mite expl?cito

`functions/src/modules/clientDelegations/access.ts` exige actor actual, root, lifecycle y restricci?n confiable; termina en superadmin o propietario directo actual. Para concesiones delegadas valida la vigencia y los identificadores, resuelve el otorgante con prioridad `grantAuthority.grantorUid || grantedBy || createdBy`, exige al otorgante actual rol superadmin/admin y permiso can?nico usuarios/clientDelegations, recorre ancestros hasta 16 y cruza permisos/plazos. La autoridad expl?cita SUPERADMIN requiere terminal superadmin; DIRECT acepta terminal directo o superadmin; DELEGATED tambi?n puede terminar si su otorgante ahora tiene autoridad directa. `parentPath` DELEGATED debe identificar exactamente la concesi?n del otorgante para ese cliente. Ausencia total de procedencia sigue permitida con `LEGACY_PROVENANCE_UNVERIFIED`; este lote no cambia ese contrato ni fabrica padres.

El candidato a?ade al acceso delegado en Firestore una lectura del perfil inmediato. Comprueba lifecycle, root actual, restricci?n referida al UID del otorgante y permiso can?nico actual. SUPERADMIN y DIRECT declaran una terminal que se vuelve a comprobar contra el perfil y propietario del cliente actuales. El legado identificable y DELEGATED conservan su rama si pasan esas comprobaciones inmediatas; DELEGATED exige adem?s el parentPath exacto. No se exige propiedad directa a todo otorgante: eso cortar?a delegaciones leg?timas. La rama no crea permisos nuevos respecto al baseline; restringe su autorizaci?n existente.

**S10 de cadena completa sigue abierto.** No se lee la concesi?n padre, no se detectan revocaci?n/expiraci?n/permisos de ancestros ni ciclos remotos. Los casos conocidos de padre inactivo, expirado o sin operate se marcan como brecha, incluso cuando el candidato permite la lectura. El backend s? los rechaza. No se extrapola cierre por la cohorte previa de cuatro concesiones: ten?a dos vigentes y dos inactivas, un otorgante actual superadmin, sin autoridad hist?rica expl?cita; eso no certifica todos los linajes ni su legalidad pasada.

## Cambios auditables

- `firestore.rules`: ?nicamente helpers de restricci?n parametrizados por UID, selector generado adicional y guarda de otorgante en `clientDelegationPermission`. Los dos allow padre/notas de clientDispersions usan un helper de alias equivalente para evitar evaluar dos veces el mismo cliente; se preserva OR entre IDs distintos. Sin cambios a root econ?mico, permisos de cliente, vigencia ni rutas hist?ricas.
- `scripts/lib/authorization-policy-generator.mjs`: produce selector expl?cito `roleDefaultAllowsForRole` desde el mismo render can?nico; conserva byte a byte el selector actor existente. Reconoce el formato actor-only hist?rico y legacy. El bloque se actualiz? invocando el renderer, no escribiendo defaults a mano.
- `qa/scripts/remediation-delegation-grantor-policy.test.mjs`: coherencia de selector expl?cito/actor, determinismo, bloque completo y UID de restricci?n.
- `qa/scripts/remediation-delegation-grantor.rules.test.mjs`: fixtures reales de reglas en demo/loopback, allow/deny por familia y notas, campos tipados, precedence, ownership, SUPERADMIN/DIRECT/DELEGATED, restricciones activas/expiradas/revocadas, subjectUid equivocado, permisos granulares, independencia de propietario y brechas transitivas expl?citas.

Los helpers del otorgante siguen normalizaci?n trim/lower y fallback supervisorRole del backend sin modificar el myRole del actor. M?dulos malformados se tratan como defaults can?nicos, igual al backend (un override de acci?n presente s?lo permite boolean true). SUPERADMIN mantiene bypass de m?dulos, nunca de restricci?n/lifecycle. Un objeto/lista como identidad de otorgante no se convierte a un nombre de documento: se rechaza; no hay evidencia de concesiones v?lidas con ese formato. Valores primitivos compatibles se normalizan; no se inventa un UID a partir de un mapa.

La restricci?n utiliza subjectUid expl?cito tambi?n para autoridadUid y revokedBy. Un registro expirado cuyo subjectUid sea el receptor dentro del perfil del otorgante se rechaza; un registro v?lido del otorgante no se rechaza por esa comparaci?n equivocada. Las fechas de igualdad se prueban en un match exclusivamente de fixture que llama a los helpers originales con `request.time`: expiry igual denegado, start igual admitido, restricci?n expirada exactamente en el l?mite admitida s?lo con esquema y UID correctos. Este match no se escribe a firestore.rules.

## Presupuesto y publicaci?n

La rama b?sica usa actor, concesi?n, cliente y perfil de otorgante (cuatro documentos distintos); notas a?ade el documento padre. Esto es un recuento est?tico, no una prueba de todo query/expresi?n. No se a?ade recursion ni un l?mite arbitrario que retire DELEGATED v?lidos. Firestore limita accesos documentales y expresiones; la suite debe fallar por agotamiento incluso si el resultado esperado era permission-denied. V?ase [l?mites oficiales de reglas](https://firebase.google.com/docs/firestore/security/rules-structure#security_rule_limits). Las operaciones de strings se basan en la [API oficial String de Rules](https://firebase.google.com/docs/reference/rules/rules.String).

Gates antes de publicar: nuevas fixtures con cero agotamientos; regresiones 169 queries/listeners + 325 restricciones/Storage + 24 alias preservadas; verificar pol?tica; revisar diff de allow; candidato/hash fijado en helper de publicaci?n s?lo despu?s de revisi?n expl?cita. Storage y clientes antiguos permanecen fuera del corte. No hay aprobaci?n de deploy por esta preparaci?n.

## Evidencia local

- Selector nuevo: PASS 4.830 comparaciones, actor byte-identical y determinismo.
- Generator hist?rico: PASS 2.760 policy cases + 33.120 guard cases.
- Verificador de pol?tica: PASS. Backend generado y config JSON sin cambios.
- Sintaxis del nuevo script de emulador: PASS.
- Primer emulador: FAIL real de presupuesto en positivo `legacy-current-superadmin` de clientDispersions con clientId == clienteId. Client/solicitud/pago anteriores admitidos; la duplicaci?n wallet necesita optimizaci?n equivalente y nueva ejecuci?n. Emulador detenido, candidato no publicable.
- Regresiones 518: pendientes de ejecutar sobre este nuevo candidato.

No se ejecutaron inventarios nuevos, mutaciones remotas, proveedores, modelos, migraciones ni despliegues.

### Diagn?stico de presupuesto, pendiente de nueva ventana

El segundo y tercer candidato tambi?n fallaron en el mismo positivo de dispersi?n; ni deduplicar con `&&` ni seleccionar propietario primero bastaron. Se captur? `coverage.json` exclusivamente del emulador sint?tico y se apag? antes del siguiente predeploy coordinado. La cobertura agregada muestra evaluaci?n de restrictionAllowsRecord aun sin registro (560 observaciones de nodos, 136 undefined) y del helper inmediato (1.210/294); son conteos agregados de cobertura, no un coste exacto por petici?n ni un PASS.

El siguiente candidato preparado est?ticamente usa ternario para ausencia de trustedRestrictionV1 y de grantAuthority, y deduplicaci?n wallet con ternario expl?cito. Mantiene el selector actor byte-identical. La restricci?n del grantor recibe el root esperado despu?s de comprobar el root de su perfil normalizado; el wrapper del actor conserva root raw hist?rico. Nuevas fixtures prueban ambas diferencias. La matriz wallet owner-only/delegate-only/both/neither y 16 pruebas de alias cubren el cambio de orden manteniendo los predicados de propiedad exactos. Baseline original hash786? conservado en ruta local ignorada para controles.

Estos ?ltimos cambios NO se han ejecutado todav?a: CPU/emuladores congelados por predeploy de documentos. Ning?n resultado anterior resuelve el fallo de presupuesto.

Las ejecuciones cuarta y quinta tambi?n agotaron el presupuesto en el mismo primer positivo legacy-superadmin de dispersi?n. Separar ramas legacy y authority expl?cita no lo resolvi?. Se prepara `--budget-probe` en la suite sint?tica: match de fixture por helper, cobertura agregada por lectura y el mismo fallo final obligatorio. No forma parte de las reglas candidatas ni acepta denegaciones por presupuesto como resultado correcto. Regresiones 518 siguen pendientes; su invocaci?n preparada es `remediation-delegation-grantor-policy.test.mjs --regressions`, con el hash literal que deber? repinarse tras revisar el candidato final, sin cambiar assertions de las suites originales.

### Probe aislado y siguiente candidato est?tico

Probe ejecutado: grantor 365, delegation 759, wallet 767, wallet-alias 809, m?dulo wallet/dispersiones 812, actor 178 observaciones agregadas de nodos por lectura aislada; todos permitieron individualmente. Estos deltas incluyen cobertura del match sint?tico y no se suman como coste exacto de la operaci?n completa. La operaci?n completa volvi? a agotar 1.000 expresiones. El cambio temporal-null tambi?n fall? en esa misma primera lectura positiva (sesi?n4412 cerrada, puerto18238 apagado); no se afirma soluci?n.

Con ownership adicional aprobado, el siguiente candidato cachea UID/perfil/rol en hasModuleAction y usa selector can?nico expl?cito, m?s el helper individual con perfil recibido. Conserva autenticaci?n, existencia, lifecycle, rol raw del actor con alias operator, bypass superadmin, view obligatorio y valores individuales estrictos. El selector actor original sigue byte-identical y los defaults no se replican manualmente. El evaluador de `remediation-authorization-generator.test.mjs` enlaza las firmas reales y helpers nuevos; mantiene todas las expectativas y los 2.760+33.120 casos. Tests pendientes hasta liberar la ventana de IQ.

Cache del actor: PASS matriz 2.760/33.120 con implementaci?n actual + selector 4.830 + verificador. Sin embargo, s?ptimo emulador volvi? a agotar expresiones en el primer positivo de dispersi?n. No resuelto. Siguiente hunk est?tico aprobado: wallet comparte el cliente y root ya le?dos con la evaluaci?n del grant (cinco argumentos, mismas validaciones), en vez de volver a obtenerlos a trav?s del wrapper b?sico. No hay par?metros desde el navegador ni snapshots de otra identidad. Fast-path string conserva el helper anterior; se preparan 21 comparaciones con empty/whitespace, mapas/listas, n?meros/bools, missing y UTF-16 (incluidos surrogates), y comparaci?n backend para strings. La coerci?n de identidades mal tipadas sigue caracterizada por separado; no se afirma equivalencia de JSON num?rico flotante con todos los casos de string(number) de Rules.

## Revisi?n est?tica de callers y siguiente ventana

Candidato actual LF SHA-256: `9f41257059f8979a56e89ea96b62c534b540a1445de42d2a2d46a6a871f9445b`. Repinado expl?citamente en el gate 518 tras revisar los hunks; no se acepta un hash arbitrario por entorno. A?n no validado por emulador.

| Caller del helper wallet | Restricci?n del actor | Autenticaci?n/existencia/lifecycle y m?dulo | Guarda adicional preservada |
|---|---|---|---|
| clientBeneficiaries read | accountAllowed | hasModuleAction(wallet, beneficiarios) | Root del cliente y propiedad/delegaci?n existentes |
| clientBeneficiaryMethods read | accountAllowed | hasModuleAction(wallet, beneficiarios) | Root del cliente y propiedad/delegaci?n existentes |
| clientDispersions read | accountAllowed (ternario) | hasModuleAction(wallet, dispersiones) | userFundedDispersionScope antes del OR |
| clientDispersions/notas read | accountAllowed (ternario) | hasModuleAction(wallet, dispersiones) | userFundedDispersionScope sobre padre antes del OR |

Es la lista completa de callers actuales, obtenida por b?squeda est?tica. El helper wallet no es una API p?blica ni concede lifecycle por s? solo: depende de estas guardas exteriores. Elegir direct primero evita consultar una concesi?n inv?lida cuando existe propiedad independiente, sin omitir las guardas exteriores. Los campos de propiedad y comparaciones permanecen iguales a los originales. No se a?ade acceso de fondos USER a terceros.

`hasWalletClientReadAccessFromData` mantiene `primerAlias || segundoAlias` para IDs distintos; s?lo evita la segunda invocaci?n cuando los IDs son iguales. Los fixtures cubren primary-only, legacy-only, null-primary, sin IDs, ambos iguales v?lidos/inv?lidos y los dos ?rdenes de IDs distintos. No se introduce preferencia que descarte un segundo alias v?lido. Ambos wrappers obtienen client/root desde datos actuales de Rules, nunca desde payload de request; la versi?n compartida conserva las comprobaciones de identidad del grant.

Orden obligatorio para la siguiente ventana CPU:

1. Sintaxis de los dos scripts nuevos, equivalencia hist?rica (legacy + candidato sint?tico + actual), 4.830 selectores + 21 identidades, y verificador can?nico.
2. Emulador Firestore demo nuevo: suite grantor completa; cero errores de presupuesto incluso en denegaciones esperadas. No usar probe como sustituto de la suite.
3. S?lo si pasa, emuladores Firestore+Storage demo y `--regressions`: 169 queries/listeners + 325 restricciones/Storage + 24 alias. Mantener los 24 gaps Storage hist?ricos etiquetados, sin omitir assertions.
4. Revisar native exit, marcador final, presupuesto cero, diff, pol?tica/config/backend generado sin modificaciones. Apagar emuladores y liberar puertos.
5. Enviar evidencia/diff para revisi?n central antes de commit; sin integrar ni desplegar. Linaje completo sigue abierto.

Comandos desde la fuente ROOT (preparados, NO ejecutados en la pausa de IQ):

```powershell
node --check qa/scripts/remediation-delegation-grantor.rules.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Syntax failed' }
node --check qa/scripts/remediation-delegation-grantor-policy.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Syntax failed' }
node qa/scripts/remediation-authorization-generator.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Equivalence failed' }
node qa/scripts/remediation-delegation-grantor-policy.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Canonical selector/identity failed' }
node scripts/verify-authorization-policy.mjs
if ($LASTEXITCODE -ne 0) { throw 'Policy failed' }
```

Para ambos emuladores se usa configuraci?n temporal ignorada con firestore.rules/storage.rules de ROOT, Firestore18238, websocket19238, Storage19198, hub14438, logging14538, UI apagada y singleProjectMode=false. Es necesario confirmar puertos libres con el coordinador antes de ejecutar. Configurar TEMP/TMP y XDG_CONFIG_HOME en ese directorio privado, DEBUG vac?o y FIREBASE_CLI_DISABLE_USAGE=true; conservar/restaurar valores originales al terminar. Guardar PAY0_RULES_SOURCE_ROOT como ruta absoluta ROOT.

```powershell
$taskRoot = (Get-Location).Path
$taskRuntime = Join-Path $taskRoot '.firebase/remediation-temp/grantor-next'
[IO.Directory]::CreateDirectory($taskRuntime) | Out-Null
$taskConfig = Join-Path $taskRuntime 'firebase.json'
$taskSettings = @{
  firestore = @{ rules = (Join-Path $taskRoot 'firestore.rules') }
  storage = @{ rules = (Join-Path $taskRoot 'storage.rules') }
  emulators = @{
    firestore = @{ host = '127.0.0.1'; port = 18238; websocketPort = 19238 }
    storage = @{ host = '127.0.0.1'; port = 19198 }
    hub = @{ host = '127.0.0.1'; port = 14438 }
    logging = @{ host = '127.0.0.1'; port = 14538 }
    ui = @{ enabled = $false }; singleProjectMode = $false
  }
}
[IO.File]::WriteAllText($taskConfig, ($taskSettings | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
$taskSaved = @{}
foreach ($taskKey in @('TEMP','TMP','XDG_CONFIG_HOME','DEBUG','FIREBASE_CLI_DISABLE_USAGE','PAY0_RULES_SOURCE_ROOT')) {
  $taskSaved[$taskKey] = [Environment]::GetEnvironmentVariable($taskKey, 'Process')
}
$env:TEMP = $taskRuntime; $env:TMP = $taskRuntime
$env:XDG_CONFIG_HOME = Join-Path $taskRuntime 'cli'
$env:DEBUG = ''; $env:FIREBASE_CLI_DISABLE_USAGE = 'true'
$env:PAY0_RULES_SOURCE_ROOT = $taskRoot
try {
$taskPref = $ErrorActionPreference
try {
  $ErrorActionPreference = 'Continue'
  & node .worktrees/pay0-remediation-integration-20261009/scripts/run-firebase-clean-env.mjs emulators:exec --project demo-pay0-delegation-grantor --config $taskConfig --only firestore 'node qa/scripts/remediation-delegation-grantor.rules.test.mjs'
  $taskGrantorExit = $LASTEXITCODE
} finally { $ErrorActionPreference = $taskPref }
if ($null -eq $taskGrantorExit -or $taskGrantorExit -ne 0) { throw 'Grantor gate failed; do not continue' }
try {
  $ErrorActionPreference = 'Continue'
  & node .worktrees/pay0-remediation-integration-20261009/scripts/run-firebase-clean-env.mjs emulators:exec --project demo-pay0-restriction-boundaries --config $taskConfig --only firestore,storage 'node qa/scripts/remediation-delegation-grantor-policy.test.mjs --regressions'
  $taskRegressionExit = $LASTEXITCODE
} finally { $ErrorActionPreference = $taskPref }
if ($null -eq $taskRegressionExit -or $taskRegressionExit -ne 0) { throw '518 regression gate failed' }
} finally {
  foreach ($taskKey in $taskSaved.Keys) { [Environment]::SetEnvironmentVariable($taskKey, $taskSaved[$taskKey], 'Process') }
}
```

El PS5 wrapper debe capturar LASTEXITCODE expl?citamente: stderr esperado de permission-denied no equivale a un fallo del proceso. No se cambia ning?n assert para compensar stderr.


## Latest gate and complete-path proposal (2026-10-10)

Session 12340 passed syntax, the unchanged 2,760 policy plus 33,120 historical guard matrix, 4,830 explicit-role selector comparisons, 21 identity cases and the authorization-policy verifier. Session 37921 then failed against candidate LF SHA-256 `9f41257059f8979a56e89ea96b62c534b540a1445de42d2a2d46a6a871f9445b`: the first positive `legacy-current-superadmin:clientDispersions/operation` exceeded 1,000 expressions at rules line 825. Its preceding client/solicitud/pago reads succeeded. The ignored evidence is `.firebase/remediation-temp/grantor-next/grantor.log`. Emulators shut down. The 518 regression gate was not started, because its prerequisite failed. This candidate is not publishable; no rules were deployed or integrated.

Further emulator retries are paused. A whole-path refactor is proposed below, not implemented. Document lookup caching does not establish that repeated helper expressions are free. Static call tracing finds up to seven calls to `userDoc` for the same actor: account restriction (1), module/lifecycle (1), USER root and superadmin (2), dispersion ownership superadmin (1), wallet role/root (2). These are helper invocation counts, not distinct document reads, billed reads, or a measured expression-saving guarantee. Depending on branch evaluation, fewer calls may execute. The existing standalone probes permit the individual helpers but the complete dispersion read still exceeds the budget; aggregate coverage counters cannot be added as exact per-request cost.

### Proposed dedicated dispersion authorization path

Only the parent and notes read predicates would use the new path. All other callers retain their existing guards.

1. Authenticate first. Load actor UID and actor profile once in a dedicated entry helper. Require profile existence and the existing lifecycle predicate exactly once. Derive the current raw-role/`operator` alias and current operational root from that same profile. Do not adopt backend trimming or supervisor-role fallback for the actor.
2. Evaluate the existing trusted-restriction predicate once with its own `restrictionRoot(user, uid)`. This root is intentionally different from operational `myRootId`: restrictionRoot falls back for null/empty/false/zero, while operational root falls back only for null. Collapsing these roots would change historical authorization and is forbidden.
3. Evaluate canonical wallet view/action and individual permission predicates using the cached actor/role, preserving the superadmin module exception. This exception never bypasses restriction or lifecycle.
4. Evaluate the complete USER funding scope with cached UID/root/role before any ownership or client branch. Preserve sourceClientId equality, ownerUid equality, actor ownership/superadmin and root equality. A directly owned document must not skip these checks.
5. Evaluate the existing parent or notes direct-ownership expression using cached UID/role. Keep parent membership guards and notes raw field access behavior distinct until equivalence is established; missing fields in notes must not silently gain new semantics from defaults.
6. If direct ownership does not permit the read, evaluate the existing alias OR with cached actor UID/role/root passed into a dedicated wallet helper. That helper loads each distinct client once, preserves all five admin and three operator raw comparisons, client existence/root predicates, and passes that exact client/root to the current delegation evaluator. Equal IDs are deduplicated; distinct IDs remain a true OR; null/missing fields retain their current behavior. Grantor checks remain unchanged.
7. Notes load the parent document once and reuse that exact snapshot. The new helper stays private to these two matches; no caller can supply profile/role/client data from request input.

The mechanism removes repeated profile/root/role computation across the full read rather than optimizing another isolated boolean. It does not remove a security predicate or promise enough budget before measurement. The allow expression may use staged ternaries to avoid evaluating subordinate branches after a denied prerequisite. Malformed values must retain the same allow/deny behavior, including errors that deny access.

### Evidence required before accepting the refactor

- Differential truth table of old candidate versus new path, independent of emulator budget: unauthenticated/missing actor; all lifecycle fields; raw role aliases, whitespace, null and malformed module maps; missing/null/empty/false/zero/whitespace operational roots; absent, active, expired, revoked and malformed trusted restriction.
- USER and CLIENT funding, cross-root and inconsistent owner/sourceClientId, document owner and superadmin. Parent and notes run separately, including missing ownership fields and missing parent.
- Alias equal/distinct/null/missing/invalid IDs; first permitted and second denied, first denied and second permitted, both/neither permitted. Direct owner only, delegation only, both and neither, with all ownership field variants.
- Identical seeded first-positive control under preserved published baseline and candidate, separately reporting baseline eligibility and budget; no assumption that the old 518 matrix covered this exact alias/actor combination.
- Full new grantor fixture matrix, then all 518 prior assertions, with zero 1,000-expression diagnostics, including expected-denial cases. Preserve the current failure as a negative control. No expected success may be replaced by an expected denial to fit a budget.
- Central diff review of rules and renderer before commit. Full transitive lineage remains open even if this partial guard becomes deployable.

If the complete-path refactor remains infeasible, the alternative is a dedicated authenticated server-side dispersion/notes read contract using the backend transaction resolver, plus replacement of actual queries/listeners and a compatibility/version strategy for open sessions and alternate clients. That is a larger, separately authorized rollout; it cannot justify silently denying existing direct reads or claiming current query/listener compatibility. No such fallback is implemented by this candidate.


### Dedicated path implemented locally; emulator gate pending

The authorized dedicated parent/notes path is now present in `firestore.rules`. It loads the actor once and passes its UID, historical raw role/alias and operational root into the dedicated USER/ownership/wallet helpers. Its restriction root remains separate. Notes reuse the passed parent snapshot; the original parent membership checks versus notes direct field accesses remain distinct. Other families still call their original helpers. The shared grant/client evaluator, immediate-grantor checks and canonical policy block have not changed in this refactor.

New `qa/scripts/remediation-dispersion-rule-context.test.mjs` executes the actual candidate helper bodies and the exact prior parent/notes predicate strings, with a SHA-256 assertion that their shared historical helper bodies stay unchanged. The 9,472 differential cases PASS. Valid expired/revoked restriction and alias rescue positives are also explicitly asserted. Synthetic actor-profile loads decreased from at most 7 to 1. This is not an emulator expression-count claim: a restricted interpreter and the same downstream delegation oracle isolate context reuse; document-missing denial branches are represented as missing maps, and Firestore error/OR evaluation and access-budget semantics still require the real emulator fixtures. No budget limit was changed.

The new `--baseline-control` mode in the existing grantor suite pins the preserved published baseline LF SHA-256 `7863811b85a57ff7dde6e9d3c5925253a90371dfdf4c63fc3a60bebf5ed31876` from `.firebase/remediation-temp/grantor-guard/baseline.rules`. It runs exactly the original first positive plus five explicitly denied cases (inactive actor, inactive grant, expired grant, revoked grant, currently restricted actor), six families each: 36 reads. It does not inject candidate-only helpers or silently expect the new grantor policy from the old baseline. Syntax PASS; execution deferred pending coordinated CPU window.

Current candidate LF SHA-256: `6e5c79768f424de6619be34576fa4c99868d3698c3ac71f79c712f4a6ff1fe8e`. Central diff review and real grantor/518 gates remain required. The old regression pin deliberately has not been updated yet; updating the reviewed candidate pin is a separate explicit step before running 518. No commit, integration or deployment.

Prepared order for the next authorized emulator window: (1) same demo/loopback command above with `--baseline-control`; (2) full new candidate suite without that flag; (3) only after PASS and candidate-pin review, unchanged 518 regression suite. A failed positive or any budget diagnostic stops progression. Do not repeat an identical failed candidate.


### Published-baseline control result (session 97536)

The hash-pinned published baseline control completed all 36 access expectations, including all six reads of the first legitimate `legacy-current-superadmin` fixture. It nevertheless FAILED the strict zero-budget gate: `child-expired:clientDispersions/operation` and `child-expired:clientDispersions/operation/notas/note` each exceeded 1,000 expressions, producing `budgetErrors = 2`. These two denied reads expose pre-existing exhaustion under baseline hash786381; the final assertion rejects them even though permission was denied. Evidence: ignored `.firebase/remediation-temp/grantor-next/baseline-control.log`.

No assertion was changed. Emulator shutdown completed and session97536 exited1. Candidate6e5c and518 were not launched because the requested baseline-PASS prerequisite failed. The first-positive baseline success confirms that the previous candidate's positive failure was a regression rather than merely an untested old failure. The new dedicated candidate still requires measurement, including fixing or exposing these two additional expired-denial cases without accepting exhaustion. Candidate regression pin was updated to the root-reviewed6e5c hash; execution remains pending coordinator decision after this baseline finding.


### Dedicated candidate result (session 73094)

The coordinator explicitly authorized testing the candidate despite the newly characterized baseline failure. Candidate6e5c PASSED `--compatibility-control`: the identical six fixtures/36 reads, with `budgetErrors:0`. This includes the two expired-child denials that exhausted the published baseline. The subsequent complete suite FAILED at the next legitimate terminal DIRECT administrator fixture, `direct-adminId:clientDispersions/operation`, with the 1,000-expression limit at candidate line894. Earlier superadmin, legacy and derived-to-superadmin fixtures had progressed successfully; this is not a complete-suite PASS. Log: ignored `.firebase/remediation-temp/grantor-next/dedicated-candidate.log`. Emulators shut down and session73094 exited1. The 518 regression suite was not launched.

The failure boundary moved: actor-context reuse fixes the original positive and the two baseline expired-denial failures, but does not make the complete immediate-grantor policy affordable. Static inspection of the newly failing branch identifies additional current-admin module validation (two canonical view/clientDelegations selectors plus individual overrides), explicit authority validation and direct ownership normalization that the successful superadmin branch can skip. This is a hypothesis about incremental cost, not attribution from exact per-request measurement.

No further rules micro-adjustment is made here. The next diagnostic should isolate the same DIRECT admin fixture at (a) module eligibility, (b) direct ownership, (c) complete grantor validation, and (d) full dedicated read, recording per-request coverage differences and budget outcomes. The maximum-cost legitimate fixtures (including valid expired/revoked restrictions on actor and grantor, late ownership fields and distinct aliases) must be evaluated before considering a renderer specialization or another context refactor. A canonical generated combined view/action predicate is an option only if measurements justify it; manually replicating current role defaults or weakening validation is not. If required predicates remain unaffordable, the separate server-read contract/consumer rollout is the appropriate design boundary, not false permission denials.


### Generated grantor-module pair specialization prepared

The administrator branch previously called the generic canonical selector twice. Under the current policy, view visits one action comparison and selects 12 module strings; clientDelegations visits six action comparisons and selects one module string, in addition to repeated role selection and membership checks. These are static control-flow counts, not measured Firestore expression charges.

The renderer now emits `roleAllowsClientDelegation(role)` from the canonical JSON conjunction `usuarios.view === true && usuarios.clientDelegations === true` for non-superadmin roles, retaining the existing canonical superadmin policy bypass. Only `delegationProfileModuleAllows` calls it. The independent admin/superadmin authority-role gate, terminal-source checks, raw module-map fallback and strict per-action overrides remain unchanged. No actor or unrelated family uses the specialization. No JSON or generated backend policy changed.

Small fake gates PASS: 9,600 grantor comparisons across all 64 combinations of the two policy bits in three canonical roles, ten role inputs and fifteen raw-module shapes; 4,830 generic selector comparisons; 21 identity cases; 9,472 complete-path differential cases. Policies with view=false, action=false and malformed override shapes are included. The first fake attempt exposed an interpreter missing map-literal `.get` support, corrected in the fake translation; product semantics were not changed to satisfy it. Determinism and the single grantor callsite are asserted.

New candidate LF hash: `ef3e8699377bd8118eb2738e63a124ae767c987bac2c9b6915a077b54c5741a7`. Real emulator run deferred during IQ Execute35607. Results of candidate6e5c remain unchanged: compatibility36 PASS/budget0, complete DIRECT positive FAIL,518 not executed. This specialization is not yet a verified budget fix.


### Specialized candidate result (sessions 82645 and 7588)

Session82645 passed the policy verifier, 2,760 policy/33,120 historical guard cases, 4,830 selector cases,21 identity cases,9,600 grantor-pair cases and9,472 context differential cases. Session7588 then tested candidateef3e: compatibility36 PASS with budget0. The complete matrix progressed through DIRECT adminId and ownerId positives, then FAILED `direct-managedByUserId:clientDispersions/operation` with the1,000-expression limit at line896. The later fixtures were not reached; no518 execution. Emulators shut down and child/outer exit1 were preserved. Evidence: `.firebase/remediation-temp/grantor-next/specialized-candidate.log` (ignored).

The generated pair specialization changed the actual failure boundary but did not produce a publishable candidate. Before another product change, a diagnostic aggregate run should execute all existing assertions, collecting each failed case and still exiting nonzero on any assertion or budget error. This would expose the full surface (late owner fields, valid restriction records, distinct aliases) instead of repeatedly discovering only the first failure. Such a diagnostic is not a passing gate and must not replace the original expected outcomes or relax budget0. Proposed only; no aggregate retry has been run.


### Complete aggregate diagnostic: session38715

The authorized aggregate mode executed all original assertions against unchanged candidateef3e: **689 attempts,658 assertions passed,31 assertions failed,56 budget errors**. Every assertion failure was an expected ALLOW that was denied with budget exhaustion; no unexpected ALLOW was observed. Of the56 budget errors,25 occurred in expected-denial cases and therefore did not independently fail an access assertion, but remain unacceptable under budget0. Final exit1 was preserved. No518 run. Emulators shut down and CPU was released to the independent Functions build.

Evidence is local/ignored: `.firebase/remediation-temp/grantor-next/aggregate-candidate.log` and `.firebase/remediation-temp/grantor-guard/coverage.json` (approximately1.45MB). Coverage is cumulative across requests and must not be represented as an exact per-request expression count. The aggregate changes only failure collection; it still invokes the same assertSucceeds/assertFails and fails the final gate on either any assertion failure or any budget error.

| Fixture | Positive reads denied by budget | Expected denials hitting budget | Routes |
| --- | ---: | ---: | --- |
| direct-managedByUserId | 1 | 0 | `clientDispersions/operation` |
| direct-createdBy | 2 | 0 | `clientDispersions/operation`, `clientDispersions/operation/notas/note` |
| direct-operadorId | 2 | 0 | `clientDispersions/operation`, `clientDispersions/operation/notas/note` |
| direct-ownership-lost | 0 | 5 | `solicitudes/operation`, `pagos/operation`, `clientDispersions/operation`, `solicitudes/operation/notas/note`, `clientDispersions/operation/notas/note` |
| grantor-expired-restriction | 6 | 0 | `clients/client`, `solicitudes/operation`, `pagos/operation`, `clientDispersions/operation`, `solicitudes/operation/notas/note`, `clientDispersions/operation/notas/note` |
| grantor-trimmed-root-expired-restriction | 6 | 0 | `clients/client`, `solicitudes/operation`, `pagos/operation`, `clientDispersions/operation`, `solicitudes/operation/notas/note`, `clientDispersions/operation/notas/note` |
| grantor-expired-wrong-subject | 0 | 1 | `clientDispersions/operation` |
| grantor-expired-self-authority | 0 | 2 | `clientDispersions/operation`, `clientDispersions/operation/notas/note` |
| grantor-revoked-restriction | 6 | 0 | `clients/client`, `solicitudes/operation`, `pagos/operation`, `clientDispersions/operation`, `solicitudes/operation/notas/note`, `clientDispersions/operation/notas/note` |
| grantor-self-revoker | 0 | 6 | `clients/client`, `solicitudes/operation`, `pagos/operation`, `clientDispersions/operation`, `solicitudes/operation/notas/note`, `clientDispersions/operation/notas/note` |
| grantor-recipient-revoker-valid | 6 | 0 | `clients/client`, `solicitudes/operation`, `pagos/operation`, `clientDispersions/operation`, `solicitudes/operation/notas/note`, `clientDispersions/operation/notas/note` |
| grantor-restriction-invalid-73 | 0 | 6 | `clients/client`, `solicitudes/operation`, `pagos/operation`, `clientDispersions/operation`, `solicitudes/operation/notas/note`, `clientDispersions/operation/notas/note` |
| grantor-restriction-invalid-74 | 0 | 5 | `solicitudes/operation`, `pagos/operation`, `clientDispersions/operation`, `solicitudes/operation/notas/note`, `clientDispersions/operation/notas/note` |
| wallet-alias | 1 | 0 | `distinct-legacy` |
| wallet-note-alias | 1 | 0 | `distinct-legacy` |

This establishes three remaining cost boundaries, rather than one ownership ordering problem: (1)5 legitimate late DIRECT ownership reads; (2)24 legitimate reads with fully valid expired/revoked grantor restriction records across all six families; (3)2 legitimate distinct-alias reads where the first alias is denied and the second grants access. The other25 budget cases are denied ownership/restriction cases. Reordering ownership fields would only move the first failure and is not an acceptable fix.

Static next-design review must therefore cover the shared child-grant and trusted-restriction validators as well as the second alias. Candidate context reuse already removed repeated actor fetches from dispersion, but grant checks still compose temporal/permissions/authority and grantor profile validation for each alias; a denied first child grant can consume work before the permitted second branch. A staged child-grant eligibility predicate could reject active/revoked/time/permissions failures before entering any grantor validator, without changing the valid branch. Separately, restriction validation could receive one cached current-time value and reuse state/issued/expiry values across base-schema and terminal-state checks; it must retain every schema, exact subject/root, self-authority/self-revoker and time-boundary condition. These are design candidates requiring source-to-source equivalence and full-matrix measurement, not a promised solution or authorized removal of checks. No additional rules edit was made after the aggregate run.


### Staged eligibility and restriction context candidate

Root authorized implementation after the complete aggregate result. `clientDelegationPermissionForClient` now gates grant existence and the full existing child-eligibility predicate before invoking the immediate-grantor evaluator. Its scope, active, revoked, temporary-mode, start/expiry and permission comparisons are unchanged, and one captured actor UID is reused. Direct ownership fields and their order are unchanged.

The restriction entry point rejects non-maps before the map validator, computes request.time milliseconds once, and caches state/issued/expiry values. Full schema validation receives those exact values; valid revocation checks cache revokedAt/revokedBy and preserve every identity, time, reason and self-revoker condition. ACTIVE/unexpired still denies even a malformed record. The public record-validation wrapper remains compatible. No actor/operational root normalization changed.

New `qa/scripts/remediation-restriction-eligibility-context.test.mjs` contains exact previous helper bodies from ef3e and executes old/new validators. PASS:21,096 restriction cases covering valid expired/revoked, unexpired, unknown state, every required field deletion/mutation, extra fields, wrong root/subject, scalar/list/map types, pre-epoch/numeric overflow and time boundaries;5,792 child-eligibility cases including Timestamp-versus-number distinctions, permission shapes, scope and authority outcomes. The separate complete-path differential retains historical restriction bodies for its old side, rather than accidentally using the new validator on both sides:9,472PASS. Canonical selector/pair/identity suites alsoPASS.

Candidate LF hash: `1b7fee332bef84ad968c992392560b8206d2c9bac58286ce8ba0708c71826309`. Interpreter results are not a Firestore budget proof. The verifier/historical matrix and real36?689 aggregate?518 sequence remain the required next gates. Earlier ef3e failures remain recorded; no assertions or expected outcomes were removed.


### Staged-context result: sessions96072/49438

Policy verifier and historical2,760+33,120 matrix PASS. Candidate1b7fee compatibility36 PASS with budget0, but the complete689 aggregate FAILED:656 assertions passed,33 failed,55 budget errors. All33 failures are legitimate positives denied; no unexpected allow. Compared with ef3e, valid restriction failures remain24, distinct-alias failures remain2, and late DIRECT failures increase from5 to7 (managedByUserId parent+notes; createdBy parent+notes; operadorId parent+solicitud-note+dispersion-note). The reduction56?55 total budget errors is not a success: expected allow regressions increased. Emulator shutdown and exit1 preserved;518 not run. Evidence: `.firebase/remediation-temp/grantor-next/staged-candidate.log`. Prior ef3e coverage was preserved separately as `.firebase/remediation-temp/grantor-next/coverage-ef3e-aggregate.json` before the new run.

Thus caching now/state/issued/expiry and splitting child eligibility into a seven-argument helper did not meet the objective. The additional helper boundary is a plausible contributor to DIRECT overhead, but causal attribution requires an isolated comparison. A semantics-identical next ablation would inline the unchanged eligibility predicate into the existing grant helper while retaining the eligibility-to-grantor ternary, removing the extra argument boundary without altering guards. That does not itself solve the24 valid restriction failures. Further restriction changes need a full-path design or per-request cost evidence; this candidate must not be published merely because most assertions pass. CPU released for the independent QRCode profiling batch.


### Final bounded inline candidate prepared

Following coordinator review, the seven-argument child-eligibility helper was removed and its identical predicate inlined before the existing grantor ternary. The restriction map validator now holds now/state/issued/expiry/revokedAt/revokedBy in one six-let context, with the complete schema and terminal predicates inline. The public map-type wrapper preserves malformed non-map denial. The extra RecordValidAt/Revocation helper boundaries and unused old base-schema wrapper were removed; all original schema, exact identity, root, reason, numeric type/bounds, lifetime and self-authority/self-revoker checks remain present. Ownership order and predicates did not change.

Small differential gates PASS:24,608 final restriction authorization cases;147,504 compositions with false/true/error using three-valued AND/OR allow outcomes;5,792 child eligibility cases;9,472 complete dispersion path cases;9,600 generated pair comparisons plus the earlier selector/identity matrix. Exact prior helper bodies remain in the fake for comparison. Removing the unused base-schema helper changes the test focus from its nonpublic intermediate boolean to the final restriction decision, with additional root/subject invalid variants increasing final-decision coverage. Real Firestore error/OR behavior still requires the unchanged emulator matrix.

Candidate LF SHA-256: `054362694fe19584b278d1cf24bd80dae2859383ca00bf826fd3f12017b3214b`. No real emulator result yet. CPU reserved by root for QRCode integration/build/discovery; no emulator or heavy matrix launched during that reservation. Per coordinator, this is the final bounded micro-candidate before considering a separate server-read transition if it still lacks budget. Earlier failures remain gates, not accepted limitations.


The final real-emulator matrix adds18 positive reads without removing or changing any of the689 prior expectations: both actor and grantor with valid expired restrictions; both with valid revoked restrictions; and DIRECT authority via the last ownership field combined with a valid expired grantor restriction. Each fixture covers all six resource families. Full cardinality is now explicitly asserted as707; compatibility control remains36. These expensive compositions require real-engine verification and cannot be inferred from separate actor/grantor fixtures. No execution yet; rules hash054362 is unchanged by the added tests.


## Final bounded experiment result and change of strategy

Session54456 passed policy synchronization and all historical/synthetic differentials. Session54306 then tested hash054362694fe19584b278d1cf24bd80dae2859383ca00bf826fd3f12017b3214b:36 compatibility checks PASS with0 budget errors, followed by707 full assertions (658PASS,49FAIL) and68 expression-budget errors. All49 failures were expected legitimate ALLOWs denied by budget; no unexpected ALLOW. The31 previously failing positive reads remain (5 late DIRECT ownership,24 valid grantor restriction,2 distinct-alias); all18 newly added composed reads also fail. An additional19 expected denials exhaust budget. The two baseline expired-child denial exhaustions remain fixed in the36 control, but that narrow improvement does not make this candidate deployable.

Session54306 exited1 and all emulators shut down. Baseline profiling received the CPU window. No more rules micro-candidates, no518 execution, no integration or remote mutation. Evidence: ignored `inline-candidate.log` and current coverage.json; previous candidate logs/coverage remain preserved. This isolated commit must not be merged or cherry-picked into a release. New work proceeds from integration2613559 in a different worktree.

### Consumer inventory and staged server-read transition (static source evidence)

| Family | Current consumer | Existing server path and remaining direct reads | Next gate |
| --- | --- | --- | --- |
| Clients | src/services/clients.ts; clientes page | listClientsCanonical/getClientCanonical already use backend resolver; frontend cache30s and watchClientById is a one-shot wrapper, not realtime. Backend catalog enumeration is currently unbounded and uses separate reads. | Verify per-request current authority and bounded pagination before treating all callers as migrated. |
| Dispersions | src/services/financing.ts; wallet/dispersiones page | listScopedClientDispersions already callable, page size100. Integration has authorized scan pages200 with2000 scan budget, stable createdAt+ID descending cursor, USER funding guard and per-client resolver; ROOT's older list lacks these and must not be copied. Notes remain direct onSnapshot orderedcreatedAtASC. | First replace only notes reader; preserve integration funding behavior and existing mutation callables. |
| Solicitudes | listSolicitudes plus useLiveOperationRows; solicitudes page | Callable pagination100 does not eliminate direct reads: loaded-ID listeners plus scoped new-record discovery, direct deep-link getDoc, notes listener and cross-list pagos/application listeners remain. | Backend list/get/watch-equivalent contract and all cross-page consumers before changing direct access. |
| Pagos | listPagos plus useLiveOperationRows; pagos page | Same loaded-ID/discovery direct listeners; direct getDoc after create; solicitudes selector, notes and upload/application listeners remain. | Preserve initial pagination, subsequent updates and creator/date filtering; do not migrate only initial list. |
| Dashboard | dashboard page | Direct solicitudes count queries by role/status. | Server aggregate with identical authorized scope; account for additional record visibility if delegation is expanded. |
| Notes | wallet, solicitudes and pagos dialogs | Three direct notes onSnapshot queries. Writes use existing callables; write permission is separate from note-read permission. | Granular wallet notes first; solicitudes/pagos follow only after their exact read and unread-marker contracts are reviewed. |

`useLiveOperationRows` removes an ID on permission-denied and shows a fixed message; discovery errors only show a message. It does not automatically reload into a server-read implementation. Publishing Hosting does not replace open bundles, alternate clients or direct SDK consumers. Therefore direct rule removal remains gated independently of a new frontend release.

The integration index manifest includes clientDispersions(rootId,createdAt DESC), root/clientId and root/clienteId variants; solicitudes/pagos orderedcreatedAt+documentID indexes and role/root variants. Exact equality-filter combinations and ordering must be checked against the new query contracts: existing presence of similar indexes is not proof all new queries are deploy-ready. Notes currently order onlycreatedAtASC; the proposed notes cursor uses same-parent createdAt+documentID stable ordering, tested with equal timestamps. No index deployment occurs here.

Accepted first contract: listClientDispersionNotes, authenticated callable taking dispersionId and validated bounded pagination, with current actor/parent/root/USER and grantor-chain authorization in a read transaction. Caller role/root are not authority. Current read permission is viewBasic; do not require comment permission to read. Preserve direct independent ownership and aliases as separately tested branches. Missing/contradictory parent root must fail closed and is a compatibility gate for historical callers, not grounds to fabricate a parent.

The new UI will explicitly display a5-second refresh cadence while the dialog is visible, refresh on focus and successful send, avoid overlap, back off errors, and discard stale responses after parent/account/root changes. It will offer all older notes through Cargar anteriores, retain already loaded history while refreshing the latest50, deduplicate byID, and clear every page on denied authority or scope change. Cursor fields are untrusted selectors validated for schema/timestamp/nanoseconds/ID and bound to the authorized parent; they are never capabilities. No new secret/token scheme is required.

Rollout order: additive backend endpoint with fake/emulator authorization gates; frontend wrapper/poller and old-history/refresh/browser tests; Functions+frontend builds and policy verifier; coordinator-approved backend deployment, then frontend publication. Keep existing direct rules during overlap. Only a later, separately reviewed compatibility/version gate for open bundles and alternate clients can retire the corresponding direct notes-read branch. Fail closed on actual denial, without falling back from denied server authority to the old SDK path. Existing known direct-rule lineage exposure remains explicitly open during overlap; neither a new endpoint nor HostingPASS alone closes it. Already delivered data cannot be retrospectively revoked.
