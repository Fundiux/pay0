import { normalizeSolicitudStatus } from "@/lib/solicitudStatus";

export type SolicitudLite = {
  id?: string;
  folio?: string;
  status?: string;
  relatedSolicitudId?: string;
  relatedSolicitudFolio?: string;
  replacementOfSolicitudId?: string;
  replacementOfSolicitudFolio?: string;
  uuidCfdiSustituto?: string;
  uuidCfdiSustituido?: string;
  _sustituyeFolio?: string;
  facturaFecha?: string;
  originalFacturaFecha?: string;
  sustitucionAt?: { seconds?: number };
};

export type SustitucionIndex = {
  byId: Map<string, SolicitudLite>;
  byFolio: Map<string, SolicitudLite>;
  originByCurrentKey: Map<string, SolicitudLite>;
  replacementByCurrentKey: Map<string, SolicitudLite>;
};

function clean(v: any): string {
  return String(v || "").trim();
}

function keysFor(sol: SolicitudLite | null | undefined): string[] {
  return [clean(sol?.id), clean(sol?.folio)].filter(Boolean);
}

export function buildSustitucionIndex(all: SolicitudLite[]): SustitucionIndex {
  const byId = new Map<string, SolicitudLite>();
  const byFolio = new Map<string, SolicitudLite>();
  const originByCurrentKey = new Map<string, SolicitudLite>();
  const replacementByCurrentKey = new Map<string, SolicitudLite>();

  all.forEach((sol) => {
    const id = clean(sol?.id);
    const folio = clean(sol?.folio);
    if (id) byId.set(id, sol);
    if (folio) byFolio.set(folio, sol);
  });
  all.forEach((sol) => {
    // A replacement points back to its origin with replacementOf*. Older
    // records point forward with relatedSolicitud*. Support both directions.
    const origin = byId.get(clean(sol.replacementOfSolicitudId)) ||
      byFolio.get(clean(sol.replacementOfSolicitudFolio));
    if (origin) {
      keysFor(sol).forEach((key) => originByCurrentKey.set(key, origin));
      keysFor(origin).forEach((key) => replacementByCurrentKey.set(key, sol));
      return;
    }
    if (!isSolicitudEnSustitucion(sol)) return;
    const replacement = byId.get(clean(sol.relatedSolicitudId)) || byFolio.get(clean(sol.relatedSolicitudFolio));
    if (!replacement) return;
    keysFor(replacement).forEach((key) => originByCurrentKey.set(key, sol));
    keysFor(sol).forEach((key) => replacementByCurrentKey.set(key, replacement));
  });
  return { byId, byFolio, originByCurrentKey, replacementByCurrentKey };
}

export function isSolicitudEnSustitucion(sol: SolicitudLite | null | undefined): boolean {
  return normalizeSolicitudStatus(sol?.status) === "EN_SUSTITUCION";
}

export function getSolicitudIdentity(sol: SolicitudLite | null | undefined) {
  return {
    id: clean(sol?.id),
    folio: clean(sol?.folio),
  };
}

export function getSolicitudRelacionObjetivo(sol: SolicitudLite | null | undefined) {
  return {
    relatedSolicitudId: clean(sol?.relatedSolicitudId),
    relatedSolicitudFolio: clean(sol?.relatedSolicitudFolio),
  };
}

export function findSolicitudSustitutaOf(
  base: SolicitudLite | null | undefined,
  all: SolicitudLite[], index?: SustitucionIndex
): SolicitudLite | null {
  if (index) {
    return keysFor(base).map((key) => index.replacementByCurrentKey.get(key)).find(Boolean) || null;
  }
  const baseId = clean(base?.id);
  const baseFolio = clean(base?.folio);

  return (
    all.find((x) => {
      if (!isSolicitudEnSustitucion(x)) return false;

      const relId = clean(x?.relatedSolicitudId);
      const relFolio = clean(x?.relatedSolicitudFolio);

      return (!!baseId && relId === baseId) || (!!baseFolio && relFolio === baseFolio);
    }) || null
  );
}

export function findSolicitudOrigenOf(
  current: SolicitudLite | null | undefined,
  all: SolicitudLite[], index?: SustitucionIndex
): SolicitudLite | null {
  if (index) {
    return keysFor(current).map((key) => index.originByCurrentKey.get(key)).find(Boolean) || null;
  }
  const relId = clean(current?.replacementOfSolicitudId || current?.relatedSolicitudId);
  const relFolio = clean(current?.replacementOfSolicitudFolio || current?.relatedSolicitudFolio);

  if (!relId && !relFolio) return null;

  return (
    all.find((x) => {
      const id = clean(x?.id);
      const folio = clean(x?.folio);
      return (!!relId && id === relId) || (!!relFolio && folio === relFolio);
    }) || null
  );
}

export function buildSustitucionSnapshot(
  current: SolicitudLite | null | undefined,
  all: SolicitudLite[], index?: SustitucionIndex
) {
  const origen = findSolicitudOrigenOf(current, all, index);
  const sustituta = findSolicitudSustitutaOf(current, all, index);

  return {
    current,
    origen,
    sustituta,
    currentStatus: normalizeSolicitudStatus(current?.status),
    origenStatus: normalizeSolicitudStatus(origen?.status),
    sustitutaStatus: normalizeSolicitudStatus(sustituta?.status),
  };
}

function sameSolicitud(a: SolicitudLite | null | undefined, b: SolicitudLite | null | undefined): boolean {
  const aId = clean(a?.id);
  const aFolio = clean(a?.folio);
  const bId = clean(b?.id);
  const bFolio = clean(b?.folio);

  return (!!aId && !!bId && aId === bId) || (!!aFolio && !!bFolio && aFolio === bFolio);
}

export function findSolicitudOrigenRaizOf(
  current: SolicitudLite | null | undefined,
  all: SolicitudLite[], index?: SustitucionIndex
): SolicitudLite | null {
  let cursor = current || null;
  let guard = 0;

  while (cursor && guard < 20) {
    const parent = findSolicitudOrigenOf(cursor, all, index);
    if (!parent) return cursor;
    if (sameSolicitud(parent, cursor)) return cursor;
    cursor = parent;
    guard += 1;
  }

  return cursor || null;
}

export function buildSustitucionChain(
  current: SolicitudLite | null | undefined,
  all: SolicitudLite[], index?: SustitucionIndex
) {
  const root = findSolicitudOrigenRaizOf(current, all, index) || current || null;
  const chain: SolicitudLite[] = [];
  const seen = new Set<string>();

  let cursor = root;
  let guard = 0;

  while (cursor && guard < 20) {
    const key = `${clean(cursor?.id)}|${clean(cursor?.folio)}`;
    if (seen.has(key)) break;

    seen.add(key);
    chain.push(cursor);

    const next = findSolicitudSustitutaOf(cursor, all, index);
    if (!next || sameSolicitud(next, cursor)) break;

    cursor = next;
    guard += 1;
  }

  const vigente = chain.length ? chain[chain.length - 1] : null;

  const currentIndex = chain.findIndex((x) => sameSolicitud(x, current));
  const vigenteIndex = chain.findIndex((x) => sameSolicitud(x, vigente));

  return {
    root,
    chain,
    vigente,
    currentIndex,
    vigenteIndex,
    chainFolios: chain.map((x) => clean(x?.folio || x?.id)).filter(Boolean),
    rootStatus: normalizeSolicitudStatus(root?.status),
    vigenteStatus: normalizeSolicitudStatus(vigente?.status),
    currentStatus: normalizeSolicitudStatus(current?.status),
  };
}
