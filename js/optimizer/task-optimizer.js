// task-planner/js/optimizer/task-optimizer.js
import { vincentyDistance, vincentyBearing, vincentyDestination } from '../geo-math.js';

/**
 * Optimizes a paragliding task to find the shortest path touching all cylinders
 * on the WGS-84 ellipsoid following CIVL rules.
 * 
 * @param {Array<Object>} turnpoints - Array of task turnpoint objects:
 *   {
 *     id: string,
 *     waypoint: { name, code, lat, lng, elev, desc },
 *     radius: number (meters),
 *     type: 'takeoff' | 'sss' | 'turnpoint' | 'ess' | 'goal',
 *     direction: 'enter' | 'exit', // for sss
 *     goalType: 'cylinder' | 'line', // for goal
 *     locked: boolean
 *   }
 * @returns {Object} Optimized route result with points, distances, and metrics
 */
export function optimizeTaskRoute(turnpoints) {
    if (!turnpoints || turnpoints.length === 0 || turnpoints.some(tp => !tp || !tp.waypoint || tp.waypoint.lat === undefined)) {
        return {
            points: [],
            legDistances: [],
            totalDistanceKm: 0,
            speedSectionDistanceKm: 0,
            touchPoints: []
        };
    }

    const N = turnpoints.length;
    if (N === 1) {
        const wp = turnpoints[0].waypoint;
        return {
            points: [{ lat: wp.lat, lng: wp.lng, index: 0, radius: turnpoints[0].radius }],
            legDistances: [],
            totalDistanceKm: 0,
            speedSectionDistanceKm: 0,
            touchPoints: [{ lat: wp.lat, lng: wp.lng, index: 0 }]
        };
    }

    // Initialize touch-points with waypoint centers
    const Q = turnpoints.map((tp, idx) => ({
        lat: tp.waypoint.lat,
        lng: tp.waypoint.lng,
        index: idx,
        radius: tp.radius || 400
    }));

    // Find SSS, ESS, Goal indices
    let sssIdx = turnpoints.findIndex(tp => tp.type === 'sss');
    let essIdx = turnpoints.findIndex(tp => tp.type === 'ess');
    let goalIdx = turnpoints.findIndex(tp => tp.type === 'goal');
    if (goalIdx === -1) goalIdx = N - 1;
    if (essIdx === -1) essIdx = goalIdx;
    if (sssIdx === -1) sssIdx = turnpoints.findIndex(tp => tp.type !== 'takeoff');
    if (sssIdx === -1) sssIdx = 0;

    const maxIterations = 18;
    for (let iter = 0; iter < maxIterations; iter++) {
        // Optimize intermediate turnpoints (between 0 and N-1)
        for (let i = 0; i < N; i++) {
            const tp = turnpoints[i];
            const center = { lat: tp.waypoint.lat, lng: tp.waypoint.lng };
            const radiusM = tp.radius || 400;

            if (i === 0) {
                // First point (Takeoff or first cylinder)
                if (tp.type === 'takeoff') {
                    // Takeoff point stays at center
                    Q[0] = { lat: center.lat, lng: center.lng, index: 0 };
                } else if (N > 1 && radiusM > 0) {
                    // Start cylinder: touch point facing next point Q[1]
                    const brng = vincentyBearing(center, Q[1]);
                    const isExit = (tp.direction || 'exit').toLowerCase() === 'exit';
                    const targetBrng = isExit ? brng : (brng + Math.PI);
                    const pt = vincentyDestination(center, radiusM, targetBrng);
                    Q[0] = { lat: pt.lat, lng: pt.lng, index: 0 };
                }
                continue;
            }

            if (i === N - 1) {
                // Last point (Goal)
                if (radiusM > 0) {
                    const prevPt = Q[i - 1];
                    const brng = vincentyBearing(center, prevPt);
                    if (tp.goalType === 'line') {
                        // Goal line: half circle or perpendicular line segment of 100m
                        // Touch point is towards the previous point
                        const pt = vincentyDestination(center, Math.min(radiusM, 100), brng);
                        Q[i] = { lat: pt.lat, lng: pt.lng, index: i };
                    } else {
                        // Goal cylinder: perimeter point facing prevPt
                        const pt = vincentyDestination(center, radiusM, brng);
                        Q[i] = { lat: pt.lat, lng: pt.lng, index: i };
                    }
                } else {
                    Q[i] = { lat: center.lat, lng: center.lng, index: i };
                }
                continue;
            }

            // Intermediate turnpoints (including SSS and ESS if intermediate)
            if (radiusM <= 0) {
                Q[i] = { lat: center.lat, lng: center.lng, index: i };
                continue;
            }

            const prevPt = Q[i - 1];
            const nextPt = Q[i + 1];

            // Intermediate SSS with EXIT direction: pilot starts inside and exits toward nextPt
            if (tp.type === 'sss' && (tp.direction || 'exit').toLowerCase() === 'exit') {
                const bNext = vincentyBearing(center, nextPt);
                const pt = vincentyDestination(center, radiusM, bNext);
                Q[i] = { lat: pt.lat, lng: pt.lng, index: i, bearingOnCylinder: bNext };
                continue;
            }

            // Golden-section / ternary search along the perimeter angle to minimize dist(prevPt, P) + dist(P, nextPt)
            // Center bearing between prev and next as initial guess
            const bPrev = vincentyBearing(center, prevPt);
            const bNext = vincentyBearing(center, nextPt);
            
            // Mid-angle bisector
            let midBrng = Math.atan2(Math.sin(bPrev) + Math.sin(bNext), Math.cos(bPrev) + Math.cos(bNext));

            let low = midBrng - Math.PI / 2;
            let high = midBrng + Math.PI / 2;

            for (let step = 0; step < 16; step++) {
                const m1 = low + (high - low) / 3;
                const m2 = high - (high - low) / 3;

                const p1 = vincentyDestination(center, radiusM, m1);
                const p2 = vincentyDestination(center, radiusM, m2);

                const d1 = vincentyDistance(prevPt, p1) + vincentyDistance(p1, nextPt);
                const d2 = vincentyDistance(prevPt, p2) + vincentyDistance(p2, nextPt);

                if (d1 < d2) {
                    high = m2;
                } else {
                    low = m1;
                }
            }

            const bestBrng = (low + high) / 2;
            const bestPt = vincentyDestination(center, radiusM, bestBrng);
            Q[i] = { lat: bestPt.lat, lng: bestPt.lng, index: i, bearingOnCylinder: bestBrng };
        }
    }

    // Compute leg distances and total distance
    const legDistances = [];
    let totalDistMeters = 0;
    let speedSectionDistMeters = 0;

    for (let i = 0; i < N - 1; i++) {
        const d = vincentyDistance(Q[i], Q[i + 1]);
        legDistances.push(d / 1000); // km
        totalDistMeters += d;

        if (i >= sssIdx && i < essIdx) {
            speedSectionDistMeters += d;
        }
    }

    const touchPoints = Q.map((pt, idx) => ({
        lat: pt.lat,
        lng: pt.lng,
        turnpointIndex: idx,
        turnpoint: turnpoints[idx]
    }));

    return {
        points: Q,
        legDistances: legDistances,
        totalDistanceKm: totalDistMeters / 1000,
        speedSectionDistanceKm: speedSectionDistMeters / 1000,
        touchPoints: touchPoints
    };
}
