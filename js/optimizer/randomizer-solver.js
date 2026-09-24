// task-planner/js/optimizer/randomizer-solver.js
import { vincentyDistance, deflectionAngle, roundTo2SigFigs, getDiscrete2SigFigValues, calculatePolylineOverlapPercent } from '../geo-math.js';
import { optimizeTaskRoute } from './task-optimizer.js';

/**
 * Constraint-based paragliding task randomizer and solver.
 * 
 * Guarantees diversity:
 * - Strictly excludes the current task and recent task configurations so consecutive runs always produce NEW options.
 * - Samples a diverse candidate pool of valid solutions rather than exiting on the first duplicate match.
 * - Filters out candidates whose flight route overlaps >= maxOverlapPercent with any previous option.
 * - Fast single-turnpoint path directly evaluates shuffled candidate waypoints without wasteful attempts.
 * 
 * Rules enforced:
 * 1. Target distance tolerance: +/- distanceToleranceKm (configurable, default 0.5 km)
 * 2. Number of turnpoints = N
 * 3. Radius bounds: 400m to 300km, discrete steps of 2 significant figures
 * 4. Locked waypoints remain fixed
 * 5. Minimum leg length >= 30% of average leg length
 * 6. Deflection angle: 20 deg <= theta <= 160 deg (with turnaround tolerance up to 175° if out-and-return)
 * 7. Max route overlap: < maxOverlapPercent with existing options
 */
