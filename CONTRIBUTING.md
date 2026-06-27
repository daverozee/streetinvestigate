# Contributing

Thanks for helping improve Infinite Atlas.

This project is a small static prototype, so the best contributions are focused, easy to review, and careful with public mapping services.

## Getting Started

1. Fork the repository.
2. Clone your fork.
3. Serve the project folder locally:

```powershell
python -m http.server 8787
```

4. Open `http://127.0.0.1:8787/`.
5. Make your change in a focused branch.
6. Open a pull request with a short description and screenshots or screen recordings for visual changes.

## Development Guidelines

- Keep the app static unless there is a strong reason to add a build step.
- Keep dependencies light and explain any new dependency in the pull request.
- Respect OpenStreetMap tile and Overpass usage policies. Do not add bulk tile scraping, planet-scale downloads, or aggressive prefetching.
- Prefer readable code over clever code.
- Test atlas mode and Street Mode before opening a pull request.
- Check mobile layout if your change touches HUDs, controls, or canvas sizing.

## Good First Issues

- Improve touch controls in Street Mode.
- Add road markings and crosswalk hints.
- Improve building color and height heuristics.
- Add lightweight collision so the player stays on roads/paths.
- Add more OSM tags such as benches, transit stops, shops, bridges, and tunnels.
- Improve README screenshots and examples.

## Pull Request Checklist

- The app still runs with a static server.
- No console errors in atlas mode.
- No console errors after entering Street Mode.
- Public API usage remains viewport/player-position based.
- Visual changes include a screenshot or short explanation.

## Conduct

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
