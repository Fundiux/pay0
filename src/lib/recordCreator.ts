export type RecordCreatorOption = { uid: string; displayName: string; username: string };

export function recordCreatorLabel(record: { createdBy?: unknown; createdByDisplayName?: unknown; createdByUsername?: unknown; createdByName?: unknown }) {
  for (const value of [record.createdByDisplayName, record.createdByUsername, record.createdByName]) {
    const label = String(value || "").trim();
    if (label && label !== record.createdBy && !/^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(label)) return label;
  }
  return "No disponible";
}
