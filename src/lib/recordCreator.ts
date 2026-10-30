export type RecordCreatorOption = { uid: string; displayName: string; username: string; userNumber?: number };

type CreatorRecord = { [key: string]: unknown };
export function recordCreatorLabel(record: CreatorRecord, options: RecordCreatorOption[] = []) {
  const uid = String(record.createdBy || record.actorUid || record.creatorId || "").trim();
  const human = (value: unknown) => {
    const label = String(value || "").trim();
    return label && label !== uid && !/^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(label) ? label : "";
  };
  for (const value of [record.createdByDisplayName, record.createdByUsername, record.createdByName, record.creatorName, record.createdUsername]) {
    if (human(value)) return human(value);
  }
  let creator = options.find(option => option.uid === uid);
  if (!uid) {
    creator = options.find(option => option.uid === (record.ownerId || record.operationalOwnerId));
    const number = Number(record.nUsuario || (!record.delegateUid && !record.delegateUserNumber ? record.userNumber : 0));
    const matches = options.filter(option => number > 0 && option.userNumber === number);
    if (!creator && matches.length === 1) creator = matches[0];
  }
  if (creator) return human(creator.displayName) || human(creator.username) || "No disponible";
  if (!uid || uid === (record.operationalOwnerId || record.ownerId)) {
    if (human(record.operationalOwnerName)) return human(record.operationalOwnerName);
  }
  return "No disponible";
}
