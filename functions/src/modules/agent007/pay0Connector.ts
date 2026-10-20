import { FieldPath, Firestore } from "firebase-admin/firestore";
import { isIqRepRequestHardEnabled } from "../paymentApplications/complementGates";

export type Pay0Identity = { uid: string; rootId: string; role: "superadmin" };
export type Completeness = "COMPLETE" | "PARTIAL" | "UNKNOWN";
export type Pay0Evidence = { sourceSystem: "PAY0"; sourceType: "FIRESTORE"; entityType: string; entityId: string; retrievedAt: string; effectiveAt: string | null; scope: { rootId: string }; completeness: Completeness; kind: "FACT" };
export type Pay0Trace = { traceId: string; actorUid: string; rootId: string; tool: string; sourceSystem: "PAY0"; requestedAt: string; completedAt: string; latencyMs: number; evidenceIds: string[]; completeness: Completeness; result: "OK" | "UNKNOWN" | "ERROR"; error?: string };
export type Pay0ToolResult<T> = { sourceSystem: "PAY0"; tool: string; retrievedAt: string; scope: { rootId: string }; completeness: Completeness; evidence: Pay0Evidence[]; data: T; trace: Pay0Trace };
export type ReceivedPaymentQuery = { limit?: number; beforePaymentId?: string };

const date = (value: any): string | null => value?.toDate?.()?.toISOString?.() || (value instanceof Date ? value.toISOString() : null);
const safeId = (value: string) => Boolean(value && value.length <= 160 && !value.includes("/"));
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;
const recordedAmount = (value: unknown): number | null => (typeof value === "number" || typeof value === "string" && value.trim() !== "") && Number.isFinite(Number(value)) ? Number(value) : null;
const clientFields = (row: any) => ({ cliente: row.__clientName ?? null, clienteId: row.__clientId ?? null, clienteFuente: row.__clientSource || "NOT_RECORDED" });
const solicitudView = (row: any) => ({ id: row.id, rootId: row.rootId, folio: row.folio || null, folioIq: row.folioIq || null,
  ...clientFields(row), empresa: row.companyName || row.empresaNombre || row.empresa || null,
  monto: recordedAmount(row.amount ?? row.monto ?? row.total), estado: row.status || row.estatus || null, status: row.status || row.estatus || null,
  tipoFactura: text(row.tipoFactura), metodoPago: row.tipoFactura === "PPD" || row.tipoFactura === "PUE" ? row.tipoFactura : null, moneda: text(row.moneda) || "MXN",
  factura: row.factura || row.invoiceNumber || null, facturamaStatus: row.facturamaStatus || null, createdAt: date(row.createdAt),
  claveSat: row.satProductCode || row.ocFiscalMetadata?.productCode || null, unidadSat: row.satUnitCode || row.ocFiscalMetadata?.unitCode || null });
const pagoView = (row: any) => {
  const semanticReceipt = row.receiptLearningSignals?.semanticReceipt || null;
  const receivedAt = date(row.reportDateAt || row.fechaPago || row.createdAt);
  const registeredAt = date(row.createdAt);
  const reconciled = ["CONCILIADO", "APLICADO_PARCIAL", "APLICADO_TOTAL"].includes(String(row.status || row.estatus || "").toUpperCase());
  const payerName = text(row.payerName);
  return { id: row.id, rootId: row.rootId, folio: row.folio || null, folioIq: row.folioIq || null,
    ...clientFields(row), pagador: payerName,
    pagadorFuente: payerName ? "CONFIRMED" : "NOT_RECORDED",
    remitenteDetectado: text(row.receiptLearningSignals?.detectedSenderName), remitenteFuente: text(row.receiptLearningSignals?.detectedSenderName) ? "RECEIPT_DETECTED" : "NOT_RECORDED",
    bancoDetectado: text(row.receiptLearningSignals?.detectedBankName),
    comprobante: semanticReceipt ? { readerVersion: row.receiptLearningSignals?.readerVersion || semanticReceipt.readerVersion || null, analysisId: row.receiptLearningSignals?.analysisId || null,
      reviewRequired: semanticReceipt.reviewRequired === true, reviewReasons: semanticReceipt.reviewReasons || [], fields: semanticReceipt.fields || {} } : null,
    monto: recordedAmount(row.montoTotal ?? row.amount ?? row.monto ?? row.total), moneda: row.moneda || "MXN",
    estado: row.status || row.estatus || null, status: row.status || row.estatus || null, conciliado: reconciled,
    recibidoAt: receivedAt, registradoAt: registeredAt,
    fechaSemantica: "reportDateAt (fechaPago; createdAt solo como respaldo al registrar)" };
};
const complementView = (row: any) => ({ id: row.id, rootId: row.rootId, solicitudFolio: row.solicitudFolio || null, pagoFolio: row.pagoFolio || null,
  status: row.status || null, automationStatus: row.automationStatus || null, automationError: row.automationError || null,
  provider: row.provider || null, externalRequestSent: row.externalRequestSent === true });

