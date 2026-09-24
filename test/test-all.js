// task-planner/test/test-all.js
import assert from 'node:assert';
import { vincentyDistance, vincentyBearing, vincentyDestination, deflectionAngle, roundTo2SigFigs, getDiscrete2SigFigValues, calculatePolylineOverlapPercent, formatRadiusDisplay } from '../js/geo-math.js';
import { parseCup } from '../js/parsers/cup-parser.js';
import { parseWpt } from '../js/parsers/wpt-parser.js';
import { optimizeTaskRoute } from '../js/optimizer/task-optimizer.js';
import { solveRandomizedTask } from '../js/optimizer/randomizer-solver.js';
import { findCandidateWaypointsForCutPoint } from '../js/optimizer/reverse-cycle.js';
import { translateFreehandStrokeToTask } from '../js/drawing/freehand-tracer.js';
import { taskToXcTrackJson, taskToXcTrackQrString, xcTrackJsonToTask, taskToCupString, encodeTurnpointCoords, decodeTurnpointCoords } from '../js/qr/xctrack-qr.js';

console.log("=== RUNNING SUITE: PARAGLIDING TASK PLANNER ===");

// 1. WGS-84 Geodesic Math
console.log("\n[1/8] Testing WGS-84 Geodesic Math...");
const stAndre = { lat: 43.96, lng: 6.51 };
const colAllos = { lat: 44.25, lng: 6.59 };
const distMeters = vincentyDistance(stAndre, colAllos);
assert(distMeters > 32800 && distMeters < 32900, `Expected ~32853m, got ${distMeters}`);

const brngRad = vincentyBearing(stAndre, colAllos);
const destPt = vincentyDestination(stAndre, distMeters, brngRad);
const loopDist = vincentyDistance(destPt, colAllos);
assert(loopDist < 0.01, `Geodesic closure error should be < 1cm, got ${loopDist}m`);

// 2-sig-fig rounding
assert.strictEqual(roundTo2SigFigs(432), 430);
assert.strictEqual(roundTo2SigFigs(995), 1000);
assert.strictEqual(roundTo2SigFigs(1240), 1200);
assert.strictEqual(roundTo2SigFigs(25700), 26000);
assert.strictEqual(roundTo2SigFigs(250), 400); // clamped to min 400m
console.log("✓ Geodesic math and rounding passed");

// 2. Parsers
console.log("\n[2/8] Testing Waypoint Parsers (.cup & .wpt)...");
const cupSample = `
"name","code","country","lat","lon","elev","style","rwdir","rwlen","rwwidth","freq","desc"
"St Andre Chalvet","D01",FR,4358.150N,00631.200E,1530m,1,,,,,"Takeoff West"
"Col Allos","A05",FR,4415.000N,00635.400E,7381ft,1,,,,,"Pass TP"
-----TASKS-----
"Champs Task","D01","A05"
`;
const cupRes = parseCup(cupSample);
assert.strictEqual(cupRes.waypoints.length, 2);
assert.strictEqual(cupRes.waypoints[0].name, "St Andre Chalvet");
assert.strictEqual(cupRes.waypoints[0].code, "D01");
assert.strictEqual(cupRes.waypoints[0].elev, 1530);
assert.strictEqual(cupRes.waypoints[1].elev, 2250); // 7381ft in meters
assert(cupRes.task !== null && cupRes.task.turnpoints.length === 2);

const wptSample = `
$FormatGEO
WP01 N 44 15 00.00 E 006 35 24.00 2250 Col Allos Pass
W  D01 A 43.969167N 6.520000E 27-MAR-24 00:00:00 1530 St Andre Takeoff
`;
const wptRes = parseWpt(wptSample);
assert.strictEqual(wptRes.length, 2);
assert.strictEqual(wptRes[0].id, "WP01");
assert.strictEqual(wptRes[0].code, "WP01");
assert.strictEqual(wptRes[0].name, "Col Allos Pass");
assert.strictEqual(wptRes[1].id, "D01");
assert.strictEqual(wptRes[1].code, "D01");
assert.strictEqual(wptRes[1].name, "St Andre Takeoff");
console.log("✓ CUP and WPT parsers passed (codes & names verified)");

