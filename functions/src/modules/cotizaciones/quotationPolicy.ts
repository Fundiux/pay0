const TERMINAL = new Set(["RECHAZADA", "RECHAZADO", "CANCELADA", "CANCELADO", "ELIMINADA", "ELIMINADO", "COMPLETADA", "COMPLETADO", "OMITTED", "OMITIDO"]);

export function isTerminalSolicitud(row: Record<string, any>): boolean {
  return row.isDeleted === true || Boolean(row.deletedAt) ||
    [row.status, row.estado, row.solicitudStatus].some(value => TERMINAL.has(String(value ?? "").trim().toUpperCase()));
}
