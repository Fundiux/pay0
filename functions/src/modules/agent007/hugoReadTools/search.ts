// Pure search over an already-authorized, root-scoped snapshot. No Firestore
// imports: the loader owns I/O and root scoping, this module owns semantics.
import { HUGO_READ_LIMITS } from "./contract";
import type {
  FindPeopleInput, FindPeopleResult, GetSolicitudDetailInput, GetSolicitudDetailResult, MatchNote, Orden, PagoItem, PersonMatch,
  SearchPagosInput, SearchPagosResult, SearchSolicitudesInput, SearchSolicitudesResult, SolicitudDetail, SolicitudItem,
} from "./contract";

export type RawRow = { id: string; [k: string]: any };
// aplicaciones = pagoAplicaciones rows (pagoId + solicitudId + montoAplicado); only needed by getSolicitudDetail.
export type ReadSnapshot = { solicitudes: RawRow[]; pagos: RawRow[]; users: RawRow[]; clients: RawRow[]; companies: RawRow[]; uploads?: RawRow[]; aplicaciones?: RawRow[]; now?: Date };

export const FUZZY_THRESHOLD = 0.72;
export const FUZZY_TIE_MARGIN = 0.03;
const SUGGESTION_FLOOR = 0.45;
const CONCILIATED = new Set(["CONCILIADO", "APLICADO_PARCIAL", "APLICADO_TOTAL"]);

// ---------- values ----------
const text = (value: unknown, max = 200): string | null => typeof value === "string" && value.trim() ? value.trim().replace(/\s+/g, " ").slice(0, max) : typeof value === "number" && Number.isFinite(value) ? String(value) : null;
const first = (...values: unknown[]) => { for (const value of values) { const found = text(value); if (found) return found; } return null; };
const amount = (...values: unknown[]): number | null => {
  for (const value of values) if ((typeof value === "number" || typeof value === "string" && value.trim() !== "") && Number.isFinite(Number(value))) return Number(value);
  return null;
};
const round2 = (value: number) => Math.round(value * 100) / 100;
const isDeleted = (row: RawRow) => row?.isDeleted === true || (row?.deletedAt !== undefined && row?.deletedAt !== null);
const live = (rows: RawRow[] | undefined) => (rows || []).filter(row => row && typeof row.id === "string" && !isDeleted(row));

export function toMillis(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value?.toMillis === "function") { const ms = Number(value.toMillis()); return Number.isFinite(ms) ? ms : null; }
  if (typeof value?.toDate === "function") { const ms = value.toDate()?.getTime?.(); return Number.isFinite(ms) ? ms : null; }
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "string") { const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value); return Number.isFinite(ms) ? ms : null; }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object") {
    const seconds = value._seconds ?? value.seconds;
    if (typeof seconds === "number" && Number.isFinite(seconds)) return seconds * 1000 + Math.floor(Number(value._nanoseconds ?? value.nanoseconds ?? 0) / 1e6);
  }
  return null;
}

