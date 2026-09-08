export const IQ_CANONICAL_CONTRACT_VERSION =
  "H4_D80_A4B" as const;

export type IqCanonicalCapability =
  | "CREATE_INVOICE"
  | "RESOLVE_INVOICE_FOLIO"
  | "SYNC_INVOICE_STATUS"
  | "CREATE_DEPOSIT"
  | "RESOLVE_DEPOSIT_FOLIO"
  | "SYNC_DEPOSIT_STATUS"
  | "CREATE_PAYMENT_APPLICATION"
  | "RESOLVE_PAYMENT_APPLICATION_FOLIO"
  | "SYNC_PAYMENT_APPLICATION_STATUS";

export type IqCanonicalOwner =
  | "IQ_SOLICITUDES"
  | "IQ_PAGO_DEPOSIT"
  | "PAYMENT_APPLICATIONS";

export type IqCanonicalLifecycleStatus =
  | "QUEUED"
  | "WAITING_BATCH"
  | "RUNNING"
  | "WAITING_IQ"
  | "CREATED_PENDING_FOLIO"
  | "CREATED_CONFIRMED"
  | "CONCILIATION_PENDING"
  | "SUCCEEDED"
  | "REJECTED"
  | "CANCELLED"
  | "REVIEW_REQUIRED";

export type IqCanonicalFolioPolicy =
  | "WRITE_ONCE"
  | "WRITE_ONCE_AFTER_RESOLUTION";

export const IQ_CANONICAL_TERMINAL_STATES =
  Object.freeze([
    "SUCCEEDED",
    "REJECTED",
    "CANCELLED",
  ] as const);

export const IQ_CANONICAL_CAPABILITIES =
  Object.freeze({
    CREATE_INVOICE: Object.freeze({
      owner: "IQ_SOLICITUDES",
      module:
        "functions/src/modules/iq",
      contract:
        "create/enqueue/process solicitud invoice",
    }),
    RESOLVE_INVOICE_FOLIO: Object.freeze({
      owner: "IQ_SOLICITUDES",
      module:
        "functions/src/modules/iq",
      contract:
        "resolve immutable solicitudIqFolio",
    }),
    SYNC_INVOICE_STATUS: Object.freeze({
      owner: "IQ_SOLICITUDES",
      module:
        "functions/src/modules/iq",
      contract:
        "sync invoice operation and reconciliation status",
    }),
    CREATE_DEPOSIT: Object.freeze({
      owner: "IQ_PAGO_DEPOSIT",
      module:
        "functions/src/modules/iq/pagoDepositCallables.ts",
      contract:
        "prepare/create deposit through canonical gate",
    }),
    RESOLVE_DEPOSIT_FOLIO: Object.freeze({
      owner: "IQ_PAGO_DEPOSIT",
      module:
        "functions/src/modules/iq/pagoDepositCallables.ts",
      contract:
        "known folio or one exact free candidate",
    }),
    SYNC_DEPOSIT_STATUS: Object.freeze({
      owner: "IQ_PAGO_DEPOSIT",
      module:
        "functions/src/modules/iq/pagoDepositCallables.ts",
      contract:
        "read IQ status then request canonical financial posting",
    }),
    CREATE_PAYMENT_APPLICATION: Object.freeze({
      owner: "PAYMENT_APPLICATIONS",
      module:
        "functions/src/modules/paymentApplications",
      contract:
        "execute one idempotent plan POST",
    }),
    RESOLVE_PAYMENT_APPLICATION_FOLIO:
      Object.freeze({
        owner: "PAYMENT_APPLICATIONS",
        module:
          "functions/src/modules/paymentApplications",
        contract:
          "read-only folio resolution; never repeat POST",
      }),
    SYNC_PAYMENT_APPLICATION_STATUS:
      Object.freeze({
        owner: "PAYMENT_APPLICATIONS",
        module:
          "functions/src/modules/paymentApplications",
        contract:
          "pagoApplicationIqPlans canonical lifecycle",
      }),
  } satisfies Readonly<
    Record<
      IqCanonicalCapability,
      Readonly<{
        owner: IqCanonicalOwner;
        module: string;
        contract: string;
      }>
    >
  >);

export const IQ_CANONICAL_FOLIOS =
  Object.freeze({
    solicitudIqFolio: Object.freeze({
      owner: "IQ_SOLICITUDES",
      policy: "WRITE_ONCE",
    }),
    pagoIqFolio: Object.freeze({
      owner: "IQ_PAGO_DEPOSIT",
      policy: "WRITE_ONCE",
    }),
    iqApplicationId: Object.freeze({
      owner: "PAYMENT_APPLICATIONS",
      policy:
        "WRITE_ONCE_AFTER_RESOLUTION",
    }),
  } satisfies Readonly<
    Record<
      string,
      Readonly<{
        owner: IqCanonicalOwner;
        policy: IqCanonicalFolioPolicy;
      }>
    >
  >);

export const IQ_CANONICAL_APPLICATION_RULE =
  Object.freeze({
    acceptedPostWithVerifiedFields:
      "CREATED_PENDING_FOLIO",
    resolvedExactFolio:
      "CREATED_CONFIRMED",
    repeatPostWhileFolioPending: false,
    resolutionMode: "READ_ONLY",
    canonicalCollection:
      "pagoApplicationIqPlans",
  } as const);

export const IQ_CANONICAL_BATCH_KEY =
  Object.freeze([
    "rootId",
    "despachoId",
    "iqCredentialProfileId",
  ] as const);

export const IQ_CANONICAL_BATCH_WINDOW_MINUTES =
  5 as const;