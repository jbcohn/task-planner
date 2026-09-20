// task-planner/js/drawing/freehand-tracer.js
import { vincentyDistance, vincentyBearing, vincentyDestination, roundTo2SigFigs } from '../geo-math.js';
import { optimizeTaskRoute } from '../optimizer/task-optimizer.js';

/**
 * Translates a freehand stroke of map coordinates into a sequence of paragliding task waypoints
 * such that the resulting OPTIMIZED PATH matches the inflection points of the drawn route.
 * 
 * For each intermediate inflection point I_k:
 * 1. Computes the inner turn bisector angle.
 * 2. Searches the catalog for a waypoint W_k whose cylinder can touch I_k on the optimal path.
 * 3. Sets radius r_k = roundTo2SigFigs(dist(W_k, I_k)).
 * 
 * @param {Array<{lat: number, lng: number}>} strokePoints - Raw points sampled from finger/mouse drag
 * @param {Array<Object>} waypointCatalog - Loaded waypoint database
 * @param {Object} [options]
 * @param {number} [options.epsilonKm=1.5] - RDP tolerance in km for corner extraction
 * @returns {{ turnpoints: Array<Object>, optimized: Object, corners: Array<Object> }}
 */
export function translateFreehandStrokeToTask(strokePoints, waypointCatalog, options = {}) {
    if (!strokePoints || strokePoints.length < 2 || !waypointCatalog || waypointCatalog.length === 0) {
        return { turnpoints: [], optimized: null, corners: [] };
    }

    const epsilonKm = options.epsilonKm || 1.5;

    // 1. Simplify trajectory with Ramer-Douglas-Peucker to extract key inflection corners
    const simplifiedPoints = ramerDouglasPeucker(strokePoints, epsilonKm);

    if (simplifiedPoints.length < 2) {
        return { turnpoints: [], optimized: null, corners: [] };
    }

    const M = simplifiedPoints.length;
    const turnpoints = [];
    const usedWpIds = new Set();

    for (let k = 0; k < M; k++) {
        const I_k = simplifiedPoints[k];

        if (k === 0) {
            // First point: Start / Takeoff
            // Pick closest waypoint to start point
            const wp = findBestWaypointNear(I_k, waypointCatalog, usedWpIds);
            const r = wp ? Math.max(400, roundTo2SigFigs(vincentyDistance(wp, I_k))) : 1000;
            turnpoints.push({
                id: `TP_${k + 1}_${wp ? wp.id : k}`,
                waypoint: wp || { id: 'WP_START', name: 'Start', lat: I_k.lat, lng: I_k.lng },
                radius: Math.min(r, 5000),
                type: 'takeoff',
                direction: 'enter',
                goalType: 'cylinder',
                locked: false
            });
            if (wp) usedWpIds.add(wp.id);
            continue;
        }

        if (k === M - 1) {
            // Last point: Goal
            const wp = findBestWaypointNear(I_k, waypointCatalog, usedWpIds);
            const r = wp ? Math.max(400, roundTo2SigFigs(vincentyDistance(wp, I_k))) : 400;
            turnpoints.push({
                id: `TP_${k + 1}_${wp ? wp.id : k}`,
                waypoint: wp || { id: 'WP_GOAL', name: 'Goal', lat: I_k.lat, lng: I_k.lng },
                radius: Math.min(r, 3000),
                type: 'goal',
                direction: 'enter',
                goalType: 'cylinder',
                locked: false
            });
            if (wp) usedWpIds.add(wp.id);
            continue;
        }

        // Intermediate inflection point I_k
        const I_prev = simplifiedPoints[k - 1];
        const I_next = simplifiedPoints[k + 1];

        const bIn = vincentyBearing(I_prev, I_k);
        const bOut = vincentyBearing(I_k, I_next);

        // Calculate inner bisector vector (opposing the turn deflection)
        const vxIn = Math.sin(bIn), vyIn = Math.cos(bIn);
        const vxOut = Math.sin(bOut), vyOut = Math.cos(bOut);
        const bx = -(vxOut - vxIn);
        const by = -(vyOut - vyIn);
        const bisectorBrng = Math.atan2(bx, by); // radians

        // Search catalog for waypoint W positioned along inner bisector
        let bestWp = null;
        let bestScore = -Infinity;
        let bestRadius = 1000;

        for (const wp of waypointCatalog) {
            if (usedWpIds.has(wp.id)) continue;

            const dist = vincentyDistance(I_k, wp);
            // Look for waypoints within 400m to 25km
            if (dist > 35000) continue;

            if (dist < 400) {
                // Extremely close waypoint, can be used directly with 400m radius
                const score = 1000 - dist;
                if (score > bestScore) {
                    bestScore = score;
                    bestWp = wp;
                    bestRadius = 400;
                }
                continue;
            }

            // Check bearing from I_k to wp
            const brngToWp = vincentyBearing(I_k, wp);
            const angleDiff = Math.abs(brngToWp - bisectorBrng);
            const normDiff = Math.min(angleDiff, 2 * Math.PI - angleDiff);

            // Cosine of alignment with inner bisector
            const cosAlign = Math.cos(normDiff);

            // We prefer waypoints that are on the inside of the turn (cosAlign > 0)
            if (cosAlign > 0.1) {
                // Score combines bisector alignment and reasonable distance
                const score = (cosAlign * 2) - (dist / 15000);
                if (score > bestScore) {
                    bestScore = score;
                    bestWp = wp;
                    bestRadius = roundTo2SigFigs(dist);
                }
            }
        }

        // Fallback: closest waypoint if no well-aligned waypoint found
        if (!bestWp) {
            bestWp = findBestWaypointNear(I_k, waypointCatalog, usedWpIds);
            if (bestWp) {
                const dist = vincentyDistance(I_k, bestWp);
                bestRadius = Math.max(400, roundTo2SigFigs(dist));
            }
        }

        if (bestWp) {
            usedWpIds.add(bestWp.id);
            turnpoints.push({
                id: `TP_${k + 1}_${bestWp.id}`,
                waypoint: bestWp,
                radius: Math.min(bestRadius, 35000),
                type: (k === 1 && M > 3) ? 'sss' : 'turnpoint',
                direction: (k === 1 && M > 3) ? 'exit' : 'enter',
                goalType: 'cylinder',
                locked: false
            });
        }
    }

    const optimized = optimizeTaskRoute(turnpoints);

    return {
        turnpoints: turnpoints,
        optimized: optimized,
        corners: simplifiedPoints
    };
}

