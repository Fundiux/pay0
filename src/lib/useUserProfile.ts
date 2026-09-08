import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebaseClient";
import { useAuth } from "@/lib/auth";

export function useUserProfile() {
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const uid = (user as any)?.uid as string | undefined;

    if (authLoading) {
      setLoading(true);
      return;
    }

    if (!uid) {
      setProfile(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    const refUsers = doc(db, "users", uid);

    const unsub = onSnapshot(
      refUsers,
      (snap) => {
        if (snap.exists()) setProfile((snap.data() as any) || null);
        else setProfile(null);
        setLoading(false);
      },
      (err) => {
        console.warn("[useUserProfile] users/{uid}:", (err as any)?.code || (err as any)?.message || err);
        setProfile(null);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [authLoading, (user as any)?.uid]);

  return { profile, loading };
}