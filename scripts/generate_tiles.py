#!/usr/bin/env python3
"""
Offline tile generator for Walking Off Sunshine.

Downloads the Israel OSM PBF extract, extracts buildings and trees,
tiles them into 0.005° grid cells, and uploads JSON tiles to GCS
in the same format as the Overpass-based runtime cache.

Usage:
    pip install osmium google-cloud-storage
    python scripts/generate_tiles.py [--dry-run] [--local-pbf path/to/israel.osm.pbf]

Cost: ~$3 one-time (GCS writes) + ~$0.05/month storage.
"""

import argparse
import json
import math
import os
import sys
import tempfile
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

import osmium

TILE_SIZE_DEG = 0.005

# Israel bounding box (generous, includes Golan + Eilat)
ISRAEL_SOUTH = 29.45
ISRAEL_NORTH = 33.35
ISRAEL_WEST = 34.20
ISRAEL_EAST = 35.90

PBF_URL = "https://download.geofabrik.de/asia/israel-and-palestine-latest.osm.pbf"

GCS_BUCKET = "walking-off-sunshine-osm-tiles"


def snap_to_tile(coord: float) -> float:
    return math.floor(coord / TILE_SIZE_DEG) * TILE_SIZE_DEG


def tile_key_str(south: float, west: float) -> str:
    return "%.5f_%.5f" % (south, west)


# ── OSM handlers ─────────────────────────────────────────────────

class BuildingHandler(osmium.SimpleHandler):
    """Collects building ways into tiles."""

    def __init__(self):
        super().__init__()
        # tile_key -> list of Overpass-style element dicts
        self.tiles: dict[str, list[dict]] = defaultdict(list)
        self.count = 0

    def way(self, w):
        if "building" not in w.tags:
            return
        if not w.nodes:
            return

        nodes = []
        for n in w.nodes:
            try:
                nodes.append({"lat": n.lat, "lon": n.lon})
            except osmium.InvalidLocationError:
                return

        if len(nodes) < 3:
            return

        tags = {t.k: t.v for t in w.tags}

        # Tile by centroid
        avg_lat = sum(n["lat"] for n in nodes) / len(nodes)
        avg_lon = sum(n["lon"] for n in nodes) / len(nodes)
        tk = tile_key_str(snap_to_tile(avg_lat), snap_to_tile(avg_lon))

        self.tiles[tk].append({
            "type": "way",
            "geometry": nodes,
            "tags": tags,
        })
        self.count += 1
        if self.count % 50000 == 0:
            print(f"  buildings: {self.count} processed...", flush=True)


class TreeHandler(osmium.SimpleHandler):
    """Collects tree nodes and tree_row ways into tiles."""

    def __init__(self):
        super().__init__()
        self.tiles: dict[str, list[dict]] = defaultdict(list)
        self.count = 0

    def node(self, n):
        if n.tags.get("natural") != "tree":
            return
        try:
            lat, lon = n.location.lat, n.location.lon
        except osmium.InvalidLocationError:
            return

        tags = {t.k: t.v for t in n.tags}
        tk = tile_key_str(snap_to_tile(lat), snap_to_tile(lon))

        self.tiles[tk].append({
            "type": "node",
            "lat": lat,
            "lon": lon,
            "geometry": [],
            "tags": tags,
        })
        self.count += 1
        if self.count % 50000 == 0:
            print(f"  trees (nodes): {self.count} processed...", flush=True)

    def way(self, w):
        if w.tags.get("natural") != "tree_row":
            return

        nodes = []
        for n in w.nodes:
            try:
                nodes.append({"lat": n.lat, "lon": n.lon})
            except osmium.InvalidLocationError:
                return

        if len(nodes) < 2:
            return

        tags = {t.k: t.v for t in w.tags}
        avg_lat = sum(n["lat"] for n in nodes) / len(nodes)
        avg_lon = sum(n["lon"] for n in nodes) / len(nodes)
        tk = tile_key_str(snap_to_tile(avg_lat), snap_to_tile(avg_lon))

        self.tiles[tk].append({
            "type": "way",
            "lat": None,
            "lon": None,
            "geometry": nodes,
            "tags": tags,
        })
        self.count += 1


# ── Tile generation ──────────────────────────────────────────────

def all_tile_keys() -> list[str]:
    """Generate all tile keys covering Israel."""
    keys = []
    lat = snap_to_tile(ISRAEL_SOUTH)
    while lat <= ISRAEL_NORTH:
        lon = snap_to_tile(ISRAEL_WEST)
        while lon <= ISRAEL_EAST:
            keys.append(tile_key_str(lat, lon))
            lon += TILE_SIZE_DEG
        lat += TILE_SIZE_DEG
    return keys


