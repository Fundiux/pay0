import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type AuthActivityEventInput = {
  event: "LOGIN" | "LOGOUT";
  actorName?: string;
  description?: string;
};

export async function logAuthEventMutation(input: AuthActivityEventInput) {
  const fn = httpsCallable(functions, "logAuthEventCallable");
  const res: any = await fn(input);
  return res?.data;
}