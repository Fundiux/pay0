// Creates and releases automatic client deliveries. Shared by the uploads trigger and by
// server flows that produce a client message directly (the signature link).
import { prepareDocumentDeliveryJobCore } from "./service";
import { releaseWhatsAppJobDeliveriesCore } from "./whatsappReleaseCallables";
import { readWhatsAppAutomationState } from "./whatsappAutomationCallables";
import { clientFacingFileName, type DeliverySourceType } from "./whatsappDeliveryDomain";

type UploadRow = Record<string, any> & { id: string };
const cleanText = (value: unknown) => String(value ?? "").trim();
const cleanUpper = (value: unknown) => cleanText(value).toUpperCase();

export type AutomaticDeliveryInput = {
  rootId: string;
  sourceType: DeliverySourceType;
  sourceId: string;
  clienteId: string;
  clienteNombre?: string | null;
  documents?: Array<Record<string, unknown>>;
  caption: string;
  textBody?: string | null;
  linkToken?: string | null;
  notes: string;
};

/** Creates (once) and releases the automatic delivery job. Does nothing while the master switch is OFF. */
export async function queueAutomaticClientDelivery(input: AutomaticDeliveryInput): Promise<string> {
  const automation = await readWhatsAppAutomationState(input.rootId);

  // Switch OFF = no crear ningun trabajo automatico.
  if (automation.enabled !== true) {
    console.log("[WHATSAPP AUTO] OFF", input.sourceType);
    return "OFF";
  }

  // The connector may be down: the job waits in the queue until Hugo comes back.
  if (automation.effectiveReady !== true) {
    console.warn("[WHATSAPP AUTO] CONECTOR NO LISTO; SE ENCOLARA", input.sourceType, automation.connector?.status || "UNKNOWN");
  }

  if (!input.clienteId) {
    console.warn("[WHATSAPP AUTO] SIN CLIENTE", input.sourceType);
    return "NO_CLIENT";
  }

  const prepared: any = await prepareDocumentDeliveryJobCore(
    {
      data: {
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        clienteId: input.clienteId,
        clienteNombre: input.clienteNombre || null,
        documents: input.documents || [],
        caption: input.caption,
        textBody: input.textBody || null,
        linkToken: input.linkToken || null,
        notes: input.notes,
      },
    },
    {
      origin: "AUTOMATIC",
      rootId: input.rootId,
      actorUid: "system",
      actorName: "Sistema",
      actorRole: "system",
    }
  );

  // Misma version ya enviada. AUTOMATIC nunca hace forceResend.
  if (prepared.action === "REQUIRES_CONFIRMATION") return "ALREADY_SENT";

  // A job prepared by hand is released too; anything already queued or in flight is left alone.
  if (prepared.action === "ALREADY_IN_PROGRESS" && prepared.status !== "READY_FOR_MANUAL_SEND") return "ALREADY_IN_PROGRESS";

  if (!["CREATED", "RETRY_EXISTING", "ALREADY_IN_PROGRESS"].includes(prepared.action)) return "NO_ACTION";

  if (prepared.action === "CREATED" && Number(prepared.destinationsCount || 0) === 0) {
    console.warn("[WHATSAPP AUTO] ESPERANDO DESTINO", input.sourceType, prepared.targetResolutionStatus || "ROUTE_NOT_CONFIGURED");
    return "WAITING_DESTINATION";
  }

  try {
    const released = await releaseWhatsAppJobDeliveriesCore({ jobId: prepared.jobId, uid: "system", actorName: "Sistema" });
    console.log("[WHATSAPP AUTO] LIBERADO", input.sourceType, released.releasedCount);
    return "RELEASED";
  } catch (error: any) {
    // No destination yet or nothing to release: the job stays visible and waits.
    console.warn("[WHATSAPP AUTO] SIN LIBERAR", input.sourceType, error?.message || error);
    return "NOT_RELEASED";
  }
}

/** Neutral, white-label file names: the stored names can carry internal folios. */
export function packageDocuments(sourceType: DeliverySourceType, rows: UploadRow[], dateMs: number) {
  return rows.map((row) => {
    const fileName = clientFacingFileName({ sourceType, documentType: row.documentType, contentType: row.contentType, storagePath: row.storagePath, dateMs });
    return { name: fileName, fileName, contentType: cleanText(row.contentType) || null, storagePath: cleanText(row.storagePath),
      documentType: cleanUpper(row.documentType), uploadId: row.id };
  });
}

