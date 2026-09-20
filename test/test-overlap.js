import assert from 'assert';
import { parseCup } from '../js/parsers/cup-parser.js';
import {
    vincentyDistance,
    distanceToSegmentMeters,
    samplePolylineUniformly,
    calculatePolylineOverlapPercent
} from '../js/geo-math.js';
import { solveRandomizedTask } from '../js/optimizer/randomizer-solver.js';

console.log("=== RUNNING TESTS: TASK OVERLAP & DISTANCE TOLERANCE ===");

// 1. Point to segment distance test
console.log("\n[1/5] Testing distanceToSegmentMeters...");
const s1 = { lat: 43.969167, lng: 6.520000 }; // St Andre Chalvet
const s2 = { lat: 43.981667, lng: 6.556667 }; // Col des Robines (~3.3 km away)
const pOnSegment = {
    lat: (s1.lat + s2.lat) / 2,
    lng: (s1.lng + s2.lng) / 2
};
const dOnSeg = distanceToSegmentMeters(pOnSegment, s1, s2);
assert(dOnSeg < 5, `Expected point on segment to have distance < 5m, got ${dOnSeg}`);

const pOffSegment = {
    lat: pOnSegment.lat + 0.01, // ~1.1 km North
    lng: pOnSegment.lng
};
const dOffSeg = distanceToSegmentMeters(pOffSegment, s1, s2);
assert(dOffSeg > 900 && dOffSeg < 1300, `Expected ~1100m, got ${dOffSeg}`);
console.log(`✓ distanceToSegmentMeters passed (on-seg: ${dOnSeg.toFixed(1)}m, off-seg: ${dOffSeg.toFixed(1)}m)`);

// 2. Uniform polyline sampling
console.log("\n[2/5] Testing samplePolylineUniformly...");
const poly = [
    { lat: 43.969167, lng: 6.520000 },
    { lat: 44.013333, lng: 6.586667 },
    { lat: 44.208333, lng: 6.333333 }
];
const samples = samplePolylineUniformly(poly, 30);
assert.strictEqual(samples.length, 30, "Expected exactly 30 samples");
assert(Math.abs(samples[0].lat - poly[0].lat) < 1e-4, "Start sample matches start point");
assert(Math.abs(samples[29].lat - poly[2].lat) < 1e-4, "End sample matches end point");
console.log(`✓ samplePolylineUniformly passed (${samples.length} points correctly distributed)`);

// 3. Polyline overlap calculation
console.log("\n[3/5] Testing calculatePolylineOverlapPercent...");
// 3a. Identical polylines -> 100% overlap
const overlapIdentical = calculatePolylineOverlapPercent(poly, poly, 2000);
assert.strictEqual(overlapIdentical, 100, `Expected 100% for identical polylines, got ${overlapIdentical}%`);

// 3b. Parallel polyline 500m apart -> high overlap (> 90%)
const polyShifted500m = poly.map(pt => ({ lat: pt.lat + 0.004, lng: pt.lng })); // ~440m offset
const overlapShifted = calculatePolylineOverlapPercent(poly, polyShifted500m, 2000);
assert(overlapShifted >= 90, `Expected >= 90% overlap for 500m shifted polyline, got ${overlapShifted}%`);

// 3c. Divergent polyline (completely different 2nd leg)
const polyDivergent = [
    poly[0],
    poly[1],
    { lat: 43.800000, lng: 6.250000 } // South instead of North
];
const overlapDivergent = calculatePolylineOverlapPercent(poly, polyDivergent, 2000);
assert(overlapDivergent < 80, `Expected < 80% overlap for divergent path, got ${overlapDivergent}%`);
console.log(`✓ calculatePolylineOverlapPercent passed:
   - Identical: ${overlapIdentical}%
   - Parallel (500m offset): ${overlapShifted}%
   - Divergent: ${overlapDivergent}%`);

