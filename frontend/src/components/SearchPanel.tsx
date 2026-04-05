import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import type { LatLon } from "../types";

interface Props {
  onSearch: (
    origin: LatLon,
    destination: LatLon,
    datetime: string
  ) => void;
  isLoading: boolean;
}

declare global {
  interface Window {
    __googleMapsReadyPromise: Promise<void>;
    __googleMapsReadyResolve: () => void;
    __googleMapsReady: () => void;
  }
}

function toLocalDatetimeValue(date: Date): string {
  // Returns "YYYY-MM-DDTHH:MM" in local time for datetime-local input
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    date.getFullYear() +
    "-" +
    pad(date.getMonth() + 1) +
    "-" +
    pad(date.getDate()) +
    "T" +
    pad(date.getHours()) +
    ":" +
    pad(date.getMinutes())
  );
}

export function SearchPanel({ onSearch, isLoading }: Props) {
  const originInputRef = useRef<HTMLInputElement>(null);
  const destInputRef = useRef<HTMLInputElement>(null);

  const [originPlace, setOriginPlace] =
    useState<google.maps.places.PlaceResult | null>(null);
  const [destPlace, setDestPlace] =
    useState<google.maps.places.PlaceResult | null>(null);
  const [useNow, setUseNow] = useState(true);
  const [datetimeValue, setDatetimeValue] = useState(() =>
    toLocalDatetimeValue(new Date())
  );
  const [error, setError] = useState<string | null>(null);

  // Initialise Autocomplete widgets after Maps API is ready
  useEffect(() => {
    window.__googleMapsReadyPromise.then(() => {
      if (!originInputRef.current || !destInputRef.current) return;

      const options: google.maps.places.AutocompleteOptions = {
        types: ["geocode"],
      };

      const originAC = new google.maps.places.Autocomplete(
        originInputRef.current,
        options
      );
      originAC.addListener("place_changed", () => {
        setOriginPlace(originAC.getPlace());
      });

      const destAC = new google.maps.places.Autocomplete(
        destInputRef.current,
        options
      );
      destAC.addListener("place_changed", () => {
        setDestPlace(destAC.getPlace());
      });
    });
  }, []);

  function extractLatLon(
    place: google.maps.places.PlaceResult | null,
    label: string
  ): LatLon | string {
    const loc = place?.geometry?.location;
    if (!loc) return `Please select a valid ${label} from the suggestions.`;
    return { lat: loc.lat(), lon: loc.lng() };
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const origin = extractLatLon(originPlace, "origin");
    if (typeof origin === "string") {
      setError(origin);
      return;
    }

    const destination = extractLatLon(destPlace, "destination");
    if (typeof destination === "string") {
      setError(destination);
      return;
    }

    const dt = useNow ? new Date().toISOString() : new Date(datetimeValue).toISOString();
    onSearch(origin, destination, dt);
  }

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <div style={styles.logoRow}>
        <span style={styles.sunIcon}>☀️</span>
        <h1 style={styles.title}>Walking Off Sunshine</h1>
      </div>
      <p style={styles.subtitle}>Find the shadiest walking route</p>

      <div style={styles.fieldGroup}>
        <label style={styles.label} htmlFor="origin-input">
          Origin
        </label>
        <input
          id="origin-input"
          ref={originInputRef}
          type="text"
          placeholder="Start location"
          style={styles.input}
          required
        />
      </div>

      <div style={styles.fieldGroup}>
        <label style={styles.label} htmlFor="dest-input">
          Destination
        </label>
        <input
          id="dest-input"
          ref={destInputRef}
          type="text"
          placeholder="End location"
          style={styles.input}
          required
        />
      </div>

      <div style={styles.fieldGroup}>
        <label style={styles.label}>Departure Time</label>
        <div style={styles.nowRow}>
          <label style={styles.checkLabel}>
            <input
              type="checkbox"
              checked={useNow}
              onChange={(e) => setUseNow(e.target.checked)}
              style={{ marginRight: 6 }}
            />
            Now
          </label>
        </div>
        {!useNow && (
          <input
            type="datetime-local"
            value={datetimeValue}
            onChange={(e) => setDatetimeValue(e.target.value)}
            style={{ ...styles.input, marginTop: 6 }}
            required
          />
        )}
      </div>

      {error && <p style={styles.error}>{error}</p>}

      <button type="submit" style={styles.button} disabled={isLoading}>
        {isLoading ? "Searching…" : "Find Shaded Routes"}
      </button>
    </form>
  );
}

const styles: Record<string, CSSProperties> = {
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  logoRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  sunIcon: {
    fontSize: 28,
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    color: "#1a1a1a",
    lineHeight: 1.2,
  },
  subtitle: {
    fontSize: 13,
    color: "#666",
    marginTop: -8,
  },
  fieldGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: 600,
    color: "#444",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  input: {
    padding: "9px 12px",
    borderRadius: 8,
    border: "1.5px solid #ddd",
    fontSize: 14,
    outline: "none",
    transition: "border-color 0.15s",
    width: "100%",
  },
  nowRow: {
    display: "flex",
    alignItems: "center",
  },
  checkLabel: {
    fontSize: 14,
    color: "#333",
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
  },
  button: {
    padding: "11px 0",
    borderRadius: 8,
    border: "none",
    backgroundColor: "#2E7D32",
    color: "#fff",
    fontWeight: 700,
    fontSize: 15,
    cursor: "pointer",
    marginTop: 4,
    transition: "background-color 0.15s",
  },
  error: {
    fontSize: 13,
    color: "#c62828",
    backgroundColor: "#ffebee",
    borderRadius: 6,
    padding: "8px 10px",
  },
};
