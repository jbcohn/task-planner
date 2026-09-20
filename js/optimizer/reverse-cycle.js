// task-planner/js/optimizer/reverse-cycle.js
import { vincentyDistance, deflectionAngle, roundTo2SigFigs } from '../geo-math.js';
import { optimizeTaskRoute } from './task-optimizer.js';

/**
 * Finds alternative candidate waypoints that can achieve an existing optimized cut-point P
 * on turnpoint T_i, adjusting cylinder radius to r = dist(W, P) (rounded to 2 sig figs),
 * and enforcing the paragliding angle and minimum leg length constraints.
 * 
 * @param {Object} options
 * @param {Array<Object>} options.waypoints - Full waypoint database
 * @param {Array<Object>} options.turnpoints - Current task turnpoints
 * @param {number} options.turnpointIndex - Index i of the turnpoint being adjusted
 * @param {{lat: number, lng: number}} options.cutPoint - Selected optimized touch point P
 * @param {number} options.targetDistanceKm - Target optimized distance in km
 * @returns {Array<Object>} Candidate options sorted by distance delta
 */
export function findCandidateWaypointsForCutPoint({
    waypoints,
    turnpoints,
    turnpointIndex,
    cutPoint,
    targetDistanceKm
}) {
    if (!waypoints || !turnpoints || turnpointIndex < 0 || turnpointIndex >= turnpoints.length) {
        return [];
    }

    const N = turnpoints.length;
    const i = turnpointIndex;
    const prevPt = i > 0 ? (turnpoints[i - 1].waypoint) : null;
    const nextPt = i < N - 1 ? (turnpoints[i + 1].waypoint) : null;

    const L_avg = (targetDistanceKm || 50) / Math.max(1, N - 1);
    const minLegMeters = 0.3 * L_avg * 1000;

    // Check angle constraint at the cut-point P with adjacent points
    if (prevPt && nextPt) {
        const cutAngle = deflectionAngle(prevPt, cutPoint, nextPt);
        if (cutAngle < 20 || cutAngle > 160) {
            // Deflection angle at P is out of range
            return [];
        }
    }

    const candidates = [];
    const currentWpId = turnpoints[i].waypoint ? turnpoints[i].waypoint.id : null;

    for (const wp of waypoints) {
        if (wp.id === currentWpId) continue;

        // Calculate distance from candidate waypoint center to the touch point P
        const distToCutPoint = vincentyDistance(wp, cutPoint);

        // Radius constraint: 400m <= R <= 300km
        if (distToCutPoint < 350 || distToCutPoint > 300000) {
            continue;
        }

        const candidateRadius = roundTo2SigFigs(distToCutPoint);

        // Minimum leg length check from adjacent waypoint centers/touchpoints
        if (prevPt) {
            const dPrev = vincentyDistance(prevPt, wp);
            if (dPrev < minLegMeters) continue;
        }
        if (nextPt) {
            const dNext = vincentyDistance(wp, nextPt);
            if (dNext < minLegMeters) continue;
        }

        // Simulate replacing turnpoint i with candidate waypoint & radius
        const simulatedTask = turnpoints.map((tp, idx) => {
            if (idx === i) {
                return {
                    ...tp,
                    waypoint: wp,
                    radius: candidateRadius
                };
            }
            return tp;
        });

        const opt = optimizeTaskRoute(simulatedTask);
        const newTouchPoint = (opt.touchPoints && opt.touchPoints[i]) ? opt.touchPoints[i] : null;
        if (!newTouchPoint) continue;

        // Verify that the new optimized route actually passes through the selected touch point P
        const touchPointDeviationMeters = vincentyDistance(newTouchPoint, cutPoint);
        const maxTouchDeviation = Math.max(1500, Math.min(4000, candidateRadius * 0.35));
        if (touchPointDeviationMeters > maxTouchDeviation) {
            continue;
        }

        const diffKm = Math.abs(opt.totalDistanceKm - targetDistanceKm);

        candidates.push({
            waypoint: wp,
            radius: candidateRadius,
            optimizedDistanceKm: opt.totalDistanceKm,
            diffKm: diffKm,
            distToCutPointMeters: distToCutPoint,
            touchPointDeviationMeters: touchPointDeviationMeters
        });
    }

    // Sort candidates: closest touchpoint alignment first, then closest to target distance
    candidates.sort((a, b) => a.touchPointDeviationMeters - b.touchPointDeviationMeters || a.diffKm - b.diffKm);

    return candidates;
}
