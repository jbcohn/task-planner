// task-planner/js/ui/map-controller.js
import { createOfflineTileLayer } from '../offline/tile-cache.js';
import { formatRadiusDisplay, vincentyBearing, vincentyDestination } from '../geo-math.js';

export const BASE_LAYERS_CONFIG = {
    esritopo: {
        name: '🗺️ ESRI World Topo (Shaded Relief)',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
        options: {
            maxZoom: 19,
            layerId: 'esritopo',
            attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, USGS'
        }
    },
    opentopo: {
        name: '⛰️ OpenTopoMap (Contours & Peaks)',
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        options: {
            maxZoom: 19,
            maxNativeZoom: 17,
            subdomains: ['a', 'b', 'c'],
            layerId: 'opentopo',
            attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)'
        }
    },
    satellite: {
        name: '🛰️ Satellite (Aerial Imagery)',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        options: {
            maxZoom: 19,
            layerId: 'satellite',
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics'
        }
    },
    cyclosm: {
        name: '🚲 CyclOSM (Outdoor Topo)',
        url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
        options: {
            maxZoom: 19,
            maxNativeZoom: 18,
            subdomains: ['a', 'b', 'c'],
            layerId: 'cyclosm',
            attribution: '&copy; OpenStreetMap contributors, CyclOSM'
        }
    },
    osm: {
        name: '📍 OpenStreetMap (Standard)',
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        options: {
            maxZoom: 19,
            layerId: 'osm',
            attribution: '&copy; OpenStreetMap contributors'
        }
    }
};

export class MapController {
    constructor({ 
        mapElementId, 
        drawCanvasId, 
        onAddWaypointToTask, 
        onRemoveWaypointFromTask,
        onSetLaunchWaypoint, 
        onSetGoalWaypoint, 
        onCutPointSelected, 
        onFreehandStrokeComplete,
        onRemoveTurnpoint,
        onFocusTurnpoint
    }) {
        this.mapElementId = mapElementId;
        this.drawCanvasId = drawCanvasId;
        this.onAddWaypointToTask = onAddWaypointToTask;
        this.onRemoveWaypointFromTask = onRemoveWaypointFromTask;
        this.onSetLaunchWaypoint = onSetLaunchWaypoint;
        this.onSetGoalWaypoint = onSetGoalWaypoint;
        this.onCutPointSelected = onCutPointSelected;
        this.onFreehandStrokeComplete = onFreehandStrokeComplete;
        this.onRemoveTurnpoint = onRemoveTurnpoint;
        this.onFocusTurnpoint = onFocusTurnpoint;

        this.showWaypointLabels = true;
        this.labelMode = (typeof localStorage !== 'undefined' && localStorage.getItem('pg_label_mode')) || 'codes';
        this.routeColor = (typeof localStorage !== 'undefined' && localStorage.getItem('pg_opt_line_color')) || '#0f172a';

        this.map = null;
        this.tileLayer = null;
        this.activeTileConfig = null;
        this.baseLayers = {};
        this.layerControl = null;
        this.waypointLayer = null;
        this.taskCylinderLayer = null;
        this.taskLineLayer = null;
        this.optLineLayer = null;
        this.touchpointLayer = null;

        this.isDrawingMode = false;
        this.drawCanvas = null;
        this.drawCtx = null;
        this.currentStroke = [];

        this.activeCutPoint = null;
        this.currentTurnpoints = [];
        this.currentOptimized = null;
    }

