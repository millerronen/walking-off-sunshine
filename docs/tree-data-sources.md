# Tree Data Sources for Future Integration

Current approach: **OSM/Overpass API** for tree data, falling back to defaults (4m canopy radius, 7m height) when tags are missing. Many cities publish richer tree inventories that could improve shade accuracy.

## Top Candidates (have canopy/height data)

| City | Trees | Key data | Format |
|---|---|---|---|
| Melbourne | ~70K | species, canopy size, age, health | CSV, GeoJSON, API |
| NYC | ~680K | species, diameter | CSV, GeoJSON, Socrata API |
| Paris | ~200K | height, circumference, species | CSV, GeoJSON, CKAN API |
| Berlin | ~800K | species, trunk circumference, planting year | CSV, GeoJSON, WFS |
| Singapore | comprehensive | NParks full inventory | OneMap API |
| Tel Aviv | existing | already available | GeoJSON, CSV |

## Other Cities with Open Tree Data

San Francisco, London, Amsterdam, Vienna, Barcelona, Madrid, Toronto, Vancouver, Montreal, Washington DC, Chicago, Seattle, Helsinki, Copenhagen, Dublin, Brussels, Zurich, Sydney, Brisbane, Auckland, Seoul, Hong Kong, Los Angeles, Boston, Portland, Denver, Austin, Pittsburgh, Minneapolis, Edmonton, Ottawa, Hamburg.

## Global Platforms

- **OpenTreeMap** — used by dozens of cities (Philadelphia, Sacramento, etc.), REST/JSON API
- **Google Environmental Insights Explorer** — tree canopy coverage percentages for thousands of cities (not individual trees)
- **Global Forest Watch** — satellite-derived canopy cover rasters, global coverage, API available

## Integration Approach

- Per-city adapter that checks for city-specific data first, falls back to Overpass/OSM
- Prioritize cities based on user concentration
- Key fields to extract: canopy diameter, height, species (for lookup of typical canopy dimensions)
