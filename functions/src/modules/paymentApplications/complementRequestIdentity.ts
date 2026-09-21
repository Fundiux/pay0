import { hash } from "./complementPolicy";

// A profile is execution evidence, never the identity of a provider operation.
export function iqRepRequestId(rootId: string, depositId: string): string {
  if (!rootId || !/^\d{3,20}$/.test(depositId)) throw Error("REP_IQ_DEPOSIT_REQUIRED");
  return hash(`${rootId}:IQ:${depositId}:REQUEST_REP`);
}

export function matchingIqRepJobs(rows: { id: string; data: () => any }[], rootId: string, depositId: string) {
  return rows.filter(row => row.data().rootId === rootId && row.data().provider === "IQ" && row.data().depositId === depositId);
}