    init() {
        // Initialize Leaflet map
        this.map = L.map(this.mapElementId, {
            center: [44.0, 6.5], // Default Alps paragliding site
            zoom: 10,
            zoomControl: false,
            attributionControl: false
        });

        // Add zoom control to top-right
        L.control.zoom({ position: 'topright' }).addTo(this.map);

        // Add Metric Scale control to bottom-left
        L.control.scale({
            imperial: false,
            metric: true,
            position: 'bottomleft',
            maxWidth: 140
        }).addTo(this.map);

        // Setup Base Layers (ESRI Topo, OpenTopoMap, Satellite, CyclOSM, OSM) - default to OpenTopoMap
        this.baseLayers = {};
        const savedLayerKey = (typeof localStorage !== 'undefined' && localStorage.getItem('pg_selected_basemap')) || 'opentopo';
        let activeBaseLayerKey = BASE_LAYERS_CONFIG[savedLayerKey] ? savedLayerKey : 'opentopo';

        for (const [key, cfg] of Object.entries(BASE_LAYERS_CONFIG)) {
            const layer = createOfflineTileLayer(L, cfg.url, cfg.options);
            this.baseLayers[cfg.name] = layer;
            if (key === activeBaseLayerKey) {
                layer.addTo(this.map);
                this.tileLayer = layer;
                this.activeTileConfig = cfg;
            }
        }

        // Add Layer control to top-right
        this.layerControl = L.control.layers(this.baseLayers, null, {
            position: 'topright',
            collapsed: true
        }).addTo(this.map);

        this.map.on('baselayerchange', (e) => {
            for (const [key, cfg] of Object.entries(BASE_LAYERS_CONFIG)) {
                if (cfg.name === e.name) {
                    this.tileLayer = e.layer;
                    this.activeTileConfig = cfg;
                    try {
                        localStorage.setItem('pg_selected_basemap', key);
                    } catch (err) {}
                    break;
                }
            }
        });

        // Create layers
        this.waypointLayer = L.layerGroup().addTo(this.map);
        this.taskCylinderLayer = L.layerGroup().addTo(this.map);
        this.taskLineLayer = L.layerGroup().addTo(this.map);
        this.optLineLayer = L.layerGroup().addTo(this.map);
        this.touchpointLayer = L.layerGroup().addTo(this.map);

        this.applyLabelModeClass();
        this.initDrawingCanvas();
    }

    initDrawingCanvas() {
        this.drawCanvas = document.getElementById(this.drawCanvasId);
        if (!this.drawCanvas) return;
        this.drawCtx = this.drawCanvas.getContext('2d');

        const resize = () => {
            this.drawCanvas.width = window.innerWidth;
            this.drawCanvas.height = window.innerHeight;
        };
        resize();
        window.addEventListener('resize', resize);

        let isPointerDown = false;

        const startStroke = (e) => {
            if (!this.isDrawingMode) return;
            e.preventDefault();
            isPointerDown = true;
            this.currentStroke = [];
            this.drawCtx.clearRect(0, 0, this.drawCanvas.width, this.drawCanvas.height);
            this.drawCtx.beginPath();
            this.drawCtx.strokeStyle = '#0084ff';
            this.drawCtx.lineWidth = 4;
            this.drawCtx.lineCap = 'round';
            this.drawCtx.lineJoin = 'round';

            const rect = this.drawCanvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            const x = clientX - rect.left;
            const y = clientY - rect.top;

            this.drawCtx.moveTo(x, y);
            const latLng = this.map.containerPointToLatLng([x, y]);
            this.currentStroke.push({ lat: latLng.lat, lng: latLng.lng });
        };

        const moveStroke = (e) => {
            if (!this.isDrawingMode || !isPointerDown) return;
            e.preventDefault();
            const rect = this.drawCanvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            const x = clientX - rect.left;
            const y = clientY - rect.top;

            this.drawCtx.lineTo(x, y);
            this.drawCtx.stroke();

            const latLng = this.map.containerPointToLatLng([x, y]);
            this.currentStroke.push({ lat: latLng.lat, lng: latLng.lng });
        };

        const endStroke = () => {
            if (!this.isDrawingMode || !isPointerDown) return;
            isPointerDown = false;
            this.drawCtx.clearRect(0, 0, this.drawCanvas.width, this.drawCanvas.height);
            this.setDrawingMode(false);

            if (this.currentStroke.length > 2 && this.onFreehandStrokeComplete) {
                this.onFreehandStrokeComplete(this.currentStroke);
            }
        };

        this.drawCanvas.addEventListener('mousedown', startStroke);
        this.drawCanvas.addEventListener('mousemove', moveStroke);
        window.addEventListener('mouseup', endStroke);

        this.drawCanvas.addEventListener('touchstart', startStroke, { passive: false });
        this.drawCanvas.addEventListener('touchmove', moveStroke, { passive: false });
        window.addEventListener('touchend', endStroke);
    }

