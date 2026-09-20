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

function canAccessSolicitud(user: any, uid: string, rootId: string, solicitud: any): boolean {
  const r = role(user);
  if (r === "superadmin") return clean(solicitud?.rootId, 128) === rootId || clean(solicitud?.createdBy, 128) === uid;
  if (r === "admin") return clean(solicitud?.rootId, 128) === rootId && clean(solicitud?.adminId, 128) === uid;
  if (r === "operador") return clean(solicitud?.rootId, 128) === rootId && clean(solicitud?.createdBy, 128) === uid;
  return false;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
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
}) {
    const uid = requireAuth(request);
    const user = await getMyUser(uid);
    assertAuthorized(request.auth, user, {
      allowedRoles: ["superadmin", "admin", "operador"],
      requiredModule: "solicitudes",
      requiredAction: "uploadDocs",
    });

    const rootId = clean(user?.rootId || uid, 128);
    const solicitudId = clean(request.data?.solicitudId, 128);
    if (!solicitudId) throw new HttpsError("invalid-argument", "solicitudId requerido.");

    const solicitudRef = db.collection("solicitudes").doc(solicitudId);
    const solicitudSnap = await solicitudRef.get();
    if (!solicitudSnap.exists) throw new HttpsError("not-found", "Solicitud no existe.");
    const solicitud: any = solicitudSnap.data() || {};
    if (!canAccessSolicitud(user, uid, rootId, solicitud)) throw new HttpsError("permission-denied", "No autorizado.");

    const replaceExisting = request.data?.replaceExisting === true;
    const existing = await db.collection("uploads")
      .where("solicitudId", "==", solicitudId)
      .where("documentType", "==", "COTIZACION")
      .where("active", "==", true)
      .limit(1)
      .get();
    if (!replaceExisting && !existing.empty) {
      const doc = existing.docs[0];
      return { ok: true, alreadyExists: true, uploadId: doc.id, ...(doc.data() || {}) };
    }

    const companyId = clean(solicitud.companyId || solicitud.empresaId, 128);
    const clientId = clean(solicitud.clienteId || solicitud.clientId, 128);
    const [companySnap, clientSnap] = await Promise.all([
      companyId ? db.collection("companies").doc(companyId).get() : Promise.resolve(null),
      clientId ? db.collection("clients").doc(clientId).get() : Promise.resolve(null),
    ]);
    const company: any = companySnap?.exists ? companySnap.data() || {} : {};
    const client: any = clientSnap?.exists ? clientSnap.data() || {} : {};
    const companyRfc = normalizeRfc(company.rfc || solicitud.companyRfc || solicitud.empresaRfc);
    const deposit = activeDepositAccount(company);

    if (!companySnap?.exists || !companyRfc) {
      throw new HttpsError("failed-precondition", "La empresa de la solicitud no tiene RFC o catalogo empresarial valido.");
    }

    const companyName = clean(company.nombre || company.razonSocial || solicitud.empresaNombre || solicitud.companyName, 180);
    const companySlug = canonicalSlug(companyName || companyRfc);
    const canonicalTemplate = canonicalQuotationTemplateByRfc(companyRfc);

    const templateSnapshot = {
      documentType: "COTIZACION",
      templateId: canonicalTemplate?.templateId || `${companySlug}-cotizacion-v1.0`,
      templateVersion: canonicalTemplate?.version || "1.0",
      companyId: canonicalTemplate?.companyId || companyId || companySlug,
      companyName: canonicalTemplate?.companyName || companyName,
      companyRfc,
      referencePdf: canonicalTemplate?.referencePdf || `COTIZACION_CANONICA_${companySlug.replace(/-/g, "_").toUpperCase()}_v1.0.pdf`,
      referencePdfSha256: canonicalTemplate?.referencePdfSha256 || null,
      templateEngine: "PAY0_CANONICAL_HTML_CSS_PRINT_V1",
    };

    const folio = `COT-${clean(solicitud.folio || solicitudId, 80)}`;
    // Solicitudes conservan monto como total operativo. A quote must never
    // treat that total as a subtotal and charge IVA twice.
    const total = money(solicitud.total || solicitud.monto || solicitud.amount);
    const subtotal = Math.round((total / 1.16) * 100) / 100;
    const iva = Math.round((total - subtotal) * 100) / 100;
    const description = clean(
      solicitud.ocConceptDescription || solicitud.ordenCompraConcepto || solicitud.concepto || solicitud.descripcion || solicitud.operationTypeName || "Servicio operativo segun Orden de Compra",
      240,
    );

    // This opaque token is intentionally the only credential in the QR.  It
    // verifies one sealed quotation publicly and never grants access to PAY0.
    const publicVerificationToken = randomBytes(24).toString("base64url");
    const verificationUrl = `https://pay-0-system.web.app/verificar/cotizacion/${publicVerificationToken}`;
    const pdf = await renderCanonicalQuotePdf({
      folio,
      companyName,
      companyRfc,
      // An active OC is the immediate commercial instruction. Prefer its
      // extracted client data so the document never says "Conforme a CSF" or
      // substitutes a generic service when the source has those values.
      clientName: clean(solicitud.ocClientName || solicitud.clienteNombre || solicitud.clientName || client.nombre || client.name || "Cliente", 180),
      clientRfc: normalizeRfc(solicitud.ocClientRfc || solicitud.clienteRfc || solicitud.clientRfc || client.rfc || client.fiscalProfile?.rfc) || "PENDIENTE",
      clientAddress: clean(solicitud.ocClientAddress || client.fiscalProfile?.address || client.domicilioFiscal || client.address || "", 300),
      deliveryLocation: clean(solicitud.ocDeliveryLocation || solicitud.lugarEntrega || "", 240),
      bankName: deposit.bankName,
      bankAccount: deposit.accountNumber,
      bankClabe: deposit.clabe,
      reference: clean(solicitud.ordenCompraFolio || solicitud.ocReferencia || solicitud.folio || solicitudId, 180),
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
      items: Array.isArray(solicitud.ocItems) ? solicitud.ocItems : [],
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
    await uploadRef.set({
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
      quotationTemplate: templateSnapshot,
      quotationSnapshot: {
        folio,
        subtotal,
        iva,
        total,
        description,
        documentSha256,
      },
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

    let finalVersion = 1;
    await db.runTransaction(async (tx) => {
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

      logActivityTx(tx, db, {
        event: "COTIZACION_GENERADA",
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
        },
      });
    });

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
  { cors: true, timeoutSeconds: 120, memory: "1GiB" },
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
    if (upload.documentType !== "COTIZACION" || upload.integritySealStatus !== "SEALED") return { valid: false };
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
