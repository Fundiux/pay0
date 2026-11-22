# IQ beneficiary and account creation contract

Status: discovered read-only on 2026-11-22 from IQ's public web bundle. Not yet exercised against IQ.
`iqBeneficiaryCreateConfig/{root}.contractVerified` stays `false` until the first supervised live create
confirms it.

## How it was found

IQ's web app (`https://sistema-3-erp.vercel.app`, the `DEFAULT_IQ_ERP_URL` in
`functions/src/modules/iq/config.ts`) is a Nuxt SPA. Its `index.html` and every `/_nuxt/*.js` chunk it
references (251 files) were fetched with plain unauthenticated GETs. No login, no POST, and no IQ API call
were made. Snippets below are verbatim (minified) from those chunks; chunk names change with each IQ deploy.

### API base and auth

`index.html` runtime config:

```
window.__NUXT__.config={public:{backendUrl:"https://iq-produccion-ccc570f75402.herokuapp.com/", ...
```

`B_5n7P5t.js` (the `api` plugin): every call is `$fetch.create({baseURL: backendUrl, ...})` with
`Authorization: Bearer <access_token>` from the `/users/sessions` login. That is the same origin and token
PAY0 already uses (`iqApiOrigin()`, `loginIqHttpDirect`). No extra headers (no partner or branch header).

### Create beneficiary (step 1)

`DMKOvrnv.js` (partners composable), `createPartnerBeneficiaries`:

```
Te=C({beneficiary:C({name:L()})})
...
await w(`/partners/${l.id}/beneficiaries`,{method:"POST",body:p,onResponseError:({response:g})=>{u({title:"Error al crear el beneficiario",description:g?._data.errors.join(", "),...
```

`BcCWy5k1.js` (`PartnersBeneficiariesFormCreate`): one field, `name:"beneficiary.name"`.

- `POST /partners/{partnerId}/beneficiaries`
- JSON body `{ "beneficiary": { "name": "<nombre>" } }`
- The beneficiary belongs to the IQ associate (partner) that is active in the UI, not to a client.
  PAY0 uses the client's linked associate (`clients.iqLinksByProfile[*].partnerId`).

### Create account (step 2)

`DMKOvrnv.js`, `createPartnerBeneficiaryAccounts`:

```
$e=C({name:L(),bank_id:ee(),clabe:L().length(18,...).optional(),number:L().optional(),card_number:L().min(15,...).max(16,...).optional()}).superRefine((e,a)=>{!e.card_number&&!e.clabe&&a.addIssue({...message:"Por lo menos uno de los siguientes campos es requerido: clabe o número de tarjeta"...
...
const u=T().params.beneficiaryId ... await w(`/beneficiaries/${u}/accounts`,{method:"POST",body:p,onResponseError:({response:l})=>{d({title:"Error al crear la cuenta del beneficiario",description:l?._data.errors.join(", "),...
```

