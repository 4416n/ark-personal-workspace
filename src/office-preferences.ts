import { useEffect, useState } from "react";
type Preferences = {
  mode: string;
  zoom: number;
  view: string;
  projectId: string;
  compact: boolean;
};
const key = "ark-office-view-v1";
export function useOfficePreferences() {
  const [preferences, setPreferences] = useState<Preferences>(() => {
    const compact = window.innerWidth < 680;
    const fallback = {
      mode: "daily",
      zoom: 1,
      view: compact ? "departments" : "office",
      projectId: "",
      compact,
    };
    try {
      const raw = JSON.parse(localStorage.getItem(key) || "null");
      if (!raw || typeof raw !== "object") return fallback;
      return {
        mode: ["daily", "load", "skills"].includes(raw.mode)
          ? raw.mode
          : fallback.mode,
        zoom:
          typeof raw.zoom === "number" && raw.zoom >= 0.85 && raw.zoom <= 1.3
            ? raw.zoom
            : 1,
        view:
          raw.compact === compact &&
          ["office", "departments"].includes(raw.view)
            ? raw.view
            : fallback.view,
        projectId:
          typeof raw.projectId === "string" && raw.projectId.length <= 100
            ? raw.projectId
            : "",
        compact,
      };
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(preferences));
    } catch {
      /* Preferences are optional; business data has its own recovery UI. */
    }
  }, [preferences]);
  return [
    preferences,
    (patch: Partial<Preferences>) =>
      setPreferences((v) => ({ ...v, ...patch })),
  ] as const;
}
