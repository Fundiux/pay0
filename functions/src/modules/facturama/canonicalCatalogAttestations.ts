/**
 * Atestaciones fiscales publicadas junto con PAY0.
 *
 * No son una bandera editable en Firestore: solo el archivo con este SHA-256,
 * para el RFC indicado, puede operar sin tener cargada la copia global SAT.
 * Cualquier cambio de archivo o de versión SAT exige una nueva atestación y
 * despliegue deliberado.
 */
const TROSTRE_CATALOG_SHA256 = "ba1d8241d069a8f31024453fc501d0e13ba38d5b31e3f2c794b9398dbc340315";
const SAT_SOURCE_SHA256 = "394e8b1e5409a2ba2728cc6d00fdfa4f2417c0f7b4710e3d9c435163da57f245";

export type CanonicalCatalogAttestation = {
  issuerRfc: string;
  companyCatalogSha256: string;
  satSourceSha256: string;
  sourceLabel: string;
};

const ATTESTATIONS: CanonicalCatalogAttestation[] = [
  {
    issuerRfc: "TRO230717L64",
    companyCatalogSha256: TROSTRE_CATALOG_SHA256,
    satSourceSha256: SAT_SOURCE_SHA256,
    sourceLabel: "CATALOGO_PRODUCTOS_SERVICIOS_TROSTRE_v1.2_PRUEBA_PAY0.xlsx",
  },
];

export function getCanonicalCatalogAttestation(issuerRfc: unknown, companyCatalogSha256: unknown): CanonicalCatalogAttestation | null {
  const rfc = String(issuerRfc || "").trim().toUpperCase();
  const hash = String(companyCatalogSha256 || "").trim().toLowerCase();
  return ATTESTATIONS.find((entry) => entry.issuerRfc === rfc && entry.companyCatalogSha256 === hash) || null;
}
