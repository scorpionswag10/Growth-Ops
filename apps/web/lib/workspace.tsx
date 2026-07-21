"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { api, clearTokens, getAccessToken } from "./api";

export type LocationRow = {
  id: string;
  name: string;
  timezone: string;
  features: Record<string, boolean>;
  webhookToken: string;
  reportToken: string;
};

type Me = { sub: string; email: string; isPlatformAdmin: boolean };

type WorkspaceCtx = {
  me: Me;
  locations: LocationRow[];
  location: LocationRow | null;
  setLocationId: (id: string) => void;
  reloadLocations: () => Promise<void>;
  logout: () => void;
};

const Ctx = createContext<WorkspaceCtx | null>(null);

export function useWorkspace() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace outside provider");
  return ctx;
}

export function WorkspaceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [locations, setLocations] = useState<LocationRow[] | null>(null);
  const [locationId, setLocationIdState] = useState<string | null>(null);

  const reloadLocations = useCallback(async () => {
    const rows = await api<LocationRow[]>("/locations");
    setLocations(rows);
  }, []);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login");
      return;
    }
    (async () => {
      try {
        setMe(await api<Me>("/auth/me"));
        await reloadLocations();
        const saved = localStorage.getItem("go_location");
        if (saved) setLocationIdState(saved);
      } catch {
        clearTokens();
        router.replace("/login");
      }
    })();
  }, [router, reloadLocations]);

  if (!me || locations === null) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Loading workspace…
      </div>
    );
  }

  const location =
    locations.find((l) => l.id === locationId) ?? locations[0] ?? null;

  return (
    <Ctx.Provider
      value={{
        me,
        locations,
        location,
        setLocationId: (id) => {
          localStorage.setItem("go_location", id);
          setLocationIdState(id);
        },
        reloadLocations,
        logout: () => {
          clearTokens();
          router.replace("/login");
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
