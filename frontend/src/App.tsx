import { useState, useEffect, useRef, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { fetchShadeRoutes } from "./api/shadeApi";
import { SearchPanel } from "./components/SearchPanel";
import { MapView } from "./components/MapView";
import { RouteTierPanel } from "./components/RouteTierPanel";
import type { AppStatus, LatLon, ShadeRoute, TierPercent } from "./types";

export default function App() {
  const { t, i18n } = useTranslation();

  // Set RTL direction based on language
  useEffect(() => {
    document.documentElement.dir = i18n.language.startsWith("he") ? "rtl" : "ltr";
  }, [i18n.language]);

  const [status, setStatus] = useState<AppStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isTimeoutError, setIsTimeoutError] = useState(false);
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  const lastSearchRef = useRef<Parameters<typeof handleSearch> | null>(null);
  const [routes, setRoutes] = useState<ShadeRoute[]>([]);
  const [selectedTier, setSelectedTier] = useState<TierPercent | null>(null);
  const [originAddress, setOriginAddress] = useState("");
  const [destAddress, setDestAddress] = useState("");
  const [usingGpsOrigin, setUsingGpsOrigin] = useState(false);
  const [gpsOriginLatLon, setGpsOriginLatLon] = useState<LatLon | null>(null);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [weatherNote, setWeatherNote] = useState<string | null>(null);
  const [pickingDest, setPickingDest] = useState(false);
  const [pickedDest, setPickedDest] = useState<{ latLon: LatLon; label: string } | null>(null);
  const [pickingOrigin, setPickingOrigin] = useState(false);
  const [pickedOrigin, setPickedOrigin] = useState<{ latLon: LatLon; label: string } | null>(null);

  useEffect(() => {
    if (status !== "loading") { setLoadingSeconds(0); return; }
    const interval = setInterval(() => setLoadingSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [status]);

  async function handleSearch(origin: LatLon, destination: LatLon, datetime: string, originAddr: string, destAddr: string, gpsOrigin: boolean) {
    lastSearchRef.current = [origin, destination, datetime, originAddr, destAddr, gpsOrigin];
    setPickingDest(false);
    setPickedDest(null);
    setPickingOrigin(false);
    setPickedOrigin(null);
    setStatus("loading");
    setErrorMessage(null);
    setIsTimeoutError(false);
    setRoutes([]);
    setSelectedTier(null);
    setSheetExpanded(false);
    setOriginAddress(originAddr);
    setDestAddress(destAddr);
    setUsingGpsOrigin(gpsOrigin);
    setGpsOriginLatLon(gpsOrigin ? origin : null);
    setWeatherNote(null);

    try {
      const data = await fetchShadeRoutes({ origin, destination, datetime });
      if (data.routes.length === 0) {
        setErrorMessage(t("errorNoRoute"));
        setIsTimeoutError(false);
        setStatus("error");
        return;
      }
      setRoutes(data.routes);
      setWeatherNote(data.weatherNote ?? null);
      setStatus("success");
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "TimeoutError";
      setIsTimeoutError(isTimeout);
      setErrorMessage(err instanceof Error ? err.message : t("errorUnexpected"));
      setStatus("error");
    }
  }

  const hasResults = status === "success" && routes.length > 0;
  const showSheet = hasResults || status === "loading" || status === "error";

  return (
    <div style={styles.shell}>
      {/* Full-screen map */}
      <div style={styles.mapLayer}>
        <MapView
          routes={routes}
          selectedTier={selectedTier}
          gpsOrigin={gpsOriginLatLon}
          pickingDest={pickingDest}
          onMapPick={(latLon, label) => { setPickedDest({ latLon, label }); setPickingDest(false); }}
          pickingOrigin={pickingOrigin}
          onMapPickOrigin={(latLon, label) => { setPickedOrigin({ latLon, label }); setPickingOrigin(false); }}
        />
      </div>

      {/* Top search card */}
      <div style={styles.topCard}>
        <SearchPanel
          onSearch={handleSearch}
          isLoading={status === "loading"}
          pickedDest={pickedDest}
          onPickDestOnMap={() => { setPickingDest(true); setPickingOrigin(false); }}
          onClearPickedDest={() => setPickedDest(null)}
          pickedOrigin={pickedOrigin}
          onPickOriginOnMap={() => { setPickingOrigin(true); setPickingDest(false); }}
          onClearPickedOrigin={() => setPickedOrigin(null)}
          onGpsAcquired={(latLon) => setGpsOriginLatLon(latLon)}
        />
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
              <div>
                <p style={styles.sheetHint}>{t("findingRoutes")}</p>
                {loadingSeconds >= 8 && (
                  <p style={styles.sheetSubHint}>{t("scoringShade")}</p>
                )}
              </div>
            </div>
          )}

          {/* Error */}
          {status === "error" && errorMessage && (
            <div style={styles.errorBox}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
                {isTimeoutError ? t("stillWorking") : t("somethingWentWrong")}
              </p>
              <p style={{ marginTop: 4, fontSize: 13 }}>{errorMessage}</p>
              {lastSearchRef.current && (
                <button
                  style={styles.retryButton}
                  onClick={() => handleSearch(...lastSearchRef.current!)}
                >
                  {t("tryAgain")}
                </button>
              )}
            </div>
          )}

          {/* Weather banner */}
          {hasResults && weatherNote && (
            <div style={styles.weatherBanner}>
              {weatherNote}
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
    // Belt-and-suspenders: prevent any child from expanding beyond screen width
    maxWidth: "100vw",
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
    // Split into separate properties so horizontal padding is never affected
    // by env() parsing — safe-area-inset-top only applies to paddingTop
    paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)",
    paddingLeft: 12,
    paddingRight: 12,
    paddingBottom: 0,
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
    // extra bottom padding for home indicator on notchless iPhones
    padding: "0 16px calc(env(safe-area-inset-bottom, 0px) + 32px)",
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
    margin: 0,
  },
  sheetSubHint: {
    fontSize: 12,
    color: "#999",
    marginTop: 4,
    marginBottom: 0,
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
    backgroundColor: "#fff8e1",
    borderRadius: 10,
    padding: "12px 14px",
    color: "#5d4037",
    fontSize: 14,
    border: "1px solid #ffe082",
  },
  retryButton: {
    marginTop: 10,
    padding: "7px 18px",
    borderRadius: 20,
    border: "none",
    backgroundColor: "#2E7D32",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  weatherBanner: {
    margin: "4px 16px 0",
    backgroundColor: "#E3F2FD",
    borderRadius: 10,
    padding: "10px 14px",
    color: "#1565C0",
    fontSize: 13,
    fontWeight: 500,
    border: "1px solid #BBDEFB",
    flexShrink: 0,
  },
};
