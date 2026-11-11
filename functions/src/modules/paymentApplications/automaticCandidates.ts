import type { Query, QuerySnapshot } from "firebase-admin/firestore";
import { db } from "../sharedCallables/helpers";
import { AUTOMATIC_CANDIDATE_LIMIT, decideAutomaticPayment, referencedInvoiceFolios, type AutomaticPaymentDecision } from "./automaticDomain";

type Row = Record<string, any>;
/** Invoice folios read when the client has more solicitudes than the candidate scan. */
const FOLIO_LOOKUP_LIMIT = 10;
const clean = (value: unknown) => String(value ?? "").trim();
const rows = (snapshot: QuerySnapshot) => snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));

/**
 * Reads the client's invoices and decides. A client above AUTOMATIC_CANDIDATE_LIMIT
 * is matched only against the invoices whose folio the reference names. The
 * financial transaction repeats the same reads through `read`.
 */
export async function decideAutomaticPaymentFromStore(pagoId: string, pago: Row, rootId: string,
  read: (query: Query) => Promise<QuerySnapshot>): Promise<AutomaticPaymentDecision> {
  const solicitudes = db.collection("solicitudes").where("rootId", "==", rootId).where("clienteId", "==", pago.clienteId);
  const candidates = await read(solicitudes.limit(AUTOMATIC_CANDIDATE_LIMIT + 1));
  const folios = candidates.size > AUTOMATIC_CANDIDATE_LIMIT
    ? referencedInvoiceFolios([pago.referencia, pago.concepto].map(clean).join(" ")).slice(0, FOLIO_LOOKUP_LIMIT) : [];
  if (!folios.length) return decideAutomaticPayment(pagoId, pago, rows(candidates));
  // facturaFolio is stored as written in the XML, so look it up with and without a leading zero.
  const values = Array.from(new Set(folios.flatMap(folio => [folio, `0${folio}`])));
  const named = await read(solicitudes.where("facturaFolio", "in", values).limit(AUTOMATIC_CANDIDATE_LIMIT));
  return decideAutomaticPayment(pagoId, pago, rows(named), { folioLookup: true });
}