const MX_FORMAT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
function mexicoParts(ms: number) {
  const parts: Record<string, string> = {};
  for (const part of MX_FORMAT.formatToParts(new Date(ms))) parts[part.type] = part.value;
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), h: Number(parts.hour) % 24, mi: Number(parts.minute), s: Number(parts.second) };
}
function mexicoMidnight(y: number, m: number, d: number) {
  const target = Date.UTC(y, m - 1, d);
  let ms = target;
  for (let step = 0; step < 4; step++) {
    const p = mexicoParts(ms), offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - ms, next = target - offset;
    if (next === ms) break;
    ms = next;
  }
  return ms;
}
export function parseCalendarDay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const y = Number(match[1]), m = Number(match[2]), d = Number(match[3]), check = new Date(Date.UTC(y, m - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d ? { y, m, d } : null;
}
// Inclusive calendar days in America/Mexico_City; toMs is exclusive (midnight after `hasta`).
export function mexicoDayRange(desde?: string, hasta?: string): { fromMs?: number; toMs?: number } {
  const range: { fromMs?: number; toMs?: number } = {};
  if (desde) { const day = parseCalendarDay(desde); if (!day) throw Error("HUGO_TOOL_INVALID_INPUT"); range.fromMs = mexicoMidnight(day.y, day.m, day.d); }
  if (hasta) {
    const day = parseCalendarDay(hasta); if (!day) throw Error("HUGO_TOOL_INVALID_INPUT");
    const next = new Date(Date.UTC(day.y, day.m - 1, day.d + 1));
    range.toMs = mexicoMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  }
  return range;
}
const pad = (value: number) => String(value).padStart(2, "0");
export function mexicoDate(value: any): string | null {
  if (typeof value === "string" && parseCalendarDay(value)) return value;
  const ms = toMillis(value);
  if (ms === null) return null;
  const p = mexicoParts(ms);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}
function mexicoTime(value: any): string | null {
  if (typeof value === "string" && parseCalendarDay(value)) return null;
  const ms = toMillis(value);
  if (ms === null) return null;
  const p = mexicoParts(ms);
  return `${pad(p.h)}:${pad(p.mi)}`;
}

// ---------- fuzzy matching ----------
const CONNECTORS = new Set(["y", "e", "de", "del", "la", "las", "los", "el", "en", "con", "and", "of", "the"]);
const LEGAL_TAILS = new Set(["sadecv", "sapidecv", "sasdecv", "sabdecv", "sderldecv", "srldecv", "sprderl", "sprderldecv", "scdecv", "sderl", "srl", "spr", "sa", "sab", "sapi", "sas", "sc", "scp", "ac", "decv", "cv", "derl", "rl", "sociedadanonimadecapitalvariable", "sociedadanonima"]);
const LETTER_NAMES: Record<string, string> = { a: "a", be: "b", ce: "c", de: "d", e: "e", efe: "f", ge: "g", hache: "h", i: "i", jota: "j", ka: "k", ele: "l", eme: "m", ene: "n", o: "o", pe: "p", cu: "q", ere: "r", erre: "r", ese: "s", te: "t", u: "u", ve: "v", uve: "v", equis: "x", zeta: "z" };

export const normalizeText = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " y ").replace(/[^a-z0-9]+/g, " ").trim();
function stripLegal(tokens: string[]) {
  let out = [...tokens], changed = true;
  while (changed && out.length > 1) {
    changed = false;
    for (let size = Math.min(7, out.length - 1); size >= 1; size--) {
      if (LEGAL_TAILS.has(out.slice(-size).join(""))) { out = out.slice(0, -size); changed = true; break; }
    }
  }
  return out;
}
export function phoneticKey(value: string) {
  return value.replace(/ch/g, "x").replace(/qu(?=[ei])/g, "k").replace(/q/g, "k").replace(/c(?=[ei])/g, "s").replace(/c/g, "k")
    .replace(/z/g, "s").replace(/v/g, "b").replace(/w/g, "u").replace(/g(?=[ei])/g, "j").replace(/ll(?=[aeiou])/g, "y")
    .replace(/h/g, "").replace(/y(?![aeiou])/g, "i").replace(/(.)\1+/g, "$1");
}
function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}
const similarity = (a: string, b: string) => !a || !b ? 0 : 1 - levenshtein(a, b) / Math.max(a.length, b.length);
const dropLeadingVowel = (value: string) => value.length > 3 ? value.replace(/^[aeiou]/, "") : value;
type Prepared = { plain: string[]; content: string[]; full: string; contentKey: string; phonFull: string; phonContent: string; phonTokens: string[] };
function prepare(value: unknown): Prepared {
  let tokens = normalizeText(value).split(" ").filter(Boolean);
  // Spelled letters ("e be a ese o erre") collapse into one token.
  if (tokens.length >= 3 && tokens.every(token => LETTER_NAMES[token] || /^[a-z0-9]$/.test(token))) tokens = [tokens.map(token => LETTER_NAMES[token] || token).join("")];
  tokens = stripLegal(tokens);
  const content = tokens.filter(token => !CONNECTORS.has(token));
  const kept = content.length ? content : tokens;
  return { plain: tokens, content: kept, full: tokens.join(""), contentKey: kept.join(""), phonFull: phoneticKey(tokens.join("")), phonContent: phoneticKey(kept.join("")), phonTokens: kept.map(phoneticKey) };
}
function tokenSimilarity(a: string, b: string) {
  if (a === b) return 1;
  if (Math.min(a.length, b.length) <= 3) return 0;
  if (a.length >= 4 && b.startsWith(a)) return 0.9;
  return similarity(a, b);
}
function scorePrepared(q: Prepared, s: Prepared) {
  if (!q.full || !s.full) return 0;
  if (q.contentKey === s.contentKey) return 1;
  const compact = Math.max(similarity(q.phonFull, s.phonFull), similarity(q.phonContent, s.phonContent),
    0.95 * similarity(dropLeadingVowel(q.phonContent), dropLeadingVowel(s.phonContent)));
  let covered = 0;
  const storedHit = new Set<number>();
  for (const token of q.phonTokens) {
    let best = 0, bestIndex = -1;
    s.phonTokens.forEach((candidate, index) => { const value = tokenSimilarity(token, candidate); if (value > best) { best = value; bestIndex = index; } });
    if (best >= 0.7) { covered += best; storedHit.add(bestIndex); }
  }
  const coverage = q.phonTokens.length ? covered / q.phonTokens.length : 0;
  const tokenScore = coverage * (0.9 + 0.1 * (s.phonTokens.length ? storedHit.size / s.phonTokens.length : 0));
  return Math.min(1, Math.max(compact, tokenScore));
}
export function fuzzyScore(spoken: string, stored: string): number {
  return Math.round(scorePrepared(prepare(spoken), prepare(stored)) * 1000) / 1000;
}
const verbatim = (spoken: string, stored: string) => {
  const q = prepare(spoken), s = prepare(stored);
  return q.contentKey === s.contentKey || q.content.every(token => s.content.includes(token));
};
const singular = (value: string) => normalizeText(value).split(" ").map(token => token.length > 4 && /s$/.test(token) ? token.replace(/(?<=[aeiou])s$|es$/, "") : token).join(" ");