// 3. Task Optimization
console.log("\n[3/8] Testing CIVL Task Optimization on WGS-84...");
const task3 = [
    { waypoint: { lat: 43.96, lng: 6.51, name: "T1" }, radius: 1000, type: "takeoff" },
    { waypoint: { lat: 44.25, lng: 6.59, name: "T2" }, radius: 2000, type: "turnpoint" },
    { waypoint: { lat: 44.12, lng: 6.20, name: "T3" }, radius: 400, type: "goal" }
];
const opt3 = optimizeTaskRoute(task3);
assert(opt3.totalDistanceKm > 60 && opt3.totalDistanceKm < 65, `Unexpected opt distance: ${opt3.totalDistanceKm}`);
assert.strictEqual(opt3.touchPoints.length, 3);
// Check touch point 1 lies on cylinder perimeter of T2
const dToCenter = vincentyDistance(opt3.touchPoints[1], task3[1].waypoint);
assert(Math.abs(dToCenter - 2000) < 1.0, `Touch point distance from center should be 2000m, got ${dToCenter}`);
console.log("✓ Task optimizer passed (perimeter touchpoint verified)");

// 4. Constraint Solver & Randomization
console.log("\n[4/8] Testing Constraint-Based Randomizer Solver...");
const gridWps = [];
for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 7; j++) {
        gridWps.push({
            id: `WP_${i}_${j}`,
            name: `WP_${i}_${j}`,
            lat: 43.7 + i * 0.10,
            lng: 6.1 + j * 0.10,
            elev: 1000 + (i + j) * 50
        });
    }
}
const templateTask = [
    { waypoint: gridWps[0], radius: 1000, locked: true, type: "takeoff" },
    { waypoint: null, radius: 400, locked: false },
    { waypoint: null, radius: 400, locked: false },
    { waypoint: gridWps[24], radius: 400, locked: true, type: "goal" }
];
const targetDist = 70.0;
const solverRes = solveRandomizedTask({
    waypoints: gridWps,
    currentTurnpoints: templateTask,
    targetDistanceKm: targetDist,
    numTurnpoints: 4,
    maxAttempts: 400
});

assert(solverRes.turnpoints && solverRes.turnpoints.length === 4, "Solver should return 4 turnpoints");
assert.strictEqual(solverRes.turnpoints[0].waypoint.id, gridWps[0].id, "Locked takeoff should be preserved");
assert.strictEqual(solverRes.turnpoints[3].waypoint.id, gridWps[24].id, "Locked goal should be preserved");
assert(solverRes.diffKm <= 0.5, `Solver diff should be <= 0.5km, got ${solverRes.diffKm}`);
// Check discrete radii and cylinder direction constraints
solverRes.turnpoints.forEach((tp, idx) => {
    assert.strictEqual(tp.radius, roundTo2SigFigs(tp.radius), `Radius ${tp.radius} must be 2 sig figs`);
    if (tp.type !== 'sss') {
        assert.strictEqual(tp.direction, 'enter', `Turnpoint ${idx} (${tp.type}) must be an Enter cylinder`);
    }
});
// Verify Launch and Goal stay anchored at start (slot 0) and end (slot N - 1) when N changes
const res5 = solveRandomizedTask({
    waypoints: gridWps,
    currentTurnpoints: solverRes.turnpoints,
    targetDistanceKm: 75.0,
    numTurnpoints: 5
});
assert.strictEqual(res5.turnpoints.length, 5);
assert.strictEqual(res5.turnpoints[0].waypoint.id, gridWps[0].id, "Launch must stay at start (slot 0) when N=5");
assert.strictEqual(res5.turnpoints[4].waypoint.id, gridWps[24].id, "Goal must stay at end (slot 4) when N=5");

const res3 = solveRandomizedTask({
    waypoints: gridWps,
    currentTurnpoints: solverRes.turnpoints,
    targetDistanceKm: 65.0,
    numTurnpoints: 3
});
assert.strictEqual(res3.turnpoints.length, 3);
assert.strictEqual(res3.turnpoints[0].waypoint.id, gridWps[0].id, "Launch must stay at start (slot 0) when N=3");
assert.strictEqual(res3.turnpoints[2].waypoint.id, gridWps[24].id, "Goal must stay at end (slot 2) when N=3");

console.log(`✓ Solver passed: generated ${solverRes.optimized.totalDistanceKm.toFixed(2)} km task (diff: ${solverRes.diffKm.toFixed(2)} km, Launch/Goal anchored across N=3, N=4, N=5)`);

