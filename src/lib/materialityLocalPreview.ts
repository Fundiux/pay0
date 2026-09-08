export const LOCAL_MATERIALITY_PREVIEW_ID = "local-preview-cliente-demo-empresa-demo";

const REQUIRED_TYPES = [
  "ORDEN_COMPRA",
  "PRESUPUESTO",
  "FACTURA_XML",
  "FACTURA_PDF",
  "COMPROBANTE_PAGO",
];

const COMPLETED_TYPES = ["ORDEN_COMPRA", "PRESUPUESTO", "FACTURA_XML", "FACTURA_PDF"];

const MISSING_TYPES = ["COMPROBANTE_PAGO"];

export function getLocalMaterialityDashboard() {
  const updatedAt = new Date().toISOString();

  return {
    ok: true,
    localPreview: true,
    summary: {
      totalFolders: 1,
      incompleteFolders: 1,
      completeFolders: 0,
      noOperationFolders: 0,
      totalActiveAmount: 125000,
    },
    folders: [
      {
        id: LOCAL_MATERIALITY_PREVIEW_ID,
        materialityClientCompanyId: LOCAL_MATERIALITY_PREVIEW_ID,
        clienteId: "cliente-demo",
        clienteNombre: "Cliente Demo Materialidad",
        companyId: "empresa-demo",
        companyName: "Empresa Demo PAY0",
        status: "INCOMPLETE",
        operationCount: 1,
        activeOperationCount: 1,
        totalAmount: 125000,
        missingTypes: MISSING_TYPES,
        missingTypeLabels: ["Comprobante de Pago"],
        updatedAt,
      },
    ],
    alerts: [
      {
        id: "local-preview-alert-comprobante-pago",
        materialityClientCompanyId: LOCAL_MATERIALITY_PREVIEW_ID,
        severity: "warning",
        title: "Falta comprobante de pago",
        message: "Expediente local preview con una operacion vinculada y un faltante documental.",
      },
    ],
  };
}

export function getLocalMaterialityOverview(id?: string) {
  const materialityClientCompanyId = id || LOCAL_MATERIALITY_PREVIEW_ID;
  const updatedAt = new Date().toISOString();

  return {
    ok: true,
    exists: true,
    localPreview: true,
    materialityClientCompanyId,
    folder: {
      id: materialityClientCompanyId,
      materialityClientCompanyId,
      clienteId: "cliente-demo",
      clienteNombre: "Cliente Demo Materialidad",
      companyId: "empresa-demo",
      companyName: "Empresa Demo PAY0",
      status: "INCOMPLETE",
      updatedAt,
    },
    operations: [
      {
        id: "local-preview-operation-001",
        materialityClientCompanyId,
        solicitudId: "local-preview-solicitud-001",
        solicitudFolio: "S-LOCAL-MAT-001",
        concepto: "Operacion demo para smoke visual de expediente interno",
        status: "INCOMPLETE",
        monto: 125000,
        requiredTypes: REQUIRED_TYPES,
        completedTypes: COMPLETED_TYPES,
        missingTypes: MISSING_TYPES,
        ordenCompraUploadId: "local-preview-oc",
        presupuestoUploadId: "local-preview-presupuesto",
        facturaXmlUploadId: "local-preview-factura-xml",
        facturaPdfUploadId: "local-preview-factura-pdf",
        comprobantePagoUploadId: "",
        comprobantePagoSourcePagoId: "",
        updatedAt,
        createdAt: updatedAt,
      },
    ],
    contracts: [],
    summary: {
      operationCount: 1,
      activeOperationCount: 1,
      contractCount: 0,
      totalAmount: 125000,
      requiredTypes: REQUIRED_TYPES,
      completedTypes: COMPLETED_TYPES,
      missingTypes: MISSING_TYPES,
      missingTypeLabels: ["Comprobante de Pago"],
      status: "INCOMPLETE",
      updatedAt,
    },
  };
}