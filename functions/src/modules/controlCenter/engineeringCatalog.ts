/** Curated source contracts, not runtime health or proof of deployment. */
export const ENGINEERING_MODULES = [
  { id: "users", name: "Acceso y usuarios", responsibility: "Autenticación, roles y permisos de módulos.", data: ["users"], boundary: "assertAuthorized y política de autorización", dependencies: [], checks: ["Verificador de política de autorización"], source: "functions/src/modules/users" },
  { id: "clientDelegations", name: "Delegación de clientes", responsibility: "Validar acceso operativo al cliente dentro de su organización.", data: ["userClientAccess"], boundary: "requireClientOperationalAccess", dependencies: ["users"], checks: ["Contratos de delegación y alcance"], source: "functions/src/modules/clientDelegations" },
  { id: "pagos", name: "Pagos y comprobantes", responsibility: "Identificar comprobantes y registrar pagos con evidencia y revisión humana.", data: ["pagos"], boundary: "Servicios de pagos y callables de identificación", dependencies: ["clientDelegations"], checks: ["Extracción de comprobantes", "Autorización y duplicados"], source: "functions/src/modules/pagos" },
  { id: "paymentApplications", name: "Aplicación de pagos", responsibility: "Aplicar pagos y dar seguimiento a complementos sin duplicar envíos.", data: ["paymentComplementRequests", "paymentComplementJobs"], boundary: "Callables de aplicaciones y automatización de complementos", dependencies: ["pagos"], checks: ["Idempotencia y límites de aplicación", "Puertas de complementos IQ"], source: "functions/src/modules/paymentApplications" },
  { id: "agent007", name: "Hugo operativo", responsibility: "Consultar operaciones y registrar observaciones, decisiones y trazas supervisadas.", data: ["agent007Observations", "agent007Recommendations"], boundary: "HugoToolRouter y callables con autorización de superadmin", dependencies: ["users", "paymentApplications"], checks: ["Identidad y alcance de herramientas", "Evidencia y aprendizaje supervisado"], source: "functions/src/modules/agent007" },
  { id: "controlCenter", name: "Centro de control", responsibility: "Proyectar indicadores y mostrar evidencia operativa con cobertura explícita.", data: ["controlCenterSnapshots", "analyticsRoots"], boundary: "Callables de reportes autorizados y proyecciones", dependencies: ["users", "pagos", "agent007"], checks: ["Contratos analíticos y cobertura", "Compilación de frontend y Functions"], source: "functions/src/modules/controlCenter" },
] as const;

export function engineeringCatalog() {
  return {
    schemaVersion: 1,
    coverage: "CURATED" as const,
    modules: ENGINEERING_MODULES.map(module => ({ ...module, technicalOwner: null, independence: "SHARED_FIREBASE_RUNTIME" as const })),
    release: {
      deployedVersion: null,
      certification: "UNKNOWN" as const,
      productionVerification: "UNKNOWN" as const,
      explanation: "Este catálogo describe contratos del código. No acredita una versión desplegada ni pruebas productivas.",
    },
    engineeringAgents: { environment: "CODEX" as const, names: ["Sol", "Astra"], explanation: "Modelos usados en Codex para trabajo de ingeniería; su ejecución y publicación no se controlan desde PAY0." },
  };
}
