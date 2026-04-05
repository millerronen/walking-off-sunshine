import { useState, type CSSProperties } from "react";
import { fetchShadeRoutes } from "./api/shadeApi";
import { SearchPanel } from "./components/SearchPanel";
import { MapView } from "./components/MapView";
import { RouteTierPanel } from "./components/RouteTierPanel";
import type { AppStatus, LatLon, ShadeRoute, TierPercent } from "./types";

export default function App() {
  const [status, setStatus] = useState<AppStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [routes, setRoutes] = useState<ShadeRoute[]>([]);
  const [shortestDistance, setShortestDistance] = useState(0);
  const [selectedTier, setSelectedTier] = useState<TierPercent | null>(null);
  const [originAddress, setOriginAddress] = useState("");
  const [destAddress, setDestAddress] = useState("");
  const [usingGpsOrigin, setUsingGpsOrigin] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);

  async function handleSearch(origin: LatLon, destination: LatLon, datetime: string, originAddr: string, destAddr: string, gpsOrigin: boolean) {
    setStatus("loading");
    setErrorMessage(null);
    setRoutes([]);
    setSelectedTier(null);
    setSheetExpanded(false);
    setOriginAddress(originAddr);
    setDestAddress(destAddr);
    setUsingGpsOrigin(gpsOrigin);

    try {
      const data = await fetchShadeRoutes({ origin, destination, datetime });
      setRoutes(data.routes);
      setShortestDistance(data.shortestDistanceMeters);
      setStatus("success");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "An unexpected error occurred.");
      setStatus("error");
    }
  }

  const hasResults = status === "success" && routes.length > 0;
  const showSheet = hasResults || status === "loading" || status === "error";

  return (
    <div style={styles.shell}>
      {/* Full-screen map */}
      <div style={styles.mapLayer}>
        <MapView routes={routes} selectedTier={selectedTier} />
      </div>

      {/* Top search card */}
      <div style={styles.topCard}>
        <SearchPanel onSearch={handleSearch} isLoading={status === "loading"} />
      </div>

      {/* Bottom sheet */}
      {showSheet && (
        <div
          style={{
            ...styles.sheet,
            transform: sheetExpanded ? "translateY(0)" : "translateY(calc(100% - 140px))",
          }}
        >
          {/* Drag handle */}
          <div style={styles.handleRow} onClick={() => setSheetExpanded((v) => !v)}>
            <div style={styles.handle} />
          </div>

          {/* Loading */}
          {status === "loading" && (
            <div style={styles.sheetCenter}>
              <div style={styles.spinner} />
              <p style={styles.sheetHint}>Finding shaded routes…</p>
            </div>
          )}

          {/* Error */}
          {status === "error" && errorMessage && (
            <div style={styles.errorBox}>
              <strong>Error</strong>
              <p style={{ marginTop: 4, fontSize: 13 }}>{errorMessage}</p>
            </div>
          )}

          {/* Results */}
          {hasResults && (
            <div style={styles.sheetScroll}>
              <RouteTierPanel
                routes={routes}
                selectedTier={selectedTier}
                onSelectTier={(tier) => {
                  setSelectedTier(tier);
                  setSheetExpanded(false);
                }}
                shortestDistanceMeters={shortestDistance}
                originAddress={originAddress}
                destAddress={destAddress}
                usingGpsOrigin={usingGpsOrigin}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  shell: {
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    backgroundColor: "#f5f5f5",
  },
  mapLayer: {
    position: "absolute",
    inset: 0,
  },
  topCard: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    padding: "12px 12px 0",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    backgroundColor: "#fff",
    borderRadius: "20px 20px 0 0",
    boxShadow: "0 -4px 20px rgba(0,0,0,0.15)",
    transition: "transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)",
    maxHeight: "85%",
    display: "flex",
    flexDirection: "column",
  },
  handleRow: {
    display: "flex",
    justifyContent: "center",
    padding: "12px 0 8px",
    cursor: "pointer",
    flexShrink: 0,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#ddd",
  },
  sheetScroll: {
    overflowY: "auto",
    padding: "0 16px 32px",
    flex: 1,
  },
  sheetCenter: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "16px 20px 32px",
  },
  sheetHint: {
    fontSize: 14,
    color: "#666",
  },
  spinner: {
    width: 18,
    height: 18,
    borderRadius: "50%",
    border: "2.5px solid #ddd",
    borderTopColor: "#2E7D32",
    animation: "spin 0.8s linear infinite",
    flexShrink: 0,
  },
  errorBox: {
    margin: "8px 16px 24px",
    backgroundColor: "#ffebee",
    borderRadius: 10,
    padding: "12px 14px",
    color: "#c62828",
    fontSize: 14,
    border: "1px solid #ffcdd2",
  },
};
