"use client";

import { formatDateTime24 } from "@/lib/dateTime";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot, query, where,
  getDocs} from "firebase/firestore";
import { ref, getDownloadURL } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { prepareDocumentDeliveryJob } from "@/services/documentDelivery";
import {
  releaseWhatsAppJobDeliveries,
  retryWhatsAppJobErrors,
} from "@/services/whatsappQr";
import { ChevronDown, Download, UploadCloud, X } from "lucide-react";
import { db, functions, storage } from "@/lib/firebaseClient";
import { CALLABLES } from "@/lib/callableNames";
type RelatedPagoReceipt = {
  id: string;
  pagoId: string;
  pagoFolio?: string | null;
  originalName?: string | null;
  filename?: string | null;
  fileName?: string | null;
  storagePath?: string | null;
  documentType?: string | null;
  status?: string | null;
  active?: boolean;
};

// IQ2G_H4_D41_UI_RELATED_PAGO_RECEIPTS_TYPES
function chunkForInQuery<T>(items: T[], size = 10): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function getRelatedReceiptName(row: RelatedPagoReceipt) {
  return row.originalName || row.filename || row.fileName || row.storagePath?.split("/").pop() || "Comprobante de pago";
}

import { forceDownloadFromUrl } from "@/lib/downloadFile";
import {
  SOLICITUD_DOCUMENT_TYPES,
  SolicitudDocumentType,
  uploadSolicitudDoc,
} from "@/lib/uploadSolicitudDoc";
import {
  createSolicitudIq,
  reconcileSolicitudIq,
  syncIqSolicitudStatus,
  syncIqSolicitudInvoice,
} from "@/services/iq";
import { useGlobalLoading } from "@/components/GlobalLoading";
import { useUserProfile } from "@/lib/useUserProfile";
import { normalizeRole } from "@/lib/roles";
import { createSolicitudSignatureLink, generateSolicitudQuotation } from "@/services/signatureLinks";

type UploadRow = {
  id: string;
  documentType?: string | null;
  documentTypeLabel?: string | null;
  filename?: string | null;
  originalName?: string | null;
  status?: string | null;
  active?: boolean | null;
  version?: number | null;
  createdAt?: any;
  finalizedAt?: any;
  storagePath?: string | null;
};

function formatDate(value: any) {
  return formatDateTime24(value, "---");
}

function getTypeLabel(type: string) {
  return SOLICITUD_DOCUMENT_TYPES.find((x) => x.value === type)?.label || type || "Otro";
}

function getAccept(type: SolicitudDocumentType) {
  return SOLICITUD_DOCUMENT_TYPES.find((x) => x.value === type)?.accept || "*/*";
}

function getSelectedLabel(type: SolicitudDocumentType) {
  return SOLICITUD_DOCUMENT_TYPES.find((x) => x.value === type)?.label || "Otro";
}

