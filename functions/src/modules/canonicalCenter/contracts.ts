export const CANONICAL_CENTER_SCHEMA_VERSION = 1 as const;

export type CanonicalResourceKind =
  | "COMPANY_PROFILE"
  | "INSTITUTIONAL_DOCUMENT"
  | "CFDI_CONFIGURATION"
  | "SAT_CATALOG"
  | "SAT_PRODUCT_SERVICE"
  | "DOCUMENT_TEMPLATE"
  | "BRAND_STATIONERY"
  | "INTEGRATION_CONFIGURATION"
  | "SYSTEM_PARAMETER";

export type CanonicalVersionStatus = "DRAFT" | "REVIEW" | "ACTIVE" | "RETIRED";

export type CanonicalScope = {
  rootId: string;
  companyId?: string;
  environment?: "SANDBOX" | "PRODUCTION";
};

export type CanonicalVersion = {
  schemaVersion: typeof CANONICAL_CENTER_SCHEMA_VERSION;
  resourceId: string;
  resourceKind: CanonicalResourceKind;
  version: number;
  status: CanonicalVersionStatus;
  scope: CanonicalScope;
  payload: Record<string, unknown>;
  contentDigest: string;
  comment: string;
  createdAt: string;
  createdBy: string;
  approvedAt?: string | null;
  approvedBy?: string | null;
  supersedesVersion?: number | null;
};

export type CanonicalResourcePointer = {
  schemaVersion: typeof CANONICAL_CENTER_SCHEMA_VERSION;
  resourceId: string;
  resourceKind: CanonicalResourceKind;
  scope: CanonicalScope;
  activeVersion: number | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};

// Secrets never belong in CanonicalVersion.payload. Only a provider-neutral
// secret reference and sanitized status may be stored in Firestore.
export type CanonicalIntegrationReference = {
  provider: "IQ" | "FACTURAMA" | "SAT" | "WHATSAPP" | "TELEGRAM" | "API";
  enabled: boolean;
  secretReference?: string | null;
  schedulerReference?: string | null;
  health: "NOT_CONFIGURED" | "READY" | "DEGRADED" | "DISABLED";
};

export const CANONICAL_CENTER_STORAGE = Object.freeze({
  resources: "canonicalResources",
  versions: "canonicalResourceVersions",
  audit: "canonicalAuditLog",
  activity: "canonicalActivityLog",
  blobsPrefix: "canonical-center/{rootId}/{companyId}/{resourceKind}/{resourceId}/{version}",
});

export const CANONICAL_CENTER_ROUTES = Object.freeze({
  root: "/canonical-center",
  companies: "/canonical-center/companies",
  documents: "/canonical-center/documents",
  satCatalogs: "/canonical-center/sat-catalogs",
  cfdi: "/canonical-center/cfdi",
  templates: "/canonical-center/templates",
  stationery: "/canonical-center/stationery",
  integrations: "/canonical-center/integrations",
  parameters: "/canonical-center/parameters",
  audit: "/canonical-center/audit",
});