type Entity = { key: string; label: string; names: string[] };
type Resolution = { keys: Set<string>; note: MatchNote; sugerencias: string[]; labels: string[] };
function addEntity(map: Map<string, Entity>, key: string, label: string | null, names: unknown[]) {
  const clean = names.map(name => text(name)).filter((name): name is string => !!name);
  if (!label && !clean.length) return;
  const current = map.get(key);
  if (current) { for (const name of clean) if (!current.names.includes(name)) current.names.push(name); return; }
  map.set(key, { key, label: label || clean[0], names: [...new Set(clean)] });
}
function rankEntities(spoken: string, entities: Iterable<Entity>, plural = false) {
  const variants = plural ? [...new Set([spoken, singular(spoken)])] : [spoken];
  const prepared = variants.map(prepare);
  const ranked = [...entities].map(entity => {
    let best = 0, bestName = entity.label;
    for (const name of entity.names) {
      const stored = prepare(name);
      for (const q of prepared) { const value = scorePrepared(q, stored); if (value > best) { best = value; bestName = name; } }
    }
    return { entity, score: best, bestName };
  });
  return ranked.sort((a, b) => b.score - a.score || a.entity.label.localeCompare(b.entity.label));
}
function resolveEntity(campo: string, spoken: string, entities: Iterable<Entity>, plural = false): Resolution {
  const ranked = rankEntities(spoken, entities, plural);
  const top = ranked[0]?.score || 0;
  const matched = top >= FUZZY_THRESHOLD ? ranked.filter(row => row.score >= FUZZY_THRESHOLD && row.score >= top - FUZZY_TIE_MARGIN) : [];
  const labels = [...new Set(matched.map(row => row.entity.label))];
  const exact = matched.length === 1 && (verbatim(spoken, matched[0].bestName) || (plural && verbatim(singular(spoken), matched[0].bestName)));
  const sugerencias = [...new Set(ranked.filter(row => row.score >= SUGGESTION_FLOOR).slice(0, 3).map(row => row.entity.label))];
  return {
    keys: new Set(matched.map(row => row.entity.key)), labels, sugerencias,
    note: { campo, dicho: spoken, entendido: labels.length > 1 ? `${labels.join(" | ")} (varias coincidencias similares; se incluyen todas)` : labels[0] || "SIN_COINCIDENCIA", confianza: exact ? "EXACTA" : "APROXIMADA" },
  };
}

