import { collection, documentId, orderBy, query, Timestamp, where, type Firestore } from "firebase/firestore";
import type { OperationScope, OperationDiscoverySeed } from "@/lib/liveOperationRows";

/** Same role constraints and ordering as the callable list. Never a collection-wide listener. */
export function buildOperationDiscoveryQuery(db: Firestore, collectionName: "pagos" | "solicitudes", scope: OperationScope, seed: OperationDiscoverySeed) {
  if (!scope.uid || !scope.rootId || !["superadmin", "admin", "operador", "operator"].includes(scope.role)) return null;
  const constraints = [];
  if (collectionName === "pagos" || scope.role === "superadmin") constraints.push(where("rootId", "==", scope.rootId));
  if (scope.role === "admin") constraints.push(where("adminId", "==", scope.uid));
  if (["operador", "operator"].includes(scope.role)) constraints.push(where("createdBy", "==", scope.uid));
  const boundary = seed.boundary ? new Timestamp(seed.boundary.seconds, seed.boundary.nanoseconds) : Timestamp.fromMillis(scope.fromMillis);
  constraints.push(where("createdAt", ">=", boundary), where("createdAt", "<=", Timestamp.fromMillis(scope.toMillis)), orderBy("createdAt", "desc"), orderBy(documentId()));
  // Fixed lower boundary of the initial page: no sliding limit that can lose a
  // burst of new documents while offline. Older pages retain their doc listeners.
  return query(collection(db, collectionName), ...constraints);
}
