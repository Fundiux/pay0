import { Firestore } from "firebase-admin/firestore";

export type Pay0Identity = { uid: string; rootId: string; role: "superadmin" };
export type Completeness = "COMPLETE" | "PARTIAL" | "UNKNOWN";
export type Pay0Evidence = { sourceSystem: "PAY0"; sourceType: "FIRESTORE"; entityType: string; entityId: string; retrievedAt: string; effectiveAt: string | null; scope: { rootId: string }; completeness: Completeness; kind: "FACT" };
export type Pay0Trace = { traceId: string; actorUid: string; rootId: string; tool: string; sourceSystem: "PAY0"; requestedAt: string; completedAt: string; latencyMs: number; evidenceIds: string[]; completeness: Completeness; result: "OK" | "UNKNOWN" | "ERROR"; error?: string };
export type Pay0ToolResult<T> = { sourceSystem: "PAY0"; tool: string; retrievedAt: string; scope: { rootId: string }; completeness: Completeness; evidence: Pay0Evidence[]; data: T; trace: Pay0Trace };

const date = (value: any): string | null => value?.toDate?.()?.toISOString?.() || (value instanceof Date ? value.toISOString() : null);
const safeId = (value: string) => Boolean(value && value.length <= 160 && !value.includes("/"));
const solicitudView = (row: any) => ({ id: row.id, rootId: row.rootId, folio: row.folio || null, folioIq: row.folioIq || null,
  cliente: row.clientName || row.clienteNombre || row.cliente || null, empresa: row.companyName || row.empresaNombre || row.empresa || null,
  monto: Number(row.amount || row.monto || row.total || 0), estado: row.status || row.estatus || null, status: row.status || row.estatus || null,
  factura: row.factura || row.invoiceNumber || null, facturamaStatus: row.facturamaStatus || null,
  claveSat: row.satProductCode || row.ocFiscalMetadata?.productCode || null, unidadSat: row.satUnitCode || row.ocFiscalMetadata?.unitCode || null });
const pagoView = (row: any) => ({ id: row.id, rootId: row.rootId, folio: row.folio || null, folioIq: row.folioIq || null,
  cliente: row.clientName || row.clienteNombre || row.cliente || null, monto: Number(row.amount || row.monto || row.total || 0),
  estado: row.status || row.estatus || null, status: row.status || row.estatus || null });
const complementView = (row: any) => ({ id: row.id, rootId: row.rootId, solicitudFolio: row.solicitudFolio || null, pagoFolio: row.pagoFolio || null,
  status: row.status || null, automationStatus: row.automationStatus || null, automationError: row.automationError || null,
  provider: row.provider || null, externalRequestSent: row.externalRequestSent === true });

export class Pay0Connector {
  constructor(private readonly db: Firestore, private readonly identity: Pay0Identity, private readonly onTrace?: (trace: Pay0Trace) => void) {
    if (!safeId(identity.uid) || !safeId(identity.rootId) || identity.role !== "superadmin") throw Error("PAY0_CONNECTOR_UNAUTHORIZED");
  }

  private async query<T>(tool: string, entityType: string, run: () => Promise<{ rows: any[]; data: T; completeness: Completeness }>): Promise<Pay0ToolResult<T>> {
    const start = Date.now(), requestedAt = new Date(start).toISOString();
    const traceId = `${this.identity.uid}:${start}:${Math.random().toString(36).slice(2, 10)}`;
    try {
      const { rows, data, completeness } = await run();
      const retrievedAt = new Date().toISOString();
      const evidence: Pay0Evidence[] = rows.map(row => ({ sourceSystem: "PAY0", sourceType: "FIRESTORE", entityType: row.__entityType || entityType, entityId: row.id,
        retrievedAt, effectiveAt: date(row.updatedAt || row.createdAt), scope: { rootId: this.identity.rootId }, completeness, kind: "FACT" }));
      const trace: Pay0Trace = { traceId, actorUid: this.identity.uid, rootId: this.identity.rootId, tool, sourceSystem: "PAY0", requestedAt, completedAt: retrievedAt,
        latencyMs: Date.now() - start, evidenceIds: evidence.map(row => `${row.entityType}/${row.entityId}`), completeness, result: completeness === "UNKNOWN" ? "UNKNOWN" : "OK" };
      this.onTrace?.(trace);
      return { sourceSystem: "PAY0", tool, retrievedAt, scope: { rootId: this.identity.rootId }, completeness, evidence, data, trace };
    } catch (error) {
      this.onTrace?.({ traceId, actorUid: this.identity.uid, rootId: this.identity.rootId, tool, sourceSystem: "PAY0", requestedAt,
        completedAt: new Date().toISOString(), latencyMs: Date.now() - start, evidenceIds: [], completeness: "UNKNOWN", result: "ERROR", error: error instanceof Error ? error.name : "ERROR" });
      throw error;
    }
  }