    setDrawingMode(active) {
        this.isDrawingMode = active;
        if (this.drawCanvas) {
            if (active) {
                this.drawCanvas.classList.add('active');
            } else {
                this.drawCanvas.classList.remove('active');
            }
        }
    }

    applyLabelModeClass() {
        if (typeof document === 'undefined') return;
        const mapEl = document.getElementById(this.mapElementId);
        if (!mapEl) return;
        mapEl.classList.remove('wp-labels-none', 'wp-labels-codes', 'wp-labels-all', 'hide-wp-labels');
        if (this.labelMode === 'none') {
            mapEl.classList.add('wp-labels-none');
        } else if (this.labelMode === 'all') {
            mapEl.classList.add('wp-labels-all');
        } else {
            mapEl.classList.add('wp-labels-codes');
        }
    }

    cycleWaypointLabelMode() {
        // Cycle order: 'codes' -> 'all' (codes+names) -> 'none' (off) -> 'codes'
        if (this.labelMode === 'codes') {
            this.labelMode = 'all';
        } else if (this.labelMode === 'all') {
            this.labelMode = 'none';
        } else {
            this.labelMode = 'codes';
        }
        try {
            localStorage.setItem('pg_label_mode', this.labelMode);
        } catch (err) {}
        this.applyLabelModeClass();
        return this.labelMode;
    }

    getWaypointLabelMode() {
        return this.labelMode;
    }

    toggleWaypointLabels() {
        return this.cycleWaypointLabelMode();
    }

    setRouteColor(color) {
        if (!color) return;
        this.routeColor = color;
        try {
            localStorage.setItem('pg_opt_line_color', color);
        } catch (err) {}
        if (this.currentTurnpoints && this.currentTurnpoints.length > 0) {
            this.renderTask(this.currentTurnpoints, this.currentOptimized);
        }
    }

    getRouteColor() {
        return this.routeColor || '#0f172a';
    }

    isColorDark(hex) {
        if (!hex || typeof hex !== 'string') return true;
        let c = hex.replace('#', '').trim();
        if (c.length === 3) c = c.split('').map(x => x + x).join('');
        const r = parseInt(c.substr(0, 2), 16) || 0;
        const g = parseInt(c.substr(2, 2), 16) || 0;
        const b = parseInt(c.substr(4, 2), 16) || 0;
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        return lum < 140;
    }

    getActiveTileConfig() {
        return this.activeTileConfig || BASE_LAYERS_CONFIG.opentopo;
    }

    setBaseLayer(key) {
        if (!BASE_LAYERS_CONFIG[key] || !this.baseLayers) return;
        const cfg = BASE_LAYERS_CONFIG[key];
        const targetLayer = this.baseLayers[cfg.name];
        if (!targetLayer) return;

        for (const [name, layer] of Object.entries(this.baseLayers)) {
            if (this.map.hasLayer(layer)) {
                this.map.removeLayer(layer);
            }
        }
        targetLayer.addTo(this.map);
        if (targetLayer.bringToBack) {
            targetLayer.bringToBack();
        }
        this.tileLayer = targetLayer;
        this.activeTileConfig = cfg;
        try {
            localStorage.setItem('pg_selected_basemap', key);
        } catch (err) {}
    }

    getActiveBaseLayerKey() {
        if (this.activeTileConfig) {
            for (const [k, cfg] of Object.entries(BASE_LAYERS_CONFIG)) {
                if (cfg.name === this.activeTileConfig.name) return k;
            }
        }
        return 'opentopo';
    }

    setActiveCutPoint(idx, cutPoint) {
        this.activeCutPoint = { index: idx, latLng: cutPoint };
        this.renderTouchpoints();
    }