function findBestWaypointNear(pt, catalog, usedIds) {
    let best = null;
    let minD = Infinity;
    for (const wp of catalog) {
        if (usedIds && usedIds.has(wp.id)) continue;
        const d = vincentyDistance(pt, wp);
        if (d < minD) {
            minD = d;
            best = wp;
        }
    }
    return best;
}

/**
 * Standard Ramer-Douglas-Peucker simplification using perpendicular distance.
 */
function ramerDouglasPeucker(points, epsilonKm) {
    if (points.length <= 2) return points;

    let maxDist = 0;
    let index = 0;
    const start = points[0];
    const end = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
        const dist = perpendicularDistance(points[i], start, end);
        if (dist > maxDist) {
            maxDist = dist;
            index = i;
        }
    }

    if (maxDist > epsilonKm) {
        const left = ramerDouglasPeucker(points.slice(0, index + 1), epsilonKm);
        const right = ramerDouglasPeucker(points.slice(index), epsilonKm);
        return left.slice(0, left.length - 1).concat(right);
    } else {
        return [start, end];
    }
}

/**
 * Perpendicular distance in km from point P to segment AB.
 */
function perpendicularDistance(p, a, b) {
    const latMean = (a.lat + b.lat) / 2 * Math.PI / 180;
    const cosLat = Math.cos(latMean);
    const R = 6371.0;

    const xA = a.lng * Math.PI / 180 * cosLat * R;
    const yA = a.lat * Math.PI / 180 * R;
    const xB = b.lng * Math.PI / 180 * cosLat * R;
    const yB = b.lat * Math.PI / 180 * R;
    const xP = p.lng * Math.PI / 180 * cosLat * R;
    const yP = p.lat * Math.PI / 180 * R;

    const dx = xB - xA;
    const dy = yB - yA;
    const lenSq = dx * dx + dy * dy;

    if (lenSq === 0) {
        return Math.hypot(xP - xA, yP - yA);
    }

    const t = Math.max(0, Math.min(1, ((xP - xA) * dx + (yP - yA) * dy) / lenSq));
    const projX = xA + t * dx;
    const projY = yA + t * dy;

    return Math.hypot(xP - projX, yP - projY);
}