  private async byFolio(collection: "solicitudes" | "pagos", folio: string) {
    if (!safeId(folio)) throw Error("PAY0_CONNECTOR_INVALID_FOLIO");
    const snap = await this.db.collection(collection).where("rootId", "==", this.identity.rootId).where("folio", "==", folio).limit(3).get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Record<string, any> & { id: string }));
  }

  private async recent(collection: string, limit: number) {
    const snap = await this.db.collection(collection).where("rootId", "==", this.identity.rootId).orderBy("createdAt", "desc").limit(limit).get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Record<string, any> & { id: string }))
      .sort((a, b) => (a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0) < (b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0) ? 1 : -1);
  }

  getSolicitud(folio: string) { return this.query("getSolicitud", "solicitud", async () => {
    const rows = await this.byFolio("solicitudes", folio);
    return { rows, data: rows.length === 1 ? solicitudView(rows[0]) : null, completeness: rows.length === 1 ? "COMPLETE" as const : "UNKNOWN" as const };
  }); }
  searchSolicitudes(limit = 40) { return this.query("searchSolicitudes", "solicitud", async () => {
    const rows = await this.recent("solicitudes", limit);
    return { rows, data: rows.map(solicitudView), completeness: "PARTIAL" as const };
  }); }
  getPago(folio: string) { return this.query("getPago", "pago", async () => {
    const rows = await this.byFolio("pagos", folio);
    return { rows, data: rows.length === 1 ? pagoView(rows[0]) : null, completeness: rows.length === 1 ? "COMPLETE" as const : "UNKNOWN" as const };
  }); }
  searchPagos(limit = 30) { return this.query("searchPagos", "pago", async () => {
    const rows = await this.recent("pagos", limit);
    return { rows, data: rows.map(pagoView), completeness: "PARTIAL" as const };
  }); }
  getPaymentComplementStatus(folio?: string) { return this.query("getPaymentComplementStatus", "paymentComplementRequest", async () => {
    const rows = (await this.recent("paymentComplementRequests", 30)).filter(row => !folio || row.solicitudFolio === folio || row.pagoFolio === folio);
    return { rows, data: rows.map(complementView), completeness: "PARTIAL" as const };
  }); }
  getPay0OperationalSummary() { return this.query("getPay0OperationalSummary", "operationalSample", async () => {
    const [solicitudes, pagos, complements] = await Promise.all([this.recent("solicitudes", 40), this.recent("pagos", 30), this.recent("paymentComplementRequests", 30)]);
    const rows = [...solicitudes.map(row => ({ ...row, __entityType: "solicitud" })), ...pagos.map(row => ({ ...row, __entityType: "pago" })), ...complements.map(row => ({ ...row, __entityType: "paymentComplementRequest" }))];
    return { rows, data: { solicitudes: solicitudes.map(solicitudView), pagos: pagos.map(pagoView), complements: complements.map(complementView), sampleLimits: { solicitudes: 40, pagos: 30, complements: 30 } }, completeness: "PARTIAL" as const };
  }); }
  getIqCapabilities() { return this.query("getIqCapabilities", "integrationConfig", async () => {
    const [complementConfigSnap, masterSnap] = await Promise.all([
      this.db.doc(`paymentComplementConfigs/${this.identity.rootId}`).get(), this.db.doc(`iqIntegrationConfigs/${this.identity.rootId}`).get(),
    ]);
    const complementConfig = complementConfigSnap.data(), master = masterSnap.data();
    const iqLookupAllowed = master?.enabled === true && !!complementConfig && complementConfig.iqLookupEnabled !== false;
    const iqRequestAllowed = iqLookupAllowed && master?.automation?.aplicacionPagos === true && complementConfig?.iqEnabled === true && complementConfig?.iqRequestEnabled !== false;
    const data = { altaBeneficiario: "NO_CONECTADA", consultaComplemento: iqLookupAllowed ? "HABILITADA_SUJETA_A_PERFIL_PERMISOS_Y_CUOTA" : "PAUSADA_POR_CONFIGURACION_O_MASTER",
      solicitudComplemento: iqRequestAllowed ? "HABILITADA_SOLO_PPD_NUEVAS_CONFIRMADAS_SUJETA_A_PERFIL_PERMISOS_Y_CUOTA" : "PAUSADA_POR_CONFIGURACION_O_MASTER",
      complementoFacturama: complementConfig?.facturamaEnabled === true ? "AUTOMATICO_CON_VALIDACION_FISCAL" : "PAUSADO", dispersion: "TRANSFERENCIA_Y_TDC_CON_VALIDACIONES" };
    const rows = [complementConfigSnap, masterSnap].filter(snap => snap.exists).map(snap => ({ id: snap.id, __entityType: snap.ref.parent.id }));
    return { rows, data, completeness: rows.length === 2 ? "COMPLETE" as const : "UNKNOWN" as const };
  }); }
}