    clearActiveCutPoint() {
        this.activeCutPoint = null;
        this.renderTouchpoints();
    }

    /**
     * Render interactive touchpoint markers at the contact points on cylinder perimeters.
     * Pilots click these directly to find alternative waypoints through the same touchpoint.
     */
    renderTouchpoints() {
        this.touchpointLayer.clearLayers();
        const optimized = this.currentOptimized;
        const turnpoints = this.currentTurnpoints;
        if (!optimized || !optimized.touchPoints || !turnpoints || turnpoints.length < 3) return;

        const N = turnpoints.length;
        for (let idx = 1; idx < N - 1; idx++) {
            const touchPt = optimized.touchPoints[idx];
            if (!touchPt) continue;

            const isActive = this.activeCutPoint && this.activeCutPoint.index === idx;
            const tp = turnpoints[idx];
            const wp = tp.waypoint;
            const displayCode = wp ? (wp.code || wp.name) : `#${idx + 1}`;

            const customIcon = L.divIcon({
                className: 'touchpoint-node-wrapper',
                html: `<div class="touchpoint-node ${isActive ? 'active' : ''}" data-idx="${idx}" title="Touchpoint TP ${idx + 1} (${displayCode}) - Click for Route Alternatives">
                    <span class="touchpoint-core"></span>
                </div>`,
                iconSize: [22, 22],
                iconAnchor: [11, 11]
            });

            const marker = L.marker([touchPt.lat, touchPt.lng], {
                icon: customIcon,
                zIndexOffset: isActive ? 3000 : 1800,
                interactive: true
            });

            marker.bindTooltip(`<strong>🎯 TP ${idx + 1} Touchpoint</strong> (${displayCode})<br><span style="font-size: 10px; color: #93c5fd;">Click to find alternative cylinders through this point</span>`, {
                direction: 'top',
                offset: [0, -10],
                className: 'touchpoint-map-tooltip'
            });

            marker.on('click', (e) => {
                if (e && e.originalEvent) {
                    e.originalEvent.stopPropagation();
                }
                this.setActiveCutPoint(idx, touchPt);
                if (this.onCutPointSelected) {
                    this.onCutPointSelected(idx, touchPt);
                }
            });

            this.touchpointLayer.addLayer(marker);
        }
    }

    /**
     * Render waypoint catalog on the map with visible permanent short codes.
     */
    renderWaypoints(waypoints) {
        this.waypointLayer.clearLayers();
        if (!waypoints || waypoints.length === 0) return;

        const markers = [];
        for (const wp of waypoints) {
            const marker = L.circleMarker([wp.lat, wp.lng], {
                radius: 5,
                fillColor: '#9ba8b5',
                color: '#0f1418',
                weight: 1.5,
                opacity: 0.9,
                fillOpacity: 0.8
            });

            // Turnpoint code shown on the map by default, full name revealed on hover / mouseover
            const displayCode = wp.code || wp.name;
            const hasFullName = wp.name && wp.name !== displayCode;
            const labelHtml = `<span class="wp-code">${displayCode}</span>${hasFullName ? `<span class="wp-fullname"> • ${wp.name}</span>` : ''}`;

            marker.bindTooltip(labelHtml, {
                permanent: true,
                direction: 'right',
                offset: [7, 0],
                className: 'wp-map-label',
                interactive: true
            });

            // Hovering either the marker dot or the label triggers full name display
            marker.on('mouseover', () => {
                const tip = marker.getTooltip();
                if (tip && tip.getElement()) {
                    tip.getElement().classList.add('hovered');
                }
            });
            marker.on('mouseout', () => {
                const tip = marker.getTooltip();
                if (tip && tip.getElement()) {
                    tip.getElement().classList.remove('hovered');
                }
            });

            // Clicking marker opens the popup card
            marker.on('click', () => marker.openPopup());

            // Clicking the tooltip label also opens the popup card
            marker.on('tooltipopen', (e) => {
                if (e.tooltip && e.tooltip.getElement()) {
                    e.tooltip.getElement().addEventListener('click', (evt) => {
                        evt.stopPropagation();
                        marker.openPopup();
                    });
                }
            });

            marker.bindPopup(() => this.buildWaypointPopupContent(wp));
            this.waypointLayer.addLayer(marker);
            markers.push([wp.lat, wp.lng]);
        }

        if (markers.length > 0) {
            this.map.fitBounds(L.latLngBounds(markers), { padding: [40, 40] });
        }
    }