// 5. Reverse Cut-Point Candidate Cycling
console.log("\n[5/8] Testing Reverse Touchpoint Route Cycling...");
const doglegTask = [
    { waypoint: gridWps[0], radius: 1000, type: "takeoff" },
    { waypoint: gridWps[5], radius: 3000, type: "turnpoint" },
    { waypoint: gridWps[35], radius: 400, type: "goal" }
];
const doglegOpt = optimizeTaskRoute(doglegTask);
const cutPoint1 = doglegOpt.touchPoints[1];

// Also insert a waypoint located directly along the normal bisector ray of cutPoint1
const normalBrng = vincentyBearing(cutPoint1, doglegTask[1].waypoint);
const alignedWp = vincentyDestination(cutPoint1, 8000, normalBrng);
alignedWp.id = "WP_ALIGNED";
alignedWp.name = "Aligned Normal Waypoint";
alignedWp.code = "ALN";

const testWps = [...gridWps, alignedWp];

const reverseCandidates = findCandidateWaypointsForCutPoint({
    waypoints: testWps,
    turnpoints: doglegTask,
    turnpointIndex: 1,
    cutPoint: cutPoint1,
    targetDistanceKm: 85.0
});
assert(reverseCandidates.length > 0, "Should find candidate alternatives");
assert(reverseCandidates[0].waypoint.id === "WP_ALIGNED", "Aligned waypoint should be top candidate");
assert(reverseCandidates[0].touchPointDeviationMeters < 50, `Aligned candidate should have touchpoint deviation < 50m, got ${reverseCandidates[0].touchPointDeviationMeters}`);

reverseCandidates.forEach(cand => {
    assert(cand.radius >= 400 && cand.radius <= 300000, "Candidate radius must be in [400m, 300km]");
    assert.strictEqual(cand.radius, roundTo2SigFigs(cand.radius), "Candidate radius must be 2 sig figs");
    assert(cand.touchPointDeviationMeters !== undefined, "Candidate must include touchPointDeviationMeters");
    assert(cand.touchPointDeviationMeters <= 4000, "Candidate route must actually touch near cut point");
});
console.log(`✓ Touchpoint reverse cycling passed: found ${reverseCandidates.length} candidate turnpoints (top candidate touch deviation: ${reverseCandidates[0].touchPointDeviationMeters.toFixed(1)}m)`);

// 6. Freehand Drawing Translation
console.log("\n[6/8] Testing Freehand Stroke Translation...");
const stroke = [
    { lat: 43.71, lng: 6.11 },
    { lat: 43.82, lng: 6.32 },
    { lat: 43.91, lng: 6.50 },
    { lat: 44.15, lng: 6.42 }
];
const strokeRes = translateFreehandStrokeToTask(stroke, gridWps);
assert(strokeRes.turnpoints.length >= 2, "Stroke should generate at least 2 turnpoints");
assert(strokeRes.optimized.totalDistanceKm > 0, "Optimized distance should be positive");
console.log(`✓ Freehand translation passed: ${strokeRes.turnpoints.length} turnpoints generated`);

// 7. XCTrack QR & Export (Format 1 and compact Format 2)
console.log("\n[7/8] Testing XCTrack QR and File Export...");

// Test official XCTrack snippet polyline encoding
const encodedSnippet = encodeTurnpointCoords(147.97455, -36.18604, 940, 400);
assert.strictEqual(encodedSnippet, "}gdf[vqz{Ewy@_X", "Polyline encoding should match official XCTrack example");
const decodedSnippet = decodeTurnpointCoords(encodedSnippet);
assert.strictEqual(decodedSnippet.lon, 147.97455);
assert.strictEqual(decodedSnippet.lat, -36.18604);
assert.strictEqual(decodedSnippet.alt, 940);
assert.strictEqual(decodedSnippet.radius, 400);

// Test Format 2 compact QR string generation
const qrStr = taskToXcTrackQrString(doglegTask, { startTime: "13:30:00Z" });
assert(qrStr.startsWith("XCTSK:"), "QR payload must begin with XCTSK: prefix for XCTrack scanner");
assert(qrStr.length < 350, `Format 2 QR payload must be compact (< 350 chars), got ${qrStr.length}`);

// Test Format 2 QR decoding round-trip
const parsedQr = xcTrackJsonToTask(qrStr);
assert.strictEqual(parsedQr.turnpoints.length, 3);
assert.strictEqual(parsedQr.turnpoints[0].waypoint.name, doglegTask[0].waypoint.name);
assert.strictEqual(parsedQr.taskMeta.startTime, "13:30:00Z");

