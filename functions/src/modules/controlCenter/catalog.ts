export type KpiDefinition = {
  id: string;
  version: number;
  label: string;
  meaning: string;
  sourceEvents: string[];
  aggregation: "SUM" | "COUNT" | "AVERAGE" | "RATIO" | "LATEST";
  unit: "MXN" | "COUNT" | "PERCENT" | "DAYS" | "STATUS";
  supportedDimensions: string[];
  evidenceRoute: string;
  estimated?: boolean;
  availability?: "READY" | "REQUIRES_ACCOUNTING_SOURCE";
};

export const CONTROL_CENTER_KPIS: readonly KpiDefinition[] = [
  { id: "billing.issued", version: 1, label: "Facturación emitida", meaning: "Importe de CFDI emitidos y no cancelados en el periodo.", sourceEvents: ["INVOICE_ISSUED", "INVOICE_CANCELED"], aggregation: "SUM", unit: "MXN", supportedDimensions: ["companyId", "clientId", "userId", "satKey"], evidenceRoute: "/facturacion" },
  { id: "cash.collected", version: 1, label: "Cobranza recibida", meaning: "Importe de pagos recibidos, independientemente de su aplicación posterior.", sourceEvents: ["PAYMENT_CREATED"], aggregation: "SUM", unit: "MXN", supportedDimensions: ["companyId", "clientId", "bankId", "paymentMethod"], evidenceRoute: "/pagos" },
  { id: "cash.applied", version: 2, label: "Pagos aplicados", meaning: "Importe aplicado a solicitudes; no equivale a ingreso propio de PAY0.", sourceEvents: ["PAYMENT_APPLIED", "SOURCE_RECONCILED"], aggregation: "SUM", unit: "MXN", supportedDimensions: ["companyId", "clientId"], evidenceRoute: "/pagos" },
  { id: "expense.recorded", version: 1, label: "Gastos registrados", meaning: "Gastos reconocidos por una fuente canónica y vinculados a la operación.", sourceEvents: ["EXPENSE_RECORDED"], aggregation: "SUM", unit: "MXN", supportedDimensions: ["companyId", "clientId"], evidenceRoute: "/materialidad" },
  { id: "profit.operating", version: 2, label: "Utilidad operativa", meaning: "Requiere ingresos propios y gastos con cobertura contable validada. No se deriva del volumen de pagos de clientes.", sourceEvents: ["EXPENSE_RECORDED"], aggregation: "SUM", unit: "MXN", supportedDimensions: ["companyId", "clientId"], evidenceRoute: "/reportes", availability: "REQUIRES_ACCOUNTING_SOURCE" },
  { id: "profit.margin", version: 2, label: "Margen operativo", meaning: "No disponible hasta validar ingresos propios, gastos y su cobertura.", sourceEvents: ["EXPENSE_RECORDED"], aggregation: "RATIO", unit: "PERCENT", supportedDimensions: ["companyId", "clientId"], evidenceRoute: "/reportes", availability: "REQUIRES_ACCOUNTING_SOURCE" },
  { id: "requests.open", version: 1, label: "Solicitudes abiertas", meaning: "Solicitudes que no se encuentran en un estado terminal.", sourceEvents: ["SOLICITUD_CREATED", "SOLICITUD_STATUS_CHANGED"], aggregation: "COUNT", unit: "COUNT", supportedDimensions: ["companyId", "clientId", "userId", "status"], evidenceRoute: "/solicitudes" },
  { id: "invoices.issued", version: 1, label: "CFDI emitidos", meaning: "Número de CFDI emitidos durante el periodo.", sourceEvents: ["INVOICE_ISSUED"], aggregation: "COUNT", unit: "COUNT", supportedDimensions: ["companyId", "clientId", "userId"], evidenceRoute: "/facturacion" },
  { id: "materiality.completed", version: 1, label: "Expedientes completos", meaning: "Expedientes que alcanzaron el estado canónico completo.", sourceEvents: ["MATERIALITY_COMPLETED"], aggregation: "COUNT", unit: "COUNT", supportedDimensions: ["companyId", "clientId", "userId"], evidenceRoute: "/materialidad" },
  { id: "tax.vat.estimated", version: 1, label: "IVA estimado", meaning: "Estimación analítica; no sustituye el cálculo fiscal ni contable.", sourceEvents: ["INVOICE_ISSUED", "EXPENSE_RECORDED"], aggregation: "SUM", unit: "MXN", supportedDimensions: ["companyId", "clientId"], evidenceRoute: "/facturacion", estimated: true },
] as const;

