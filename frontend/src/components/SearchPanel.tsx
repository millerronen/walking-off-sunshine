import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { Geolocation } from "@capacitor/geolocation";
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
}

declare global {
  interface Window {
    __googleMapsReadyPromise: Promise<void>;
    __googleMapsReadyResolve: () => void;
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

export function SearchPanel({ onSearch, isLoading, pickedDest, onPickDestOnMap, onClearPickedDest }: Props) {
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

  useEffect(() => {
    const fetchGps = async (): Promise<LatLon | null> => {
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
        return loc;
      } catch {
        setGpsState("error");
        return null;
      }
    };
    gpsFetchPromise.current = fetchGps();
  }, []);

  // Sync map-picked destination into the input field
  useEffect(() => {
    if (!destInputRef.current) return;
    if (pickedDest) {
      destInputRef.current.value = pickedDest.label;
      setDestHasText(true);
      setDestPlace(null);
    }
  }, [pickedDest]);

  // Set up dest autocomplete once on mount
  useEffect(() => {
    window.__googleMapsReadyPromise.then(() => {
      if (!destInputRef.current) return;
      const destAC = new google.maps.places.Autocomplete(destInputRef.current, { types: ["geocode"] });
      destAC.addListener("place_changed", () => setDestPlace(destAC.getPlace()));
    });
  }, []);

  // Set up origin autocomplete once on mount (input is always in the DOM now)
  useEffect(() => {
    window.__googleMapsReadyPromise.then(() => {
      if (!originInputRef.current) return;
      const originAC = new google.maps.places.Autocomplete(originInputRef.current, { types: ["geocode"] });
      originAC.addListener("place_changed", () => setOriginPlace(originAC.getPlace()));
    });
  }, []);

  function extractLatLon(place: google.maps.places.PlaceResult | null, label: string): LatLon | string {
    const loc = place?.geometry?.location;
    if (!loc) return `Select a valid ${label} from the suggestions.`;
    return { lat: loc.lat(), lon: loc.lng() };
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
    setOriginPlace(null);
    setOriginHasText(false);
    if (originInputRef.current) { originInputRef.current.value = ""; originInputRef.current.focus(); }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const destination: LatLon | string = pickedDest
      ? pickedDest.latLon
      : extractLatLon(destPlace, "destination");
    if (typeof destination === "string") { setError(destination); return; }

    const destAddress = pickedDest?.label ?? destPlace?.formatted_address ?? destInputRef.current?.value ?? "";
    const originIsEmpty = !showOrigin || !originInputRef.current?.value.trim();

    if (originIsEmpty) {
      let origin = prefetchedGps.current;
      if (!origin) {
        if (gpsState === "denied") {
          setError("Location access denied. Go to Settings → HolechBaTzel → Location and allow access, or enter a starting point.");
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
        setError("Could not get your location. Enter a starting point or check Settings → Privacy → Location Services.");
        return;
      }
      const dt = useNow ? new Date().toISOString() : new Date(datetimeValue).toISOString();
      onSearch(origin, destination, dt, "", destAddress, true);
    } else {
      const origin = extractLatLon(originPlace, "origin");
      if (typeof origin === "string") { setError(origin); return; }
      const originAddress = originPlace?.formatted_address ?? originInputRef.current?.value ?? "";
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
        <span style={styles.title}>HolechBaTzel</span>
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
          placeholder="Starting point"
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
          <button type="button" style={styles.gpsPill} onClick={handleUseGps}>
            Use my location
          </button>
        )}
      </div>

      {/* Destination */}
      <div style={styles.destRow}>
        <input
          ref={destInputRef}
          type="text"
          placeholder="Where to?"
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
          <span style={{ ...styles.gpsDot, backgroundColor: gpsDotColor }} />
          <span style={styles.originHintText}>
            {gpsState === "acquiring" ? "Locating you…" : gpsState === "ready" ? "From your location" : "Location unavailable"}
          </span>
          <button type="button" style={styles.changeBtn} onClick={() => setShowOrigin(true)}>
            change
          </button>
        </div>

      {/* Time picker */}
      <div style={styles.timeRow}>
        <button
          type="button"
          style={{ ...styles.timeChip, ...(useNow ? styles.timeChipActive : {}) }}
          onClick={() => setUseNow(true)}
        >
          Now
        </button>
        <button
          type="button"
          style={{ ...styles.timeChip, ...(!useNow ? styles.timeChipActive : {}) }}
          onClick={() => setUseNow(false)}
        >
          Choose time
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
        {locating ? "Getting location…" : isLoading ? "Calculating routes…" : "Find Shaded Routes"}
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
    border: "none",
    background: "transparent",
    fontSize: 14,
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
    fontSize: 13,
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