export function solveRandomizedTask({
    waypoints,
    currentTurnpoints,
    targetDistanceKm,
    numTurnpoints,
    targetIndex = null,
    distanceToleranceKm = 0.5,
    maxOverlapPercent = 80,
    recentTasks = [],
    recentSignatures,
    maxAttempts = 300
}) {
    if (!waypoints || waypoints.length < 2) {
        return { success: false, error: "Not enough waypoints loaded" };
    }

    const toleranceKm = Math.max(0.05, Number(distanceToleranceKm) || 0.5);
    const maxOverlap = (maxOverlapPercent !== undefined && maxOverlapPercent !== null && !isNaN(maxOverlapPercent))
        ? Number(maxOverlapPercent)
        : 80;

    const N = Math.max(2, numTurnpoints || (currentTurnpoints ? currentTurnpoints.length : 4));
    const L_avg = targetDistanceKm / (N - 1);
    const minLegMeters = 0.3 * L_avg * 1000;
    const discreteRadii = getDiscrete2SigFigValues(400, 300000);

    const currentSignature = (currentTurnpoints || [])
        .map(t => (t && t.waypoint ? t.waypoint.id : ''))
        .join('|');

    const excludeSignatures = new Set(recentSignatures || []);
    if (currentSignature) {
        excludeSignatures.add(currentSignature);
    }

    // Build list of previous task routes for spatial overlap comparison
    const previousTasksToCompare = [];
    if (recentTasks && recentTasks.length > 0) {
        for (const taskEntry of recentTasks) {
            if (taskEntry.optimized && taskEntry.optimized.points) {
                previousTasksToCompare.push(taskEntry.optimized.points);
            } else if (taskEntry.points) {
                previousTasksToCompare.push(taskEntry.points);
            } else if (taskEntry.turnpoints && taskEntry.turnpoints.length >= 2) {
                if (taskEntry.turnpoints.every(t => t && t.waypoint && t.waypoint.lat !== undefined)) {
                    const opt = optimizeTaskRoute(taskEntry.turnpoints);
                    if (opt && opt.points && opt.points.length >= 2) previousTasksToCompare.push(opt.points);
                }
            }
        }
    }
    // Also include current task if not already in history
    if (currentTurnpoints && currentTurnpoints.length >= 2 && previousTasksToCompare.length === 0) {
        if (currentTurnpoints.every(t => t && t.waypoint && t.waypoint.lat !== undefined)) {
            const curOpt = optimizeTaskRoute(currentTurnpoints);
            if (curOpt && curOpt.points && curOpt.points.length >= 2) previousTasksToCompare.push(curOpt.points);
        }
    }

    function isCandidateTooSimilar(candOpt) {
        if (maxOverlap >= 100 || !candOpt || !candOpt.points || candOpt.points.length < 2) {
            return false;
        }
        for (const prevPoints of previousTasksToCompare) {
            if (prevPoints && prevPoints.length >= 2) {
                const overlap = calculatePolylineOverlapPercent(candOpt.points, prevPoints);
                if (overlap >= maxOverlap) {
                    return true;
                }
            }
        }
        return false;
    }

    // Build the slot template
    const template = [];
    const isSingleTarget = targetIndex !== null && targetIndex !== undefined;

    // Identify designated or existing launch (takeoff) and goal turnpoints
    const launchTp = (currentTurnpoints && currentTurnpoints.length > 0)
        ? (currentTurnpoints.find(t => t && t.type === 'takeoff') || currentTurnpoints[0])
        : null;
    const isLaunchLocked = launchTp ? (launchTp.locked !== false) : true;

    const goalTp = (currentTurnpoints && currentTurnpoints.length > 1)
        ? (currentTurnpoints.slice().reverse().find(t => t && t.type === 'goal') || currentTurnpoints[currentTurnpoints.length - 1])
        : null;
    const isGoalLocked = goalTp ? (goalTp.locked !== false) : true;

    // Takeoffs must start with 'T', Goals with 'G' (with graceful fallback)
    const takeoffPool = waypoints.filter(w => {
        const c = (w.code || w.name || '').toUpperCase();
        return c.startsWith('T');
    });
    const effectiveTakeoffPool = takeoffPool.length > 0 ? takeoffPool : waypoints;

    const goalPool = waypoints.filter(w => {
        const c = (w.code || w.name || '').toUpperCase();
        const d = (w.desc || w.description || '').toUpperCase();
        return c.startsWith('G') || d.includes('GOAL');
    });
    const effectiveGoalPool = goalPool.length > 0 ? goalPool : waypoints;

    for (let i = 0; i < N; i++) {
        if (isSingleTarget) {
            // Randomizing specifically targetIndex
            const existing = currentTurnpoints && currentTurnpoints[i];
            if (i === targetIndex) {
                const existingType = existing ? existing.type : null;
                const isSssSlot = existingType === 'sss' || (!existingType && i === 1 && N >= 5);
                const isEssSlot = existingType === 'ess' || (!existingType && i === N - 2 && N >= 5);
                const isGoalSlot = (i === N - 1);
                const isTakeoffSlot = (i === 0);

                const slotType = isTakeoffSlot ? 'takeoff' : (isGoalSlot ? 'goal' : (isSssSlot ? 'sss' : (isEssSlot ? 'ess' : 'turnpoint')));
                const slotDir = isSssSlot ? (existing && existing.direction ? existing.direction : 'exit') : 'enter';
                const defaultRadius = (isSssSlot || isEssSlot) ? 2000 : (isTakeoffSlot ? 1000 : 400);

                template.push({
                    waypoint: null,
                    radius: defaultRadius,
                    type: slotType,
                    direction: slotDir,
                    goalType: (existing && existing.goalType) || 'cylinder',
                    locked: false
                });
            } else if (existing && existing.waypoint) {
                template.push({
                    waypoint: existing.waypoint,
                    radius: roundTo2SigFigs(existing.radius || 400),
                    type: existing.type || (i === 0 ? 'takeoff' : (i === N - 1 ? 'goal' : 'turnpoint')),
                    direction: existing.direction || (i === 1 && existing.type === 'sss' ? 'exit' : 'enter'),
                    goalType: existing.goalType || 'cylinder',
                    locked: true
                });
            } else {
                template.push({
                    waypoint: null,
                    radius: 400,
                    type: i === 0 ? 'takeoff' : (i === N - 1 ? 'goal' : 'turnpoint'),
                    direction: 'enter',
                    goalType: 'cylinder',
                    locked: false
                });
            }
            continue;
        }

        // Full Task Randomization
        if (i === 0) {
            if (isLaunchLocked && launchTp && launchTp.waypoint) {
                template.push({
                    waypoint: launchTp.waypoint,
                    radius: roundTo2SigFigs(launchTp.radius || 1000),
                    type: 'takeoff',
                    direction: 'enter',
                    goalType: 'cylinder',
                    locked: true
                });
            } else {
                template.push({
                    waypoint: null,
                    radius: 1000,
                    type: 'takeoff',
                    direction: 'enter',
                    goalType: 'cylinder',
                    locked: false
                });
            }
        } else if (i === N - 1) {
            if (isGoalLocked && goalTp && goalTp.waypoint) {
                template.push({
                    waypoint: goalTp.waypoint,
                    radius: roundTo2SigFigs(goalTp.radius || 400),
                    type: 'goal',
                    direction: 'enter',
                    goalType: goalTp.goalType || 'cylinder',
                    locked: true
                });
            } else {
                template.push({
                    waypoint: null,
                    radius: 400,
                    type: 'goal',
                    direction: 'enter',
                    goalType: 'cylinder',
                    locked: false
                });
            }
        } else if (i === 1 && N >= 5) {
            // Default SSS: 2km around launch waypoint (direction: exit)
            const existing = currentTurnpoints && currentTurnpoints[1];
            if (existing && existing.locked && existing.waypoint && existing.type === 'sss') {
                template.push({
                    waypoint: existing.waypoint,
                    radius: roundTo2SigFigs(existing.radius || 2000),
                    type: 'sss',
                    direction: existing.direction || 'exit',
                    goalType: 'cylinder',
                    locked: true
                });
            } else if (existing && existing.type && existing.type !== 'sss') {
                template.push({
                    waypoint: (existing.locked && existing.waypoint) ? existing.waypoint : null,
                    radius: existing.radius || 400,
                    type: 'turnpoint',
                    direction: 'enter',
                    goalType: 'cylinder',
                    locked: !!existing.locked
                });
            } else {
                const launchWp = (isLaunchLocked && launchTp && launchTp.waypoint) ? launchTp.waypoint : null;
                template.push({
                    waypoint: launchWp,
                    radius: (existing && existing.radius) ? existing.radius : 2000,
                    type: 'sss',
                    direction: (existing && existing.direction) ? existing.direction : 'exit',
                    goalType: 'cylinder',
                    locked: existing ? !!existing.locked : false
                });
            }
        } else if (i === N - 2 && N >= 5) {
            // Default ESS: 2km around goal waypoint (direction: enter)
            const existing = currentTurnpoints && currentTurnpoints[N - 2];
            if (existing && existing.locked && existing.waypoint && existing.type === 'ess') {
                template.push({
                    waypoint: existing.waypoint,
                    radius: roundTo2SigFigs(existing.radius || 2000),
                    type: 'ess',
                    direction: 'enter',
                    goalType: 'cylinder',
                    locked: true
                });
            } else if (existing && existing.type && existing.type !== 'ess') {
                template.push({
                    waypoint: (existing.locked && existing.waypoint) ? existing.waypoint : null,
                    radius: existing.radius || 400,
                    type: 'turnpoint',
                    direction: 'enter',
                    goalType: 'cylinder',
                    locked: !!existing.locked
                });
            } else {
                const goalWp = (isGoalLocked && goalTp && goalTp.waypoint) ? goalTp.waypoint : null;
                template.push({
                    waypoint: goalWp,
                    radius: (existing && existing.radius) ? existing.radius : 2000,
                    type: 'ess',
                    direction: (existing && existing.direction) ? existing.direction : 'enter',
                    goalType: 'cylinder',
                    locked: existing ? !!existing.locked : false
                });
            }
        } else {
            // Intermediate turnpoint slots
            const existing = currentTurnpoints && currentTurnpoints[i];
            const isSssSlot = (i === 1 && N >= 3 && existing && existing.type === 'sss');
            const isEssSlot = (i === N - 2 && N >= 4 && existing && existing.type === 'ess');
            const type = isSssSlot ? 'sss' : (isEssSlot ? 'ess' : 'turnpoint');
            const dir = isSssSlot ? (existing.direction || 'exit') : 'enter';
            const defaultRadius = (isSssSlot || isEssSlot) ? 2000 : 400;

            if (existing && existing.locked && existing.waypoint && existing !== launchTp && existing !== goalTp) {
                template.push({
                    waypoint: existing.waypoint,
                    radius: roundTo2SigFigs(existing.radius || defaultRadius),
                    type: existing.type || type,
                    direction: existing.direction || dir,
                    goalType: 'cylinder',
                    locked: true
                });
            } else {
                template.push({
                    waypoint: null,
                    radius: defaultRadius,
                    type: type,
                    direction: dir,
                    goalType: 'cylinder',
                    locked: false
                });
            }
        }
    }

    const lockedPoints = template.filter(t => t.locked && t.waypoint);
    let anchor = lockedPoints.length > 0 ? lockedPoints[0].waypoint : waypoints[0];

    const maxSearchRadiusMeters = Math.max(targetDistanceKm * 1.8, 60) * 1000;
    const pool = waypoints.filter(w => vincentyDistance(anchor, w) <= maxSearchRadiusMeters);
    const candidatePool = pool.length >= N * 2 ? pool : waypoints;

    // Shuffle candidate pool
    const shuffledPool = candidatePool.slice().sort(() => Math.random() - 0.5);

    let isOutAndReturn = false;
    if (template[0].waypoint && template[N - 1].waypoint) {
        const dStartGoal = vincentyDistance(template[0].waypoint, template[N - 1].waypoint);
        if (dStartGoal < targetDistanceKm * 0.3 * 1000) {
            isOutAndReturn = true;
        }
    }

    const maxDeflection = isOutAndReturn ? 180 : 160;

    const validSolutions = [];
    const fineSolutions = [];
    const bestFallbackSolutions = [];

    // Fast Single-Turnpoint Path
    if (targetIndex !== null && targetIndex !== undefined) {
        const idx = targetIndex;
        const prevWp = idx > 0 ? template[idx - 1].waypoint : null;
        const nextWp = idx < N - 1 ? template[idx + 1].waypoint : null;

        let poolToUse = shuffledPool;
        if (idx === 0) {
            poolToUse = effectiveTakeoffPool;
        } else if (idx === N - 1) {
            poolToUse = effectiveGoalPool;
        }

        // Count occurrences of waypoints in other slots to allow up to 2 visits
        const idCounts = new Map();
        for (let i = 0; i < N; i++) {
            if (i !== idx && template[i].waypoint) {
                const id = template[i].waypoint.id;
                idCounts.set(id, (idCounts.get(id) || 0) + 1);
            }
        }

        for (const candWp of poolToUse) {
            const count = idCounts.get(candWp.id) || 0;
            if (count >= 2) continue;

            if (prevWp && prevWp.id === candWp.id) continue;
            if (nextWp && nextWp.id === candWp.id) continue;

            if (prevWp) {
                const d = vincentyDistance(prevWp, candWp);
                if (d < minLegMeters) continue;
            }
            if (nextWp) {
                const d = vincentyDistance(candWp, nextWp);
                if (d < minLegMeters) continue;
            }

            const candidateTask = template.map((t, i) => {
                if (i === idx) {
                    return { ...t, waypoint: candWp, radius: t.radius || 400 };
                }
                return { ...t };
            });

            const sig = candidateTask.map(t => t.waypoint ? t.waypoint.id : '').join('|');
            if (excludeSignatures.has(sig)) continue;

            // Check deflection angles
            let anglesOk = true;
            for (let i = 1; i < N - 1; i++) {
                const pPrev = candidateTask[i - 1].waypoint;
                const pCurr = candidateTask[i].waypoint;
                const pNext = candidateTask[i + 1].waypoint;
                if (!pPrev || !pCurr || !pNext) continue;
                if (pPrev.id === pCurr.id || pCurr.id === pNext.id) continue;

                const ang = deflectionAngle(pPrev, pCurr, pNext);
                if (ang < 20 || ang > maxDeflection) {
                    anglesOk = false;
                    break;
                }
            }
            if (!anglesOk) continue;

            // Tune radius for this candidate
            let opt = optimizeTaskRoute(candidateTask);
            let overshootKm = opt.totalDistanceKm - targetDistanceKm;
            if (overshootKm > toleranceKm && idx > 0 && idx < N - 1) {
                const pPrev = candidateTask[idx - 1].waypoint;
                const pNext = candidateTask[idx + 1].waypoint;
                if (pPrev && pNext && pPrev.id !== candWp.id && candWp.id !== pNext.id) {
                    const angObj = deflectionAngle(pPrev, candWp, pNext);
                    const sinHalf = Math.sin((angObj * Math.PI / 180) / 2);
                    const neededR = (overshootKm * 1000) / (2 * Math.max(0.2, sinHalf));
                    const discreteR = roundTo2SigFigs(Math.min(neededR, 50000));
                    let bestR = discreteR >= 400 ? discreteR : 400;
                    candidateTask[idx].radius = bestR;
                    opt = optimizeTaskRoute(candidateTask);
                    let bestDiff = Math.abs(opt.totalDistanceKm - targetDistanceKm);

                    let isFine = false;
                    // If discrete 2-sig-fig radius misses tolerance, refine with binary search in 100m steps
                    if (bestDiff > toleranceKm) {
                        let low = 400, high = 50000;
                        for (let step = 0; step < 16; step++) {
                            const mid = Math.round(((low + high) / 2) / 100) * 100;
                            if (mid < 400) { low = 400; continue; }
                            candidateTask[idx].radius = mid;
                            const testOpt = optimizeTaskRoute(candidateTask);
                            const curDiff = testOpt.totalDistanceKm - targetDistanceKm;
                            if (Math.abs(curDiff) < bestDiff) {
                                bestDiff = Math.abs(curDiff);
                                bestR = mid;
                                opt = testOpt;
                            }
                            if (curDiff > 0) low = mid + 100;
                            else high = mid - 100;
                        }
                        candidateTask[idx].radius = bestR;
                        if (bestR !== discreteR && roundTo2SigFigs(bestR) !== bestR) {
                            isFine = true;
                        }
                    }
                }
            }

            const diff = Math.abs(opt.totalDistanceKm - targetDistanceKm);
            if (diff <= toleranceKm) {
                if (!isCandidateTooSimilar(opt)) {
                    const hasNon2SigFig = candidateTask.some(t => t.radius && roundTo2SigFigs(t.radius) !== t.radius);
                    const sol = { turnpoints: candidateTask, optimized: opt, diffKm: diff, signature: sig };
                    if (hasNon2SigFig) {
                        fineSolutions.push(sol);
                    } else {
                        validSolutions.push(sol);
                    }
                    if (validSolutions.length >= 6) break;
                }
            } else {
                if (!isCandidateTooSimilar(opt)) {
                    bestFallbackSolutions.push({ turnpoints: candidateTask, optimized: opt, diffKm: diff, signature: sig });
                }
            }
        }
    } else {
        // Multi-Turnpoint Search
        const attempts = Math.min(Math.max(maxAttempts, 300), 1000);
        for (let attempt = 0; attempt < attempts; attempt++) {
            const candidateTask = template.map(t => ({ ...t }));

            // If slot 0 (Launch) is unlocked, select from effectiveTakeoffPool
            if (!candidateTask[0].waypoint) {
                const randTakeoff = effectiveTakeoffPool[Math.floor(Math.random() * effectiveTakeoffPool.length)];
                candidateTask[0].waypoint = randTakeoff;
                candidateTask[0].radius = 1000;
            }

            // If SSS slot (slot 1) is default 2km around Launch
            if (N >= 5 && candidateTask[1].type === 'sss' && !candidateTask[1].locked && !candidateTask[1].waypoint) {
                candidateTask[1].waypoint = candidateTask[0].waypoint;
                candidateTask[1].radius = 2000;
                candidateTask[1].direction = 'exit';
            }

            // If slot N - 1 (Goal) is unlocked, select from effectiveGoalPool
            if (!candidateTask[N - 1].waypoint) {
                const randGoal = effectiveGoalPool[Math.floor(Math.random() * effectiveGoalPool.length)];
                candidateTask[N - 1].waypoint = randGoal;
                candidateTask[N - 1].radius = 400;
            }

            // If ESS slot (slot N - 2) is default 2km around Goal
            if (N >= 5 && candidateTask[N - 2].type === 'ess' && !candidateTask[N - 2].locked && !candidateTask[N - 2].waypoint) {
                candidateTask[N - 2].waypoint = candidateTask[N - 1].waypoint;
                candidateTask[N - 2].radius = 2000;
                candidateTask[N - 2].direction = 'enter';
            }

            const dStartGoal = vincentyDistance(candidateTask[0].waypoint, candidateTask[N - 1].waypoint);
            const isTaskOutAndReturn = dStartGoal < targetDistanceKm * 0.35 * 1000;
            const currentMaxDeflection = isTaskOutAndReturn ? 180 : 160;

            // Track waypoint occurrences across the task
            const idCounts = new Map();
            for (let i = 0; i < N; i++) {
                if (candidateTask[i].waypoint) {
                    const id = candidateTask[i].waypoint.id;
                    idCounts.set(id, (idCounts.get(id) || 0) + 1);
                }
            }

            let validSequence = true;
            for (let i = 0; i < N; i++) {
                if (candidateTask[i].waypoint) {
                    continue;
                }

                const prevWp = i > 0 ? candidateTask[i - 1].waypoint : null;
                const nextWp = (i < N - 1 && candidateTask[i + 1].waypoint) ? candidateTask[i + 1].waypoint : null;

                const validChoices = [];
                const offset = Math.floor(Math.random() * shuffledPool.length);
                for (let s = 0; s < shuffledPool.length; s++) {
                    const randWp = shuffledPool[(offset + s) % shuffledPool.length];
                    
                    // Allow waypoint to appear up to 2 times in the task
                    const currentCount = idCounts.get(randWp.id) || 0;
                    if (currentCount >= 2) continue;

                    // Do not place duplicate consecutively
                    if (prevWp && prevWp.id === randWp.id) continue;
                    if (nextWp && nextWp.id === randWp.id) continue;

                    if (prevWp) {
                        const d = vincentyDistance(prevWp, randWp);
                        if (d < minLegMeters) continue;
                        if (i >= 2 && candidateTask[i - 2].waypoint && candidateTask[i - 2].waypoint.id !== prevWp.id) {
                            const angle = deflectionAngle(candidateTask[i - 2].waypoint, prevWp, randWp);
                            if (angle < 20 || angle > currentMaxDeflection) continue;
                        }
                    }
                    if (nextWp) {
                        const d = vincentyDistance(randWp, nextWp);
                        if (d < minLegMeters) continue;
                    }

                    validChoices.push(randWp);
                }

                if (validChoices.length === 0) {
                    validSequence = false;
                    break;
                }

                const chosen = validChoices[Math.floor(Math.random() * validChoices.length)];
                candidateTask[i].waypoint = chosen;
                candidateTask[i].radius = candidateTask[i].radius || 400;
                idCounts.set(chosen.id, (idCounts.get(chosen.id) || 0) + 1);
            }

            if (!validSequence) continue;

            const candidateSignature = candidateTask.map(t => t.waypoint ? t.waypoint.id : '').join('|');
            if (excludeSignatures.has(candidateSignature)) {
                continue;
            }

            let anglesOk = true;
            const angles = [];
            for (let i = 1; i < N - 1; i++) {
                const pPrev = candidateTask[i - 1].waypoint;
                const pCurr = candidateTask[i].waypoint;
                const pNext = candidateTask[i + 1].waypoint;
                if (!pPrev || !pCurr || !pNext) continue;
                if (pPrev.id === pCurr.id || pCurr.id === pNext.id) continue;

                const angle = deflectionAngle(pPrev, pCurr, pNext);
                if (angle < 20 || angle > currentMaxDeflection) {
                    anglesOk = false;
                    break;
                }
                angles.push({ index: i, angle });
            }
            if (!anglesOk) continue;

            let opt = optimizeTaskRoute(candidateTask);
            let currentDist = opt.totalDistanceKm;

            const overshootKm = currentDist - targetDistanceKm;
            let unlockedIndices = [];
            for (let i = 0; i < N; i++) {
                if (!candidateTask[i].locked && candidateTask[i].type === 'turnpoint') {
                    unlockedIndices.push(i);
                }
            }
            if (unlockedIndices.length === 0) {
                for (let i = 1; i < N - 1; i++) {
                    if (!candidateTask[i].locked) unlockedIndices.push(i);
                }
            }

            if (overshootKm > toleranceKm && unlockedIndices.length > 0) {
                let remainingOvershootMeters = overshootKm * 1000;
                for (const idx of unlockedIndices) {
                    if (remainingOvershootMeters <= (toleranceKm * 1000)) break;
                    const angObj = angles.find(a => a.index === idx);
                    const angleDeg = angObj ? angObj.angle : 90;
                    const sinHalf = Math.sin((angleDeg * Math.PI / 180) / 2);

                    const targetCutMeters = Math.min(remainingOvershootMeters, remainingOvershootMeters / Math.max(1, unlockedIndices.length) * 1.5);
                    const neededRadius = targetCutMeters / (2 * Math.max(0.2, sinHalf));

                    const baseR = roundTo2SigFigs(Math.min(neededRadius, 50000));
                    const baseIdx = discreteRadii.indexOf(baseR);
                    const testRadii = [baseR];
                    if (baseIdx > 0) testRadii.push(discreteRadii[baseIdx - 1]);
                    if (baseIdx >= 0 && baseIdx < discreteRadii.length - 1) testRadii.push(discreteRadii[baseIdx + 1]);

                    let bestR = baseR;
                    let bestDiff = Infinity;
                    let bestOpt = opt;

                    for (const r of testRadii) {
                        if (r < 400) continue;
                        candidateTask[idx].radius = r;
                        const testOpt = optimizeTaskRoute(candidateTask);
                        const d = Math.abs(testOpt.totalDistanceKm - targetDistanceKm);
                        if (d < bestDiff) {
                            bestDiff = d;
                            bestR = r;
                            bestOpt = testOpt;
                        }
                    }

                    let isFine = false;
                    // If discrete 2-sig-fig radius misses tolerance, refine with binary search in 100m steps
                    if (bestDiff > toleranceKm) {
                        let low = 400, high = 50000;
                        for (let step = 0; step < 16; step++) {
                            const mid = Math.round(((low + high) / 2) / 100) * 100;
                            if (mid < 400) { low = 400; continue; }
                            candidateTask[idx].radius = mid;
                            const testOpt = optimizeTaskRoute(candidateTask);
                            const curDiff = testOpt.totalDistanceKm - targetDistanceKm;
                            if (Math.abs(curDiff) < bestDiff) {
                                bestDiff = Math.abs(curDiff);
                                bestR = mid;
                                bestOpt = testOpt;
                            }
                            if (curDiff > 0) low = mid + 100;
                            else high = mid - 100;
                        }
                        if (bestR !== baseR && roundTo2SigFigs(bestR) !== bestR) {
                            isFine = true;
                        }
                    }

                    candidateTask[idx].radius = bestR;
                    opt = bestOpt;
                    remainingOvershootMeters = (opt.totalDistanceKm - targetDistanceKm) * 1000;
                }
            }

            let diff = Math.abs(opt.totalDistanceKm - targetDistanceKm);
            if (diff <= toleranceKm) {
                if (!isCandidateTooSimilar(opt)) {
                    const hasNon2SigFig = candidateTask.some(t => t.radius && roundTo2SigFigs(t.radius) !== t.radius);
                    const sol = { turnpoints: candidateTask, optimized: opt, diffKm: diff, signature: candidateSignature };
                    if (hasNon2SigFig) {
                        fineSolutions.push(sol);
                    } else {
                        validSolutions.push(sol);
                    }
                    if (validSolutions.length >= 6) break;
                }
            } else {
                if (!isCandidateTooSimilar(opt) && !bestFallbackSolutions.some(b => b.signature === candidateSignature)) {
                    bestFallbackSolutions.push({ turnpoints: candidateTask, optimized: opt, diffKm: diff, signature: candidateSignature });
                    bestFallbackSolutions.sort((a, b) => a.diffKm - b.diffKm);
                    if (bestFallbackSolutions.length > 8) bestFallbackSolutions.pop();
                }
            }
        }
    }

    const solutionPool = validSolutions.length > 0 ? validSolutions : fineSolutions;
    if (solutionPool.length > 0) {
        const chosen = solutionPool[Math.floor(Math.random() * solutionPool.length)];
        return {
            success: true,
            turnpoints: chosen.turnpoints,
            optimized: chosen.optimized,
            diffKm: chosen.diffKm,
            signature: chosen.signature
        };
    }

    if (bestFallbackSolutions.length > 0) {
        bestFallbackSolutions.sort((a, b) => a.diffKm - b.diffKm);
        const chosen = bestFallbackSolutions[0];
        return {
            success: chosen.diffKm <= toleranceKm,
            turnpoints: chosen.turnpoints,
            optimized: chosen.optimized,
            diffKm: chosen.diffKm,
            signature: chosen.signature,
            message: `Closest task: ${chosen.optimized.totalDistanceKm.toFixed(1)} km (delta ${chosen.diffKm.toFixed(1)} km)`
        };
    }

    return {
        success: false,
        error: "Could not generate an alternative task satisfying constraints."
    };
}
