import { HUGO_GENERAL_READ_TOOL_NAMES, HUGO_READ_LIMITS } from "./contract";
import type { FindPeopleInput, GetSolicitudDetailInput, HugoGeneralReadToolName, SearchPagosInput, SearchSolicitudesInput } from "./contract";
import { parseCalendarDay } from "./search";

const invalid = (): never => { throw Error("HUGO_TOOL_INVALID_INPUT"); };
const ORDEN = new Set(["RECIENTES", "ANTIGUAS", "MONTO_DESC", "MONTO_ASC"]);
const TIPOS = new Set(["USUARIO", "CLIENTE", "EMPRESA", "TODOS"]);
const RANGE = ["desde", "hasta", "monto", "montoMin", "montoMax", "orden", "limite", "soloConteo"];
const KEYS: Record<HugoGeneralReadToolName, Set<string>> = {
  findSolicitudes: new Set(["folio", "cliente", "empresa", "creadoPor", "estado", "factura", ...RANGE]),
  findPagos: new Set(["folio", "cliente", "empresa", "pagador", "creadoPor", "estado", "conciliado", ...RANGE]),
  getSolicitudDetail: new Set(["id", "folio"]),
  findPeople: new Set(["texto", "tipo", "limite"]),
};
const TEXT_KEYS = new Set(["folio", "cliente", "empresa", "creadoPor", "estado", "factura", "pagador", "texto"]);

export const isHugoGeneralReadTool = (name: unknown): name is HugoGeneralReadToolName => (HUGO_GENERAL_READ_TOOL_NAMES as readonly string[]).includes(String(name));

function textValue(value: unknown) {
  if (typeof value !== "string") return invalid();
  const clean = value.trim().replace(/\s+/g, " ");
  if (clean.length > HUGO_READ_LIMITS.maxText || /[\u0000-\u001f\u007f]/.test(clean)) invalid();
  return clean;
}
const amountValue = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1e12 ? value : invalid();

// Null, undefined and empty strings mean "not provided" (strict realtime schemas send null for unused fields).
export function validateHugoReadInput(name: HugoGeneralReadToolName, raw: unknown): any {
  if (!isHugoGeneralReadTool(name)) invalid();
  if (raw === undefined || raw === null) raw = {};
  if (typeof raw !== "object" || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null) invalid();
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!KEYS[name].has(key)) invalid();
    if (value === undefined || value === null || value === "") continue;
    if (TEXT_KEYS.has(key)) { const clean = textValue(value); if (clean) out[key] = clean; continue; }
    if (key === "id") { const id = textValue(value); if (id.length > 160 || id.includes("/") || id === "." || id === "..") invalid(); out.id = id; continue; }
    if (key === "desde" || key === "hasta") { const day = textValue(value); if (!parseCalendarDay(day)) invalid(); out[key] = day; continue; }
    if (key === "monto" || key === "montoMin" || key === "montoMax") { out[key] = amountValue(value); continue; }
    if (key === "orden") { if (typeof value !== "string" || !ORDEN.has(value)) invalid(); out.orden = value; continue; }
    if (key === "tipo") { if (typeof value !== "string" || !TIPOS.has(value)) invalid(); out.tipo = value; continue; }
    if (key === "limite") { if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > HUGO_READ_LIMITS.maxItems) invalid(); out.limite = value; continue; }
    if (key === "soloConteo" || key === "conciliado") { if (typeof value !== "boolean") invalid(); out[key] = value; continue; }
    invalid();
  }
  if (typeof out.desde === "string" && typeof out.hasta === "string" && out.desde > out.hasta) invalid();
  if (typeof out.montoMin === "number" && typeof out.montoMax === "number" && out.montoMin > out.montoMax) invalid();
  if (name === "getSolicitudDetail" && !out.id && !out.folio) invalid();
  if (name === "findPeople" && !out.texto) invalid();
  return out as SearchSolicitudesInput | SearchPagosInput | GetSolicitudDetailInput | FindPeopleInput;
}
