import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import type { LatLon } from "../types";

interface Props {
  onSearch: (origin: LatLon, destination: LatLon, datetime: string) => void;
  isLoading: boolean;
}

declare global {
  interface Window {
    __googleMapsReadyPromise: Promise<void>;
    __googleMapsReadyResolve: () => void;
    __googleMapsReady: () => void;
  }
}

export function SearchPanel({ onSearch, isLoading }: Props) {
  const originInputRef = useRef<HTMLInputElement>(null);
  const destInputRef = useRef<HTMLInputElement>(null);

  const [originPlace, setOriginPlace] =
    useState<google.maps.places.PlaceResult | null>(null);
  const [destPlace, setDestPlace] =
    useState<google.maps.places.PlaceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.__googleMapsReadyPromise.then(() => {
      if (!originInputRef.current || !destInputRef.current) return;
      const options: google.maps.places.AutocompleteOptions = { types: ["geocode"] };

      const originAC = new google.maps.places.Autocomplete(originInputRef.current, options);
      originAC.addListener("place_changed", () => setOriginPlace(originAC.getPlace()));

      const destAC = new google.maps.places.Autocomplete(destInputRef.current, options);
      destAC.addListener("place_changed", () => setDestPlace(destAC.getPlace()));
    });
  }, []);

  function extractLatLon(place: google.maps.places.PlaceResult | null, label: string): LatLon | string {
    const loc = place?.geometry?.location;
    if (!loc) return `Select a valid ${label} from the suggestions.`;
    return { lat: loc.lat(), lon: loc.lng() };
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const origin = extractLatLon(originPlace, "origin");
    if (typeof origin === "string") { setError(origin); return; }

    const destination = extractLatLon(destPlace, "destination");
    if (typeof destination === "string") { setError(destination); return; }

    onSearch(origin, destination, new Date().toISOString());
  }

  return (
    <form onSubmit={handleSubmit} style={styles.card}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.sun}>☀️</span>
        <span style={styles.title}>Walking Off Sunshine</span>
      </div>

      {/* Inputs */}
      <div style={styles.inputsBox}>
        <div style={styles.inputRow}>
          <span style={styles.dot} />
          <input
            ref={originInputRef}
            type="text"
            placeholder="From"
            style={styles.input}
            required
          />
        </div>
        <div style={styles.dividerLine} />
        <div style={styles.inputRow}>
          <span style={{ ...styles.dot, backgroundColor: "#2E7D32" }} />
          <input
            ref={destInputRef}
            type="text"
            placeholder="To"
            style={styles.input}
            required
          />
        </div>
      </div>

      {error && <p style={styles.error}>{error}</p>}

      <button type="submit" style={styles.button} disabled={isLoading}>
        {isLoading ? "Searching…" : "Find Shaded Routes"}
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
  sun: {
    fontSize: 20,
  },
  title: {
    fontSize: 15,
    fontWeight: 700,
    color: "#1a1a1a",
  },
  inputsBox: {
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    overflow: "hidden",
  },
  inputRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    backgroundColor: "#bbb",
    flexShrink: 0,
  },
  dividerLine: {
    height: 1,
    backgroundColor: "#e0e0e0",
    marginLeft: 32,
  },
  input: {
    flex: 1,
    border: "none",
    background: "transparent",
    fontSize: 15,
    outline: "none",
    color: "#1a1a1a",
  },
  error: {
    fontSize: 12,
    color: "#c62828",
    padding: "0 4px",
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