export class Pay0Connector {
  private readonly clientReads = new Map<string, Promise<{ name: string | null; source: string }>>();
  private async withClient(row: any) {
    const rawId = row.clienteId || row.clientId;
    const id = text(rawId);
    if (!rawId) {
      const name = text(row.clientName) || text(row.clienteNombre) || text(row.cliente);
      return { ...row, __clientName: name, __clientId: null, __clientSource: name ? "OPERATION_SNAPSHOT" : "NOT_RECORDED" };
    }
    if (!id || typeof rawId !== "string" || rawId.length > 160 || !safeId(id)) return { ...row, __clientName: null, __clientId: null, __clientSource: "UNRESOLVED" };
    if (!this.clientReads.has(id)) this.clientReads.set(id, (async () => {
      const snap = await this.db.collection("clients").doc(id).get();
      const client = snap.exists ? snap.data() : null;
      if (!client || client.rootId !== this.identity.rootId) return { name: null, source: "UNRESOLVED" };
      const name = text(client.nombre) || text(client.clienteNombre) || text(client.name) || text(client.razonSocial) || text(client.alias);
      return { name, source: name ? "CLIENT_RECORD" : "NOT_RECORDED" };
    })());
    const client = await this.clientReads.get(id)!;
    return { ...row, __clientName: client.name, __clientId: id, __clientSource: client.source };
  }
  private async solicitudViews(rows: any[]) { return Promise.all(rows.map(async row => solicitudView(await this.withClient(row)))); }
  private async pagoViews(rows: any[]) { return Promise.all(rows.map(async row => pagoView(await this.withClient(row)))); }
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
    return { rows, data: rows.length === 1 ? (await this.solicitudViews(rows))[0] : null, completeness: rows.length === 1 ? "COMPLETE" as const : "UNKNOWN" as const };
  }); }
  searchSolicitudes(limit = 40) { return this.query("searchSolicitudes", "solicitud", async () => {
    const rows = await this.recent("solicitudes", limit);
    return { rows, data: await this.solicitudViews(rows), completeness: "PARTIAL" as const };
  }); }
  getLatestSolicitud() { return this.query("getLatestSolicitud", "solicitud", async () => {
    const snap = await this.db.collection("solicitudes").where("rootId", "==", this.identity.rootId).orderBy("createdAt", "desc").orderBy(FieldPath.documentId()).limit(1).get();
    const rows = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Record<string, any> & { id: string }));
    return { rows, data: { item: rows[0] ? (await this.solicitudViews(rows))[0] : null, order: { field: "createdAt", direction: "desc", semantic: "SOLICITUD_CREATED_AT" }, statusPolicy: "ALL_CANONICAL_STATUSES" }, completeness: "COMPLETE" as const };
  }); }
  getPago(folio: string) { return this.query("getPago", "pago", async () => {
    const rows = await this.byFolio("pagos", folio);
    return { rows, data: rows.length === 1 ? (await this.pagoViews(rows))[0] : null, completeness: rows.length === 1 ? "COMPLETE" as const : "UNKNOWN" as const };
  }); }
  searchPagos(limit = 30) { return this.query("searchPagos", "pago", async () => {
    const rows = await this.recent("pagos", limit);
    return { rows, data: await this.pagoViews(rows), completeness: "PARTIAL" as const };
  }); }
  searchReceivedPagos(input: ReceivedPaymentQuery = {}) { return this.query("searchReceivedPagos", "pago", async () => {
    const limit = Math.min(Math.max(Number(input.limit) || 1, 1), 5);
    let query = this.db.collection("pagos").where("rootId", "==", this.identity.rootId).orderBy("reportDateAt", "desc");
    if (input.beforePaymentId) {
      if (!safeId(input.beforePaymentId)) throw Error("PAY0_CONNECTOR_INVALID_PAYMENT_REFERENCE");
      const anchor = await this.db.collection("pagos").doc(input.beforePaymentId).get();
      if (!anchor.exists || anchor.data()?.rootId !== this.identity.rootId || !anchor.get("reportDateAt")) throw Error("PAY0_PAYMENT_REFERENCE_NOT_FOUND");
      query = query.startAfter(anchor);
    }
    const snap = await query.limit(limit).get();
    const rows = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Record<string, any> & { id: string }));
    return { rows, data: { items: await this.pagoViews(rows), order: { field: "reportDateAt", direction: "desc", semantic: "PAYMENT_RECEIVED_AT" }, requestedLimit: limit }, completeness: "COMPLETE" as const };
  }); }
  getPagoById(paymentId: string) { return this.query("getPagoById", "pago", async () => {
    if (!safeId(paymentId)) throw Error("PAY0_CONNECTOR_INVALID_PAYMENT_REFERENCE");
    const snap = await this.db.collection("pagos").doc(paymentId).get();
    const direct = snap.exists && snap.data()?.rootId === this.identity.rootId ? { id: snap.id, ...snap.data() } : null;
    if (direct) return { rows: [direct], data: (await this.pagoViews([direct]))[0], completeness: "COMPLETE" as const };
    const [folio, folioIq] = await Promise.all([
      this.db.collection("pagos").where("rootId", "==", this.identity.rootId).where("folio", "==", paymentId).limit(3).get(),
      this.db.collection("pagos").where("rootId", "==", this.identity.rootId).where("folioIq", "==", paymentId).limit(3).get(),
    ]);
    const unique = new Map([...folio.docs, ...folioIq.docs].map(doc => [doc.id, { id: doc.id, ...doc.data() }]));
    const rows = [...unique.values()];
    return { rows, data: rows.length === 1 ? (await this.pagoViews(rows))[0] : null, completeness: rows.length === 1 ? "COMPLETE" as const : "UNKNOWN" as const };
  }); }
  getPaymentComplementStatus(folio?: string) { return this.query("getPaymentComplementStatus", "paymentComplementRequest", async () => {
    const rows = (await this.recent("paymentComplementRequests", 30)).filter(row => !folio || row.solicitudFolio === folio || row.pagoFolio === folio);
    return { rows, data: rows.map(complementView), completeness: "PARTIAL" as const };
  }); }
  getPay0OperationalSummary() { return this.query("getPay0OperationalSummary", "operationalSample", async () => {
    const [solicitudes, pagos, complements] = await Promise.all([this.recent("solicitudes", 40), this.recent("pagos", 30), this.recent("paymentComplementRequests", 30)]);
    const rows = [...solicitudes.map(row => ({ ...row, __entityType: "solicitud" })), ...pagos.map(row => ({ ...row, __entityType: "pago" })), ...complements.map(row => ({ ...row, __entityType: "paymentComplementRequest" }))];
    return { rows, data: { solicitudes: await this.solicitudViews(solicitudes), pagos: await this.pagoViews(pagos), complements: complements.map(complementView), sampleLimits: { solicitudes: 40, pagos: 30, complements: 30 } }, completeness: "PARTIAL" as const };
  }); }
  getIqCapabilities() { return this.query("getIqCapabilities", "integrationConfig", async () => {
    const [complementConfigSnap, masterSnap] = await Promise.all([
      this.db.doc(`paymentComplementConfigs/${this.identity.rootId}`).get(), this.db.doc(`iqIntegrationConfigs/${this.identity.rootId}`).get(),
    ]);
    const complementConfig = complementConfigSnap.data(), master = masterSnap.data();
    const iqLookupAllowed = master?.enabled === true && !!complementConfig && complementConfig.iqLookupEnabled !== false;
    const iqRequestAllowed = iqLookupAllowed && master?.automation?.aplicacionPagos === true && complementConfig?.iqEnabled === true && isIqRepRequestHardEnabled(complementConfig);
    const data = { altaBeneficiario: "NO_CONECTADA", consultaComplemento: iqLookupAllowed ? "HABILITADA_SUJETA_A_PERFIL_PERMISOS_Y_CUOTA" : "PAUSADA_POR_CONFIGURACION_O_MASTER",
      solicitudComplemento: iqRequestAllowed ? "HABILITADA_SOLO_PPD_NUEVAS_CONFIRMADAS_SUJETA_A_PERFIL_PERMISOS_Y_CUOTA" : "PAUSADA_POR_CONFIGURACION_O_MASTER",
      complementoFacturama: complementConfig?.facturamaEnabled === true ? "AUTOMATICO_CON_VALIDACION_FISCAL" : "PAUSADO", dispersion: "TRANSFERENCIA_Y_TDC_CON_VALIDACIONES" };
    const rows = [complementConfigSnap, masterSnap].filter(snap => snap.exists).map(snap => ({ id: snap.id, __entityType: snap.ref.parent.id }));
    return { rows, data, completeness: rows.length === 2 ? "COMPLETE" as const : "UNKNOWN" as const };
  }); }
}