`DVEt4mOM.js` (`PartnersBeneficiariesAccountsFormCreate`): fields `name` ("Nombre de la cuenta del
beneficiario"), `bank_id` (select over `computedData.banks`, value `E.id`, label `E.name`), `clabe`,
`card_number`.

- `POST /beneficiaries/{beneficiaryId}/accounts`
- JSON body `{ "name": "<titular>", "bank_id": <IQ bank id>, "clabe": "<18 dígitos>" }` or
  `{ ..., "card_number": "<15-16 dígitos>" }` (at least one of clabe / card_number)
- Bank list: `GET /beneficiaries/{beneficiaryId}/accounts/new` returns `{ banks: [{ id, name, ... }] }`
  (`getPartnerBeneficiaryAccountsNew`). The UI shows only `id` and `name`; whether IQ also returns the ABM
  code is unknown, so PAY0 matches the ABM code when present and otherwise the exact normalized bank name,
  and stops (`IQ_BANK_UNRESOLVED`, review) when neither is unique.

### Reads used to link instead of creating

`DMKOvrnv.js`:

```
getPartnerBeneficiaries ... "filter[id]":p.value||void 0,"filter[name]":u.value||void 0,"filter[accounts]":d.value||void 0 ... await D(`/partners/${n}/beneficiaries`,{lazy:!0,query:g,...
getPartnerBeneficiaryAccounts ... "filter[bank]" ... "filter[card_number]":l.value||void 0,"filter[clabe]":g.value||void 0,"filter[number]" ... "filter[status]":b.value||void 0 ... await D(`/beneficiaries/${n}/accounts`,...
```

- `GET /partners/{partnerId}/beneficiaries?filter[name]=…&limit=100&offset=…` → rows `{ id, name, accounts, created_at }`
  (`accounts` is a count column, "Num. de cuentas", not account numbers).
- `GET /beneficiaries/{id}/accounts?filter[clabe]=…|filter[card_number]=…` → rows
  `{ id, created_at, owner_name, bank, clabe, card_number, number, conciliation_status }`.
  These are the same endpoints and fields the nightly catalog (`iqCatalogSync.ts`) already reads.
- There is no account-level search across an associate's beneficiaries in the UI, so a live read cannot
  prove absence by itself; the nightly catalog is the proof (owner decision 2026-11-22).

### Response and error shapes

- Success: the UI only checks `response.ok` and reloads the list; the body of the 2xx is not read by the
  UI, so the presence of `id` in it is unverified. PAY0 accepts `id`, `beneficiary.id`/`account.id` or
  `data.id`, and when none is present re-reads by name / CLABE to get the ids.
- Errors: `response._data.errors` is an array of strings (`errors.join(", ")`). The exact "ya existe" text
  is not in the bundle (it comes from IQ's server). PAY0 treats `ya existe`, `ya ha sido tomad…`,
  `ya está en uso/registrad…`, `duplicad…`, `already exists/been taken` as EXISTS and then re-reads.

### Conciliation (important)

`BPAecCal.js`:

```
await F("/accounts/pending",{lazy:!0,query:w,...
conciliateBeneficiaryAccounts:async(c,r)=>{...await B("/accounts/conciliate",{method:"POST",body:{ids:n,conciliation_status:r},...
```

Account filter values: `pending_conciliation` (Sin Conciliar), `conciliated`, `canceled`, `rejected`.
A new account most likely starts as pending and an IQ user conciliates it. PAY0 therefore stores a created
account as `NOT_CONCILIATED` with `createState: PENDING_CONCILIATION` (ids kept, not used by dispersions);
the nightly catalog turns it `LINKED` once IQ shows it conciliated. PAY0 never calls `/accounts/conciliate`.

## Confidence

- Paths, methods and request bodies: high (taken from IQ's own production bundle).
- Bank list endpoint and shape `{ banks: [{ id, name }] }`: high for `id`/`name`; ABM code field unknown.
- Response body ids and the exact "ya existe" text: unverified; handled defensively by re-reading.
- Initial conciliation status of a new account: inferred, to confirm in the first live create.
- Required IQ permission for the RR and PAY0 logins to create beneficiaries: unknown (UI gates the button
  with `canAssignPartnersBeneficiaries`); a 401/403 surfaces as `REVIEW_REQUIRED` with `IQ_ACCOUNT_HTTP_403`
  or `IQ_BENEFICIARY_HTTP_403`.

## Flow in PAY0 (functions/src/modules/beneficiaries)

1. Catalog match (per catalog, client's associate only) → link. Rows of other associates do not count.
2. IQ master switch, then the reservation for the account in this catalog: `CREATED` → reuse; `RESERVED`
   younger than 15 min → in progress (trigger retries); `OUTCOME_UNKNOWN`/stale `RESERVED` → read only.
3. Name lookup (dispersion wizard) as an extra chance to link.
4. Absence proof: the associate was read whole by the nightly catalog within `catalogMaxAgeHours`
   (default 36 h, `iqBeneficiaryCatalogState.partnerSyncedAt[partnerId]`) and has no row for the account.
   Stale → `PENDING_RETRY CATALOG_STALE` (does not spend attempts).
5. Reservation transaction (create gate + daily counter, default limit 100) → `create()` with the catalog's
   writer login (`iq-group-pay0` → PAY0, `iq-group-rr` → RR): name read → existing account check → bank
   resolution → beneficiary POST if missing → account POST (marked as the one provider effect).
6. Lost answer (timeout/5xx after the account POST) → never re-sent: account-level read now and up to 3
   more times every 6 h, then `REVIEW_REQUIRED OUTCOME_UNKNOWN`. "Ya existe" → read and link, else review.
