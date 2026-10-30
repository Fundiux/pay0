import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebaseClient";
import { useAuth } from "@/lib/auth";

export function useUserProfile() {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid || null;
  const [snapshot, setSnapshot] = useState<{ profile: any | null; uid: string | null; loading: boolean }>({ profile: null, uid: null, loading: true });
  useEffect(() => {
    let current = true;
    if (authLoading) return;
    if (!uid) { setSnapshot({ profile: null, uid: null, loading: false }); return; }
    setSnapshot({ profile: null, uid: null, loading: true });
    const unsub = onSnapshot(doc(db, "users", uid), snap => {
      if (current) setSnapshot({ profile: snap.exists() ? snap.data() || null : null, uid, loading: false });
    }, () => {
      if (current) setSnapshot({ profile: null, uid, loading: false });
    });
    return () => { current = false; unsub(); };
  }, [authLoading, uid]);
  const matches = snapshot.uid === uid;
  return { profile: matches ? snapshot.profile : null, profileUid: snapshot.uid, loading: authLoading || snapshot.loading || !matches };
}