export type WidgetDefinition = {
  id: string;
  version: number;
  title: string;
  category: "EXECUTIVE" | "FINANCE" | "COMMERCIAL" | "OPERATIONS" | "FISCAL" | "AI" | "RISK";
  allowedRoles: Array<"superadmin" | "admin" | "operador">;
  supportedFilters: string[];
  kpiIds: string[];
  renderer: "KPI" | "TIME_SERIES" | "RANKING_BAR" | "DONUT" | "FUNNEL" | "HEATMAP" | "FINDINGS" | "HEALTH";
  defaultSize: { width: number; height: number };
  drillDown?: string;
  refreshPolicy: "EVENT" | "MINUTE" | "HOURLY" | "DAILY";
};

export const CONTROL_CENTER_WIDGETS: readonly WidgetDefinition[] = [
  { id: "executive.cash-collected", version: 1, title: "Cobranza recibida", category: "EXECUTIVE", allowedRoles: ["superadmin", "admin"], supportedFilters: ["companyId", "clientId", "period"], kpiIds: ["cash.collected"], renderer: "KPI", defaultSize: { width: 3, height: 1 }, drillDown: "/pagos", refreshPolicy: "EVENT" },
  { id: "executive.operating-profit", version: 1, title: "Utilidad operativa", category: "EXECUTIVE", allowedRoles: ["superadmin", "admin"], supportedFilters: ["companyId", "clientId", "period"], kpiIds: ["profit.operating", "profit.margin"], renderer: "KPI", defaultSize: { width: 3, height: 1 }, drillDown: "/reportes", refreshPolicy: "EVENT" },
  { id: "finance.cash-flow", version: 1, title: "Ingresos vs gastos", category: "FINANCE", allowedRoles: ["superadmin", "admin"], supportedFilters: ["companyId", "clientId", "period"], kpiIds: ["cash.applied", "expense.recorded"], renderer: "TIME_SERIES", defaultSize: { width: 8, height: 3 }, refreshPolicy: "EVENT" },
  { id: "operations.pipeline", version: 1, title: "Pipeline operativo", category: "OPERATIONS", allowedRoles: ["superadmin", "admin", "operador"], supportedFilters: ["companyId", "clientId", "userId", "period"], kpiIds: ["requests.open", "invoices.issued", "materiality.completed"], renderer: "FUNNEL", defaultSize: { width: 6, height: 3 }, refreshPolicy: "EVENT" },
  { id: "fiscal.estimated-vat", version: 1, title: "IVA estimado", category: "FISCAL", allowedRoles: ["superadmin", "admin"], supportedFilters: ["companyId", "clientId", "period"], kpiIds: ["tax.vat.estimated"], renderer: "KPI", defaultSize: { width: 3, height: 1 }, drillDown: "/facturacion", refreshPolicy: "EVENT" },
] as const;

export function validateControlCenterCatalog() {
  const kpiIds = new Set<string>();
  for (const kpi of CONTROL_CENTER_KPIS) {
    if (kpiIds.has(kpi.id)) throw new Error(`CONTROL_CENTER_DUPLICATE_KPI:${kpi.id}`);
    kpiIds.add(kpi.id);
  }
  const widgetIds = new Set<string>();
  for (const widget of CONTROL_CENTER_WIDGETS) {
    if (widgetIds.has(widget.id)) throw new Error(`CONTROL_CENTER_DUPLICATE_WIDGET:${widget.id}`);
    widgetIds.add(widget.id);
    for (const kpiId of widget.kpiIds) if (!kpiIds.has(kpiId)) throw new Error(`CONTROL_CENTER_UNKNOWN_KPI:${widget.id}:${kpiId}`);
  }
  return { kpis: kpiIds.size, widgets: widgetIds.size };
}
