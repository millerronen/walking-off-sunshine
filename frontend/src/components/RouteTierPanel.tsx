import type { CSSProperties } from "react";
import type { ShadeRoute, TierPercent } from "../types";
import { TIER_COLORS, TIER_LABELS } from "../types";

interface Props {
  routes: ShadeRoute[];
  selectedTier: TierPercent | null;
  onSelectTier: (tier: TierPercent | null) => void;
  shortestDistanceMeters: number;
}

function formatDistance(meters: number): string {
  return (meters / 1000).toFixed(2) + " km";
}

function formatDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h} hr` : `${h} hr ${rem} min`;
}

function shadePercent(score: number): string {
  return Math.round(score * 100) + "%";
}

function buildGoogleMapsUrl(polyline: ShadeRoute["polyline"]): string {
  if (polyline.length < 2) return "https://maps.google.com";
  const origin = `${polyline[0].lat},${polyline[0].lon}`;
  const destination = `${polyline[polyline.length - 1].lat},${polyline[polyline.length - 1].lon}`;
  // Sample up to 8 intermediate waypoints evenly to stay within URL limits
  const inner = polyline.slice(1, -1);
  const step = Math.max(1, Math.floor(inner.length / 8));
  const waypoints = inner
    .filter((_, i) => i % step === 0)
    .slice(0, 8)
    .map((p) => `${p.lat},${p.lon}`)
    .join("|");
  const base = "https://www.google.com/maps/dir/?api=1";
  return `${base}&origin=${origin}&destination=${destination}&travelmode=walking&dir_action=navigate${waypoints ? `&waypoints=${waypoints}` : ""}`;
}

export function RouteTierPanel({
  routes,
  selectedTier,
  onSelectTier,
  shortestDistanceMeters,
}: Props) {
  if (routes.length === 0) return null;

  return (
    <div style={styles.panel}>
      <h2 style={styles.heading}>Route Options</h2>
      <p style={styles.shortest}>
        Shortest distance: {formatDistance(shortestDistanceMeters)}
      </p>
      <div style={styles.list}>
        {routes.map((route) => {
          const color = TIER_COLORS[route.tierPercent];
          const isSelected = selectedTier === route.tierPercent;
          return (
            <button
              key={route.tierPercent}
              style={{
                ...styles.card,
                borderColor: isSelected ? color : "#e0e0e0",
                backgroundColor: isSelected ? color + "18" : "#fff",
                boxShadow: isSelected
                  ? `0 0 0 2px ${color}`
                  : "0 1px 3px rgba(0,0,0,0.08)",
              }}
              onClick={() =>
                onSelectTier(
                  isSelected ? null : route.tierPercent
                )
              }
            >
              {/* Tier badge */}
              <div
                style={{
                  ...styles.badge,
                  backgroundColor: color,
                }}
              >
                <span style={styles.badgeText}>
                  {route.tierPercent === 100 ? "#1" : route.tierPercent === 75 ? "#2" : route.tierPercent === 50 ? "#3" : "#4"}
                </span>
              </div>

              {/* Route info */}
              <div style={styles.info}>
                <p style={styles.tierLabel}>
                  {TIER_LABELS[route.tierPercent]}
                </p>
                <div style={styles.stats}>
                  <span style={styles.stat}>
                    🌿 {shadePercent(route.shadeScore)} shade
                  </span>
                  <span style={styles.stat}>
                    📍 {formatDistance(route.distanceMeters)}
                  </span>
                  <span style={styles.stat}>
                    🕒 {formatDuration(route.durationSeconds)}
                  </span>
                </div>
              </div>

              {/* Navigate button */}
              <a
                href={buildGoogleMapsUrl(route.polyline)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...styles.navigateBtn, borderColor: color, color }}
                onClick={(e) => e.stopPropagation()}
              >
                ↗
              </a>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    paddingTop: 8,
  },
  heading: {
    fontSize: 15,
    fontWeight: 700,
    color: "#1a1a1a",
  },
  shortest: {
    fontSize: 12,
    color: "#888",
    marginTop: -6,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  card: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 10,
    border: "1.5px solid #e0e0e0",
    cursor: "pointer",
    textAlign: "left",
    transition: "border-color 0.15s, background-color 0.15s",
    position: "relative",
    background: "none",
    width: "100%",
  },
  badge: {
    width: 44,
    height: 44,
    borderRadius: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  badgeText: {
    color: "#fff",
    fontWeight: 800,
    fontSize: 13,
    textShadow: "0 1px 2px rgba(0,0,0,0.25)",
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  tierLabel: {
    fontWeight: 600,
    fontSize: 14,
    color: "#1a1a1a",
    marginBottom: 4,
  },
  stats: {
    display: "flex",
    flexWrap: "wrap",
    gap: "2px 10px",
  },
  stat: {
    fontSize: 12,
    color: "#555",
  },
  navigateBtn: {
    flexShrink: 0,
    width: 32,
    height: 32,
    borderRadius: 8,
    border: "1.5px solid",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 16,
    fontWeight: 700,
    textDecoration: "none",
    background: "transparent",
  },
};
