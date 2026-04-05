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

  async function handleSearch(
    origin: LatLon,
    destination: LatLon,
    datetime: string
  ) {
    setStatus("loading");
    setErrorMessage(null);
    setRoutes([]);
    setSelectedTier(null);

    try {
      const data = await fetchShadeRoutes({ origin, destination, datetime });
      setRoutes(data.routes);
      setShortestDistance(data.shortestDistanceMeters);
      setStatus("success");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "An unexpected error occurred."
      );
      setStatus("error");
    }
  }

  return (
    <div style={styles.appShell}>
      {/* ── Left Sidebar ── */}
      <aside style={styles.sidebar}>
        <div style={styles.sidebarScroll}>
          <SearchPanel
            onSearch={handleSearch}
            isLoading={status === "loading"}
          />

          {/* Divider */}
          {(status === "success" || status === "error" || status === "loading") && (
            <hr style={styles.divider} />
          )}

          {/* Loading state */}
          {status === "loading" && (
            <div style={styles.statusBox}>
              <div style={styles.spinner} />
              <p style={styles.statusText}>Finding shaded routes…</p>
            </div>
          )}

          {/* Error state */}
          {status === "error" && errorMessage && (
            <div style={styles.errorBox}>
              <strong>Error</strong>
              <p style={{ marginTop: 4, fontSize: 13 }}>{errorMessage}</p>
            </div>
          )}

          {/* Results */}
          {status === "success" && routes.length > 0 && (
            <RouteTierPanel
              routes={routes}
              selectedTier={selectedTier}
              onSelectTier={setSelectedTier}
              shortestDistanceMeters={shortestDistance}
            />
          )}

          {status === "success" && routes.length === 0 && (
            <p style={styles.statusText}>
              No routes found. Try different locations.
            </p>
          )}
        </div>
      </aside>

      {/* ── Map Panel ── */}
      <main style={styles.mapPanel}>
        <MapView routes={routes} selectedTier={selectedTier} />
      </main>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  appShell: {
    display: "flex",
    height: "100%",
    width: "100%",
    overflow: "hidden",
  },
  sidebar: {
    width: 320,
    flexShrink: 0,
    backgroundColor: "#fafafa",
    borderRight: "1px solid #e0e0e0",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  sidebarScroll: {
    flex: 1,
    overflowY: "auto",
    padding: "20px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  divider: {
    border: "none",
    borderTop: "1px solid #e8e8e8",
    margin: 0,
  },
  mapPanel: {
    flex: 1,
    overflow: "hidden",
  },
  statusBox: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 0",
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
  statusText: {
    fontSize: 14,
    color: "#666",
  },
  errorBox: {
    backgroundColor: "#ffebee",
    borderRadius: 8,
    padding: "12px 14px",
    color: "#c62828",
    fontSize: 14,
    border: "1px solid #ffcdd2",
  },
};
