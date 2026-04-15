import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { LatLon, ShadeRoute, TierPercent } from "../types";
import { TIER_COLORS } from "../types";

interface Props {
  routes: ShadeRoute[];
  selectedTier: TierPercent | null;
  gpsOrigin?: LatLon | null;
  pickingDest?: boolean;
  onMapPick?: (latLon: LatLon, label: string) => void;
  pickingOrigin?: boolean;
  onMapPickOrigin?: (latLon: LatLon, label: string) => void;
}

export function MapView({ routes, selectedTier, gpsOrigin, pickingDest, onMapPick, pickingOrigin, onMapPickOrigin }: Props) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const polylinesRef = useRef<Map<TierPercent, google.maps.Polyline>>(new Map());
  const gpsMarkerRef = useRef<google.maps.Marker | null>(null);
  const pickMarkerRef = useRef<google.maps.Marker | null>(null);
  const pickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const originPickMarkerRef = useRef<google.maps.Marker | null>(null);
  const originPickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState(false);

  // Wait for Maps API to be available
  useEffect(() => {
    window.__googleMapsReadyPromise
      .then(() => setMapsReady(true))
      .catch(() => setMapsError(true));
  }, []);

  // When network comes back (or app foregrounds), force Maps to re-fetch grey tiles
  // by nudging the zoom level — the only reliable way to invalidate the tile cache.
  useEffect(() => {
    const refreshTiles = () => {
      const map = mapRef.current;
      if (!map) return;
      const zoom = map.getZoom();
      if (zoom === undefined) return;
      map.setZoom(zoom + 1);
      setTimeout(() => map.setZoom(zoom), 50);
    };
    const handleVisibility = () => { if (!document.hidden) refreshTiles(); };
    window.addEventListener("online", refreshTiles);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("online", refreshTiles);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  // Stop any GPU work while the app is in the background (Page Visibility API).
  // Disabling gestures when hidden prevents the map from processing touch events
  // that can wake the GPU on Capacitor's WKWebView.
  useEffect(() => {
    const handleVisibility = () => {
      if (!mapRef.current) return;
      mapRef.current.setOptions({
        gestureHandling: document.hidden ? "none" : "greedy",
      });
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // Initialise the map once the API is ready and the container is mounted
  useEffect(() => {
    if (!mapsReady || !containerRef.current) return;
    if (mapRef.current) return; // already initialised

    mapRef.current = new google.maps.Map(containerRef.current, {
      center: { lat: 32.0853, lng: 34.7818 }, // Tel Aviv
      zoom: 13,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      zoomControl: false,
      gestureHandling: "greedy",
      clickableIcons: false,
      // RASTER uses pre-rendered image tiles instead of WebGL vector rendering.
      // This keeps the GPU idle between interactions — the single biggest battery saving.
      renderingType: "RASTER" as google.maps.RenderingType,
      // Disable tilt/rotation — no 3D transforms means less GPU work on pan
      tilt: 0,
      rotateControl: false,
    });
  }, [mapsReady]);

  // Draw / redraw polylines whenever routes change
  useEffect(() => {
    if (!mapRef.current || routes.length === 0) return;

    // Remove existing polylines
    polylinesRef.current.forEach((pl) => pl.setMap(null));
    polylinesRef.current.clear();

    const bounds = new google.maps.LatLngBounds();

    // Draw dimmest routes first so the selected / higher routes sit on top.
    // We'll sort by tierPercent ascending so 25 is drawn first (under others).
    const sorted = [...routes].sort((a, b) => a.tierPercent - b.tierPercent);

    sorted.forEach((route) => {
      const path = route.polyline.map((pt) => ({
        lat: pt.lat,
        lng: pt.lon,
      }));

      path.forEach((pt) => bounds.extend(pt));

      const isSelected =
        selectedTier === null || selectedTier === route.tierPercent;

      const polyline = new google.maps.Polyline({
        path,
        strokeColor: TIER_COLORS[route.tierPercent],
        strokeOpacity: isSelected ? 0.95 : 0.3,
        strokeWeight: selectedTier === route.tierPercent ? 7 : 4,
        map: mapRef.current!,
        zIndex: route.tierPercent, // higher shade = drawn on top
      });

      polylinesRef.current.set(route.tierPercent, polyline);
    });

    mapRef.current.fitBounds(bounds, { top: 60, right: 40, bottom: 40, left: 40 });
  }, [routes, selectedTier]);

  // Show / update blue GPS origin marker
  useEffect(() => {
    if (!mapRef.current) return;
    if (!gpsOrigin) {
      gpsMarkerRef.current?.setMap(null);
      gpsMarkerRef.current = null;
      return;
    }
    const pos = { lat: gpsOrigin.lat, lng: gpsOrigin.lon };
    if (!gpsMarkerRef.current) {
      gpsMarkerRef.current = new google.maps.Marker({
        position: pos,
        map: mapRef.current,
        title: t("fromYourLocation"),
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: "#4285F4",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
        zIndex: 999,
      });
    } else {
      gpsMarkerRef.current.setPosition(pos);
      gpsMarkerRef.current.setMap(mapRef.current);
    }
    // Pan to GPS position if no routes yet
    if (routes.length === 0) {
      mapRef.current.panTo(pos);
      mapRef.current.setZoom(16);
    }
  }, [gpsOrigin, routes.length, mapsReady]);

  // Pick-on-map mode for origin
  useEffect(() => {
    if (!mapRef.current || !mapsReady) return;

    if (!pickingOrigin) {
      if (originPickListenerRef.current) { google.maps.event.removeListener(originPickListenerRef.current); originPickListenerRef.current = null; }
      originPickMarkerRef.current?.setMap(null);
      originPickMarkerRef.current = null;
      if (!pickingDest) mapRef.current.getDiv().style.cursor = "";
      return;
    }

    mapRef.current.getDiv().style.cursor = "crosshair";

    const geocoder = new google.maps.Geocoder();
    const placePin = (latLng: google.maps.LatLng) => {
      if (!mapRef.current) return;
      if (!originPickMarkerRef.current) {
        originPickMarkerRef.current = new google.maps.Marker({
          map: mapRef.current,
          draggable: true,
          animation: google.maps.Animation.DROP,
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: "#1565C0", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 },
        });
        originPickMarkerRef.current.addListener("dragend", () => {
          const pos = originPickMarkerRef.current!.getPosition()!;
          placePin(pos);
        });
      }
      originPickMarkerRef.current.setPosition(latLng);
      geocoder.geocode({ location: latLng }).then((res) => {
        const label = res.results?.[0]?.formatted_address ?? `${latLng.lat().toFixed(5)}, ${latLng.lng().toFixed(5)}`;
        onMapPickOrigin?.({ lat: latLng.lat(), lon: latLng.lng() }, label);
      }).catch(() => {
        onMapPickOrigin?.({ lat: latLng.lat(), lon: latLng.lng() }, `${latLng.lat().toFixed(5)}, ${latLng.lng().toFixed(5)}`);
      });
    };

    originPickListenerRef.current = mapRef.current.addListener("click", (e: google.maps.MapMouseEvent) => {
      if (e.latLng) placePin(e.latLng);
    });

    return () => {
      if (originPickListenerRef.current) { google.maps.event.removeListener(originPickListenerRef.current); originPickListenerRef.current = null; }
    };
  }, [pickingOrigin, mapsReady]);

  // Pick-on-map mode: click to drop / drag a destination pin
  useEffect(() => {
    if (!mapRef.current || !mapsReady) return;

    if (!pickingDest) {
      // Clean up
      if (pickListenerRef.current) { google.maps.event.removeListener(pickListenerRef.current); pickListenerRef.current = null; }
      pickMarkerRef.current?.setMap(null);
      pickMarkerRef.current = null;
      mapRef.current.getDiv().style.cursor = "";
      return;
    }

    mapRef.current.getDiv().style.cursor = "crosshair";

    const geocoder = new google.maps.Geocoder();
    const placePin = (latLng: google.maps.LatLng) => {
      if (!mapRef.current) return;
      if (!pickMarkerRef.current) {
        pickMarkerRef.current = new google.maps.Marker({
          map: mapRef.current,
          draggable: true,
          animation: google.maps.Animation.DROP,
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: "#2E7D32", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 },
        });
        pickMarkerRef.current.addListener("dragend", () => {
          const pos = pickMarkerRef.current!.getPosition()!;
          placePin(pos);
        });
      }
      pickMarkerRef.current.setPosition(latLng);

      geocoder.geocode({ location: latLng }).then((res) => {
        const label = res.results?.[0]?.formatted_address
          ?? `${latLng.lat().toFixed(5)}, ${latLng.lng().toFixed(5)}`;
        onMapPick?.({ lat: latLng.lat(), lon: latLng.lng() }, label);
      }).catch(() => {
        onMapPick?.({ lat: latLng.lat(), lon: latLng.lng() },
          `${latLng.lat().toFixed(5)}, ${latLng.lng().toFixed(5)}`);
      });
    };

    pickListenerRef.current = mapRef.current.addListener("click", (e: google.maps.MapMouseEvent) => {
      if (e.latLng) placePin(e.latLng);
    });

    return () => {
      if (pickListenerRef.current) { google.maps.event.removeListener(pickListenerRef.current); pickListenerRef.current = null; }
    };
  }, [pickingDest, mapsReady]);

  // Update polyline appearance when selectedTier changes without redrawing
  useEffect(() => {
    polylinesRef.current.forEach((pl, tier) => {
      const isSelected = selectedTier === null || selectedTier === tier;
      pl.setOptions({
        strokeOpacity: isSelected ? 0.95 : 0.3,
        strokeWeight: selectedTier === tier ? 7 : 4,
      });
    });
  }, [selectedTier]);

  return (
    <div style={styles.wrapper}>
      {mapsError ? (
        <div style={styles.loadingOverlay}>
          <div style={styles.errorOverlayContent}>
            <p style={styles.loadingText}>{t("mapNoConnection")}</p>
            <button style={styles.retryMapBtn} onClick={() => window.location.reload()}>
              {t("tryAgain")}
            </button>
          </div>
        </div>
      ) : !mapsReady && (
        <div style={styles.loadingOverlay}>
          <p style={styles.loadingText}>{t("loadingMap")}</p>
        </div>
      )}
      {pickingDest && (
        <div style={styles.pickHint}>
          {t("tapMapDest")}
        </div>
      )}
      {pickingOrigin && (
        <div style={styles.pickHint}>
          {t("tapMapOrigin")}
        </div>
      )}
      <div ref={containerRef} style={styles.map} />
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrapper: {
    position: "relative",
    width: "100%",
    height: "100%",
  },
  map: {
    width: "100%",
    height: "100%",
  },
  loadingOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f5f5f5",
    zIndex: 10,
  },
  loadingText: {
    fontSize: 16,
    color: "#888",
  },
  errorOverlayContent: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 16,
  },
  retryMapBtn: {
    padding: "9px 24px",
    borderRadius: 20,
    border: "none",
    backgroundColor: "#2E7D32",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  pickHint: {
    position: "absolute",
    top: 12,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 30,
    backgroundColor: "#2E7D32",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    padding: "8px 18px",
    borderRadius: 20,
    pointerEvents: "none",
    whiteSpace: "nowrap",
    boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
  },
};