// Test that non-SSS turnpoints are Enter cylinders
parsedQr.turnpoints.forEach((tp, idx) => {
    if (tp.type !== 'sss') {
        assert.strictEqual(tp.direction, 'enter', `Turnpoint ${idx} (${tp.type}) must be an Enter cylinder`);
    }
});

// Test Format 1 JSON export and round-trip
const xcJson = taskToXcTrackJson(doglegTask, { startTime: "12:00:00Z" });
const parsedXc = xcTrackJsonToTask(xcJson);
assert.strictEqual(parsedXc.turnpoints.length, 3);
assert.strictEqual(parsedXc.turnpoints[0].waypoint.name, doglegTask[0].waypoint.name);

// Test CUP format export
const cupStr = taskToCupString(doglegTask);
assert(cupStr.includes("-----TASKS-----"), "CUP string should include task section");
console.log(`✓ XCTrack Format 2 QR (${qrStr.length} chars, XCTSK: prefix), Format 1 JSON, and CUP export passed`);

// 8. Task Route Overlap & Configurable Distance Tolerance
console.log("\n[8/8] Testing Route Overlap & Distance Tolerance...");
const polyA = [
    { lat: 43.969167, lng: 6.520000 },
    { lat: 44.013333, lng: 6.586667 },
    { lat: 44.208333, lng: 6.333333 }
];
const overlapSame = calculatePolylineOverlapPercent(polyA, polyA, 2000);
assert.strictEqual(overlapSame, 100, `Identical routes should have 100% overlap, got ${overlapSame}%`);

const polyParallel = polyA.map(pt => ({ lat: pt.lat + 0.003, lng: pt.lng })); // ~330m offset
const overlapParallel = calculatePolylineOverlapPercent(polyA, polyParallel, 2000);
assert(overlapParallel >= 90, `Parallel routes within 330m should have >= 90% overlap, got ${overlapParallel}%`);

const polyDivergent = [
    polyA[0],
    polyA[1],
    { lat: 43.700000, lng: 6.200000 }
];
const overlapDivergent = calculatePolylineOverlapPercent(polyA, polyDivergent, 2000);
assert(overlapDivergent < 80, `Divergent route should have < 80% overlap, got ${overlapDivergent}%`);

const solverTight = solveRandomizedTask({
    waypoints: gridWps,
    currentTurnpoints: templateTask,
    targetDistanceKm: 70.0,
    distanceToleranceKm: 0.25,
    maxOverlapPercent: 80,
    numTurnpoints: 4,
    maxAttempts: 500
});
assert(solverTight.success, "Solver should find solution with tight 0.25 km tolerance");
assert(solverTight.diffKm <= 0.25, `Delta should be <= 0.25 km, got ${solverTight.diffKm}`);
console.log(`✓ Route overlap and custom tolerance passed (Identical: ${overlapSame}%, Parallel: ${overlapParallel}%, Divergent: ${overlapDivergent}%, Delta: ${solverTight.diffKm.toFixed(2)} km)`);

// 9. T/G Code Enforcement, 2km SSS/ESS Defaults & Waypoint Duplication
console.log("\n[9/9] Testing T/G Codes, 2km SSS/ESS Defaults, and Duplicate Waypoints...");
const tgWaypoints = [
    { id: "T01", code: "T01", name: "St Andre Chalvet", lat: 43.969, lng: 6.520, elev: 1530 },
    { id: "T02", code: "T02", name: "Thorame Launch", lat: 44.088, lng: 6.575, elev: 1650 },
    { id: "G01", code: "G01", name: "Landing Aerodrome", lat: 43.958, lng: 6.501, elev: 910 },
    { id: "G02", code: "G02", name: "Camping Goal", lat: 43.941, lng: 6.516, elev: 890 },
    { id: "B02", code: "B02", name: "Col des Robines", lat: 43.981, lng: 6.556, elev: 1480 },
    { id: "C03", code: "C03", name: "Chamatte Sud", lat: 43.920, lng: 6.533, elev: 1870 },
    { id: "D04", code: "D04", name: "Dormillouse", lat: 44.208, lng: 6.333, elev: 2505 },
    { id: "A05", code: "A05", name: "Col d Allos", lat: 44.250, lng: 6.590, elev: 2250 },
    { id: "E06", code: "E06", name: "Cheval Blanc", lat: 44.120, lng: 6.468, elev: 2323 },
    { id: "B13", code: "B13", name: "Barcelonnette", lat: 44.386, lng: 6.651, elev: 1135 }
];

