"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import { logAuthEventMutation } from "@/services/activityLogMutations";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) {
      setAuthError("Firebase Auth no esta inicializado (auth undefined). Revisa .env.local y firebaseClient.ts");
      setLoading(false);
      return;
    }

    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  return { user, loading, authError };
}

function getAuthDisplayName(user: User | null): string {
  return String(user?.displayName || user?.email || user?.uid || "Usuario");
}

export async function loginWithEmailPassword(email: string, password: string) {
  if (!auth) throw new Error("Firebase Auth no inicializado.");

  const cred = await signInWithEmailAndPassword(auth, email, password);

  try {
    await logAuthEventMutation({
      event: "LOGIN",
      actorName: getAuthDisplayName(cred.user),
    });
  } catch (e) {
    console.error("No se pudo registrar login en activityLog:", e);
  }

  return cred;
}

export async function logout() {
  if (!auth) return;

  const current = auth.currentUser;

  try {
    if (current) {
      await logAuthEventMutation({
        event: "LOGOUT",
        actorName: getAuthDisplayName(current),
      });
    }
  } catch (e) {
    console.error("No se pudo registrar logout en activityLog:", e);
  }

  await signOut(auth);
}

export const useSession = useAuth;