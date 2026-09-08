"use client";

import { db } from "@/lib/firebaseClient";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";

export type AdminUser = { id: string; email: string };

export async function listAdmins(): Promise<AdminUser[]> {
  const q = query(collection(db, "users"), where("role","==","admin"), orderBy("email", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, email: (d.data() as any).email ?? "" }));
}


