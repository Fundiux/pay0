import {
  collection,
  limit,
  orderBy,
  query,
  where,
  type Firestore,
  type QueryConstraint,
} from "firebase/firestore";

type ActivityReader = {
  uid: string;
  rootId: string;
  role: string;
  maxRows: number;
};

export function buildActivityLogQuery(db: Firestore, collectionName: string, reader: ActivityReader) {
  if (!["pay0ActivityLog", "activityLog"].includes(collectionName) || !reader.uid || !reader.rootId) {
    throw new Error("La consulta de actividad requiere un usuario y un ámbito válidos.");
  }

  const filters: QueryConstraint[] = [where("rootId", "==", reader.rootId)];
  if (collectionName === "pay0ActivityLog") {
    filters.push(where("sourceSystem", "==", "PAY0"));
  }
  if (reader.role === "admin") {
    filters.push(where("adminId", "==", reader.uid));
  } else if (reader.role !== "superadmin") {
    filters.push(where("actorUid", "==", reader.uid));
  }

  return query(collection(db, collectionName), ...filters, orderBy("createdAt", "desc"), limit(reader.maxRows));
}