// ---------- folios ----------
const NUMBER_WORDS: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiun: 21, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100,
  doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900, mil: 1000,
};
const FOLIO_LETTERS: Record<string, string> = { ...LETTER_NAMES, es: "s", s: "s", c: "c", p: "p", u: "u", e: "e" };
const FOLIO_NOISE = new Set(["folio", "solicitud", "pago", "numero", "num", "no", "el", "la", "de", "del", "guion", "con", "es", "y"]);
const trailingZeros = (value: number) => { let count = 0; while (value > 0 && value % 10 === 0) { count++; value /= 10; } return count; };
export function normalizeSpokenFolio(input: string): string | null {
  const tokens = String(input ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  let out = "", group: number | null = null;
  const flush = () => { if (group !== null) out += String(group); group = null; };
  tokens.forEach((token, index) => {
    if (token === "y" && group !== null && NUMBER_WORDS[tokens[index + 1]] !== undefined) return;
    if (NUMBER_WORDS[token] !== undefined) {
      const value = NUMBER_WORDS[token];
      if (value === 1000) { group = (group || 1) * 1000; return; }
      if (group !== null && value > 0 && String(value).length <= trailingZeros(group)) group += value;
      else { flush(); group = value; }
      return;
    }
    if (/^[a-z]*\d[a-z0-9]*$/.test(token) || /^\d+$/.test(token)) { flush(); out += token; return; }
    if (FOLIO_NOISE.has(token) && !(token === "es" && index === 0)) { flush(); return; }
    if (FOLIO_LETTERS[token] || /^[a-z]$/.test(token)) { flush(); out += FOLIO_LETTERS[token] || token; return; }
    flush();
  });
  flush();
  const folio = out.toUpperCase();
  return folio.length >= 2 && /\d/.test(folio) && /[A-Z]/.test(folio) ? folio.slice(0, 40) : /^\d{2,}$/.test(folio) ? folio : null;
}
const folioKey = (value: unknown) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
function resolveFolio<T extends RawRow>(spoken: string, rows: T[]) {
  const folio = normalizeSpokenFolio(spoken);
  const keys = (row: T) => [folioKey(row.folio), folioKey(row.folioIq)].filter(Boolean);
  if (!folio) return { rows: [] as T[], note: { campo: "folio", dicho: spoken, entendido: "SIN_FOLIO_RECONOCIBLE", confianza: "APROXIMADA" as const }, sugerencias: [] as string[], folio: null };
  const exact = rows.filter(row => keys(row).includes(folio));
  if (exact.length) return { rows: exact, note: { campo: "folio", dicho: spoken, entendido: folio, confianza: "EXACTA" as const }, sugerencias: [], folio };
  const digitRun = /^\d+$/.test(folio) ? new RegExp(`(?<![0-9])${folio}(?![0-9])`) : null;
  const approx = rows.filter(row => keys(row).some(key => digitRun ? digitRun.test(key) : (folio.length >= 4 && key.startsWith(folio)) || (folio.length >= 5 && levenshtein(key, folio) <= 1)));
  const sugerencias = [...rows].map(row => ({ folio: text(row.folio), distance: Math.min(...keys(row).map(key => levenshtein(key, folio)), 99) }))
    .filter(row => row.folio && row.distance <= Math.max(2, Math.floor(folio.length / 3))).sort((a, b) => a.distance - b.distance).slice(0, 3).map(row => row.folio as string);
  const labels = [...new Set(approx.map(row => text(row.folio)).filter(Boolean))].slice(0, 5);
  return { rows: approx, note: { campo: "folio", dicho: spoken, entendido: labels.length ? `${folio} ≈ ${labels.join(" | ")}` : folio, confianza: "APROXIMADA" as const }, sugerencias, folio };
}

// ---------- shared filtering ----------
type Context = { users: Map<string, RawRow>; clients: Map<string, RawRow>; companies: Map<string, RawRow> };
const byId = (rows: RawRow[]) => new Map(live(rows).map(row => [row.id, row]));
const context = (snapshot: ReadSnapshot): Context => ({ users: byId(snapshot.users), clients: byId(snapshot.clients), companies: byId(snapshot.companies) });
const clientRecordName = (row?: RawRow) => row ? first(row.name, row.razonSocial, row.nombre, row.nombreComercial, row.alias, row.clienteNombre) : null;
const companyRecordName = (row?: RawRow) => row ? first(row.nombre, row.name, row.razonSocial, row.nombreComercial, row.alias) : null;
const userRecordName = (row?: RawRow) => row ? first(row.displayName, row.nombreUsuario, row.username, row.usernameNormalized, typeof row.email === "string" ? row.email.split("@")[0] : null) : null;
const userNames = (row: RawRow) => [row.displayName, row.nombreUsuario, row.username, row.usernameNormalized, row.email, typeof row.email === "string" ? row.email.split("@")[0] : null];
const clientIdOf = (row: RawRow) => text(row.clienteId) || text(row.clientId);
const snapshotClient = (row: RawRow) => first(row.clienteNombre, row.clientName, row.cliente);
const snapshotCompany = (row: RawRow) => first(row.empresaNombre, row.companyName, row.empresa);
const snapshotCreator = (row: RawRow) => first(row.createdByDisplayName, row.createdByUsername);
const nameKey = (value: string | null) => `n:${normalizeText(value)}`;

function clientEntities(rows: RawRow[], ctx: Context) {
  const map = new Map<string, Entity>();
  for (const [id, client] of ctx.clients) addEntity(map, `c:${id}`, clientRecordName(client), [client.name, client.razonSocial, client.nombre, client.nombreComercial, client.alias, client.clienteNombre]);
  for (const row of rows) { const id = clientIdOf(row), name = snapshotClient(row); if (id && ctx.clients.has(id)) addEntity(map, `c:${id}`, null, [name]); else if (name) addEntity(map, nameKey(name), name, [name]); }
  return map;
}
const clientKeyOf = (row: RawRow, ctx: Context) => { const id = clientIdOf(row); return id && ctx.clients.has(id) ? `c:${id}` : snapshotClient(row) ? nameKey(snapshotClient(row)) : null; };
function companyEntities(rows: RawRow[], ctx: Context) {
  const map = new Map<string, Entity>();
  for (const [id, company] of ctx.companies) addEntity(map, `e:${id}`, companyRecordName(company), [company.nombre, company.name, company.razonSocial, company.nombreComercial, company.alias]);
  for (const row of rows) { const id = text(row.companyId), name = snapshotCompany(row); if (id && ctx.companies.has(id)) addEntity(map, `e:${id}`, null, [name]); else if (name) addEntity(map, nameKey(name), name, [name]); }
  return map;
}
const companyKeyOf = (row: RawRow, ctx: Context) => { const id = text(row.companyId); return id && ctx.companies.has(id) ? `e:${id}` : snapshotCompany(row) ? nameKey(snapshotCompany(row)) : null; };
function userEntities(rows: RawRow[], ctx: Context) {
  const map = new Map<string, Entity>();
  for (const [id, user] of ctx.users) addEntity(map, `u:${id}`, userRecordName(user), userNames(user));
  for (const row of rows) {
    const id = text(row.createdBy), names = [row.createdByDisplayName, row.createdByUsername];
    if (id && ctx.users.has(id)) addEntity(map, `u:${id}`, null, names); else if (snapshotCreator(row)) addEntity(map, id ? `u:${id}` : nameKey(snapshotCreator(row)), snapshotCreator(row), names);
  }
  return map;
}
const userKeyOf = (row: RawRow, ctx: Context) => { const id = text(row.createdBy); return id && (ctx.users.has(id) || snapshotCreator(row)) ? `u:${id}` : snapshotCreator(row) ? nameKey(snapshotCreator(row)) : null; };
const statusOf = (row: RawRow) => first(row.status, row.estatus);
function statusEntities(rows: RawRow[]) {
  const map = new Map<string, Entity>();
  for (const row of rows) { const status = statusOf(row); if (status) addEntity(map, `s:${status.toUpperCase()}`, status.toUpperCase(), [status, status.replace(/_/g, " ")]); }
  return map;
}
const statusKeyOf = (row: RawRow) => statusOf(row) ? `s:${statusOf(row)!.toUpperCase()}` : null;

type FieldSpec = { campo: string; spoken?: string; entities: () => Map<string, Entity>; keyOf: (row: RawRow) => string | null; plural?: boolean };
function applyFuzzyFields(rows: RawRow[], specs: FieldSpec[], filtros: Record<string, unknown>, interpretacion: MatchNote[], sugerencias: string[]) {
  let out = rows;
  for (const spec of specs) {
    if (!spec.spoken) continue;
    const resolution = resolveEntity(spec.campo, spec.spoken, spec.entities().values(), spec.plural);
    interpretacion.push(resolution.note);
    filtros[spec.campo] = resolution.labels;
    sugerencias.push(...resolution.sugerencias);
    out = out.filter(row => { const key = spec.keyOf(row); return !!key && resolution.keys.has(key); });
  }
  return out;
}
function applyAmountAndDates(rows: RawRow[], input: { monto?: number; montoMin?: number; montoMax?: number; desde?: string; hasta?: string }, amountOf: (row: RawRow) => number | null, dateOf: (row: RawRow) => number | null, filtros: Record<string, unknown>) {
  let out = rows;
  if (input.monto !== undefined) {
    const tolerance = Math.max(1, Math.abs(input.monto) * 0.005);
    filtros.montoAproximado = { monto: input.monto, min: round2(input.monto - tolerance), max: round2(input.monto + tolerance) };
    out = out.filter(row => { const value = amountOf(row); return value !== null && Math.abs(value - input.monto!) <= tolerance; });
  }
  if (input.montoMin !== undefined) { filtros.montoMin = input.montoMin; out = out.filter(row => { const value = amountOf(row); return value !== null && value >= input.montoMin!; }); }
  if (input.montoMax !== undefined) { filtros.montoMax = input.montoMax; out = out.filter(row => { const value = amountOf(row); return value !== null && value <= input.montoMax!; }); }
  if (input.desde || input.hasta) {
    const { fromMs, toMs } = mexicoDayRange(input.desde, input.hasta);
    filtros.desde = input.desde || null; filtros.hasta = input.hasta || null; filtros.zonaHoraria = "America/Mexico_City";
    out = out.filter(row => { const ms = dateOf(row); return ms !== null && (fromMs === undefined || ms >= fromMs) && (toMs === undefined || ms < toMs); });
  }
  return out;
}
function sortRows(rows: RawRow[], orden: Orden, amountOf: (row: RawRow) => number | null, dateOf: (row: RawRow) => number | null) {
  const byDate = (a: RawRow, b: RawRow) => (dateOf(b) ?? -Infinity) - (dateOf(a) ?? -Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return [...rows].sort((a, b) => {
    if (orden === "ANTIGUAS") { const x = dateOf(a), y = dateOf(b); if (x !== y) return x === null ? 1 : y === null ? -1 : x - y; return a.id < b.id ? -1 : 1; }
    if (orden === "MONTO_DESC" || orden === "MONTO_ASC") {
      const x = amountOf(a), y = amountOf(b);
      if (x !== y) return x === null ? 1 : y === null ? -1 : orden === "MONTO_DESC" ? y - x : x - y;
    }
    return byDate(a, b);
  });
}
const limitOf = (value: unknown) => Math.min(Math.max(Math.trunc(Number(value) || HUGO_READ_LIMITS.defaultItems), 1), HUGO_READ_LIMITS.maxItems);
function totals(rows: RawRow[], amountOf: (row: RawRow) => number | null, currencyOf: (row: RawRow) => string) {
  const byCurrency: Record<string, number> = {};
  let sum = 0;
  for (const row of rows) { const value = amountOf(row) ?? 0; sum += value; const currency = currencyOf(row); byCurrency[currency] = round2((byCurrency[currency] || 0) + value); }
  return { montoTotal: round2(sum), montosPorMoneda: Object.keys(byCurrency).length > 1 ? byCurrency : undefined };
}

// ---------- solicitudes ----------
const solicitudAmount = (row: RawRow) => amount(row.monto, row.amount, row.total);
const solicitudDate = (row: RawRow) => toMillis(row.createdAt);
const currencyOf = (row: RawRow) => (first(row.currency, row.moneda) || "MXN").toUpperCase();
const facturaLabel = (row: RawRow) => first(row.facturaDisplay) || (() => {
  const folio = first(row.facturaFolio, row.numFactura), serie = first(row.facturaSerie);
  return folio ? `${serie && !folio.startsWith(serie) ? `${serie}-` : ""}${folio}` : null;
})();
function solicitudItem(row: RawRow, ctx: Context): SolicitudItem {
  const method = first(row.tipoFactura, row.facturaMetodoPago, row.paymentMethod);
  return {
    id: row.id, folio: text(row.folio), cliente: snapshotClient(row) || clientRecordName(ctx.clients.get(clientIdOf(row) || "")),
    empresa: snapshotCompany(row) || companyRecordName(ctx.companies.get(text(row.companyId) || "")),
    monto: solicitudAmount(row), moneda: currencyOf(row), estado: statusOf(row), metodoPago: method ? method.toUpperCase() : null,
    factura: facturaLabel(row), fecha: mexicoDate(row.createdAt), creadoPor: userRecordName(ctx.users.get(text(row.createdBy) || "")) || snapshotCreator(row),
    cotizacion: text(row.cotizacionAutoGenerateStatus), hora: mexicoTime(row.createdAt),
  };
}
function filterSolicitudes(snapshot: ReadSnapshot, input: SearchSolicitudesInput) {
  const ctx = context(snapshot), all = live(snapshot.solicitudes);
  const filtros: Record<string, unknown> = {}, interpretacion: MatchNote[] = [], sugerencias: string[] = [];
  let rows = all;
  if (input.folio) {
    const folio = resolveFolio(input.folio, rows);
    rows = folio.rows; filtros.folio = folio.folio; interpretacion.push(folio.note); sugerencias.push(...folio.sugerencias);
  }
  rows = applyFuzzyFields(rows, [
    { campo: "cliente", spoken: input.cliente, entities: () => clientEntities(all, ctx), keyOf: row => clientKeyOf(row, ctx) },
    { campo: "empresa", spoken: input.empresa, entities: () => companyEntities(all, ctx), keyOf: row => companyKeyOf(row, ctx) },
    { campo: "creadoPor", spoken: input.creadoPor, entities: () => userEntities(all, ctx), keyOf: row => userKeyOf(row, ctx) },
    { campo: "estado", spoken: input.estado, entities: () => statusEntities(all), keyOf: statusKeyOf, plural: true },
  ], filtros, interpretacion, sugerencias);
  if (input.factura) {
    const needle = folioKey(input.factura);
    filtros.factura = needle;
    rows = rows.filter(row => [row.facturaDisplay, row.facturaFolio, row.numFactura, `${row.facturaSerie || ""}${row.facturaFolio || row.numFactura || ""}`, row.facturaUuid, row.uuidCfdi]
      .some(value => needle && folioKey(value).includes(needle)));
  }
  rows = applyAmountAndDates(rows, input, solicitudAmount, solicitudDate, filtros);
  return { ctx, rows, filtros, interpretacion, sugerencias };
}
export function findSolicitudes(snapshot: ReadSnapshot, input: SearchSolicitudesInput): SearchSolicitudesResult {
  const { ctx, rows, filtros, interpretacion, sugerencias } = filterSolicitudes(snapshot, input);
  const orden = input.orden || "RECIENTES", limite = limitOf(input.limite);
  Object.assign(filtros, { orden, limite, campoFecha: "createdAt", soloConteo: input.soloConteo === true });
  const items = input.soloConteo ? [] : sortRows(rows, orden, solicitudAmount, solicitudDate).slice(0, limite).map(row => solicitudItem(row, ctx));
  const sums = totals(rows, solicitudAmount, currencyOf);
  return { total: rows.length, montoTotal: sums.montoTotal, ...(sums.montosPorMoneda ? { montosPorMoneda: sums.montosPorMoneda } : {}), mostrados: items.length, items, filtros, interpretacion,
    ...(rows.length === 0 ? { sugerencias: [...new Set(sugerencias)].slice(0, 6) } : {}) };
}

const motivoText = (row: RawRow) => {
  const raw = row.motivoRechazo;
  const base = typeof raw === "string" ? text(raw, 400) : raw && typeof raw === "object" ? first(raw.label, raw.motivo, raw.text, raw.descripcion, raw.message, raw.reason, raw.code) : null;
  const detail = text(row.motivoRechazoDetalle, 400) || (raw && typeof raw === "object" ? first(raw.detalle, raw.detail) : null);
  return base && detail && !base.includes(detail) ? `${base}: ${detail}` : base || detail;
};
function solicitudDetail(row: RawRow, snapshot: ReadSnapshot, ctx: Context): SolicitudDetail {
  const items = Array.isArray(row.ocCommercialItems) ? row.ocCommercialItems : Array.isArray(row.ocItems) ? row.ocItems : [];
  const hasOc = [row.ocClientName, row.ocClientRfc, row.ocCommercialSubtotal, row.ocCommercialIva, row.ocCommercialTotal].some(value => value !== undefined && value !== null && value !== "") || items.length > 0;
  const pagos = byId(snapshot.pagos);
  const documentos = live(snapshot.uploads).filter(upload => upload.solicitudId === row.id && upload.active !== false)
    .sort((a, b) => (toMillis(b.createdAt) ?? 0) - (toMillis(a.createdAt) ?? 0)).slice(0, 30)
    .map(upload => ({ tipo: first(upload.documentTypeLabel, upload.documentType) || "DOCUMENTO", nombre: first(upload.originalName, upload.filename), estado: text(upload.status), fecha: mexicoDate(upload.createdAt) }));
  const pagosRelacionados = live(snapshot.aplicaciones).filter(app => app.solicitudId === row.id)
    .sort((a, b) => (toMillis(b.createdAt) ?? 0) - (toMillis(a.createdAt) ?? 0)).slice(0, 30)
    .map(app => { const pago = pagos.get(text(app.pagoId) || ""); return {
      id: text(app.pagoId) || app.id, folio: pago ? text(pago.folio) : null, monto: amount(app.montoAplicado),
      fechaPago: pago ? mexicoDate(pago.fechaPago ?? pago.reportDateAt ?? pago.createdAt) : null, estado: pago ? statusOf(pago) : null,
      montoPago: pago ? pagoAmount(pago) : null, estadoAplicacion: text(app.status) }; });
  const cotizacion = [row.cotizacionAutoGenerateStatus, row.cotizacionAutoGenerateStage, row.cotizacionAutoGenerateLastError].some(value => value !== undefined && value !== null && value !== "");
  return {
    ...solicitudItem(row, ctx),
    subtotal: amount(row.facturaSubtotal), totalFactura: amount(row.facturaTotal), totalAbonado: amount(row.totalAbonado),
    motivoRechazo: motivoText(row), facturaUuid: first(row.facturaUuid, row.uuidCfdi), facturaFecha: mexicoDate(row.facturaFecha),
    oc: hasOc ? { cliente: text(row.ocClientName), rfc: text(row.ocClientRfc, 20), total: amount(row.ocCommercialTotal), subtotal: amount(row.ocCommercialSubtotal), iva: amount(row.ocCommercialIva),
      partidas: items.slice(0, 30).map((item: any) => ({ cantidad: amount(item?.quantity, item?.cantidad), descripcion: first(item?.description, item?.descripcion) || "", importe: amount(item?.importe, item?.amount, item?.total, item?.subtotal) })) } : null,
    documentos,
    cotizacionDetalle: cotizacion ? { estado: text(row.cotizacionAutoGenerateStatus), etapa: text(row.cotizacionAutoGenerateStage), ultimoError: text(row.cotizacionAutoGenerateLastError, 300) } : null,
    pagosRelacionados,
  };
}
// Resolves the target without uploads/aplicaciones so the loader can fetch only that solicitud's related rows.
export function resolveSolicitudForDetail(snapshot: ReadSnapshot, input: GetSolicitudDetailInput) {
  const rows = live(snapshot.solicitudes);
  if (input.id) { const row = rows.find(candidate => candidate.id === input.id); return { row: row || null, candidates: [] as RawRow[], interpretacion: [] as MatchNote[] }; }
  const folio = resolveFolio(input.folio || "", rows);
  return folio.rows.length === 1 ? { row: folio.rows[0], candidates: [], interpretacion: [folio.note] } : { row: null, candidates: folio.rows, interpretacion: [folio.note] };
}
export function getSolicitudDetail(snapshot: ReadSnapshot, input: GetSolicitudDetailInput): GetSolicitudDetailResult {
  const ctx = context(snapshot), resolved = resolveSolicitudForDetail(snapshot, input);
  if (resolved.row) return { encontrada: true, solicitud: solicitudDetail(resolved.row, snapshot, ctx), ...(resolved.interpretacion.length ? { interpretacion: resolved.interpretacion } : {}) };
  const candidatos = sortRows(resolved.candidates, "RECIENTES", solicitudAmount, solicitudDate).slice(0, HUGO_READ_LIMITS.defaultItems).map(row => solicitudItem(row, ctx));
  return { encontrada: false, solicitud: null, candidatos, ...(resolved.interpretacion.length ? { interpretacion: resolved.interpretacion } : {}) };
}

// ---------- pagos ----------
const pagoAmount = (row: RawRow) => amount(row.montoTotal, row.montoTotalCanonico, row.amount, row.monto);
const pagoDate = (row: RawRow) => toMillis(row.fechaPago) ?? toMillis(row.reportDateAt) ?? toMillis(row.createdAt);
const pagoConciliado = (row: RawRow) => CONCILIATED.has(String(statusOf(row) || "").toUpperCase());
function pagoItem(row: RawRow, ctx: Context): PagoItem {
  const paid = row.fechaPago ?? row.reportDateAt ?? row.createdAt;
  return {
    id: row.id, folio: text(row.folio), cliente: snapshotClient(row) || clientRecordName(ctx.clients.get(clientIdOf(row) || "")),
    empresa: snapshotCompany(row) || companyRecordName(ctx.companies.get(text(row.companyId) || "")), pagador: text(row.payerName),
    monto: pagoAmount(row), moneda: currencyOf(row), estado: statusOf(row), conciliado: pagoConciliado(row),
    fechaPago: mexicoDate(paid), registrado: mexicoDate(row.createdAt), creadoPor: userRecordName(ctx.users.get(text(row.createdBy) || "")) || snapshotCreator(row),
    montoAplicado: amount(row.montoAplicado), montoDisponible: amount(row.montoDisponible), hora: mexicoTime(paid),
  };
}
export function findPagos(snapshot: ReadSnapshot, input: SearchPagosInput): SearchPagosResult {
  const ctx = context(snapshot), all = live(snapshot.pagos);
  const filtros: Record<string, unknown> = {}, interpretacion: MatchNote[] = [], sugerencias: string[] = [];
  let rows = all;
  if (input.folio) { const folio = resolveFolio(input.folio, rows); rows = folio.rows; filtros.folio = folio.folio; interpretacion.push(folio.note); sugerencias.push(...folio.sugerencias); }
  const payers = () => { const map = new Map<string, Entity>(); for (const row of all) { const name = text(row.payerName); if (name) addEntity(map, nameKey(name), name, [name]); } return map; };
  rows = applyFuzzyFields(rows, [
    { campo: "cliente", spoken: input.cliente, entities: () => clientEntities(all, ctx), keyOf: row => clientKeyOf(row, ctx) },
    { campo: "empresa", spoken: input.empresa, entities: () => companyEntities(all, ctx), keyOf: row => companyKeyOf(row, ctx) },
    { campo: "pagador", spoken: input.pagador, entities: payers, keyOf: row => text(row.payerName) ? nameKey(text(row.payerName)) : null },
    { campo: "creadoPor", spoken: input.creadoPor, entities: () => userEntities(all, ctx), keyOf: row => userKeyOf(row, ctx) },
    { campo: "estado", spoken: input.estado, entities: () => statusEntities(all), keyOf: statusKeyOf, plural: true },
  ], filtros, interpretacion, sugerencias);
  if (input.conciliado !== undefined) { filtros.conciliado = input.conciliado; rows = rows.filter(row => pagoConciliado(row) === input.conciliado); }
  rows = applyAmountAndDates(rows, input, pagoAmount, pagoDate, filtros);
  const orden = input.orden || "RECIENTES", limite = limitOf(input.limite);
  Object.assign(filtros, { orden, limite, campoFecha: "fechaPago", soloConteo: input.soloConteo === true });
  const items = input.soloConteo ? [] : sortRows(rows, orden, pagoAmount, pagoDate).slice(0, limite).map(row => pagoItem(row, ctx));
  const sums = totals(rows, pagoAmount, currencyOf);
  return { total: rows.length, montoTotal: sums.montoTotal, ...(sums.montosPorMoneda ? { montosPorMoneda: sums.montosPorMoneda } : {}), mostrados: items.length, items, filtros, interpretacion,
    ...(rows.length === 0 ? { sugerencias: [...new Set(sugerencias)].slice(0, 6) } : {}) };
}

// ---------- people ----------
export function findPeople(snapshot: ReadSnapshot, input: FindPeopleInput): FindPeopleResult {
  const tipo = input.tipo || "TODOS", limite = limitOf(input.limite);
  const candidates: Array<{ tipo: PersonMatch["tipo"]; id: string; nombre: string; detalle: string | null; names: unknown[] }> = [];
  if (tipo === "TODOS" || tipo === "USUARIO") for (const row of live(snapshot.users)) {
    const nombre = userRecordName(row); if (!nombre) continue;
    const username = first(row.username, row.nombreUsuario, row.usernameNormalized);
    candidates.push({ tipo: "USUARIO", id: row.id, nombre, names: userNames(row),
      detalle: [username && username !== nombre ? `usuario ${username}` : null, text(row.role), row.active === false ? "inactivo" : null].filter(Boolean).join(" · ") || null });
  }
  if (tipo === "TODOS" || tipo === "CLIENTE") for (const row of live(snapshot.clients)) {
    const nombre = clientRecordName(row); if (!nombre) continue;
    const razon = text(row.razonSocial);
    candidates.push({ tipo: "CLIENTE", id: row.id, nombre, names: [row.name, row.razonSocial, row.nombre, row.nombreComercial, row.alias, row.clienteNombre],
      detalle: [razon && razon !== nombre ? razon : null, row.active === false ? "inactivo" : null].filter(Boolean).join(" · ") || null });
  }
  if (tipo === "TODOS" || tipo === "EMPRESA") for (const row of live(snapshot.companies)) {
    const nombre = companyRecordName(row); if (!nombre) continue;
    const razon = text(row.razonSocial);
    candidates.push({ tipo: "EMPRESA", id: row.id, nombre, names: [row.nombre, row.name, row.razonSocial, row.nombreComercial, row.alias],
      detalle: [razon && razon !== nombre ? razon : null, "empresa PAY0"].filter(Boolean).join(" · ") });
  }
  const q = prepare(input.texto);
  const scored = candidates.map(candidate => ({ candidate, score: Math.max(0, ...candidate.names.map(name => text(name) ? scorePrepared(q, prepare(name)) : 0)) }))
    .sort((a, b) => b.score - a.score || a.candidate.nombre.localeCompare(b.candidate.nombre));
  const strong = scored.filter(row => row.score >= FUZZY_THRESHOLD);
  // Nothing clears the threshold: return the closest few as low-confidence candidates for the model to confirm.
  const chosen = strong.length ? strong : scored.filter(row => row.score >= SUGGESTION_FLOOR).slice(0, 3);
  return { coincidencias: chosen.slice(0, limite).map(({ candidate, score }) => ({ tipo: candidate.tipo, id: candidate.id, nombre: candidate.nombre, detalle: candidate.detalle, confianza: Math.round(score * 100) / 100 })) };
}