// 4. Distance tolerance parameter test
console.log("\n[4/5] Testing solveRandomizedTask with custom distanceToleranceKm...");
const sampleCup = `
"name","code","country","lat","lon","elev","style","rwdir","rwlen","rwwidth","freq","desc"
"St Andre Chalvet","D01",FR,4358.150N,00631.200E,1530m,1,,,,,"Main Takeoff West"
"Landing Aerodrome","L01",FR,4357.500N,00630.100E,910m,1,,,,,"Official Goal Landing"
"Col des Robines","B02",FR,4358.900N,00633.400E,1480m,1,,,,,"Pass East"
"Chamatte Sud","C03",FR,4355.200N,00632.000E,1870m,1,,,,,"South Ridge"
"Dormillouse","D04",FR,4412.500N,00620.000E,2505m,1,,,,,"North Big Turnpoint"
"Col d Allos","A05",FR,4415.000N,00635.400E,2250m,1,,,,,"Pass North East"
"Cheval Blanc","E06",FR,4407.200N,00628.100E,2323m,1,,,,,"High Mountain Turn"
"Coupe","F07",FR,4403.500N,00631.800E,1750m,1,,,,,"Local Ridge"
"Thorame Haute","T08",FR,4405.300N,00634.500E,1150m,1,,,,,"Valley Station"
"Pic de Rent","P09",FR,4402.000N,00626.500E,1996m,1,,,,,"West Ridge"
"Mourre de Chanier","M10",FR,4352.000N,00624.000E,1930m,1,,,,,"South West Corner"
"Montagne de Lure","L11",FR,4407.000N,00547.000E,1826m,1,,,,,"Far West Outlying"
"Castellane","C12",FR,4350.800N,00630.700E,724m,1,,,,,"South River Gate"
"Barcelonnette","B13",FR,4423.200N,00639.100E,1135m,1,,,,,"North Valley"
"Puget Theniers","P14",FR,4357.400N,00653.800E,410m,1,,,,,"East River Valley"
"Annot","A15",FR,4357.900N,00640.100E,700m,1,,,,,"East Village"
"Gorde Sud","G16",FR,4359.800N,00623.500E,1620m,1,,,,,"West Ridge Thermal"
"Entrevaux","E17",FR,4356.900N,00648.600E,470m,1,,,,,"Citadel Landing"
"La Mure","L18",FR,4400.800N,00635.200E,1050m,1,,,,,"Intermediate Pass"
"Verdon Lake","V19",FR,4348.000N,00615.000E,480m,1,,,,,"Lake South Gate"
`;
const waypoints = parseCup(sampleCup).waypoints;
const initialTask = [
    { waypoint: waypoints[0], radius: 1000, locked: true, type: "takeoff" },
    { waypoint: waypoints[2], radius: 2000, locked: false },
    { waypoint: waypoints[4], radius: 3000, locked: false },
    { waypoint: waypoints[1], radius: 400, locked: true, type: "goal" }
];

// Test with tolerance = 0.3 km
const resTight = solveRandomizedTask({
    waypoints,
    currentTurnpoints: initialTask,
    targetDistanceKm: 65.0,
    distanceToleranceKm: 0.3,
    maxOverlapPercent: 100,
    numTurnpoints: 4,
    maxAttempts: 1500
});
assert(resTight.success, "Solver should succeed with tolerance 0.3 km");
const diffTight = Math.abs(resTight.optimized.totalDistanceKm - 65.0);
assert(diffTight <= 0.35, `Expected delta <= 0.35 km, got ${diffTight.toFixed(2)} km`);
console.log(`✓ Solver with distanceToleranceKm=0.3 passed: Dist = ${resTight.optimized.totalDistanceKm.toFixed(2)} km (delta: ${diffTight.toFixed(2)} km)`);

// 5. Similarity overlap filtering in solver
console.log("\n[5/5] Testing similarity filtering (maxOverlapPercent=70%)...");
const savedHistory = [
    { turnpoints: resTight.turnpoints, optimized: resTight.optimized, signature: resTight.signature }
];

const resFiltered = solveRandomizedTask({
    waypoints,
    currentTurnpoints: resTight.turnpoints,
    targetDistanceKm: 65.0,
    distanceToleranceKm: 0.5,
    maxOverlapPercent: 70,
    recentTasks: savedHistory,
    numTurnpoints: 4,
    maxAttempts: 500
});

if (resFiltered.success) {
    const overlapWithPrev = calculatePolylineOverlapPercent(
        resFiltered.optimized.points,
        savedHistory[0].optimized.points,
        2000
    );
    console.log(`Generated new task with ${overlapWithPrev}% overlap against previous task`);
    assert(overlapWithPrev < 70, `Expected overlap < 70%, got ${overlapWithPrev}%`);
    console.log("✓ Similarity filtering strictly rejected tasks overlapping >= 70%!");
} else {
    console.log("✓ Solver cleanly reported when no tasks met the strict 70% threshold");
}

console.log("\n==========================================");
console.log("ALL OVERLAP & TOLERANCE TESTS PASSED!");
console.log("==========================================");
