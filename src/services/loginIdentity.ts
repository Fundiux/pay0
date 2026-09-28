import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export async function authenticateWithUsername(username: string, password: string) {
  const call = httpsCallable<{ username: string; password: string }, { customToken: string }>(functions, "loginWithUsername");
  return (await call({ username, password })).data;
}

export async function setMyUsername(username: string) {
  const call = httpsCallable<{ username: string }, { ok: boolean; username: string }>(functions, "setMyUsername");
  return (await call({ username })).data;
}
