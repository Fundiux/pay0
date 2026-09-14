import type { Query, QueryDocumentSnapshot } from "firebase-admin/firestore";

/** Read a complete financial input in bounded queries, never a silent prefix. */
export async function readLedgerQueryPages(query: Query): Promise<QueryDocumentSnapshot[]> {
  const docs: QueryDocumentSnapshot[] = [];
  let cursor: QueryDocumentSnapshot | undefined;
  const pageSize = 500;
  for (;;) {
    const page = await (cursor ? query.startAfter(cursor) : query).limit(pageSize).get();
    docs.push(...page.docs);
    if (page.size < pageSize) return docs;
    cursor = page.docs[page.docs.length - 1];
  }
}
