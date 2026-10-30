import * as admin from "firebase-admin";
import { createHash, randomBytes } from "crypto";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { logActivity, logActivityTx } from "../../utils/logActivity";
import { getActivityAdminId, getMyUser, requireAuth } from "../sharedCallables/helpers";
import { finalizeSolicitudDocumentVersionTx } from "../solicitudDocuments/lifecycle";
import { linkSolicitudToMaterialityOperationCore } from "../materiality/service";
import { renderCanonicalQuotePdf } from "../documents/canonicalPdf";
import { resolveCorporateDocumentBundle } from "../canonicalCenter/service";
import { requireClientOperationalAccess } from "../clientDelegations/access";
import { isTerminalSolicitud } from "./quotationPolicy";
import { readOcQuotationLines } from "../solicitudDocuments/service";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const quotationManifestPath = resolve(__dirname, "../../assets/cotizaciones-manifest.json");

type CanonicalQuotationTemplate = {
  templateId: string;
  companyId: string;
  companyName: string;
  rfc: string;
  version: string;
  referencePdf: string;
  referencePdfSha256: string;
};

function canonicalQuotationTemplateByRfc(rfc: string): CanonicalQuotationTemplate | null {
  if (!existsSync(quotationManifestPath)) return null;
  try {
    const manifest = JSON.parse(readFileSync(quotationManifestPath, "utf8"));
    return (manifest.templates || []).find((template: CanonicalQuotationTemplate) => template.rfc === rfc) || null;
  } catch {
    return null;
  }
}