// H4_D87_A57_A70_SOLICITUD_FRONTEND_DIRECT_CREATE_NO_PREVALIDATE_PREPARE
export default function DocsModal(props: {
  open: boolean;
  onClose: () => void;
  solicitud: any | null;
}) {
  const { open, onClose, solicitud } = props;
  const { profile } = useUserProfile();
  const globalLoading = useGlobalLoading();
  const isIqPreparationSuperAdmin =
    normalizeRole((profile as any)?.role) === "superadmin";
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [documentType, setDocumentType] = useState<SolicitudDocumentType>("FACTURA_PDF");
  const [otherLabel, setOtherLabel] = useState("");
  const [docs, setDocs] = useState<UploadRow[]>([]);
  const [relatedPagoReceipts, setRelatedPagoReceipts] = useState<RelatedPagoReceipt[]>([]);
  const [loadingRelatedPagoReceipts, setLoadingRelatedPagoReceipts] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deliveryPreparing, setDeliveryPreparing] = useState(false);
  const [whatsappResendWarning, setWhatsappResendWarning] = useState<{
    previousJobId: string;
    message: string;
  } | null>(null);
  const [iqPreparing, setIqPreparing] = useState(false);
  const [iqPreparationMessage, setIqPreparationMessage] = useState("");
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [signatureSaving, setSignatureSaving] = useState(false);
  const [signatureMessage, setSignatureMessage] = useState("");
  const [signatureLinkCreating, setSignatureLinkCreating] = useState(false);
  const [signatureLink, setSignatureLink] = useState("");
  const [quotationGenerating, setQuotationGenerating] = useState(false);
  const [ocReprocessing, setOcReprocessing] = useState(false);
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const signatureDrawingRef = useRef(false);
  const signatureHasInkRef = useRef(false);

  const solicitudId = solicitud?.id;

  async function handleGenerateQuotation() {
    if (!solicitudId || quotationGenerating) return;
    setQuotationGenerating(true);
    setSignatureMessage("");
    try {
      const result = await generateSolicitudQuotation(solicitudId, true);
      setSignatureMessage(result.alreadyExists ? "La cotizacion ya estaba generada." : "Cotizacion regenerada y agregada a Docs.");
    } catch (error: any) {
      setSignatureMessage(error?.message || "No se pudo generar la cotizacion.");
    } finally {
      setQuotationGenerating(false);
    }
  }

  async function handleReprocessActiveOc() {
    if (!solicitudId || ocReprocessing) return;
    setOcReprocessing(true);
    setSignatureMessage("");
    try {
      await httpsCallable<{ solicitudId: string }, any>(functions, CALLABLES.reprocessActiveSolicitudOc)({ solicitudId });
      setSignatureMessage("OC activa reprocesada. Facturacion y cotizacion se actualizaron desde sus datos.");
    } catch (error: any) {
      setSignatureMessage(error?.message || "No se pudo reprocesar la OC activa.");
    } finally {
      setOcReprocessing(false);
    }
  }

  const title = useMemo(() => {
    if (!solicitud) return "Documentos";
    return `Docs - ${solicitud.folio || solicitud.id}`;
  }, [solicitud]);

  
  useEffect(() => {
    // IQ2G_H4_D41_UI_LOAD_RELATED_PAGO_RECEIPTS
    let cancelled = false;

    async function loadRelatedPagoReceipts() {
      const sid = String(solicitudId || "").trim();

      if (!sid) {
        setRelatedPagoReceipts([]);
        setLoadingRelatedPagoReceipts(false);
        return;
      }

      setLoadingRelatedPagoReceipts(true);

      try {
        const aplicacionesSnap = await getDocs(
          query(collection(db, "pagoAplicaciones"), where("solicitudId", "==", sid))
        );

        const pagoIds = Array.from(new Set(
          aplicacionesSnap.docs
            .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
            .filter((row: any) => !String(row.status || "").trim() || String(row.status || "").toUpperCase() === "APLICADA")
            .map((row: any) => String(row.pagoId || "").trim())
            .filter(Boolean)
        ));

        if (pagoIds.length === 0) {
          if (!cancelled) setRelatedPagoReceipts([]);
          return;
        }

        const rows: RelatedPagoReceipt[] = [];

        for (const chunk of chunkForInQuery(pagoIds, 10)) {
          const uploadsSnap = await getDocs(
            query(collection(db, "uploads"), where("pagoId", "in", chunk))
          );

          uploadsSnap.docs.forEach((doc) => {
            const row = { id: doc.id, ...(doc.data() as any) } as RelatedPagoReceipt;

            if (String((row as any).entityType || "") !== "pagos") return;
            if (String(row.documentType || "").toUpperCase() !== "COMPROBANTE_PAGO") return;
            if (row.active !== true) return;

            const status = String(row.status || "READY").toUpperCase();
            if (status === "INACTIVE" || status === "REPLACED") return;
            if (!row.storagePath) return;

            rows.push(row);
          });
        }

        rows.sort((a: any, b: any) => {
          const av = Number(a?.version || 0);
          const bv = Number(b?.version || 0);
          return bv - av;
        });

        if (!cancelled) {
          setRelatedPagoReceipts(rows);
        }
      } catch {
        if (!cancelled) {
          setRelatedPagoReceipts([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingRelatedPagoReceipts(false);
        }
      }
    }

    loadRelatedPagoReceipts();

    return () => {
      cancelled = true;
    };
  }, [solicitudId]);
useEffect(() => {
    if (!open || !solicitudId) {
      setDocs([]);
      return;
    }

    const qDocs = query(
      collection(db, "uploads"),
      where("solicitudId", "==", solicitudId)
    );

    return onSnapshot(
      qDocs,
      (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }))
          .filter((x: any) => String(x.entityType || "") === "solicitudes")
          .sort((a: any, b: any) => {
            const at = Number(a.finalizedAt?.seconds || a.createdAt?.seconds || 0);
            const bt = Number(b.finalizedAt?.seconds || b.createdAt?.seconds || 0);
            return bt - at;
          }) as UploadRow[];

        setDocs(rows);
      },
      () => setDocs([])
    );
  }, [open, solicitudId]);

  useEffect(() => {
    if (!open) {
      setDropdownOpen(false);
      setOtherLabel("");
      setPct(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      setIqPreparationMessage("");
      setIqPreparing(false);
      setSignatureOpen(false);
      setSignatureSaving(false);
      setSignatureMessage("");
      setSignatureLink("");
      return;
    }

    setIqPreparationMessage("");
    setSignatureMessage("");
    setSignatureLink("");
  }, [open, solicitudId]);

  useEffect(() => {
    if (!signatureOpen) return;

    const canvas = signatureCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    signatureHasInkRef.current = false;
  }, [signatureOpen]);

  // H4_D87_A58_A29_R1_UNIFIED_MANUAL_SOLICITUD_IQ
  // Un solo boton manual; reutiliza las etapas backend existentes.
  async function handleSyncIq() {
    if (!isIqPreparationSuperAdmin || !solicitudId || iqPreparing) return;

    const initialIqFolio = String(
      solicitud?.iqFolio ??
        solicitud?.iqId ??
        solicitud?.solicitudIqFolio ??
        solicitud?.folioIq ??
        "",
    ).trim();

    if (!initialIqFolio) {
      const confirmed = window.confirm(
        "Esta solicitud aun no tiene Folio IQ. Sincronizar IQ intentara crearla y despues continuara automaticamente con el seguimiento. Deseas continuar?",
      );

      if (!confirmed) return;
    }

    setIqPreparing(true);
    setIqPreparationMessage("");

    try {
      await globalLoading.run(
        {
          label: "SINCRONIZANDO IQ...",
          helper:
            "PAY0 determinara automaticamente si debe crear, recuperar folio, leer estado/rechazo o importar factura.",
        },
        async () => {
          const messages: string[] = [];
          let iqFolio = initialIqFolio;

          if (!iqFolio) {
            let creation:
              | Awaited<ReturnType<typeof createSolicitudIq>>
              | null = null;

            try {
              creation = await createSolicitudIq(solicitudId);
            } catch (error) {
              const message =
                error instanceof Error
                  ? error.message
                  : "Error desconocido al crear en IQ.";

              if (
                /resultado iq incierto|debe conciliarse|concilia el intento/i.test(
                  message,
                )
              ) {
                const reconciliation = await reconcileSolicitudIq(
                  solicitudId,
                  true,
                );

                if (!reconciliation.data.linked) {
                  setIqPreparationMessage(
                    [
                      "PAY0 intento recuperar el Folio IQ antes de crear otro.",
                      `Resultado: ${reconciliation.data.status}.`,
                      reconciliation.message,
                      "No se genero un folio nuevo para evitar duplicados.",
                    ]
                      .filter(Boolean)
                      .join(" "),
                  );
                  return;
                }

                iqFolio = String(reconciliation.data.iqId || "").trim();
                messages.push(
                  `Folio IQ recuperado: ${iqFolio || "NO IDENTIFICADO"}.`,
                );
              } else {
                throw error;
              }
            }

            if (creation) {
              if (creation.data.created) {
                iqFolio = String(creation.data.iqId || "").trim();
                messages.push(
                  creation.data.reused
                    ? `Folio IQ existente reutilizado: ${iqFolio || "NO IDENTIFICADO"}.`
                    : `Solicitud creada en IQ. Folio IQ: ${iqFolio || "NO IDENTIFICADO"}.`,
                );
              } else if (creation.data.status === "OUTCOME_UNKNOWN") {
                const reconciliation = await reconcileSolicitudIq(
                  solicitudId,
                  true,
                );

                if (!reconciliation.data.linked) {
                  setIqPreparationMessage(
                    [
                      "IQ recibio la operacion, pero PAY0 aun no pudo confirmar el Folio IQ.",
                      `Resultado de recuperacion: ${reconciliation.data.status}.`,
                      reconciliation.message,
                      "No se volvera a crear para evitar duplicados.",
                    ]
                      .filter(Boolean)
                      .join(" "),
                  );
                  return;
                }

                iqFolio = String(reconciliation.data.iqId || "").trim();
                messages.push(
                  `Folio IQ recuperado: ${iqFolio || "NO IDENTIFICADO"}.`,
                );
              } else {
                setIqPreparationMessage(
                  [
                    "IQ no creo la solicitud.",
                    creation.message ||
                      creation.data.errors?.join(" ") ||
                      "Operacion rechazada.",
                    creation.data.retryBlocked
                      ? "El reintento esta bloqueado."
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" "),
                );
                return;
              }
            }
          } else {
            messages.push(`Folio IQ: ${iqFolio}.`);
          }

          if (!iqFolio) {
            setIqPreparationMessage(
              [
                ...messages,
                "PAY0 no tiene un Folio IQ confirmado; no se ejecutara seguimiento ni factura para evitar una asociacion incorrecta.",
              ].join(" "),
            );
            return;
          }

          // Esta etapa consulta IQ y aplica rechazo/comentario mediante
          // el mismo core de processJobGroup usado por el monitor automatico.
          const statusSync = await syncIqSolicitudStatus(solicitudId);
          messages.push(`Estado IQ: ${statusSync.status}.`);

          if (statusSync.status === "REJECTED_BEFORE_STAMPING") {
            messages.push(
              "PAY0 actualizo la solicitud como RECHAZADA y guardo el motivo/comentario informado por IQ.",
            );
            setIqPreparationMessage(messages.join(" "));
            return;
          }

          // Si el monitor detecta factura, la misma accion manual intenta importarla.
          if (statusSync.status === "INVOICE_AVAILABLE") {
            const invoiceSync = await syncIqSolicitudInvoice(
              solicitudId,
              { force: true },
            );

            messages.push(`Factura IQ: ${invoiceSync.status}.`);

            if (
              invoiceSync.status === "IMPORTED" ||
              invoiceSync.status === "IMPORTED_REUSED"
            ) {
              messages.push(
                "Factura PDF/XML importada o ya existente en PAY0.",
              );
            } else {
              messages.push(
                "La factura aun no pudo importarse; el resultado quedo registrado para seguimiento.",
              );
            }
          } else if (statusSync.status === "MONITORING") {
            messages.push(
              "La solicitud sigue en proceso en IQ; no hay factura disponible todavia.",
            );
          } else if (statusSync.status === "NOT_FOUND") {
            messages.push(
              "IQ aun no devolvio una coincidencia util para este folio; el seguimiento quedo registrado.",
            );
          } else if (statusSync.status === "WAITING_FOR_OPERATING_WINDOW") {
            messages.push(
              "La revision quedo pendiente para la ventana operativa IQ.",
            );
          }

          setIqPreparationMessage(messages.join(" "));
        },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Error desconocido.";

      setIqPreparationMessage(
        `No se pudo completar la sincronizacion IQ: ${message}`,
      );
    } finally {
      setIqPreparing(false);
    }
  }

  function getSignaturePoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function beginSignature(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = signatureCanvasRef.current;
    const point = getSignaturePoint(event);
    const ctx = canvas?.getContext("2d");
    if (!canvas || !point || !ctx || signatureSaving) return;

    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    signatureDrawingRef.current = true;
    signatureHasInkRef.current = true;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  }

  function moveSignature(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!signatureDrawingRef.current || signatureSaving) return;

    const point = getSignaturePoint(event);
    const ctx = signatureCanvasRef.current?.getContext("2d");
    if (!point || !ctx) return;

    event.preventDefault();
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }

  function endSignature(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!signatureDrawingRef.current) return;

    event.preventDefault();
    signatureDrawingRef.current = false;
    try {
      signatureCanvasRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      // El pointer puede haberse liberado por el navegador.
    }
  }

  function clearSignature() {
    const canvas = signatureCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || signatureSaving) return;

    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = "#0f172a";
    signatureHasInkRef.current = false;
    setSignatureMessage("");
  }

  async function saveSignature() {
    const canvas = signatureCanvasRef.current;
    if (!canvas || !solicitudId || signatureSaving) return;

    if (!signatureHasInkRef.current) {
      setSignatureMessage("Primero captura la firma en el recuadro.");
      return;
    }

    setSignatureSaving(true);
    setSignatureMessage("");

    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => {
          if (value) resolve(value);
          else reject(new Error("No se pudo preparar la imagen de firma."));
        }, "image/png");
      });

      const folio = String(solicitud?.folio || solicitudId || "solicitud").replace(/[^a-zA-Z0-9._-]/g, "_");
      const file = new File(
        [blob],
        `firma-autorizada-cliente-${folio}-${Date.now()}.png`,
        { type: "image/png" },
      );

      await uploadSolicitudDoc({
        solicitudId: String(solicitudId),
        documentType: "FIRMA_AUTORIZADA_CLIENTE" as SolicitudDocumentType,
        file,
        onProgress: setPct,
      });

      setSignatureMessage("Firma guardada como evidencia autorizada del cliente.");
      setSignatureOpen(false);
    } catch (error: any) {
      setSignatureMessage(error?.message || "No se pudo guardar la firma.");
    } finally {
      setSignatureSaving(false);
      setPct(0);
    }
  }

  async function createSignatureLink() {
    if (!solicitudId || signatureLinkCreating) return;

    setSignatureLinkCreating(true);
    setSignatureMessage("");

    try {
      const result = await createSolicitudSignatureLink(String(solicitudId));
      setSignatureLink(result.url);
      try {
        await navigator.clipboard?.writeText(result.url);
        setSignatureMessage("Link de firma creado y copiado. Puedes enviarlo por WhatsApp al repartidor o cliente.");
      } catch {
        setSignatureMessage("Link de firma creado. Copialo y envialo al repartidor o cliente.");
      }
    } catch (error: any) {
      setSignatureMessage(error?.message || "No se pudo crear el link de firma.");
    } finally {
      setSignatureLinkCreating(false);
    }
  }

  if (!open) return null;

  const selectType = (value: SolicitudDocumentType) => {
    setDocumentType(value);
    setDropdownOpen(false);
    if (value !== "OTRO") setOtherLabel("");
  };

  
  async function downloadRelatedPagoReceipt(row: RelatedPagoReceipt) {
    if (!row.storagePath) return;

    const url = await getDownloadURL(ref(storage, row.storagePath));
    const a = document.createElement("a");
    a.href = url;
    a.download = getRelatedReceiptName(row);
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function sendFacturaWhatsapp(forceResend = false) {
    if (!forceResend) {
      setWhatsappResendWarning(null);
    }
    const facturaDocsForWhatsapp = docs.filter((doc: any) => {
      const documentType = String(doc.documentType || "").toUpperCase();

      return (
        ["FACTURA_PDF", "FACTURA_XML"].includes(documentType) &&
        doc.active === true &&
        !!doc.storagePath
      );
    });

    const hasPdf = facturaDocsForWhatsapp.some(
      (doc: any) =>
        String(doc.documentType || "").toUpperCase() === "FACTURA_PDF"
    );

    const hasXml = facturaDocsForWhatsapp.some(
      (doc: any) =>
        String(doc.documentType || "").toUpperCase() === "FACTURA_XML"
    );

    if (!hasPdf || !hasXml) {
      alert(
        "Se requiere Factura PDF y Factura XML activas para enviar por WhatsApp."
      );
      return;
    }

    setDeliveryPreparing(true);

    try {
      const solicitud = (props as any).solicitud || {};

      const deliveryDocs = facturaDocsForWhatsapp.map((doc: any) => ({
        name: String(
          doc.originalName ||
            doc.filename ||
            doc.fileName ||
            doc.storagePath?.split("/").pop() ||
            doc.documentType ||
            "factura"
        ),
        fileName: String(
          doc.originalName ||
            doc.filename ||
            doc.fileName ||
            doc.storagePath?.split("/").pop() ||
            doc.documentType ||
            "factura"
        ),
        contentType: doc.contentType || null,
        storagePath: doc.storagePath,
        documentType: String(doc.documentType || "").toUpperCase(),
      }));

      const prepared = await prepareDocumentDeliveryJob({
        sourceType: "FACTURA_PDF_XML",
        sourceId: String(
          solicitud.id ||
            solicitud.solicitudId ||
            ""
        ),
        clienteId: String(
          solicitud.clienteId ||
            solicitud.clientId ||
            ""
        ),
        clienteNombre: String(
          solicitud.clienteNombre ||
            solicitud.clientName ||
            ""
        ),
        targetLabel:
          solicitud.clienteNombre || solicitud.clientName
            ? String(
                solicitud.clienteNombre ||
                  solicitud.clientName
              )
            : "WhatsApp cliente",
        documents: deliveryDocs,
        notes: "Envio manual de factura PDF/XML desde Solicitudes.",
        forceResend,
      });

      if (prepared.action === "REQUIRES_CONFIRMATION") {
        setWhatsappResendWarning({
          previousJobId:
            prepared.previousJobId ||
            prepared.jobId,
          message:
            prepared.message ||
            "Esta misma factura PDF/XML ya fue enviada por WhatsApp.",
        });
        return;
      }

      if (prepared.action === "ALREADY_IN_PROGRESS") {
        setWhatsappResendWarning(null);

        const currentStatus = String(
          prepared.status || ""
        )
          .trim()
          .toUpperCase();

        if (currentStatus === "READY_FOR_MANUAL_SEND") {
          const released =
            await releaseWhatsAppJobDeliveries({
              jobId: prepared.jobId,
            });

          alert(
            released.message ||
              "Factura liberada a WhatsApp."
          );
          return;
        }

        if (currentStatus === "READY_FOR_SEND") {
          alert(
            "Esta factura ya esta liberada y esperando al conector WhatsApp."
          );
          return;
        }

        if (currentStatus === "SENDING") {
          alert(
            "Esta factura ya se esta enviando por WhatsApp."
          );
          return;
        }

        alert(
          prepared.message ||
            "Esta misma factura ya tiene un envio pendiente o en proceso."
        );
        return;
      }

      if (prepared.action === "RETRY_EXISTING") {
        setWhatsappResendWarning(null);

        const retried = await retryWhatsAppJobErrors({
          jobId: prepared.jobId,
        });

        alert(
          retried.message ||
            "El intento fallido fue liberado nuevamente."
        );
        return;
      }

      if (prepared.action !== "CREATED") {
        throw new Error(
          "PAY0 recibio un estado de envio WhatsApp no reconocido."
        );
      }

      setWhatsappResendWarning(null);

      const released = await releaseWhatsAppJobDeliveries({
        jobId: prepared.jobId,
      });

      alert(
        released.message ||
          (
            forceResend
              ? "Reenvio de factura liberado a WhatsApp."
              : "Factura enviada a la cola de WhatsApp."
          )
      );
    } catch (err: any) {
      console.error("[PAY0][WhatsApp][Factura]", err);

      alert(
        err?.message ||
          "No se pudo enviar la factura por WhatsApp."
      );
    } finally {
      setDeliveryPreparing(false);
    }
  }
const downloadDoc = async (doc: UploadRow) => {
    if (!doc.storagePath) {
      alert("Documento sin ruta de Storage.");
      return;
    }

    setDownloadingId(doc.id);
    try {
      const url = await getDownloadURL(ref(storage, doc.storagePath));
      await forceDownloadFromUrl(
        url,
        doc.originalName ||
          doc.filename ||
          (doc.storagePath ? doc.storagePath.split("/").pop() : null) ||
          "documento",
      );
    } catch (err: any) {
      console.error("Download error", err);
      alert(err?.message || "No se pudo descargar el archivo");
    } finally {
      setDownloadingId(null);
    }
  };

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !solicitudId) return;

    const customLabel = otherLabel.trim();

    if (documentType === "OTRO" && !customLabel) {
      alert("Ingresa el tipo de documento.");
      e.target.value = "";
      return;
    }

    setBusy(true);
    setPct(0);

    try {
      await uploadSolicitudDoc({
        solicitudId,
        documentType,
        customDocumentTypeLabel: customLabel,
        file,
        onProgress: setPct,
      });
    } catch (err: any) {
      console.error("Upload error", err);
      alert(err?.message || "No se pudo subir el archivo");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0f1624] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div>
            <div className="text-[12px] font-semibold text-white">{title}</div>
            <div className="mt-1 text-[10px] uppercase tracking-widest text-slate-500">
              Documentos por tipo
            </div>
          </div>

          <button
            type="button"
            onClick={() => !busy && !iqPreparing && !signatureSaving && onClose()}
            disabled={busy || iqPreparing || signatureSaving}
            className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            title="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          {isIqPreparationSuperAdmin ? (
            <div className="mb-4 rounded-2xl border border-violet-400/25 bg-violet-500/10 p-4 pr-12">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-violet-100">Integracion IQ</div>
                  <div className="mt-1 text-xs text-violet-200/70">
                    Sincronizacion manual integral con IQ. PAY0 ejecuta automaticamente la etapa necesaria.
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">


                  <button
                    type="button"
                    onClick={handleSyncIq}
                    disabled={iqPreparing || !solicitudId}
                    className="rounded-xl border border-sky-400/40 bg-sky-500/20 px-3 py-2 text-xs font-semibold text-sky-100 transition hover:bg-sky-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {iqPreparing ? "Procesando..." : "Sincronizar IQ"}
                  </button>
                </div>
              </div>

              {iqPreparationMessage ? (
                <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-xs leading-5 text-slate-200">
                  {iqPreparationMessage}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-cyan-200">Cotizacion automatica</div>
                <div className="mt-1 text-[11px] text-slate-500">Genera una nueva version desde la OC y reemplaza la cotizacion activa anterior.</div>
              </div>
              <button type="button" onClick={handleGenerateQuotation} disabled={quotationGenerating || !solicitudId}
                className="rounded-xl border border-cyan-400/30 bg-cyan-500/15 px-3 py-2 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50">
                {quotationGenerating ? "Generando..." : "Regenerar cotizacion"}
              </button>
              <button type="button" onClick={handleReprocessActiveOc} disabled={ocReprocessing || !solicitudId}
                className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] font-semibold text-amber-100 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50">
                {ocReprocessing ? "Reprocesando OC..." : "Reprocesar OC activa"}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-emerald-200">
                  Firma de recepción desde celular
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Captura la firma del receptor y PAY0 la guarda como documento canónico para la constancia final.
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSignatureOpen((value) => !value)}
                disabled={busy || iqPreparing || signatureSaving || !solicitudId}
                className="rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-3 py-2 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {signatureOpen ? "Ocultar firma" : "Capturar firma"}
              </button>
              <button
                type="button"
                onClick={createSignatureLink}
                disabled={busy || iqPreparing || signatureSaving || signatureLinkCreating || !solicitudId}
                className="rounded-xl border border-sky-400/30 bg-sky-500/15 px-3 py-2 text-[11px] font-semibold text-sky-100 transition hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {signatureLinkCreating ? "Creando link..." : "Crear link"}
              </button>
            </div>

            {signatureLink ? (
              <div className="mt-3 break-all rounded-xl border border-sky-400/20 bg-black/20 px-3 py-2 text-[11px] leading-5 text-sky-100">
                {signatureLink}
              </div>
            ) : null}

            {signatureOpen ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-white/10 bg-white p-2">
                  <canvas
                    ref={signatureCanvasRef}
                    className="h-48 w-full touch-none rounded-xl bg-white"
                    onPointerDown={beginSignature}
                    onPointerMove={moveSignature}
                    onPointerUp={endSignature}
                    onPointerCancel={endSignature}
                    aria-label="Area para capturar firma del receptor"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={clearSignature}
                    disabled={signatureSaving}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Limpiar
                  </button>

                  <button
                    type="button"
                    onClick={saveSignature}
                    disabled={signatureSaving || !solicitudId}
                    className="rounded-xl border border-emerald-400/30 bg-emerald-500/20 px-3 py-2 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {signatureSaving ? "Guardando..." : "Guardar firma"}
                  </button>
                </div>
              </div>
            ) : null}

            {signatureMessage ? (
              <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] leading-5 text-slate-200">
                {signatureMessage}
              </div>
            ) : null}
          </div>

          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-400">
              Tipo documento
            </label>

            <div className="relative">
              <button
                type="button"
                disabled={busy}
                onClick={() => setDropdownOpen((v) => !v)}
                className="flex h-11 w-full items-center justify-between rounded-xl border border-white/10 bg-[#070b15] px-3 text-left text-[12px] font-semibold text-white outline-none transition hover:border-sky-400/60 focus:border-sky-400 disabled:opacity-60"
              >
                <span>{getSelectedLabel(documentType)}</span>
                <ChevronDown size={16} className={`text-slate-400 transition ${dropdownOpen ? "rotate-180" : ""}`} />
              </button>

              {dropdownOpen && (
                <div className="absolute left-0 right-0 top-[48px] z-[1300] overflow-hidden rounded-xl border border-sky-400/30 bg-[#070b15] shadow-2xl">
                  {SOLICITUD_DOCUMENT_TYPES.map((type) => {
                    const active = type.value === documentType;
                    return (
                      <button
                        key={type.value}
                        type="button"
                        onClick={() => selectType(type.value)}
                        className={`block w-full px-3 py-3 text-left text-[12px] font-semibold transition ${
                          active
                            ? "bg-sky-500/20 text-sky-300"
                            : "text-slate-200 hover:bg-white/5 hover:text-white"
                        }`}
                      >
                        {type.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {documentType === "OTRO" && (
              <div className="mt-3">
                <label className="mb-1 block text-[10px] uppercase tracking-widest text-slate-400">
                  Nombre del tipo
                </label>
                <input
                  value={otherLabel}
                  onChange={(e) => setOtherLabel(e.target.value)}
                  disabled={busy}
                  maxLength={80}
                  placeholder="Ej. Carta instruccion, soporte especial..."
                  className="h-11 w-full rounded-xl border border-white/10 bg-[#070b15] px-3 text-[12px] font-semibold text-white outline-none transition placeholder:text-slate-600 focus:border-sky-400 disabled:opacity-60"
                />
              </div>
            )}
          </div>

          <label className={`flex items-center gap-2 rounded-xl border border-dashed border-sky-400/60 bg-sky-500/5 px-4 py-4 cursor-pointer ${busy ? "opacity-60 cursor-not-allowed" : "hover:bg-sky-500/10"}`}>
            <UploadCloud className="text-sky-400" size={18} />
            <div className="flex-1">
              <div className="text-[11px] font-semibold text-white">Seleccionar archivo</div>
              <div className="text-[10px] text-slate-500">
                Max 1 MB. Si subes el mismo tipo, reemplaza la version activa anterior.
              </div>
            </div>
            <input
              type="file"
              className="hidden"
              onChange={pick}
              disabled={busy}
              accept={getAccept(documentType)}
            />
          </label>

          {busy && (
            <div>
              <div className="flex justify-between text-[10px] text-slate-500">
                <span>Subiendo...</span>
                <span>{pct}%</span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-white/5">
                <div className="h-full bg-sky-400" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/5 p-4">
            {/* IQ2G_H4_D41_UI_RELATED_PAGO_RECEIPTS_SECTION */}
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[12px] uppercase tracking-[0.12em] text-emerald-200">
                  Comprobantes relacionados por pagos
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Se detectan desde los pagos aplicados a esta solicitud. No se duplica el archivo.
                </div>
              </div>
              <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-200">
                {relatedPagoReceipts.length}
              </span>
            </div>

            {loadingRelatedPagoReceipts ? (
              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-[12px] text-slate-400">
                Buscando comprobantes relacionados...
              </div>
            ) : relatedPagoReceipts.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-[12px] text-slate-500">
                Sin comprobantes relacionados por pagos aplicados.
              </div>
            ) : (
              <div className="space-y-2">
                {relatedPagoReceipts.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[12px] text-slate-100">
                        {getRelatedReceiptName(row)}
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-500">
                        Pago: {row.pagoFolio || row.pagoId || "---"}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => downloadRelatedPagoReceipt(row)}
                      className="shrink-0 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200 transition hover:bg-emerald-500/20"
                    >
                      Descargar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {docs.some((doc: any) => String(doc.documentType || "").toUpperCase() === "FACTURA_PDF" && !!doc.storagePath) &&
          docs.some((doc: any) => String(doc.documentType || "").toUpperCase() === "FACTURA_XML" && !!doc.storagePath) ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
                <div>
                  <div className="text-[12px] font-semibold text-emerald-100">Factura lista para WhatsApp</div>
                  <div className="text-[11px] text-emerald-200/80">Mensaje: compartimos folio solicitado</div>
                </div>

                <button
                  type="button"
                  onClick={() => sendFacturaWhatsapp(false)}
                  disabled={deliveryPreparing}
                  className="rounded-lg border border-emerald-500/40 px-3 py-1 text-[12px] text-emerald-100 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deliveryPreparing ? "Enviando..." : "Enviar por WhatsApp"}
                </button>
              </div>

              {whatsappResendWarning && (
                <div
                  className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 px-4 backdrop-blur-[2px]"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="whatsapp-resend-title"
                  onMouseDown={(event) => {
                    if (
                      event.target === event.currentTarget &&
                      !deliveryPreparing
                    ) {
                      setWhatsappResendWarning(null);
                    }
                  }}
                >
                  <div className="relative w-full max-w-md rounded-2xl border border-amber-400/25 bg-[#161d2b] p-6 shadow-2xl">
                    <button
                      type="button"
                      onClick={() =>
                        setWhatsappResendWarning(null)
                      }
                      disabled={deliveryPreparing}
                      className="absolute -top-3 -right-3 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[#0f172a] text-slate-300 shadow-lg transition hover:bg-[#162033] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label="Cerrar"
                    >
                      <X size={18} />
                    </button>

                    <div className="pr-8">
                      <div
                        id="whatsapp-resend-title"
                        className="text-2xl font-semibold text-slate-50"
                      >
                        Factura Enviada Anteriormente!
                      </div>
                    </div>

                    <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-start">
                      <button
                        type="button"
                        onClick={() =>
                          setWhatsappResendWarning(null)
                        }
                        disabled={deliveryPreparing}
                        className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Cancelar
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          sendFacturaWhatsapp(true)
                        }
                        disabled={deliveryPreparing}
                        className="rounded-xl border border-amber-400/30 bg-amber-500/20 px-4 py-2.5 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {deliveryPreparing
                          ? "Enviando..."
                          : "Enviar de todos modos"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          <div className="rounded-2xl border border-white/10 bg-white/[0.02]">
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
              <div className="text-[11px] font-bold uppercase tracking-widest text-white">
                Documentos cargados
              </div>
              <div className="text-[10px] text-slate-500">{docs.length} registros</div>
            </div>

            {docs.length === 0 ? (
              <div className="px-3 py-6 text-center text-[11px] text-slate-500">
                Sin documentos cargados.
              </div>
            ) : (
              <div className="max-h-[300px] overflow-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="sticky top-0 bg-[#111827] text-[9px] uppercase tracking-widest text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Tipo</th>
                      <th className="px-3 py-2 text-center">Version</th>
                      <th className="px-3 py-2 text-center">Estatus</th>
                      <th className="px-3 py-2 whitespace-nowrap">Fecha</th>
                      <th className="px-3 py-2 text-right">Acc.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.map((doc) => {
                      const status = String(doc.status || "").toUpperCase();
                      const active = doc.active === true;

                      return (
                        <tr key={doc.id} className="border-t border-white/5">
                          <td className="px-3 py-2 font-semibold text-sky-300 whitespace-nowrap">
                            <span title={doc.originalName || doc.filename || ""}>
                              {doc.documentTypeLabel || getTypeLabel(String(doc.documentType || "OTRO"))}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center font-mono text-slate-300 whitespace-nowrap">
                            {doc.version || "---"}
                          </td>
                          <td className="px-3 py-2 text-center whitespace-nowrap">
                            <span className={`rounded-full border px-2 py-1 text-[9px] font-bold ${
                              active && status === "READY"
                                ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                                : status === "REPLACED"
                                  ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
                                  : "border-slate-500/40 bg-slate-500/10 text-slate-400"
                            }`}>
                              {active && status === "READY" ? "ACTIVO" : status || "---"}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono text-slate-400 whitespace-nowrap">
                            {formatDate(doc.finalizedAt || doc.createdAt)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => downloadDoc(doc)}
                              disabled={downloadingId === doc.id || !doc.storagePath}
                              className="inline-flex items-center gap-1 rounded-full border border-sky-400/40 bg-sky-400/10 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-sky-300 transition hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
                              title="Descargar"
                            >
                              <Download size={11} />
                              Descargar
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
