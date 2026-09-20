import manifest from "@/canonicos/formatos/cotizaciones/manifest.json";

export type CotizacionCanonicalTemplate = {
  templateId: string;
  companyId: string;
  companyName: string;
  rfc: string;
  version: string;
  status: "ACTIVE" | "INACTIVE" | string;
  referencePdf: string;
  referencePdfSha256: string;
  pages: number;
};

export type CotizacionCanonicalManifest = {
  schemaVersion: string;
  documentType: "COTIZACION";
  status: string;
  canonicalCount: number;
  missingCount: number;
  versionPolicy: string;
  template: {
    html: string;
    css: string;
    engine: string;
    templateBundleSha256: string;
  };
  requiredFields: readonly string[];
  traceability: {
    requiresReferencePdfSha256: boolean;
    requiresTemplateBundleSha256: boolean;
    requiresGeneratedDocumentSha256: boolean;
    preserveTemplateVersionOnGeneratedDocument: boolean;
  };
  templates: readonly CotizacionCanonicalTemplate[];
};

export const COTIZACION_CANONICAL_MANIFEST =
  manifest as CotizacionCanonicalManifest;

export const COTIZACION_CANON_VERSION =
  `${COTIZACION_CANONICAL_MANIFEST.documentType}.v${COTIZACION_CANONICAL_MANIFEST.schemaVersion}`;

function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeRfc(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9Ñ&]/g, "");
}

export function listCanonicalCotizacionTemplates(): readonly CotizacionCanonicalTemplate[] {
  return COTIZACION_CANONICAL_MANIFEST.templates;
}

export function getCanonicalCotizacionTemplateByCompanyId(
  companyId: unknown,
): CotizacionCanonicalTemplate | null {
  const key = normalizeKey(companyId);
  if (!key) return null;
  return (
    COTIZACION_CANONICAL_MANIFEST.templates.find(
      (template) => normalizeKey(template.companyId) === key,
    ) || null
  );
}

export function getCanonicalCotizacionTemplateByRfc(
  rfc: unknown,
): CotizacionCanonicalTemplate | null {
  const key = normalizeRfc(rfc);
  if (!key) return null;
  return (
    COTIZACION_CANONICAL_MANIFEST.templates.find(
      (template) => normalizeRfc(template.rfc) === key,
    ) || null
  );
}

export function resolveCanonicalCotizacionTemplate(input: {
  companyId?: unknown;
  rfc?: unknown;
  companyName?: unknown;
}): CotizacionCanonicalTemplate | null {
  return (
    getCanonicalCotizacionTemplateByCompanyId(input.companyId) ||
    getCanonicalCotizacionTemplateByRfc(input.rfc) ||
    getCanonicalCotizacionTemplateByCompanyId(input.companyName)
  );
}

export function buildCotizacionMaterialityTemplateSnapshot(
  template: CotizacionCanonicalTemplate,
) {
  return {
    documentType: COTIZACION_CANONICAL_MANIFEST.documentType,
    templateId: template.templateId,
    templateVersion: template.version,
    companyId: template.companyId,
    companyName: template.companyName,
    companyRfc: template.rfc,
    referencePdf: template.referencePdf,
    referencePdfSha256: template.referencePdfSha256,
    templateHtml: COTIZACION_CANONICAL_MANIFEST.template.html,
    templateCss: COTIZACION_CANONICAL_MANIFEST.template.css,
    templateEngine: COTIZACION_CANONICAL_MANIFEST.template.engine,
    templateBundleSha256:
      COTIZACION_CANONICAL_MANIFEST.template.templateBundleSha256,
    versionPolicy: COTIZACION_CANONICAL_MANIFEST.versionPolicy,
  };
}