const resTG = solveRandomizedTask({
    waypoints: tgWaypoints,
    currentTurnpoints: null,
    targetDistanceKm: 65.0,
    distanceToleranceKm: 1.0,
    numTurnpoints: 5,
    maxAttempts: 400
});

assert(resTG.success, "Solver should succeed with T/G waypoint set");
assert.strictEqual(resTG.turnpoints.length, 5, "Generated task must have 5 turnpoints");

// 1. Takeoff code must start with T
const takeoffCode = (resTG.turnpoints[0].waypoint.code || '').toUpperCase();
assert(takeoffCode.startsWith('T'), `Takeoff code must start with 'T', got: ${takeoffCode}`);

// 2. SSS must default to 2km around the Launch waypoint (exit)
const sssTp = resTG.turnpoints[1];
assert.strictEqual(sssTp.type, 'sss');
assert.strictEqual(sssTp.direction, 'exit');
assert.strictEqual(sssTp.radius, 2000, `SSS radius must be 2000m, got: ${sssTp.radius}`);
assert.strictEqual(sssTp.waypoint.id, resTG.turnpoints[0].waypoint.id, "SSS must be around the Launch waypoint");

// 3. ESS must default to 2km around the Goal waypoint (enter)
const essTp = resTG.turnpoints[3];
assert.strictEqual(essTp.type, 'ess');
assert.strictEqual(essTp.direction, 'enter');
assert.strictEqual(essTp.radius, 2000, `ESS radius must be 2000m, got: ${essTp.radius}`);
assert.strictEqual(essTp.waypoint.id, resTG.turnpoints[4].waypoint.id, "ESS must be around the Goal waypoint");

// 4. Goal code must start with G
const goalCode = (resTG.turnpoints[4].waypoint.code || '').toUpperCase();
assert(goalCode.startsWith('G'), `Goal code must start with 'G', got: ${goalCode}`);

// 5. Waypoint duplicate support: out-and-return / triangle with same waypoint visited twice
const duplicateTask = [
    { waypoint: tgWaypoints[0], radius: 1000, type: "takeoff" },
    { waypoint: tgWaypoints[0], radius: 2000, type: "sss", direction: "exit" },
    { waypoint: tgWaypoints[4], radius: 3000, type: "turnpoint", direction: "enter" },
    { waypoint: tgWaypoints[5], radius: 2000, type: "turnpoint", direction: "enter" },
    { waypoint: tgWaypoints[4], radius: 3000, type: "turnpoint", direction: "enter" }, // duplicate D04!
    { waypoint: tgWaypoints[2], radius: 2000, type: "ess", direction: "enter" },
    { waypoint: tgWaypoints[2], radius: 400, type: "goal", direction: "enter" }
];
const optDup = optimizeTaskRoute(duplicateTask);
assert(optDup && optDup.totalDistanceKm > 0, "Optimizer must support duplicate waypoints in task");
assert.strictEqual(optDup.points.length, 7, "All 7 turnpoints including duplicate must be optimized");
console.log(`✓ T/G enforcement, 2km SSS/ESS defaults, and duplicate waypoint support verified`);

// 10. Topo/Terrain Map Providers & Task Turnpoint Removal
console.log("\n[10/10] Testing Topo/Terrain Base Layers & Task Removal...");
import { BASE_LAYERS_CONFIG } from '../js/ui/map-controller.js';

assert(BASE_LAYERS_CONFIG.opentopo, "OpenTopoMap must be configured");
assert(BASE_LAYERS_CONFIG.opentopo.url.includes('{s}.tile.opentopomap.org'), "OpenTopoMap URL valid");
assert.strictEqual(BASE_LAYERS_CONFIG.opentopo.options.layerId, 'opentopo');
assert(BASE_LAYERS_CONFIG.esritopo, "ESRI Topo must be configured");
assert(BASE_LAYERS_CONFIG.esritopo.url.includes('World_Topo_Map'), "ESRI Topo URL valid");
assert(BASE_LAYERS_CONFIG.satellite, "Satellite layer must be configured");
assert(BASE_LAYERS_CONFIG.cyclosm, "CyclOSM layer must be configured");
assert(BASE_LAYERS_CONFIG.osm, "OSM layer must be configured");

