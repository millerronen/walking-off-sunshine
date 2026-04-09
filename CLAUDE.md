# Walking Off Sunshine — Project Context

## What This App Does
Mobile app (iOS + Android + web) that finds walking routes maximizing shade from buildings and trees, based on sun position at a given time.

## Stack

### Backend
- Kotlin + Spring Boot, deployed on **Google Cloud Run**
- GCP project: `walking-off-sunshine`
- Region: `europe-west1`
- Routes API, Overpass API (OSM buildings + trees), JTS geometry
- GCS tile cache bucket for OSM data
- Image: `europe-west1-docker.pkg.dev/walking-off-sunshine/walking-off-sunshine/backend:latest`

### Frontend
- React + TypeScript + Vite
- Capacitor for iOS (Xcode) and Android (Android Studio) native wrappers
- Google Maps JavaScript API + Places API
- Deployed on Cloud Run
- Image: `europe-west1-docker.pkg.dev/walking-off-sunshine/walking-off-sunshine/frontend:latest`
- Cloud Build config: `frontend/cloudbuild.yaml`
- API key injected via Secret Manager: `VITE_GOOGLE_MAPS_API_KEY`

## API Keys
- **Frontend key** (Maps JS + Places): stored in Secret Manager, injected at build time via `cloudbuild.yaml`, also in `frontend/android/local.properties` (gitignored)
- **Backend key** (Routes API only): in `backend/src/main/resources/application.yml` or env var
- `local.properties` is gitignored — never commit it

## Deploy Commands
```bash
# Frontend
cd frontend && gcloud builds submit --config cloudbuild.yaml .
gcloud run deploy walking-off-sunshine-frontend --image europe-west1-docker.pkg.dev/walking-off-sunshine/walking-off-sunshine/frontend:latest --region europe-west1 --set-env-vars BACKEND_URL=https://walking-off-sunshine-backend-6p2pjp4q7a-ew.a.run.app --allow-unauthenticated

# Backend
cd backend && gcloud builds submit --tag europe-west1-docker.pkg.dev/walking-off-sunshine/walking-off-sunshine/backend:latest .
gcloud run deploy walking-off-sunshine-backend --image europe-west1-docker.pkg.dev/walking-off-sunshine/walking-off-sunshine/backend:latest --region europe-west1
```

## Cloud Run Service URLs
- Frontend: `https://walking-off-sunshine-frontend-133268494307.europe-west1.run.app`
- Backend: `https://walking-off-sunshine-backend-6p2pjp4q7a-ew.a.run.app`

## Key Conventions
- Perpendicular waypoint offset: `(directDistanceM * 0.3).coerceIn(30.0, 500.0)` — keeps short-route alternatives valid
- Route tolerance: 30% over direct distance (routes >1.3× filtered out)
- Default tree height: 7.0m (configurable in `application.yml`)
- Time picker UI: "Now" / "Choose time" chips in SearchPanel
- GPS mode: blue dot marker at GPS fix, map pans to zoom 16

## Git Remote
`https://github.com/millerronen/walking-off-sunshine.git`