def download_pbf(dest: str):
    print(f"Downloading Israel PBF from Geofabrik...")
    urllib.request.urlretrieve(PBF_URL, dest)
    size_mb = os.path.getsize(dest) / (1024 * 1024)
    print(f"  Downloaded {size_mb:.1f} MB")


def upload_to_gcs(tiles: dict[str, list[dict]], prefix: str, all_keys: list[str], dry_run: bool):
    """Upload tile JSON files to GCS.

    All tiles in the Israel grid are uploaded — populated ones with their
    elements, empty ones with {"elements":[]}. This ensures the runtime
    never falls through to Overpass: a GCS cache hit with an empty list
    means "no data here", not "we haven't checked yet".
    """
    from google.cloud import storage

    populated = sum(1 for k in all_keys if tiles.get(k))
    empty = len(all_keys) - populated
    total_elements = sum(len(v) for v in tiles.values())
    print(f"  {prefix}: {populated} tiles with data, {empty} empty tiles, {total_elements} total elements")

    if dry_run:
        print(f"  [DRY RUN] skipping upload")
        return

    client = storage.Client()
    bucket = client.bucket(GCS_BUCKET)
    empty_json = json.dumps({"elements": []}, separators=(",", ":"))

    # Pre-serialize all tile JSON payloads
    payloads = []
    for tk in all_keys:
        elements = tiles.get(tk, [])
        blob_name = f"tiles/{prefix}/{tk}.json"
        data = json.dumps({"elements": elements}, separators=(",", ":")) if elements else empty_json
        payloads.append((blob_name, data))

    uploaded = threading.atomic() if hasattr(threading, 'atomic') else None
    counter = [0]
    counter_lock = threading.Lock()
    total = len(payloads)

    def upload_one(item):
        blob_name, data = item
        blob = bucket.blob(blob_name)
        blob.upload_from_string(data, content_type="application/json")
        with counter_lock:
            counter[0] += 1
            if counter[0] % 5000 == 0:
                print(f"  {prefix}: uploaded {counter[0]}/{total} tiles...", flush=True)

    workers = 32
    print(f"  {prefix}: uploading {total} tiles with {workers} parallel workers...")
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(upload_one, item) for item in payloads]
        for f in as_completed(futures):
            f.result()  # re-raise any exception

    print(f"  {prefix}: uploaded {counter[0]} tiles to gs://{GCS_BUCKET}/tiles/{prefix}/")


def main():
    parser = argparse.ArgumentParser(description="Generate OSM tiles for Walking Off Sunshine")
    parser.add_argument("--dry-run", action="store_true", help="Parse PBF and report stats without uploading")
    parser.add_argument("--local-pbf", type=str, help="Path to local PBF file (skip download)")
    parser.add_argument("--prefix", type=str, choices=["buildings", "trees", "both"], default="both",
                        help="Which tile type to generate (default: both)")
    args = parser.parse_args()

    # 1. Get PBF file
    if args.local_pbf:
        pbf_path = args.local_pbf
        print(f"Using local PBF: {pbf_path}")
    else:
        pbf_path = os.path.join(tempfile.gettempdir(), "israel-latest.osm.pbf")
        if os.path.exists(pbf_path):
            size_mb = os.path.getsize(pbf_path) / (1024 * 1024)
            print(f"Using cached PBF: {pbf_path} ({size_mb:.1f} MB)")
        else:
            download_pbf(pbf_path)

    # 2. Generate all tile keys for Israel
    all_keys = all_tile_keys()
    print(f"Israel grid: {len(all_keys)} tiles at {TILE_SIZE_DEG}° resolution")

    # 3. Extract buildings
    if args.prefix in ("buildings", "both"):
        print("Extracting buildings...")
        bh = BuildingHandler()
        bh.apply_file(pbf_path, locations=True)
        print(f"  Found {bh.count} buildings across {len(bh.tiles)} tiles")
        upload_to_gcs(bh.tiles, "buildings", all_keys, args.dry_run)
        del bh  # free memory

    # 4. Extract trees
    if args.prefix in ("trees", "both"):
        print("Extracting trees...")
        th = TreeHandler()
        th.apply_file(pbf_path, locations=True)
        print(f"  Found {th.count} trees across {len(th.tiles)} tiles")
        upload_to_gcs(th.tiles, "trees", all_keys, args.dry_run)
        del th

    print("Done!")


if __name__ == "__main__":
    main()
