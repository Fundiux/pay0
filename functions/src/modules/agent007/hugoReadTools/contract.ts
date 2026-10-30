// Contract for Hugo's general read tools. The voice model chooses filters;
// the server owns identity, rootId scoping and read-only behavior. Every tool
// returns structured data (not prose) so the model can chain follow-up calls
// with the returned ids and keep conversational context itself.

export const HUGO_GENERAL_READ_TOOL_NAMES = ["findSolicitudes", "getSolicitudDetail", "findPagos", "findPeople"] as const;
export type HugoGeneralReadToolName = typeof HUGO_GENERAL_READ_TOOL_NAMES[number];

// Dates are calendar days (AAAA-MM-DD) in America/Mexico_City, inclusive.
export type DateRange = { desde?: string; hasta?: string };
export type AmountFilter = { monto?: number; montoMin?: number; montoMax?: number };
export type Orden = "RECIENTES" | "ANTIGUAS" | "MONTO_DESC" | "MONTO_ASC";

export type SearchSolicitudesInput = DateRange & AmountFilter & {
  folio?: string;        // exact or spoken approximation, e.g. "S1C192UE2" or "s uno c ciento noventa y dos"
  cliente?: string;      // fuzzy: client name as spoken
  empresa?: string;      // fuzzy: the PAY0 company that invoices (users often call it "proveedor")
  creadoPor?: string;    // fuzzy: PAY0 user who created it (username, display name or email)
  estado?: string;       // fuzzy against canonical status, e.g. "rechazada", "procesando"
  factura?: string;      // invoice folio/serie/uuid fragment
  orden?: Orden;         // default RECIENTES
  limite?: number;       // 1..20, default 5
  soloConteo?: boolean;  // when true, items is [] and only totals are returned
};

export type SolicitudItem = {
  id: string; folio: string | null; cliente: string | null; empresa: string | null;
  monto: number | null; moneda: string; estado: string | null; metodoPago: string | null;
  factura: string | null; fecha: string | null; creadoPor: string | null;
  cotizacion: string | null; // cotizacionAutoGenerateStatus or null
  hora?: string | null;       // HH:mm in America/Mexico_City for fecha
};

export type MatchNote = { campo: string; dicho: string; entendido: string; confianza: "EXACTA" | "APROXIMADA" };

export type SearchSolicitudesResult = {
  total: number;            // all matches in the authorized root, not a sample
  montoTotal: number;       // sum of monto across all matches
  mostrados: number;
  items: SolicitudItem[];
  filtros: Record<string, unknown>; // filters actually applied after normalization
  interpretacion: MatchNote[];      // how fuzzy inputs were resolved, so the model can confirm
  sugerencias?: string[];           // when total is 0: closest names for the fuzzy fields
  montosPorMoneda?: Record<string, number>; // only when matches mix currencies
};

export type GetSolicitudDetailInput = { id?: string; folio?: string };
export type SolicitudDetail = SolicitudItem & {
  subtotal: number | null; totalFactura: number | null; totalAbonado: number | null;
  motivoRechazo: string | null; facturaUuid: string | null; facturaFecha: string | null;
  oc: { cliente: string | null; rfc: string | null; total: number | null; subtotal: number | null; iva: number | null;
    partidas: Array<{ cantidad: number | null; descripcion: string; importe: number | null }> } | null;
  documentos: Array<{ tipo: string; nombre: string | null; estado: string | null; fecha: string | null }>;
  cotizacionDetalle: { estado: string | null; etapa: string | null; ultimoError: string | null } | null;
  // Linked through pagoAplicaciones (pagoId + solicitudId); monto is the amount applied to this solicitud.
  pagosRelacionados: Array<{ id: string; folio: string | null; monto: number | null; fechaPago: string | null; estado: string | null;
    montoPago?: number | null; estadoAplicacion?: string | null }>;
};
export type GetSolicitudDetailResult = { encontrada: boolean; solicitud: SolicitudDetail | null; candidatos?: SolicitudItem[]; interpretacion?: MatchNote[] };

export type SearchPagosInput = DateRange & AmountFilter & {
  folio?: string; cliente?: string; empresa?: string; pagador?: string; creadoPor?: string; estado?: string;
  conciliado?: boolean; orden?: Orden; limite?: number; soloConteo?: boolean;
};
export type PagoItem = {
  id: string; folio: string | null; cliente: string | null; empresa: string | null; // empresa = PAY0 company that received it
  pagador: string | null; monto: number | null; moneda: string; estado: string | null; conciliado: boolean;
  fechaPago: string | null; registrado: string | null; creadoPor: string | null;
  montoAplicado: number | null; montoDisponible: number | null;
  hora?: string | null;       // HH:mm in America/Mexico_City for fechaPago
};
export type SearchPagosResult = Omit<SearchSolicitudesResult, "items"> & { items: PagoItem[] };

export type FindPeopleInput = { texto: string; tipo?: "USUARIO" | "CLIENTE" | "EMPRESA" | "TODOS"; limite?: number };
export type PersonMatch = { tipo: "USUARIO" | "CLIENTE" | "EMPRESA"; id: string; nombre: string; detalle: string | null; confianza: number };
export type FindPeopleResult = { coincidencias: PersonMatch[] };

// Limits shared by backend validation and the gateway schemas.
export const HUGO_READ_LIMITS = { maxItems: 20, defaultItems: 5, maxText: 120 } as const;