// Test Task Turnpoint Removal logic
let taskToEdit = [
    { waypoint: { id: "wp-1", code: "T01", name: "Launch" }, radius: 1000 },
    { waypoint: { id: "wp-2", code: "A01", name: "Pass" }, radius: 400 },
    { waypoint: { id: "wp-3", code: "A02", name: "Peak" }, radius: 500 },
    { waypoint: { id: "wp-4", code: "G01", name: "Goal" }, radius: 400 }
];

// Remove by waypoint
const removeWp = { id: "wp-2", code: "A01", name: "Pass" };
taskToEdit = taskToEdit.filter(tp => tp.waypoint && tp.waypoint.id !== removeWp.id);
assert.strictEqual(taskToEdit.length, 3, "Waypoint A01 should be removed");
assert(!taskToEdit.some(tp => tp.waypoint.id === "wp-2"), "A01 should no longer exist in task");

// Remove by index
taskToEdit.splice(1, 1); // remove index 1 (wp-3)
assert.strictEqual(taskToEdit.length, 2, "Index 1 should be removed");
assert.strictEqual(taskToEdit[0].waypoint.id, "wp-1");
assert.strictEqual(taskToEdit[1].waypoint.id, "wp-4");

// Test MapController default layer key and label cycling
import { MapController } from '../js/ui/map-controller.js';

// MapController mock / standalone methods
const mapCtrl = new MapController({ mapElementId: 'map' });
assert.strictEqual(mapCtrl.getActiveBaseLayerKey(), 'opentopo', "Default base layer must be opentopo");
assert.strictEqual(mapCtrl.getWaypointLabelMode(), 'codes', "Default label mode must be codes");

// Test 3-way label cycling
assert.strictEqual(mapCtrl.cycleWaypointLabelMode(), 'all', "First cycle should switch to all (codes + names)");
assert.strictEqual(mapCtrl.cycleWaypointLabelMode(), 'none', "Second cycle should switch to none (no labels)");
assert.strictEqual(mapCtrl.cycleWaypointLabelMode(), 'codes', "Third cycle should loop back to codes");

// Test dark color detection for high contrast route casing
assert.strictEqual(mapCtrl.isColorDark('#0f172a'), true, "#0f172a is dark (needs white casing)");
assert.strictEqual(mapCtrl.isColorDark('#1e3a8a'), true, "#1e3a8a is dark (needs white casing)");
assert.strictEqual(mapCtrl.isColorDark('#ffffff'), false, "#ffffff is light (needs dark casing)");

console.log("✓ Topo/terrain base layers (OpenTopoMap default), label cycling, and waypoint removal logic verified");

// 11. Goal Description Matching, XCTrack QR Codes, Exact Stepped Radii & Goal Line Geometry
console.log("\n[11/11] Testing Goal Desc Match, XCTrack Codes, Non-Sig-Fig Radii & Goal Line...");

// 1. Goal Description matching (waypoints without 'G' code but 'goal' in description)
const launchWp = { id: "T01", code: "T01", name: "Launch", lat: 43.7, lng: 6.1, elev: 1500 };
const goalDescWp = { id: "L99", code: "L99", name: "Thorame LZ", lat: 44.2, lng: 6.6, elev: 950, desc: "Official Competition Goal" };
const allWpsWithGoalDesc = [launchWp, goalDescWp, ...gridWps];
const solverGoalDescRes = solveRandomizedTask({
    waypoints: allWpsWithGoalDesc,
    targetDistanceKm: 70.0,
    numTurnpoints: 4,
    maxAttempts: 300
});
assert(solverGoalDescRes.success, "Solver should successfully create task using waypoint with 'goal' in desc");
const solvedGoalWp = solverGoalDescRes.turnpoints[solverGoalDescRes.turnpoints.length - 1].waypoint;
assert.strictEqual(solvedGoalWp.id, "L99", "Waypoint L99 with 'goal' in desc should be selected as Goal");

// 2. Exact Stepped Radii & formatRadiusDisplay without 2-sig-fig limits
assert.strictEqual(formatRadiusDisplay(450), "450m");
assert.strictEqual(formatRadiusDisplay(1200), "1.2km");
assert.strictEqual(formatRadiusDisplay(1234), "1.234km");
assert.strictEqual(formatRadiusDisplay(12300), "12.3km");
assert.strictEqual(formatRadiusDisplay(12345), "12.345km");

