# Infinite Atlas

Infinite Atlas is a browser-based infinite terrain and street-level exploration prototype.

It is early-stage, experimental, and open to contributors who want to explore procedural worlds, mapping data, first-person navigation, or street-level interfaces.

It blends three layers:

- A 2D atlas with OpenStreetMap tiles and procedural terrain.
- A first-person Street Mode that turns live OSM geometry into roads, buildings, parks, water, and trees.
- Procedural fallback terrain and city generation for places where map data is sparse.

## Features

- Static browser app with no build step.
- OpenStreetMap tile overlay for atlas navigation.
- Live Overpass API queries for nearby OSM roads, buildings, parks, water, and trees.
- First-person Street Mode with walk controls and mouse/touch look.
- Reverse-geocoded street address display while navigating in Street Mode.
- OSM-derived street signs, road markings, building plaques, address labels, and facade detail.
- Procedural fallback terrain and city generation when live map data is sparse.
- Optional Panoramax nearby street-level imagery lookup.
- Webcam overlay support in atlas mode.

## Run

Serve the folder with any static file server:

```powershell
python -m http.server 8787
```

Then open:

```text
http://127.0.0.1:8787/
```

If you have Python installed on Windows, this command is often:

```powershell
py -m http.server 8787
```

## Controls

- Drag or use arrow/WASD controls in atlas mode.
- Use the walking icon to enter Street Mode.
- In Street Mode, use WASD or arrow keys to move.
- Drag the scene to look around.
- Use the sync button to reload Street Mode from the current atlas position.
- Use the camera button in Street Mode to search nearby Panoramax street-level imagery.

## Contributing

Contributions are welcome. Good first areas include:

- Better first-person movement and collision.
- More faithful OSM tag rendering.
- Performance improvements for dense OSM areas.
- Better mobile Street Mode controls.
- Visual polish for buildings, roads, terrain, and lighting.
- Better labels and signs that stay grounded in mapped OSM data.
- More street-level imagery providers.
- Offline or cached data experiments that respect provider policies.

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Data

- Map tiles and map data are from OpenStreetMap contributors.
- OSM geometry is queried live through Overpass API endpoints.
- Street address lookup uses OpenStreetMap Nominatim reverse geocoding.
- Street-level imagery lookup uses Panoramax when nearby imagery is available.

Please be considerate with public APIs. The prototype queries only around the current view/player position, caches address lookups, and should not be modified to bulk download map tiles, OSM data, or geocoding results.

## Notes

The app is a static prototype and does not require a build step.

## License

Code is released under the [MIT License](LICENSE).
