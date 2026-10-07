"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signInWithCustomToken, signOut, User, EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import { logAuthEventMutation } from "@/services/activityLogMutations";
import { authenticateWithUsername } from "@/services/loginIdentity";
import { validatePasswordChange } from "@/lib/accountValidation";

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

export async function loginWithIdentifier(identifier: string, password: string) {
  const value = identifier.trim();
  try {
    if (value.includes("@")) return await loginWithEmailPassword(value.toLowerCase(), password);
    const { customToken } = await authenticateWithUsername(value, password);
    const credential = await signInWithCustomToken(auth, customToken);
    try { await logAuthEventMutation({ event: "LOGIN", actorName: getAuthDisplayName(credential.user) }); }
    catch { /* Audit unavailability must not expose credentials or block a valid session. */ }
    return credential;
  } catch (error: any) {
    if (["auth/too-many-requests", "functions/resource-exhausted"].includes(error?.code)) {
      throw new Error("Demasiados intentos. Espera unos minutos e inténtalo de nuevo.");
    }
    if (["auth/network-request-failed", "functions/unavailable", "functions/deadline-exceeded"].includes(error?.code)) {
      throw new Error("El acceso no está disponible temporalmente. Revisa tu conexión o ingresa con tu correo.");
    }
    throw new Error("Usuario o contraseña incorrectos.");
  }
}

export async function reauthenticateCurrentUser(currentPassword: string) {
  const user = auth.currentUser;
  if (!user?.email || !currentPassword) throw new Error("Inicia sesión y confirma tu contraseña actual.");
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
  await user.getIdToken(true);
  return user;
}

export async function changeMyPassword(currentPassword: string, password: string, confirmation: string) {
  validatePasswordChange(currentPassword, password, confirmation);
  const user = await reauthenticateCurrentUser(currentPassword);
  await updatePassword(user, password);
  await user.getIdToken(true);
}

export const useSession = useAuth;
