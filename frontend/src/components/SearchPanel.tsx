import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { Geolocation } from "@capacitor/geolocation";
import { Capacitor } from "@capacitor/core";
import type { LatLon } from "../types";

interface Props {
  onSearch: (
    origin: LatLon,
    destination: LatLon,
    datetime: string,
    originAddress: string,
    destAddress: string,
    usingGpsOrigin: boolean
  ) => void;
  isLoading: boolean;
  pickedDest: { latLon: LatLon; label: string } | null;
  onPickDestOnMap: () => void;
  onClearPickedDest: () => void;
  pickedOrigin: { latLon: LatLon; label: string } | null;
  onPickOriginOnMap: () => void;
  onClearPickedOrigin: () => void;
  onGpsAcquired?: (latLon: LatLon) => void;
}

declare global {
  interface Window {
    __googleMapsReadyPromise: Promise<void>;
    __googleMapsReadyResolve: () => void;
    __googleMapsReadyReject: (err: Error) => void;
    __googleMapsReady: () => void;
  }
}

function toLocalDatetimeValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" +
    pad(date.getDate()) + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes())
  );
}

const MAX_WALKING_METRES = 20_000;

export function SearchPanel({ onSearch, isLoading, pickedDest, onPickDestOnMap, onClearPickedDest, pickedOrigin, onPickOriginOnMap, onClearPickedOrigin, onGpsAcquired }: Props) {
  const { t } = useTranslation();
  const originInputRef = useRef<HTMLInputElement>(null);
  const destInputRef = useRef<HTMLInputElement>(null);

  const [originPlace, setOriginPlace] = useState<google.maps.places.PlaceResult | null>(null);
  const [destPlace, setDestPlace] = useState<google.maps.places.PlaceResult | null>(null);
  const [useNow, setUseNow] = useState(true);
  const [datetimeValue, setDatetimeValue] = useState(() => toLocalDatetimeValue(new Date()));
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [showOrigin, setShowOrigin] = useState(false);
  const [destHasText, setDestHasText] = useState(false);
  const [originHasText, setOriginHasText] = useState(false);

  type GpsState = "acquiring" | "ready" | "denied" | "error";
  const [gpsState, setGpsState] = useState<GpsState>("acquiring");
  const prefetchedGps = useRef<LatLon | null>(null);
  const gpsFetchPromise = useRef<Promise<LatLon | null> | null>(null);
  const [dotCount, setDotCount] = useState(0);
  const [showManualHint, setShowManualHint] = useState(false);

  const fetchGps = async (): Promise<LatLon | null> => {
    setGpsState("acquiring");
    try {
      const { location: status } = await Geolocation.checkPermissions();
      if (status === "denied") { setGpsState("denied"); return null; }
      if (status === "prompt" || status === "prompt-with-rationale") {
        const result = await Geolocation.requestPermissions();
        if (result.location !== "granted") { setGpsState("denied"); return null; }
      }
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
      const loc: LatLon = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      prefetchedGps.current = loc;
      setGpsState("ready");
      onGpsAcquired?.(loc);
      return loc;
    } catch {
      setGpsState("error");
      return null;
    }
  };

  useEffect(() => {
    gpsFetchPromise.current = fetchGps();
  }, []);

  // Animate dots while acquiring
  useEffect(() => {
    if (gpsState !== "acquiring") { setDotCount(0); return; }
    const id = setInterval(() => setDotCount(c => (c + 1) % 4), 500);
    return () => clearInterval(id);
  }, [gpsState]);

  // Show "or set manually" hint after 5s of acquiring
  useEffect(() => {
    if (gpsState !== "acquiring") { setShowManualHint(false); return; }
    const id = setTimeout(() => setShowManualHint(true), 5000);
    return () => clearTimeout(id);
  }, [gpsState]);

  // Sync map-picked destination into the input field
  useEffect(() => {
    if (!destInputRef.current) return;
    if (pickedDest) {
      destInputRef.current.value = pickedDest.label;
      setDestHasText(true);
      setDestPlace(null);
    }
  }, [pickedDest]);

  // Sync map-picked origin into the input field
  useEffect(() => {
    if (!originInputRef.current) return;
    if (pickedOrigin) {
      originInputRef.current.value = pickedOrigin.label;
      setOriginHasText(true);
      setOriginPlace(null);
      setShowOrigin(true);
    }
  }, [pickedOrigin]);

  // Set up dest autocomplete once on mount
  useEffect(() => {
    window.__googleMapsReadyPromise.then(() => {
      if (!destInputRef.current) return;
      const destAC = new google.maps.places.Autocomplete(destInputRef.current, { types: ["geocode", "establishment"] });
      destAC.addListener("place_changed", () => setDestPlace(destAC.getPlace()));
    });
  }, []);

  // Set up origin autocomplete once on mount (input is always in the DOM now)
  useEffect(() => {
    window.__googleMapsReadyPromise.then(() => {
      if (!originInputRef.current) return;
      const originAC = new google.maps.places.Autocomplete(originInputRef.current, { types: ["geocode", "establishment"] });
      originAC.addListener("place_changed", () => setOriginPlace(originAC.getPlace()));
    });
  }, []);

  function haversineMetres(a: LatLon, b: LatLon): number {
    const R = 6371000;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLon = (b.lon - a.lon) * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function isTooClose(a: LatLon, b: LatLon): boolean {
    return haversineMetres(a, b) < 50;
  }

  function isTooFar(a: LatLon, b: LatLon): boolean {
    return haversineMetres(a, b) > MAX_WALKING_METRES;
  }

  // Types that are too broad to be a meaningful walking start/end point
  const TOO_BROAD_TYPES = new Set([
    "country", "administrative_area_level_1", "administrative_area_level_2",
    "administrative_area_level_3", "colloquial_area",
  ]);

  function extractLatLon(place: google.maps.places.PlaceResult | null, field: "dest" | "origin"): LatLon | string {
    const loc = place?.geometry?.location;
    if (!loc) return field === "dest" ? t("errorSelectDest") : t("errorSelectOrigin");

    // Reject if the only types are country / state / region level — too vague for routing
    const types = place.types ?? [];
    if (types.length > 0 && types.every(type => TOO_BROAD_TYPES.has(type))) {
      return field === "dest" ? t("errorTooBroadDest") : t("errorTooBroadOrigin");
    }

    return { lat: loc.lat(), lon: loc.lng() };
  }

  // Re-check GPS when app returns to foreground (e.g. after changing permissions in Settings)
  useEffect(() => {
    const onResume = () => {
      if (gpsState === "denied" || gpsState === "error") {
        gpsFetchPromise.current = fetchGps();
      }
    };
    document.addEventListener("resume", onResume);           // Capacitor native
    document.addEventListener("visibilitychange", () => {    // Web fallback
      if (document.visibilityState === "visible") onResume();
    });
    return () => {
      document.removeEventListener("resume", onResume);
    };
  }, [gpsState]);

  function handleLocationRetry() {
    if (gpsState === "denied" && Capacitor.isNativePlatform()) {
      window.open("app-settings:", "_self");
    } else {
      gpsFetchPromise.current = fetchGps();
    }
  }

  function handleUseGps() {
    setShowOrigin(false);
    setOriginPlace(null);
    setOriginHasText(false);
    if (originInputRef.current) originInputRef.current.value = "";
  }

  function clearDest() {
    onClearPickedDest();
    setDestPlace(null);
    setDestHasText(false);
    if (destInputRef.current) { destInputRef.current.value = ""; destInputRef.current.focus(); }
  }

  function clearOrigin() {
    onClearPickedOrigin();
    setOriginPlace(null);
    setOriginHasText(false);
    if (originInputRef.current) { originInputRef.current.value = ""; originInputRef.current.focus(); }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    let destination: LatLon;
    let destAddress: string;

    if (pickedDest) {
      destination = pickedDest.latLon;
      destAddress = pickedDest.label;
    } else if (destPlace?.geometry?.location) {
      const r = extractLatLon(destPlace, "dest");
      if (typeof r === "string") { setError(r); return; }
      destination = r;
      destAddress = destPlace.formatted_address ?? destInputRef.current?.value ?? "";
    } else {
      // User typed but didn't pick from autocomplete — try geocoding
      const destText = destInputRef.current?.value.trim() ?? "";
      if (!destText) { setError(t("errorSelectDest")); return; }
      setLocating(true);
      try {
        const geocoder = new google.maps.Geocoder();
        const result = await geocoder.geocode({ address: destText });
        const loc = result.results?.[0]?.geometry?.location;
        if (!loc) { setError(t("errorDestNotFound")); return; }
        const types = result.results[0].types ?? [];
        if (types.length > 0 && types.every(type => TOO_BROAD_TYPES.has(type))) {
          setError(t("errorTooBroadDest")); return;
        }
        destination = { lat: loc.lat(), lon: loc.lng() };
        destAddress = result.results[0].formatted_address ?? destText;
      } catch {
        setError(t("errorDestNotFound")); return;
      } finally {
        setLocating(false);
      }
    }
    const originIsEmpty = !showOrigin || !originInputRef.current?.value.trim();

    if (originIsEmpty) {
      let origin = prefetchedGps.current;
      if (!origin) {
        if (gpsState === "denied") {
          setError(t("errorLocationDenied"));
          return;
        }
        setLocating(true);
        try {
          origin = await (gpsFetchPromise.current ?? Promise.resolve(null));
        } finally {
          setLocating(false);
        }
      }
      if (!origin) {
        setError(t("errorLocationFailed"));
        return;
      }
      if (isTooClose(origin, destination)) {
        setError(t("errorSameLocation"));
        return;
      }
      if (isTooFar(origin, destination)) {
        setError(t("errorTooFar"));
        return;
      }
      const dt = useNow ? new Date().toISOString() : new Date(datetimeValue).toISOString();
      onSearch(origin, destination, dt, "", destAddress, true);
    } else {
      let origin: LatLon;
      let originAddress: string;

      if (pickedOrigin) {
        origin = pickedOrigin.latLon;
        originAddress = pickedOrigin.label;
      } else if (originPlace?.geometry?.location) {
        const r = extractLatLon(originPlace, "origin");
        if (typeof r === "string") { setError(r); return; }
        origin = r;
        originAddress = originPlace.formatted_address ?? originInputRef.current?.value ?? "";
      } else {
        const originText = originInputRef.current?.value.trim() ?? "";
        if (!originText) { setError(t("errorSelectOrigin")); return; }
        setLocating(true);
        try {
          const geocoder = new google.maps.Geocoder();
          const result = await geocoder.geocode({ address: originText });
          const loc = result.results?.[0]?.geometry?.location;
          if (!loc) { setError(t("errorOriginNotFound")); return; }
          const types = result.results[0].types ?? [];
          if (types.length > 0 && types.every(type => TOO_BROAD_TYPES.has(type))) {
            setError(t("errorTooBroadOrigin")); return;
          }
          origin = { lat: loc.lat(), lon: loc.lng() };
          originAddress = result.results[0].formatted_address ?? originText;
        } catch {
          setError(t("errorOriginNotFound")); return;
        } finally {
          setLocating(false);
        }
      }

      if (isTooClose(origin, destination)) {
        setError(t("errorSameLocation"));
        return;
      }
      if (isTooFar(origin, destination)) {
        setError(t("errorTooFar"));
        return;
      }
      const dt = useNow ? new Date().toISOString() : new Date(datetimeValue).toISOString();
      onSearch(origin, destination, dt, originAddress, destAddress, false);
    }
  }

  const gpsDotColor = gpsState === "ready" ? "#4CAF50" : gpsState === "acquiring" ? "#FFA726" : "#bbb";
  const busy = isLoading || locating;

  return (
    <form onSubmit={handleSubmit} style={styles.card}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.sun}>☀️</span>
        <span style={styles.title}>{t("appTitle")}</span>
      </div>

      {/* Origin (optional, hidden by default) — always rendered so transition is smooth */}
      <div style={{
        ...styles.originRow,
        maxHeight: showOrigin ? 56 : 0,
        opacity: showOrigin ? 1 : 0,
        overflow: "hidden",
        padding: showOrigin ? styles.originRow.padding : "0 12px",
        transition: "max-height 0.2s ease, opacity 0.15s ease, padding 0.2s ease",
        marginBottom: showOrigin ? undefined : -10,
      }}>
        <input
          ref={originInputRef}
          type="text"
          placeholder={t("startingPoint")}
          style={styles.originInput}
          onChange={() => {
            const v = originInputRef.current?.value ?? "";
            setOriginHasText(v.trim().length > 0);
            if (!v.trim()) setOriginPlace(null);
          }}
        />
        {originHasText ? (
          <button type="button" style={styles.clearBtn} onClick={clearOrigin}>✕</button>
        ) : (
          <>
            <button type="button" style={styles.mapPickBtn} onClick={onPickOriginOnMap}>📍</button>
            <button type="button" style={styles.gpsPill} onClick={handleUseGps}>
              {t("useMyLocation")}
            </button>
          </>
        )}
      </div>

      {/* Destination */}
      <div style={styles.destRow}>
        <input
          ref={destInputRef}
          type="text"
          placeholder={t("whereTo")}
          style={styles.destInput}
          onChange={() => {
            const v = destInputRef.current?.value ?? "";
            setDestHasText(v.trim().length > 0);
            if (!v.trim()) { setDestPlace(null); onClearPickedDest(); }
          }}
          required
        />
        {destHasText ? (
          <button type="button" style={styles.clearBtn} onClick={clearDest}>✕</button>
        ) : (
          <button type="button" style={styles.mapPickBtn} onClick={onPickDestOnMap}>📍</button>
        )}
      </div>

      {/* Origin hint */}
      <div style={{
        ...styles.originHint,
        maxHeight: showOrigin ? 0 : 24,
        opacity: showOrigin ? 0 : 1,
        overflow: "hidden",
        transition: "max-height 0.2s ease, opacity 0.15s ease",
      }}>
          <span style={{
            ...styles.gpsDot,
            backgroundColor: gpsDotColor,
            animation: gpsState === "acquiring" ? "gpsPulse 1.2s ease-in-out infinite" : undefined,
            cursor: (gpsState === "denied" || gpsState === "error") ? "pointer" : undefined,
          }} onClick={(gpsState === "denied" || gpsState === "error") ? handleLocationRetry : undefined} />
          <span
            style={{
              ...styles.originHintText,
              cursor: (gpsState === "denied" || gpsState === "error") ? "pointer" : undefined,
              textDecoration: (gpsState === "denied" || gpsState === "error") ? "underline" : undefined,
              color: (gpsState === "denied" || gpsState === "error") ? "#2E7D32" : undefined,
            }}
            onClick={(gpsState === "denied" || gpsState === "error") ? handleLocationRetry : undefined}
          >
            {gpsState === "acquiring"
              ? t("locatingYou") + ".".repeat(dotCount)
              : gpsState === "ready" ? t("fromYourLocation") : t("locationUnavailable") + " ↻"}
          </span>
          <button type="button" style={styles.changeBtn} onClick={() => setShowOrigin(true)}>
            {t("change")}
          </button>
        </div>

      {/* "or set manually" nudge after 5s of acquiring */}
      <div style={{
        maxHeight: (!showOrigin && gpsState === "acquiring" && showManualHint) ? 20 : 0,
        opacity: (!showOrigin && gpsState === "acquiring" && showManualHint) ? 1 : 0,
        overflow: "hidden",
        transition: "max-height 0.4s ease, opacity 0.4s ease",
        paddingLeft: 18,
      }}>
        <button type="button" style={styles.manualHintBtn} onClick={() => setShowOrigin(true)}>
          {t("orSetManually")}
        </button>
      </div>

      {/* Time picker */}
      <div style={styles.timeRow}>
        <button
          type="button"
          style={{ ...styles.timeChip, ...(useNow ? styles.timeChipActive : {}) }}
          onClick={() => setUseNow(true)}
        >
          {t("now")}
        </button>
        <button
          type="button"
          style={{ ...styles.timeChip, ...(!useNow ? styles.timeChipActive : {}) }}
          onClick={() => setUseNow(false)}
        >
          {t("chooseTime")}
        </button>
        {!useNow && (
          <input
            type="datetime-local"
            value={datetimeValue}
            onChange={e => setDatetimeValue(e.target.value)}
            style={styles.timeInput}
          />
        )}
      </div>

      {error && <p style={styles.error}>{error}</p>}

      <button type="submit" style={styles.button} disabled={busy}>
        {locating ? t("gettingLocation") : isLoading ? t("calculatingRoutes") : t("findShadedRoutes")}
      </button>
    </form>
  );
}