    /**
     * Dynamically construct popup content for a catalog waypoint.
     * Evaluates whether the waypoint is currently in the active task to show 'Remove from Task'.
     */
    buildWaypointPopupContent(wp) {
        const displayCode = wp.code || wp.name;
        const hasFullName = wp.name && wp.name !== displayCode;
        const codeUpper = (wp.code || wp.name || '').toUpperCase();
        const isTakeoffEligible = codeUpper.startsWith('T');
        const descUpper = (wp.desc || wp.description || '').toUpperCase();
        const isGoalEligible = codeUpper.startsWith('G') || descUpper.includes('GOAL');

        // Check if this waypoint is currently part of the active task
        const inTaskMatches = (this.currentTurnpoints || []).filter(tp => tp.waypoint && tp.waypoint.id === wp.id);
        const isInTask = inTaskMatches.length > 0;

        const popupContent = document.createElement('div');
        popupContent.className = 'wp-popup-card';
        popupContent.innerHTML = `
            <div class="wp-popup-title"><span class="tp-code-badge">${displayCode}</span> ${hasFullName ? wp.name : ''}</div>
            <div class="wp-popup-elev">Alt: ${wp.elev || 0}m ${wp.style ? '• Style: ' + wp.style : ''}</div>
            ${wp.desc ? `<div class="wp-popup-desc">${wp.desc}</div>` : ''}
            <div class="wp-popup-actions">
                ${isTakeoffEligible ? `<button class="wp-popup-btn wp-btn-launch" id="btn-launch-${wp.id}">🚀 Set as Launch (Start)</button>` : ''}
                ${isGoalEligible ? `<button class="wp-popup-btn wp-btn-goal" id="btn-goal-${wp.id}">🏁 Set as Goal (End)</button>` : ''}
                <button class="wp-popup-btn wp-btn-add" id="btn-add-wp-${wp.id}">+ Add to Task</button>
                ${isInTask ? `<button class="wp-popup-btn wp-btn-remove" id="btn-remove-wp-${wp.id}">🗑️ Remove from Task${inTaskMatches.length > 1 ? ` (${inTaskMatches.length})` : ''}</button>` : ''}
            </div>
        `;

        if (isTakeoffEligible) {
            const btnLaunch = popupContent.querySelector(`#btn-launch-${wp.id}`);
            if (btnLaunch) {
                btnLaunch.addEventListener('click', () => {
                    this.map.closePopup();
                    if (this.onSetLaunchWaypoint) {
                        this.onSetLaunchWaypoint(wp);
                    }
                });
            }
        }

        if (isGoalEligible) {
            const btnGoal = popupContent.querySelector(`#btn-goal-${wp.id}`);
            if (btnGoal) {
                btnGoal.addEventListener('click', () => {
                    this.map.closePopup();
                    if (this.onSetGoalWaypoint) {
                        this.onSetGoalWaypoint(wp);
                    }
                });
            }
        }

        const btnAdd = popupContent.querySelector(`#btn-add-wp-${wp.id}`);
        if (btnAdd) {
            btnAdd.addEventListener('click', () => {
                this.map.closePopup();
                if (this.onAddWaypointToTask) {
                    this.onAddWaypointToTask(wp);
                }
            });
        }

        if (isInTask) {
            const btnRemove = popupContent.querySelector(`#btn-remove-wp-${wp.id}`);
            if (btnRemove) {
                btnRemove.addEventListener('click', () => {
                    this.map.closePopup();
                    if (this.onRemoveWaypointFromTask) {
                        this.onRemoveWaypointFromTask(wp);
                    }
                });
            }
        }

        return popupContent;
    }

