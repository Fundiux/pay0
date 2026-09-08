import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function assertOk(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const domain = read("functions/src/modules/materiality/domain.ts");
const service = read("functions/src/modules/materiality/service.ts");
const modal = read("src/components/MaterialityModal.tsx");
const frontendService = read("src/services/materiality.ts");
const solicitudesPage = read("src/app/solicitudes/page.tsx");
const roles = read("src/lib/roles.ts");
const canon = read("pay0-archivo-tecnico/MATERIALIDAD-CANON.md");
const materialidadPage = read("src/app/materialidad/page.tsx");
const materialidadDetail = read("src/app/materialidad/[id]/page.tsx");
const localPreview = exists("src/lib/materialityLocalPreview.ts") ? read("src/lib/materialityLocalPreview.ts") : "";

assertOk(!domain.includes("COMPROBANTE_DISPERSION"), "domain.ts no debe incluir COMPROBANTE_DISPERSION");
assertOk(!modal.includes("COMPROBANTE_DISPERSION"), "MaterialityModal no debe incluir COMPROBANTE_DISPERSION");
assertOk(!frontendService.includes("comprobanteDispersionUploadIds"), "service frontend no debe exponer comprobanteDispersionUploadIds");
assertOk(service.includes("getActivePagoUploadsBySolicitud"), "materiality service debe buscar comprobantes desde pagos relacionados");
assertOk(service.includes("pagoAplicaciones"), "materiality service debe usar pagoAplicaciones");
assertOk(service.includes('cleanText(row.entityType) !== "pagos"'), "materiality service debe filtrar uploads de pagos");
assertOk(service.includes("comprobantePagoSourcePagoId"), "materiality operation debe guardar origen del comprobante de pago");
assertOk(service.includes("comprobanteDispersionUploadIds: FieldValue.delete()"), "materiality service debe limpiar campo heredado de dispersion");

const requiredBlock = domain.slice(domain.indexOf("MATERIALITY_REQUIRED_TYPES"), domain.indexOf("MATERIALITY_DOCUMENT_TYPES"));
assertOk(!requiredBlock.includes("CONTRATO_MARCO"), "CONTRATO_MARCO no debe ser requerido por default");
assertOk(requiredBlock.includes("COMPROBANTE_PAGO"), "COMPROBANTE_PAGO debe seguir requerido");

assertOk(roles.includes("materialidad: { view: true"), "roles debe habilitar materialidad para superadmin");
assertOk(roles.includes('href: "/materialidad"'), "sidebar debe incluir /materialidad autorizado");

assertOk(materialidadPage.includes("Tablero de expedientes"), "/materialidad debe mostrar tablero de expedientes");
assertOk(materialidadPage.includes("Ver expediente"), "/materialidad debe enlazar al detalle interno");
assertOk(materialidadPage.includes("/materialidad/${encodeURIComponent"), "/materialidad debe crear liga por materialityClientCompanyId");
assertOk(materialidadPage.includes("Solicitudes se mantiene limpio"), "/materialidad debe documentar Solicitudes limpio");
assertOk(materialidadPage.includes("getLocalMaterialityDashboard"), "/materialidad debe tener local preview dashboard");
assertOk(materialidadPage.includes("Canon M1-D5-G"), "/materialidad debe mostrar canon visual M1-D5-G");

assertOk(materialidadDetail.includes("Detalle interno de expediente"), "detalle debe mostrar titulo interno");
assertOk(materialidadDetail.includes("getMaterialityClientCompanyOverview"), "detalle debe consumir overview interno");
assertOk(materialidadDetail.includes("getLocalMaterialityOverview"), "detalle debe tener local preview overview");
assertOk(materialidadDetail.includes("No se muestra en Solicitudes"), "detalle debe conservar canon de Solicitudes limpio");
assertOk(materialidadDetail.includes("El expediente no incluye dispersiones"), "detalle debe documentar exclusion de dispersiones");
assertOk(materialidadDetail.includes("Detectado desde Pagos"), "detalle debe mostrar comprobante de pago desde Pagos");

assertOk(localPreview.includes("LOCAL_MATERIALITY_PREVIEW_ID"), "debe existir id local preview");
assertOk(localPreview.includes("getLocalMaterialityDashboard"), "debe existir dashboard local preview");
assertOk(localPreview.includes("getLocalMaterialityOverview"), "debe existir overview local preview");
assertOk(localPreview.includes("COMPROBANTE_PAGO"), "preview debe mantener COMPROBANTE_PAGO");
assertOk(!localPreview.includes("COMPROBANTE_DISPERSION"), "preview no debe incluir COMPROBANTE_DISPERSION");

assertOk(!solicitudesPage.includes("MaterialityModal"), "Solicitudes no debe importar/renderizar MaterialityModal");
assertOk(!solicitudesPage.includes("@/services/materiality"), "Solicitudes no debe importar servicios de materialidad");
assertOk(!solicitudesPage.includes("linkSolicitudToMaterialityOperation"), "Solicitudes no debe llamar linkSolicitudToMaterialityOperation desde UI");
assertOk(!solicitudesPage.includes("Sincronizar expediente"), "Solicitudes no debe mostrar sincronizacion de expediente");
assertOk(!/Expediente/i.test(solicitudesPage), "Solicitudes no debe mostrar texto Expediente");

assertOk(canon.includes("Estado: CANON M1-D5-G"), "canon debe estar actualizado a M1-D5-G");
assertOk(canon.includes("M1-D5-G - Smoke local con expediente demo"), "canon debe documentar M1-D5-G");
assertOk(canon.includes("El expediente demo no toca Firestore real"), "canon debe aclarar que preview no toca Firestore");

console.log("[OK] Materiality canon M1-D5-G");