const styles: Record<string, CSSProperties> = {
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: "14px 14px 12px",
    boxShadow: "0 2px 16px rgba(0,0,0,0.18)",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    // Allow autocomplete dropdown to overflow (fixes Huawei Android issue)
    overflow: "visible",
    minWidth: 0,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  sun: { fontSize: 20 },
  title: { fontSize: 15, fontWeight: 700, color: "#1a1a1a" },

  destRow: {
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    padding: "11px 14px",
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  destInput: {
    flex: 1,
    border: "none",
    background: "transparent",
    fontSize: 16,
    outline: "none",
    color: "#1a1a1a",
    minWidth: 0,
  },
  mapPickBtn: {
    flexShrink: 0,
    background: "none",
    border: "none",
    fontSize: 18,
    cursor: "pointer",
    padding: "0 2px",
    lineHeight: 1,
  },
  clearBtn: {
    flexShrink: 0,
    background: "none",
    border: "none",
    fontSize: 14,
    color: "#aaa",
    cursor: "pointer",
    padding: "4px 6px",
    lineHeight: 1,
    borderRadius: 99,
  },

  originHint: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    paddingLeft: 4,
  },
  gpsDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  originHintText: {
    fontSize: 12,
    color: "#888",
    flex: 1,
  },
  changeBtn: {
    fontSize: 12,
    color: "#2E7D32",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 0,
    fontWeight: 600,
  },
  manualHintBtn: {
    fontSize: 11,
    color: "#2E7D32",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 0,
    textDecoration: "underline",
    textDecorationStyle: "dotted",
  },

  originRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    padding: "8px 12px",
  },
  originInput: {
    flex: 1,
    minWidth: 0,
    border: "none",
    background: "transparent",
    fontSize: 16, // must be ≥16px or iOS auto-zooms the viewport on focus
    outline: "none",
    color: "#1a1a1a",
  },
  gpsPill: {
    flexShrink: 0,
    fontSize: 11,
    color: "#2E7D32",
    background: "#E8F5E9",
    border: "none",
    borderRadius: 20,
    padding: "4px 10px",
    cursor: "pointer",
    fontWeight: 600,
    whiteSpace: "nowrap",
  },

  timeRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  timeChip: {
    padding: "5px 12px",
    borderRadius: 20,
    border: "1.5px solid #ddd",
    background: "transparent",
    fontSize: 13,
    cursor: "pointer",
    color: "#555",
    fontWeight: 500,
  },
  timeChipActive: {
    borderColor: "#2E7D32",
    color: "#2E7D32",
    backgroundColor: "#E8F5E9",
    fontWeight: 600,
  },
  timeInput: {
    flex: 1,
    minWidth: 0,
    border: "1.5px solid #ddd",
    borderRadius: 8,
    padding: "4px 8px",
    fontSize: 16, // must be ≥16px or iOS auto-zooms the viewport on focus
    color: "#1a1a1a",
    outline: "none",
  },
  error: {
    fontSize: 12,
    color: "#c62828",
    padding: "0 4px",
    margin: 0,
  },
  button: {
    padding: "13px 0",
    borderRadius: 12,
    border: "none",
    backgroundColor: "#2E7D32",
    color: "#fff",
    fontWeight: 700,
    fontSize: 15,
    cursor: "pointer",
    letterSpacing: "0.01em",
  },
};