function clean(value: unknown, max = 500): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function money(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function formatMoney(value: unknown): string {
  return money(value).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

function normalizeRfc(value: unknown): string {
  return clean(value, 13).toUpperCase().replace(/[^A-Z0-9Ñ&]/g, "");
}

function canonicalSlug(value: unknown): string {
  return clean(value, 180).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function role(user: any): string {
  return String(getUserRole(user) || "").toLowerCase();
}

function username(user: any, uid: string): string {
  return clean(user?.username || user?.displayName || user?.email || uid, 180);
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

type OcItem = { quantity?: unknown; unit?: unknown; productCode?: unknown; description?: unknown };

export function requireQuotationSource(solicitud: any, activeOcUploadId: string) {
  const commercialUploadId = clean(solicitud.ocCommercialMetadataUploadId || solicitud.ocFiscalMetadataUploadId, 128);
  if (!activeOcUploadId || commercialUploadId !== activeOcUploadId) {
    throw new HttpsError("failed-precondition", "La OC activa debe reprocesarse antes de generar la cotizacion.");
  }
  const items = Array.isArray(solicitud.ocCommercialItems) ? solicitud.ocCommercialItems as OcItem[] : Array.isArray(solicitud.ocItems) ? solicitud.ocItems as OcItem[] : [];
  if (!items.length || items.some(item =>
    !clean(item.description, 1000) ||
    !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0
  )) {
    throw new HttpsError("failed-precondition", "La OC no contiene conceptos comerciales completos. Corrige la OC antes de generar la cotizacion.");
  }
  const total = money(solicitud.total || solicitud.monto || solicitud.amount);
  if (total <= 0) throw new HttpsError("failed-precondition", "La solicitud no tiene un importe total valido para la cotizacion.");
  if (solicitud.ocCommercialMetadataUploadId && Math.abs(money(solicitud.ocCommercialTotal) - total) > 0.01)
    throw new HttpsError("failed-precondition", "El total comercial de la OC no coincide con la Solicitud.");
  return {
    items: items.map(item => ({
      description: clean(item.description, 1000),
      unit: clean(item.unit, 60),
      productCode: /^\d{8}$/.test(clean(item.productCode, 16)) ? clean(item.productCode, 16) : "",
      quantity: Number(item.quantity),
    })),
    total,
  };
}

/** Half-up cents as Excel shows them: 6163.675 is 6163.68, not the binary 6163.67. */
function roundCents(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(Number((n * 100).toPrecision(12))) / 100 : NaN;
}

type PricedQuoteLines = {
  items: Array<{ quantity: number; unit: string; productCode: string; description: string; unitPrice: number; amount: number }>;
  subtotal: number; iva: number;
};

/**
 * A quote mirrors the OC line by line. Every line needs its amount, and the
 * lines must add up to the OC subtotal; otherwise the quote stays pending
 * instead of showing a price the OC never stated.
 */
export function requirePricedQuoteLines(
  oc: { items?: Array<{ quantity?: unknown; unit?: unknown; productCode?: unknown; description?: unknown; unitPrice?: unknown; amount?: unknown }>; subtotal?: unknown; iva?: unknown } | null,
  total: number,
): PricedQuoteLines {
  const lines = Array.isArray(oc?.items) ? oc!.items : [];
  if (!lines.length) throw new HttpsError("failed-precondition", "No se pudieron leer las partidas de la OC activa.");
  const items = lines.map(item => ({
    quantity: Number(item.quantity),
    unit: clean(item.unit, 60),
    productCode: /^\d{8}$/.test(clean(item.productCode, 16)) ? clean(item.productCode, 16) : "",
    description: clean(item.description, 1000),
    // A missing price is never a zero price.
    unitPrice: item.unitPrice === null || item.unitPrice === undefined || item.unitPrice === "" ? NaN : Number(item.unitPrice),
    amount: item.amount === null || item.amount === undefined || item.amount === "" ? NaN : roundCents(item.amount),
  }));
  if (items.some(item => !item.description || !(item.quantity > 0) || !Number.isFinite(item.amount) || !Number.isFinite(item.unitPrice) || item.amount < 0))
    throw new HttpsError("failed-precondition", "La OC no trae precio e importe en todas sus partidas; la cotizacion queda pendiente.");
  // Prefer the OC's own subtotal and IVA when they reconcile with the total;
  // otherwise fall back to the IVA-inclusive split used before.
  const ocSubtotal = roundCents(oc?.subtotal), ocIva = roundCents(oc?.iva);
  const ocSplitValid = ocSubtotal > 0 && ocIva >= 0 && Math.abs(ocSubtotal + ocIva - total) <= 0.01 + 1e-9;
  const subtotal = ocSplitValid ? ocSubtotal : roundCents(total / 1.16);
  const iva = ocSplitValid ? ocIva : roundCents(total - subtotal);
  const linesTotal = roundCents(items.reduce((sum, item) => sum + item.amount, 0));
  // Each line may carry its own half-cent rounding; a one-cent gap is accepted.
  if (Math.abs(linesTotal - subtotal) > Math.max(0.01, items.length * 0.005) + 1e-9)
    throw new HttpsError("failed-precondition", `Las partidas de la OC suman ${formatMoney(linesTotal)} y no cuadran con el subtotal ${formatMoney(subtotal)}; la cotizacion queda pendiente.`);
  return { items, subtotal, iva };
}

/** Issuer contact printed on the quote: the company's configured contact, else contacto@<alias>.mx. */
export function quotationIssuerContact(company: any): string {
  const configured = clean(company?.quotationContact, 120);
  if (configured) return configured;
  const alias = clean(company?.depositAlias, 80).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return alias ? `contacto@${alias}.mx` : "";
}

function activeDepositAccount(company: any): { bankName: string; accountNumber: string; clabe: string } {
  const accounts = Array.isArray(company?.depositAccounts) ? company.depositAccounts : [];
  const active = accounts.find((row: any) => String(row?.status || "ACTIVA").toUpperCase() === "ACTIVA" && /^\d{18}$/.test(String(row?.clabe || "").replace(/\D/g, "")));
  const legacyClabe = Array.isArray(company?.depositClabes)
    ? company.depositClabes.map((value: unknown) => String(value || "").replace(/\D/g, "")).find((value: string) => /^\d{18}$/.test(value))
    : "";
  const clabe = String(active?.clabe || legacyClabe || "").replace(/\D/g, "");
  const bankCode = clabe.slice(0, 3);
  const knownBanks: Record<string, string> = { "012": "BBVA MEXICO", "147": "BANKAOOL", "659": "ASP INTEGRA OPC" };
  return {
    bankName: clean(active?.bankName || company?.depositBankName || company?.bankName || knownBanks[bankCode] || "", 120),
    accountNumber: clean(active?.accountNumber || company?.depositAccountNumber || company?.accountNumber || "", 30),
    clabe,
  };
}

export async function generateCotizacionForSolicitudCore(request: {
  auth?: any;
  data: { solicitudId?: unknown; replaceExisting?: unknown };
  /** Server-only capability. It is deliberately outside callable data. */
  internalAutomation?: { rootId: string; originUid: string; quotationJobId: string; quoteOnly?: boolean };
}) {
    const internalAutomation = request.internalAutomation;
    const uid = internalAutomation ? clean(internalAutomation.originUid, 128) : requireAuth(request);
    if (!uid) throw new HttpsError("failed-precondition", "La automatizacion no conserva usuario origen.");
    const user = await getMyUser(uid);
    if (!internalAutomation) {
      assertAuthorized(request.auth, user, {
        allowedRoles: ["superadmin", "admin", "operador"],
        requiredModule: "solicitudes",
        requiredAction: "uploadDocs",
      });
    }

    const rootId = internalAutomation ? clean(internalAutomation.rootId, 128) : clean(user?.rootId || uid, 128);
    if (internalAutomation && clean(user?.rootId || uid, 128) !== rootId) {
      throw new HttpsError("permission-denied", "El usuario origen no pertenece al expediente de la automatizacion.");
    }
    const solicitudId = clean(request.data?.solicitudId, 128);
    if (!solicitudId) throw new HttpsError("invalid-argument", "solicitudId requerido.");

    const solicitudRef = db.collection("solicitudes").doc(solicitudId);
    const solicitudSnap = await solicitudRef.get();
    if (!solicitudSnap.exists) throw new HttpsError("not-found", "Solicitud no existe.");
    const solicitud: any = solicitudSnap.data() || {};
    const commercialUploadId = clean(solicitud.ocCommercialMetadataUploadId || solicitud.ocFiscalMetadataUploadId, 128);
    if (isTerminalSolicitud(solicitud)) throw new HttpsError("failed-precondition", "Solicitud terminal.");
    if (!clean(solicitud.iqFolio || solicitud.iqId, 128)) throw new HttpsError("failed-precondition", "Se requiere folio IQ confirmado antes de generar cotizacion.");
    if (clean(solicitud.rootId, 128) !== rootId) {
      throw new HttpsError("permission-denied", "La solicitud no pertenece a tu expediente.");
    }

    const clientId = clean(solicitud.clienteId || solicitud.clientId, 128);
    if (!clientId) throw new HttpsError("failed-precondition", "La solicitud no tiene cliente valido.");
    if (!internalAutomation) {
      await requireClientOperationalAccess({ uid, role: role(user) as "superadmin" | "admin" | "operador", rootId, clientId, permission: "operateSolicitudes" });
    }

    const replaceExisting = request.data?.replaceExisting === true;
    const existing = await db.collection("uploads")
      .where("rootId", "==", rootId)
      .where("solicitudId", "==", solicitudId)
      .where("documentType", "==", "COTIZACION")
      .where("active", "==", true)
      .limit(1)
      .get();
    if (internalAutomation && !existing.empty) {
      const doc = existing.docs[0];
      const row: any = doc.data() || {};
      if (clean(row.quotationJobId, 128) === clean(internalAutomation.quotationJobId, 128)) {
        return { ok: true, alreadyExists: true, uploadId: doc.id, active: true, ...row };
      }
      if (!row.quotationJobId) throw new HttpsError("failed-precondition", "Existe una cotizacion activa sin origen verificable; requiere conciliacion humana.");
    }
    if (internalAutomation && existing.empty) {
      const prior = await db.collection("uploads")
        .where("rootId", "==", rootId)
        .where("solicitudId", "==", solicitudId)
        .where("documentType", "==", "COTIZACION")
        .limit(50).get();
      if (prior.docs.some(doc => {
        const row: any = doc.data() || {};
        return clean(row.quotationJobId, 128) === clean(internalAutomation.quotationJobId, 128) && row.status !== "READY";
      })) throw new HttpsError("failed-precondition", "Existe una cotizacion previa sin finalizacion confirmada; requiere conciliacion.");
    }
    if (!replaceExisting && !existing.empty) {
      const doc = existing.docs[0];
      return { ok: true, alreadyExists: true, uploadId: doc.id, ...(doc.data() || {}) };
    }

    const companyId = clean(solicitud.companyId || solicitud.empresaId, 128);
    const [companySnap, clientSnap] = await Promise.all([
      companyId ? db.collection("companies").doc(companyId).get() : Promise.resolve(null),
      clientId ? db.collection("clients").doc(clientId).get() : Promise.resolve(null),
    ]);
    const company: any = companySnap?.exists ? companySnap.data() || {} : {};
    const client: any = clientSnap?.exists ? clientSnap.data() || {} : {};
    if (company.rootId !== rootId || (clientSnap?.exists && client.rootId !== rootId))
      throw new HttpsError("permission-denied", "La empresa o el cliente no pertenecen al expediente.");
    const ocClientRfc = normalizeRfc(solicitud.ocClientRfc);
    const registeredClientRfc = normalizeRfc(client.rfc || client.fiscalProfile?.rfc);
    if (ocClientRfc && registeredClientRfc && ocClientRfc !== registeredClientRfc)
      throw new HttpsError("failed-precondition", "El RFC del cliente en la OC no coincide con el expediente.");
    const companyRfc = normalizeRfc(company.rfc || solicitud.companyRfc || solicitud.empresaRfc);
    const deposit = activeDepositAccount(company);

    if (!companySnap?.exists || !companyRfc) {
      throw new HttpsError("failed-precondition", "La empresa de la solicitud no tiene RFC o catalogo empresarial valido.");
    }

    const activeOc = await db.collection("uploads")
      .where("rootId", "==", rootId)
      .where("solicitudId", "==", solicitudId)
      .where("documentType", "==", "ORDEN_COMPRA")
      .where("active", "==", true)
      .limit(1)
      .get();
    if (activeOc.empty) throw new HttpsError("failed-precondition", "Se requiere una Orden de Compra activa para generar la cotizacion.");
    const quotationSource = requireQuotationSource(solicitud, activeOc.docs[0].id);

    const companyName = clean(company.nombre || company.razonSocial || solicitud.empresaNombre || solicitud.companyName, 180);
    const companySlug = canonicalSlug(companyName || companyRfc);
    const canonicalTemplate = canonicalQuotationTemplateByRfc(companyRfc);
    const canonicalBundle = await resolveCorporateDocumentBundle(rootId, companyId, companyRfc, "COTIZACION");

    const templateSnapshot = {
      documentType: "COTIZACION",
      referencePdf: canonicalTemplate?.referencePdf || `COTIZACION_CANONICA_${companySlug.replace(/-/g, "_").toUpperCase()}_v1.0.pdf`,
      ...canonicalBundle.snapshot,
    };

    const folio = `COT-${clean(solicitud.folio || solicitudId, 80)}`;
    // Solicitudes conservan monto como total operativo. A quote must never
    // treat that total as a subtotal and charge IVA twice.
    const total = quotationSource.total;
    // Stored OC metadata predates line pricing, so the priced lines, date and
    // number are read from the active OC file itself.
    const ocLines = await readOcQuotationLines(clean(activeOc.docs[0].get("storagePath"), 1000));
    const { items: quoteItems, subtotal, iva } = requirePricedQuoteLines(ocLines, total);
    const description = clean(quoteItems[0]?.description, 240);
    // The quote shows the OC date; the real generation time stays in
    // generatedAt and createdAt on the upload record.
    const documentDate = ocLines?.date || "";
    const ocNumber = clean(ocLines?.number, 30);

    // This opaque token is intentionally the only credential in the QR.  It
    // verifies one sealed quotation publicly and never grants access to PAY0.
    const publicVerificationToken = randomBytes(24).toString("base64url");
    const verificationUrl = `https://pay-0-system.web.app/verificar/cotizacion/${publicVerificationToken}`;
    const pdf = await renderCanonicalQuotePdf({
      folio,
      canonicalBundle,
      companyName,
      companyRfc,
      // An active OC is the immediate commercial instruction. Prefer its
      // extracted client data so the document never says "Conforme a CSF" or
      // substitutes a generic service when the source has those values.
      clientName: clean(solicitud.ocClientName || solicitud.clienteNombre || solicitud.clientName || client.razonSocial || client.nombre || client.name || "Cliente", 180),
      clientRfc: normalizeRfc(solicitud.ocClientRfc || solicitud.clienteRfc || solicitud.clientRfc || client.rfc || client.fiscalProfile?.rfc) || "PENDIENTE",
      clientAddress: clean(solicitud.ocClientAddress || client.fiscalProfile?.address || client.domicilioFiscal || client.address || "", 300),
      deliveryLocation: clean(solicitud.ocDeliveryLocation || solicitud.lugarEntrega || "", 240),
      bankName: deposit.bankName,
      bankAccount: deposit.accountNumber,
      bankClabe: deposit.clabe,
      reference: clean(ocNumber || solicitud.ordenCompraFolio || solicitud.ocReferencia || solicitud.folio || solicitudId, 180),
      documentDate,
      issuerContact: quotationIssuerContact(company),
      description,
      productCode: clean(solicitud.satProductCode || solicitud.productCode || solicitud.claveSat || "", 16),
      unit: clean(solicitud.satUnitCode || solicitud.unit || solicitud.unidad || "SERVICIO", 60),
      quantity: Number(solicitud.ocQuantity || solicitud.quantity || solicitud.cantidad || 1),
      unitPrice: subtotal,
      subtotal,
      iva,
      total,
      solicitudId,
      referencePdf: templateSnapshot.referencePdf,
      verificationUrl,
      items: quoteItems,
    });
    const documentSha256 = sha256(pdf);
    const uploadId = db.collection("uploads").doc().id;
    const filename = `${folio}.pdf`.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160);
    const storagePath = `roots/${rootId}/solicitudes/${solicitudId}/docs/COTIZACION/${uploadId}-${filename}`;

    await admin.storage().bucket().file(storagePath).save(pdf, {
      contentType: "application/pdf",
      resumable: false,
      metadata: {
        metadata: {
          uploadid: uploadId,
          sha256: documentSha256,
          integrityHashAlgorithm: "SHA-256",
          integritySealVersion: "PAY0-MATERIALIDAD-V1",
          templateId: templateSnapshot.templateId,
          templateVersion: templateSnapshot.templateVersion,
        },
      },
    });

    const uploadRef = db.collection("uploads").doc(uploadId);
    await db.runTransaction(async (tx) => {
      const currentSource = await tx.get(solicitudRef);
      if (!currentSource.exists || isTerminalSolicitud(currentSource.data() || {})) throw new HttpsError("failed-precondition", "Solicitud terminal.");
      if (internalAutomation && (clean(currentSource.get("iqFolio") || currentSource.get("iqId"), 128) !== clean(solicitud.iqFolio || solicitud.iqId, 128) || clean(currentSource.get("ocCommercialMetadataUploadId") || currentSource.get("ocFiscalMetadataUploadId"), 128) !== commercialUploadId)) throw new HttpsError("failed-precondition", "IQ u OC cambiaron durante la generacion; requiere conciliacion.");
      tx.set(uploadRef, {
        rootId,
        adminId: solicitud.adminId || rootId,
        clienteId: solicitud.clienteId || solicitud.clientId || null,
        clienteNombre: solicitud.clienteNombre || solicitud.clientName || null,
        companyId: solicitud.companyId || null,
        empresaNombre: solicitud.empresaNombre || solicitud.companyName || companyName,
        entityType: "solicitudes",
        entityId: solicitudId,
        solicitudId,
        solicitudFolio: solicitud.folio || null,
        documentType: "COTIZACION",
        documentTypeLabel: "Cotizacion",
        originalName: filename,
        filename,
        contentType: "application/pdf",
        sizeBytes: pdf.length,
        storagePath,
        sha256: documentSha256,
        integrityHashAlgorithm: "SHA-256",
        integritySealStatus: "HASH_SERVER_GENERATED",
        integritySealVersion: "PAY0-MATERIALIDAD-V1",
        generatedBySystem: true,
        generatedByModule: "cotizaciones",
        quotationJobId: internalAutomation?.quotationJobId || null,
        quotationTemplate: templateSnapshot,
        quotationSnapshot: {
          folio,
          subtotal,
          iva,
          total,
          description,
          documentSha256,
          documentDate: documentDate || null,
          documentDateSource: documentDate ? "ORDEN_COMPRA" : "GENERACION",
          ocNumber: ocNumber || null,
          lineCount: quoteItems.length,
        },
        generatedAt: FieldValue.serverTimestamp(),
        publicVerificationToken,
        publicVerificationUrl: verificationUrl,
        status: "PENDING",
        active: false,
        version: null,
        createdBy: uid,
        createdUsername: username(user, uid),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    let finalVersion = 1;
    await db.runTransaction(async (tx) => {
      const currentSource = await tx.get(solicitudRef);
      if (!currentSource.exists || isTerminalSolicitud(currentSource.data() || {})) throw new HttpsError("failed-precondition", "Solicitud terminal.");
      if (internalAutomation && (clean(currentSource.get("iqFolio") || currentSource.get("iqId"), 128) !== clean(solicitud.iqFolio || solicitud.iqId, 128) || clean(currentSource.get("ocCommercialMetadataUploadId") || currentSource.get("ocFiscalMetadataUploadId"), 128) !== commercialUploadId)) throw new HttpsError("failed-precondition", "IQ u OC cambiaron durante la generacion; requiere conciliacion.");
      finalVersion = await finalizeSolicitudDocumentVersionTx({
        tx,
        db,
        rootId,
        solicitudId,
        documentType: "COTIZACION",
        uploadId,
        uploadRef,
        mode: "update",
        readyPatch: {
          finalizedBy: uid,
          finalizedUsername: username(user, uid),
          finalizedAt: FieldValue.serverTimestamp(),
          integritySealStatus: "SEALED",
          integritySealedAt: FieldValue.serverTimestamp(),
          integritySealedBy: uid,
          integritySealedUsername: username(user, uid),
        },
      });

      tx.set(solicitudRef, {
        cotizacionAutoGenerateStatus: "READY",
        cotizacionAutoGenerateStage: "COMPLETED",
        cotizacionAutoGenerateLastError: FieldValue.delete(),
        cotizacionAutoGenerateErrorCode: FieldValue.delete(),
        cotizacionAutoGenerateUpdatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      logActivityTx(tx, db, {
        event: "COTIZACION_GENERADA",
        rootId,
        adminId: solicitud.adminId || rootId,
        actorUid: uid,
        actorUsername: username(user, uid),
        actorRole: internalAutomation ? "system" : role(user),
        entityType: "solicitudes",
        entityId: solicitudId,
        referenceId: solicitudId,
        referenceFolio: solicitud.folio || solicitudId,
        referenceType: "solicitudDocument",
        amount: total,
        description: `Cotizacion generada automaticamente para solicitud ${solicitud.folio || solicitudId}.`,
        createdBy: uid,
        extra: {
          source: "cotizaciones",
          documentType: "COTIZACION",
          documentTypeLabel: "Cotizacion",
          uploadId,
          storagePath,
          templateId: templateSnapshot.templateId,
          templateVersion: templateSnapshot.templateVersion,
          documentSha256,
          companyId: solicitud.companyId || null,
          clienteId: solicitud.clienteId || solicitud.clientId || null,
          automaticExecution: Boolean(internalAutomation),
          quotationJobId: internalAutomation?.quotationJobId || null,
        },
      });
    });

    if (!internalAutomation?.quoteOnly) {
      await linkSolicitudToMaterialityOperationCore({
        auth: request.auth,
        data: { solicitudId },
      }).catch(async (error) => {
        await solicitudRef.set({
          materialitySyncStatus: "ERROR",
          materialitySyncLastError: String(error?.message || error || "No se pudo actualizar Materialidad."),
          materialitySyncUpdatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });
    }

    await logActivity({
      event: "DOCUMENTO_SOLICITUD_SUBIDO",
      rootId,
      adminId: solicitud.adminId || rootId,
      actorUid: uid,
      actorUsername: username(user, uid),
      actorRole: role(user),
      entityType: "solicitudes",
      entityId: solicitudId,
      referenceId: solicitudId,
      referenceFolio: solicitud.folio || solicitudId,
      referenceType: "solicitudDocument",
      description: `Documento Cotizacion generado y registrado en solicitud ${solicitud.folio || solicitudId}.`,
      createdBy: uid,
      extra: {
        source: "cotizaciones",
        documentType: "COTIZACION",
        documentTypeLabel: "Cotizacion",
        uploadId,
        templateId: templateSnapshot.templateId,
        documentSha256,
      },
    });

    return {
      ok: true,
      uploadId,
      storagePath,
      status: "READY",
      active: true,
      version: finalVersion,
      sizeBytes: pdf.length,
      sha256: documentSha256,
      templateId: templateSnapshot.templateId,
    };
}

export const generateSolicitudQuotation = onCall(
  { cors: true, timeoutSeconds: 120, memory: "1GiB", maxInstances: 20 },
  async (request) => generateCotizacionForSolicitudCore(request),
);

/** Public, token-scoped verification used exclusively by the QR in a quote. */
export const getPublicQuotationVerification = onCall(
  { cors: true, invoker: "public", timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    const token = clean(request.data?.token, 120);
    if (!/^[A-Za-z0-9_-]{24,120}$/.test(token)) return { valid: false };
    const match = await db.collection("uploads")
      .where("publicVerificationToken", "==", token)
      .limit(1)
      .get();
    if (match.empty) return { valid: false };
    const upload: any = match.docs[0].data() || {};
    if (
      upload.documentType !== "COTIZACION" ||
      upload.integritySealStatus !== "SEALED" ||
      upload.active !== true
    ) return { valid: false };
    const quote: any = upload.quotationSnapshot || {};
    return {
      valid: true,
      folio: clean(quote.folio || upload.originalName || "Cotizacion", 120),
      companyName: clean(upload.quotationTemplate?.companyName || upload.empresaNombre, 180),
      clientName: clean(upload.clienteNombre, 180),
      total: money(quote.total),
      createdAt: upload.createdAt?.toDate?.()?.toISOString?.() || null,
      sha256: clean(upload.sha256 || quote.documentSha256, 100),
      active: upload.active === true,
      templateId: clean(upload.quotationTemplate?.templateId, 160),
    };
  },
);
