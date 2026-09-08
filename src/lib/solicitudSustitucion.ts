import { normalizeSolicitudStatus } from "@/lib/solicitudStatus";

export type SolicitudLite = {
  id?: string;
  folio?: string;
  status?: string;
  relatedSolicitudId?: string;
  relatedSolicitudFolio?: string;
  uuidCfdiSustituto?: string;
  uuidCfdiSustituido?: string;
  _sustituyeFolio?: string;
};

function clean(v: any): string {
  return String(v || "").trim();
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
  all: SolicitudLite[]
): SolicitudLite | null {
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
  all: SolicitudLite[]
): SolicitudLite | null {
  const relId = clean(current?.relatedSolicitudId);
  const relFolio = clean(current?.relatedSolicitudFolio);

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
  all: SolicitudLite[]
) {
  const origen = findSolicitudOrigenOf(current, all);
  const sustituta = findSolicitudSustitutaOf(current, all);

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
  all: SolicitudLite[]
): SolicitudLite | null {
  let cursor = current || null;
  let guard = 0;

  while (cursor && guard < 20) {
    const parent = findSolicitudOrigenOf(cursor, all);
    if (!parent) return cursor;
    if (sameSolicitud(parent, cursor)) return cursor;
    cursor = parent;
    guard += 1;
  }

  return cursor || null;
}

export function buildSustitucionChain(
  current: SolicitudLite | null | undefined,
  all: SolicitudLite[]
) {
  const root = findSolicitudOrigenRaizOf(current, all) || current || null;
  const chain: SolicitudLite[] = [];
  const seen = new Set<string>();

  let cursor = root;
  let guard = 0;

  while (cursor && guard < 20) {
    const key = `${clean(cursor?.id)}|${clean(cursor?.folio)}`;
    if (seen.has(key)) break;

    seen.add(key);
    chain.push(cursor);

    const next = findSolicitudSustitutaOf(cursor, all);
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