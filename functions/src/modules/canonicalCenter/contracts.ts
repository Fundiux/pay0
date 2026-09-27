export const PAY0_CANONICAL_SCHEMA_VERSION = 1 as const;

export type Pay0CanonicalResourceKind =
  | "OWN_COMPANY_PROFILE"
  | "OWN_COMPANY_DOCUMENT"
  | "CFDI_CONFIGURATION"
  | "SAT_CATALOG"
  | "SAT_PRODUCT_SERVICE"
  | "DOCUMENT_TEMPLATE"
  | "BRAND_STATIONERY"
  | "INTEGRATION_REFERENCE"
  | "SYSTEM_PARAMETER";

export type Pay0CanonicalVersionStatus = "DRAFT" | "REVIEW" | "ACTIVE" | "RETIRED";

export type Pay0CanonicalScope = {
  system: "PAY0";
  rootId: string;
  ownCompanyId?: string;
  environment?: "SANDBOX" | "PRODUCTION";
};

export type Pay0CanonicalVersion = {
  schemaVersion: typeof PAY0_CANONICAL_SCHEMA_VERSION;
  resourceId: string;
  resourceKind: Pay0CanonicalResourceKind;
  version: number;
  status: Pay0CanonicalVersionStatus;
  scope: Pay0CanonicalScope;
  payload: Record<string, unknown>;
  contentDigest: string;
  comment: string;
  createdAt: string;
  createdBy: string;
  approvedAt?: string | null;
  approvedBy?: string | null;
  supersedesVersion?: number | null;
};

export type Pay0CanonicalResourcePointer = {
  schemaVersion: typeof PAY0_CANONICAL_SCHEMA_VERSION;
  resourceId: string;
  resourceKind: Pay0CanonicalResourceKind;
  scope: Pay0CanonicalScope;
  activeVersion: number | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};

// PAY0 Canonical stores only opaque secret references and sanitized state.
// Secret values never belong in version payloads, Firestore, logs or clients.
export type Pay0CanonicalIntegrationReference = {
  provider: "IQ" | "FACTURAMA" | "SAT" | "WHATSAPP" | "TELEGRAM" | "API";
  enabled: boolean;
  secretReference?: string | null;
  schedulerReference?: string | null;
  health: "NOT_CONFIGURED" | "READY" | "DEGRADED" | "DISABLED";
};

export const PAY0_CANONICAL_STORAGE = Object.freeze({
  resources: "pay0CanonicalResources",
  versions: "pay0CanonicalResourceVersions",
  audit: "pay0CanonicalAuditLog",
  activity: "pay0ActivityLog",
  blobsPrefix: "pay0-canonical/{rootId}/{ownCompanyId}/{resourceKind}/{resourceId}/{version}",
});

// Reserved names only. They are not enabled in RouteAccessGuard or navigation.
export const PAY0_CANONICAL_ROUTES = Object.freeze({
  root: "/administracion/canonicos",
  companies: "/administracion/canonicos/empresas-propias",
  documents: "/administracion/canonicos/documentos",
  satCatalogs: "/administracion/canonicos/catalogos-sat",
  cfdi: "/administracion/canonicos/facturacion",
  templates: "/administracion/canonicos/plantillas",
  stationery: "/administracion/canonicos/papeleria",
  integrations: "/administracion/canonicos/integraciones",
  parameters: "/administracion/canonicos/parametros",
  audit: "/administracion/canonicos/auditoria",
});
