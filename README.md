# Infinite Atlas

Infinite Atlas is a browser-based infinite terrain and street-level exploration prototype.

It blends three layers:

- A 2D atlas with OpenStreetMap tiles and procedural terrain.
- A first-person Street Mode that turns live OSM geometry into roads, buildings, parks, water, and trees.
- Procedural fallback terrain and city generation for places where map data is sparse.

## Run

Serve the folder with any static file server:

```powershell
python -m http.server 8787
```

Then open:

```text
http://127.0.0.1:8787/
```

## Controls

- Drag or use arrow/WASD controls in atlas mode.
- Use the walking icon to enter Street Mode.
- In Street Mode, use WASD or arrow keys to move.
- Drag the scene to look around.
- Use the sync button to reload Street Mode from the current atlas position.
- Use the camera button in Street Mode to search nearby Panoramax street-level imagery.

## Data

- Map tiles and map data are from OpenStreetMap contributors.
- OSM geometry is queried live through Overpass API endpoints.
- Street-level imagery lookup uses Panoramax when nearby imagery is available.

## Notes

The app is a static prototype and does not require a build step.
