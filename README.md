# Paragliding Task Planner 🪂

A fast, offline-capable Progressive Web Application (PWA) for designing, optimizing, randomizing, and sharing competition and cross-country paragliding tasks.

Designed for paragliding competition task setters and pilots with CIVL-compliant WGS-84 geodesic route optimization, interactive map controls, and instant QR export to flight instruments.

---

## Features

- **CIVL WGS-84 Geodesic Optimization**: Calculates the exact shortest path touching all cylinders on the WGS-84 ellipsoid using Vincenty formulas.
- **Topographic & Satellite Basemaps**:
  - **OpenTopoMap** (default with elevation contours and labeled peaks)
  - **ESRI World Topo** (shaded relief)
  - **Satellite** (aerial photography)
  - **CyclOSM** (outdoor recreation topo)
  - **Standard OSM**
- **Distance Scale**: Metric map scale indicator in the bottom-left corner.
- **Smart Waypoint Labels**:
  - 3-way toggle cycling: **Codes Only** ➔ **Codes + Names** ➔ **No Labels**.
  - Interactive hover expansion reveals elevation, coordinates, and full names.
- **Constraint-Based Task Randomizer**:
  - Target distance matching within configurable tolerance (e.g. ±0.5 km).
  - Multi-run diversity guarantee: avoids overlapping routes ($> 80\%$ similarity rejected).
  - Respects paragliding angles ($20^\circ - 160^\circ$) and minimum leg lengths.
  - Locked Launch (T-code) and Goal (G-code) turnpoints with automatic 2 km SSS / ESS cylinders.
- **Touchpoint Route Alternatives**:
  - Click directly on the contact point where the optimized route hits a cylinder perimeter.
  - Automatically searches the waypoint database for alternative waypoints whose cylinders preserve the exact route heading and touchpoint.
- **Freehand Task Drawing**:
  - Draw a freehand path across the map to automatically snap to the nearest catalog waypoints and generate a valid task.
- **Batch Multi-Select Operations**:
  - Multi-select turnpoints to duplicate, reverse, lock/unlock, or batch delete.
- **Flight Instrument QR Code & File Export**:
  - Generates compact **XCTrack Format 2** (`XCTSK:...`) QR codes for scanning from paper or screen.
  - Built-in camera QR scanner to scan tasks from other pilots or printed task sheets.
  - Direct file download for `.xctsk` (JSON) and `.cup` (SeeYou) formats.
  - Web Share API integration (WhatsApp, Telegram, AirDrop).
- **Offline PWA & Map Tile Caching**:
  - Service Worker offline caching for app functionality on remote launches.
  - One-click area tile caching with IndexedDB tile storage.

---

## Getting Started

### Local Development / Running Locally

1. Clone the repository:
   ```bash
   git clone https://github.com/jbcohn/task-planner.git
   cd task-planner
   ```

2. Start the lightweight Node.js server:
   ```bash
   node server.js
   ```

3. Open your browser to:
   ```
   http://localhost:8080/
   ```

### Running Automated Tests

Run the test suites (math, parsers, optimizer, randomizer, reverse cycle, overlap, QR encoding):
```bash
node test/test-all.js
node test/test-overlap.js
node test/test-diversity.js
```

---

## File Structure

```
task-planner/
├── css/
│   └── styles.css              # Dark mode UI theme & responsive layout
├── js/
│   ├── app.js                  # Main application orchestrator & event bus
│   ├── geo-math.js             # WGS-84 Vincenty geodesic distance & destination
│   ├── drawing/
│   │   └── freehand-tracer.js  # Freehand line Douglas-Peucker & snapping
│   ├── offline/
│   │   └── tile-cache.js       # IndexedDB tile caching & tile fetching
│   ├── optimizer/
│   │   ├── randomizer-solver.js # Constraint-satisfaction task generator
│   │   ├── reverse-cycle.js    # Touchpoint route alternative candidate finder
│   │   └── task-optimizer.js   # Shortest-path cylinder tangent optimizer
│   ├── parsers/
│   │   ├── cup-parser.js       # SeeYou .cup waypoint parser
│   │   └── wpt-parser.js       # OziExplorer / CompeGPS .wpt parser
│   ├── qr/
│   │   └── xctrack-qr.js       # Format 1 & Format 2 XCTrack QR & encoders
│   └── ui/
│       ├── map-controller.js   # Leaflet map layers, cylinders, touchpoints, scale
│       └── task-sheet.js       # Turnpoint cards, drag-drop, batch actions
├── lib/                        # Vendor libraries (Leaflet, QR generator/scanner)
├── test/                       # Node.js test suites
├── index.html                  # Main application entry point
├── manifest.webmanifest        # PWA manifest
├── server.js                   # Lightweight static file server (no-cache headers)
└── sw.js                       # Service Worker for offline PWA
```

---

## License

MIT License.