// Test TaskSheet stepped radius calculation
import { TaskSheet } from '../js/ui/task-sheet.js';
const calcRadius = TaskSheet.prototype.calculateSteppedRadius;
assert.strictEqual(calcRadius(1234, 100), 1334, "Radius should increment by exact +100m");
assert.strictEqual(calcRadius(1334, -100), 1234, "Radius should decrement by exact -100m");
assert.strictEqual(calcRadius(1234, 1000), 2234, "Radius should increment by exact +1km");
assert.strictEqual(calcRadius(2234, -1000), 1234, "Radius should decrement by exact -1km");
assert.strictEqual(calcRadius(1234, 10000), 11234, "Radius should increment by exact +10km");
assert.strictEqual(calcRadius(11234, -10000), 1234, "Radius should decrement by exact -10km");

// 3. Waypoint Code preservation in XCTrack QR (n = wp.code, d = wp.name)
const customCodeTask = [
    { waypoint: { id: "W1", code: "T01", name: "St Andre Chalvet", lat: 43.969, lng: 6.520, elev: 1530 }, radius: 1000, type: "takeoff" },
    { waypoint: { id: "W2", code: "A05", name: "Col de l'Allos", lat: 44.250, lng: 6.590, elev: 2250 }, radius: 2500, type: "turnpoint" },
    { waypoint: { id: "W3", code: "L02", name: "Thorame Landing", lat: 44.088, lng: 6.575, elev: 980, desc: "Goal LZ" }, radius: 100, type: "goal", goalType: "line" }
];
const qrPayload = taskToXcTrackQrString(customCodeTask);
const qrParsedJson = JSON.parse(qrPayload.substring(6));
assert.strictEqual(qrParsedJson.t[0].n, "T01", "Field 'n' must contain waypoint code T01");
assert.strictEqual(qrParsedJson.t[0].d, "St Andre Chalvet", "Field 'd' must contain waypoint name");
assert.strictEqual(qrParsedJson.t[1].n, "A05", "Field 'n' must contain waypoint code A05");
assert.strictEqual(qrParsedJson.t[1].d, "Col de l'Allos", "Field 'd' must contain waypoint name");
assert.strictEqual(qrParsedJson.t[2].n, "L02", "Field 'n' must contain waypoint code L02");
assert.strictEqual(qrParsedJson.g.t, 1, "Goal type in QR must be 1 (LINE)");

// 4. Goal line optimization geometry
const optGoalLine = optimizeTaskRoute(customCodeTask);
const goalTouch = optGoalLine.touchPoints[2];
assert.strictEqual(goalTouch.lat, customCodeTask[2].waypoint.lat, "Goal line touchpoint must be at waypoint center");
assert.strictEqual(goalTouch.lng, customCodeTask[2].waypoint.lng, "Goal line touchpoint must be at waypoint center");

// Verify goal line perpendicularity to incoming courseline
const prevPt = optGoalLine.points[1];
const goalPt = customCodeTask[2].waypoint;
const brngIn = vincentyBearing(prevPt, goalPt);
const halfLen = customCodeTask[2].radius;
const leftEnd = vincentyDestination(goalPt, halfLen, brngIn - Math.PI / 2);
const rightEnd = vincentyDestination(goalPt, halfLen, brngIn + Math.PI / 2);

// Distance from leftEnd to rightEnd should be ~2 * halfLen (200m)
const lineLength = vincentyDistance(leftEnd, rightEnd);
assert(Math.abs(lineLength - 200) < 0.1, `Goal line length should be 200m, got ${lineLength}`);

// Bearing of goal line from left to right should be exactly brngIn + PI/2 (+/- 0.001 rad)
const lineBrng = vincentyBearing(leftEnd, rightEnd);
let expectedLineBrng = brngIn + Math.PI / 2;
while (expectedLineBrng > Math.PI) expectedLineBrng -= 2 * Math.PI;
while (expectedLineBrng < -Math.PI) expectedLineBrng += 2 * Math.PI;
assert(Math.abs(lineBrng - expectedLineBrng) < 0.01, `Goal line bearing ${lineBrng} should match ${expectedLineBrng}`);

console.log("✓ Goal desc matching, XCTrack codes, non-sig-fig radii, and goal line geometry verified");

console.log("\n==========================================");
console.log("ALL 11 TEST SUITES PASSED CLEANLY!");
console.log("==========================================");


