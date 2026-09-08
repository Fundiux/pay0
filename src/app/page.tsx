"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";
import { getFirstAllowedRoute } from "@/lib/roles";

export default function HomePage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { profile, loading: loadingProfile } = useUserProfile();

  useEffect(() => {
    if (loading || loadingProfile) return;

    if (!user) {
      router.replace("/login");
      return;
    }

    if (profile) {
      router.replace(getFirstAllowedRoute(profile));
    }
  }, [user, profile, loading, loadingProfile, router]);

  return (
    <div className="min-h-screen grid place-items-center bg-[#0b1220] text-slate-300">
      Cargando...
    </div>
  );
}