    /**
     * Render task cylinders, center line, and optimized shortest path route.
     */
    renderTask(turnpoints, optimized) {
        this.currentTurnpoints = turnpoints || [];
        this.currentOptimized = optimized || null;

        this.taskCylinderLayer.clearLayers();
        this.taskLineLayer.clearLayers();
        this.optLineLayer.clearLayers();

        if (!turnpoints || turnpoints.length === 0) {
            this.clearActiveCutPoint();
            return;
        }

        const N = turnpoints.length;
        const centerPoints = [];

        // 1. Render Cylinders and Center Markers
        turnpoints.forEach((tp, idx) => {
            const wp = tp.waypoint;
            centerPoints.push([wp.lat, wp.lng]);
            const radiusM = tp.radius || 400;
            let color = '#0284c7'; // Turnpoint blue
            let dashArray = null;

            const type = (tp.type || '').toLowerCase();
            let roleSuffix = '';
            let labelClass = 'tp-map-label';

            if (type === 'takeoff') {
                color = '#d97706'; // Orange
                roleSuffix = ' (Launch)';
                labelClass += ' tp-takeoff';
            } else if (type === 'sss') {
                color = '#059669'; // Green
                dashArray = '6, 6';
                roleSuffix = ` (SSS ${(tp.direction || 'exit').toUpperCase()})`;
                labelClass += ' tp-sss';
            } else if (type === 'ess') {
                color = '#eab308'; // Yellow
                roleSuffix = ' (ESS)';
                labelClass += ' tp-ess';
            } else if (type === 'goal') {
                color = '#c026d3'; // Magenta
                roleSuffix = ' (Goal)';
                labelClass += ' tp-goal';
            } else {
                labelClass += ' tp-turnpoint';
            }

            const taskShapes = [];
            const isGoalLine = (type === 'goal' && tp.goalType === 'line');

            if (isGoalLine) {
                // Goal Line with semicircle perpendicular to incoming courseline
                let pPrev = null;
                if (optimized && optimized.points && optimized.points.length >= 2) {
                    pPrev = optimized.points[optimized.points.length - 2];
                } else if (idx > 0 && turnpoints[idx - 1] && turnpoints[idx - 1].waypoint) {
                    pPrev = turnpoints[idx - 1].waypoint;
                }

                const brngIn = pPrev ? vincentyBearing(pPrev, wp) : 0;
                const halfLength = radiusM; // In CIVL/XCTrack, radius is half the line length (e.g. 100m for 200m line)

                const leftPt = vincentyDestination(wp, halfLength, brngIn - Math.PI / 2);
                const rightPt = vincentyDestination(wp, halfLength, brngIn + Math.PI / 2);

                // Semicircle arc extending behind the goal line in the direction of the course
                const arcPoints = [[leftPt.lat, leftPt.lng]];
                const numSteps = 24;
                for (let s = 1; s < numSteps; s++) {
                    const angle = (brngIn - Math.PI / 2) + (Math.PI * s / numSteps);
                    const arcPt = vincentyDestination(wp, halfLength, angle);
                    arcPoints.push([arcPt.lat, arcPt.lng]);
                }
                arcPoints.push([rightPt.lat, rightPt.lng]);

                // Semicircle sector polygon
                const semiPolygon = L.polygon(arcPoints, {
                    color: color,
                    weight: 1.5,
                    dashArray: '4, 4',
                    fillColor: color,
                    fillOpacity: 0.16
                });
                taskShapes.push(semiPolygon);

                // White high-contrast casing polyline for line visibility over complex satellite/topo
                const goalLineCasing = L.polyline([[leftPt.lat, leftPt.lng], [rightPt.lat, rightPt.lng]], {
                    color: '#ffffff',
                    weight: 6,
                    opacity: 0.85,
                    lineCap: 'square'
                });
                taskShapes.push(goalLineCasing);

                // Prominent goal line perpendicular to incoming courseline
                const goalLine = L.polyline([[leftPt.lat, leftPt.lng], [rightPt.lat, rightPt.lng]], {
                    color: color,
                    weight: 4,
                    opacity: 1.0,
                    lineCap: 'square'
                });
                taskShapes.push(goalLine);
            } else {
                const circle = L.circle([wp.lat, wp.lng], {
                    radius: radiusM,
                    color: color,
                    weight: 2,
                    opacity: 0.9,
                    fillColor: color,
                    fillOpacity: 0.12,
                    dashArray: dashArray
                });
                taskShapes.push(circle);
            }

            // Center marker
            const centerMarker = L.circleMarker([wp.lat, wp.lng], {
                radius: 5,
                fillColor: color,
                color: '#ffffff',
                weight: 2,
                fillOpacity: 1
            });

            const displayCode = wp.code || wp.name;
            const hasFullName = wp.name && wp.name !== displayCode;
            const labelHtml = `<span class="tp-code">${idx + 1}. ${displayCode}${roleSuffix}</span>${hasFullName ? `<span class="tp-fullname"> • ${wp.name}</span>` : ''}<span class="tp-rad"> • ${formatRadiusDisplay(radiusM)}</span>`;

            // Permanent label for active task turnpoint showing index & code, expanding on hover
            centerMarker.bindTooltip(labelHtml, {
                permanent: true,
                direction: 'top',
                offset: [0, -6],
                className: labelClass,
                interactive: true
            });

            // Hovering center marker expands tooltip with full name
            centerMarker.on('mouseover', () => {
                const tip = centerMarker.getTooltip();
                if (tip && tip.getElement()) tip.getElement().classList.add('hovered');
            });
            centerMarker.on('mouseout', () => {
                const tip = centerMarker.getTooltip();
                if (tip && tip.getElement()) tip.getElement().classList.remove('hovered');
            });

            // Task turnpoint popup on click showing full name, role, radius, altitude, and action buttons
            const isIntermediate = idx > 0 && idx < N - 1;
            const tpPopupContent = document.createElement('div');
            tpPopupContent.className = 'wp-popup-card';
            tpPopupContent.innerHTML = `
                <div class="wp-popup-title">${idx + 1}. <span class="tp-code-badge">${displayCode}</span> ${hasFullName ? wp.name : ''}</div>
                <div class="wp-popup-elev">${roleSuffix ? roleSuffix.replace(/[()]/g, '').trim() + ' • ' : ''}Radius: ${formatRadiusDisplay(radiusM)} (${radiusM}m)</div>
                <div class="wp-popup-elev">Alt: ${wp.elev || 0}m ${tp.direction ? '• Direction: ' + tp.direction.toUpperCase() : ''}</div>
                ${wp.desc ? `<div class="wp-popup-desc">${wp.desc}</div>` : ''}
                <div class="wp-popup-actions" style="margin-top: 8px;">
                    <button class="wp-popup-btn" id="btn-tp-focus-${idx}" style="background: #0284c7; color: #ffffff; font-weight: 700;">🔍 Focus / Edit Radius</button>
                    ${isIntermediate ? `<button class="wp-popup-btn wp-btn-cutpoint" id="btn-tp-cutpoint-${idx}">🎯 Touchpoint Alternatives</button>` : ''}
                    <button class="wp-popup-btn wp-btn-add" id="btn-tp-add-again-${idx}">+ Add Waypoint Again</button>
                    <button class="wp-popup-btn wp-btn-remove" id="btn-tp-remove-${idx}">🗑️ Remove from Task</button>
                </div>
            `;

            if (isIntermediate) {
                const btnCut = tpPopupContent.querySelector(`#btn-tp-cutpoint-${idx}`);
                if (btnCut) {
                    btnCut.addEventListener('click', () => {
                        centerMarker.closePopup();
                        const cutPt = (optimized && optimized.touchPoints && optimized.touchPoints[idx]) 
                            ? optimized.touchPoints[idx] 
                            : { lat: wp.lat, lng: wp.lng };
                        this.setActiveCutPoint(idx, cutPt);
                        if (this.onCutPointSelected) {
                            this.onCutPointSelected(idx, cutPt);
                        }
                    });
                }
            }

            const btnAddAgain = tpPopupContent.querySelector(`#btn-tp-add-again-${idx}`);
            if (btnAddAgain) {
                btnAddAgain.addEventListener('click', () => {
                    centerMarker.closePopup();
                    if (this.onAddWaypointToTask) {
                        this.onAddWaypointToTask(wp);
                    }
                });
            }

            const btnFocus = tpPopupContent.querySelector(`#btn-tp-focus-${idx}`);
            if (btnFocus) {
                btnFocus.addEventListener('click', () => {
                    centerMarker.closePopup();
                    if (this.onFocusTurnpoint) {
                        this.onFocusTurnpoint(idx);
                    }
                });
            }

            const btnRemove = tpPopupContent.querySelector(`#btn-tp-remove-${idx}`);
            if (btnRemove) {
                btnRemove.addEventListener('click', () => {
                    centerMarker.closePopup();
                    if (this.onRemoveTurnpoint) {
                        this.onRemoveTurnpoint(idx);
                    }
                });
            }

            centerMarker.bindPopup(tpPopupContent);
            centerMarker.on('click', () => centerMarker.openPopup());
            taskShapes.forEach(shape => {
                shape.on('click', () => centerMarker.openPopup());
                this.taskCylinderLayer.addLayer(shape);
            });
            this.taskCylinderLayer.addLayer(centerMarker);
        });

        // 2. Render Dashed Centerline
        if (centerPoints.length >= 2) {
            const centerLine = L.polyline(centerPoints, {
                color: '#556575',
                weight: 2,
                dashArray: '4, 8',
                opacity: 0.6
            });
            this.taskLineLayer.addLayer(centerLine);
        }

        // 3. Render Optimized Shortest Path Route with contrast casing
        if (optimized && optimized.points && optimized.points.length >= 2) {
            const optLatLngs = optimized.points.map(p => [p.lat, p.lng]);
            const lineColor = this.routeColor || '#0f172a';
            const isDark = this.isColorDark(lineColor);
            const casingColor = isDark ? 'rgba(255, 255, 255, 0.85)' : 'rgba(15, 20, 24, 0.85)';

            // Outer casing for high legibility over both dark and bright terrain
            const optCasing = L.polyline(optLatLngs, {
                color: casingColor,
                weight: 5.5,
                opacity: 0.9,
                lineCap: 'round',
                lineJoin: 'round'
            });
            this.optLineLayer.addLayer(optCasing);

            const optLine = L.polyline(optLatLngs, {
                color: lineColor,
                weight: 3.5,
                opacity: 0.95,
                lineCap: 'round',
                lineJoin: 'round'
            });
            this.optLineLayer.addLayer(optLine);
        }

        // 4. Render Interactive Touchpoint Nodes on Cylinder Perimeters
        this.renderTouchpoints();
    }

    fitTask(turnpoints) {
        if (!turnpoints || turnpoints.length === 0) return;
        const coords = turnpoints.map(tp => [tp.waypoint.lat, tp.waypoint.lng]);
        this.map.fitBounds(L.latLngBounds(coords), { padding: [60, 60] });
    }

    focusTurnpoint(target, lng, zoom = 12) {
        if (typeof target === 'number' && typeof lng !== 'number') {
            const idx = target;
            if (!this.currentTurnpoints || !this.currentTurnpoints[idx]) return;
            const tp = this.currentTurnpoints[idx];
            const wp = tp.waypoint;
            const radiusM = Math.max(tp.radius || 400, 600);
            const circle = L.circle([wp.lat, wp.lng], { radius: radiusM });
            const bounds = circle.getBounds();
            this.map.fitBounds(bounds, {
                paddingTopLeft: [50, 50],
                paddingBottomRight: [50, 220],
                maxZoom: 15,
                animate: true
            });
        } else if (typeof target === 'number' && typeof lng === 'number') {
            this.map.setView([target, lng], zoom);
        } else if (target && typeof target.lat === 'number') {
            this.map.setView([target.lat, target.lng], lng || zoom);
        }
    }
}
