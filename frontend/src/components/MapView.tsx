import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ShadeRoute, TierPercent } from "../types";
import { TIER_COLORS } from "../types";

interface Props {
  routes: ShadeRoute[];
  selectedTier: TierPercent | null;
}

export function MapView({ routes, selectedTier }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const polylinesRef = useRef<
    Map<TierPercent, google.maps.Polyline>
  >(new Map());
  const [mapsReady, setMapsReady] = useState(false);

  // Wait for Maps API to be available
  useEffect(() => {
    window.__googleMapsReadyPromise.then(() => setMapsReady(true));
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
      {!mapsReady && (
        <div style={styles.loadingOverlay}>
          <p style={styles.loadingText}>Loading map…</p>
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
};
