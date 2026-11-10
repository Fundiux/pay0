import { normalizeClientRfc, requiresUniqueClientRfc } from "./domain";
import { isMergedClient } from "./mergeDomain";

const clean = (value: unknown) => String(value ?? "").trim();

export type DuplicateCandidate = {
  id: string;
  name: string;
  numero: number | null;
  iqLinked: boolean;
  iqClientId: string;
  solicitudes: number;
  pagos: number;
};

export type DuplicateGroup = { rfc: string; proposedCanonicalId: string; clients: DuplicateCandidate[] };

const clientNumber = (data: Record<string, any>) => Number(data?.clientNumber || data?.numeroCliente || data?.sequenceNumber || 0) || null;

// An IQ link is active when the client points to an IQ client and the link was not left in review or removed.
export function hasActiveIqLink(data: Record<string, any>): boolean {
  const status = clean(data?.iqLink?.status).toUpperCase();
  const iqClientId = clean(data?.iqLink?.clientId || data?.iqClientId);
  return !!iqClientId && (status === "" || status === "LINKED");
}

const history = (candidate: DuplicateCandidate) => candidate.solicitudes + candidate.pagos;

// Owner criterion: the client with an active IQ link and more history; on a tie the lowest client number;
// never an empty one while another has history.
export function proposeCanonical(candidates: DuplicateCandidate[]): string {
  const ranked = [...candidates].sort((a, b) => {
    const empty = Number(history(a) === 0) - Number(history(b) === 0);
    if (empty) return empty;
    const link = Number(b.iqLinked) - Number(a.iqLinked);
    if (link) return link;
    const more = history(b) - history(a);
    if (more) return more;
    return (a.numero ?? Number.MAX_SAFE_INTEGER) - (b.numero ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id);
  });
  return ranked[0]?.id || "";
}

// Groups the active, not yet merged clients of one root that share a unique RFC. `counts` holds the history per client id.
export function buildDuplicateGroups(clients: Array<{ id: string; data: Record<string, any> }>, counts: Map<string, { solicitudes: number; pagos: number }>): DuplicateGroup[] {
  const byRfc = new Map<string, DuplicateCandidate[]>();
  for (const { id, data } of clients) {
    if (data?.active === false || isMergedClient(data)) continue;
    const rfc = normalizeClientRfc(data?.rfc);
    if (!requiresUniqueClientRfc(rfc)) continue;
    const count = counts.get(id) || { solicitudes: 0, pagos: 0 };
    const candidate: DuplicateCandidate = {
      id, name: clean(data?.name), numero: clientNumber(data), iqLinked: hasActiveIqLink(data),
      iqClientId: clean(data?.iqLink?.clientId || data?.iqClientId), solicitudes: count.solicitudes, pagos: count.pagos,
    };
    byRfc.set(rfc, [...(byRfc.get(rfc) || []), candidate]);
  }
  return [...byRfc.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([rfc, list]) => {
      const sorted = [...list].sort((a, b) => (a.numero ?? Number.MAX_SAFE_INTEGER) - (b.numero ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id));
      return { rfc, proposedCanonicalId: proposeCanonical(sorted), clients: sorted };
    })
    .sort((a, b) => a.rfc.localeCompare(b.rfc));
}
