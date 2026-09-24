// task-planner/js/geo-math.js

export const WGS84_A = 6378137.0; // semi-major axis in meters
export const WGS84_F = 1 / 298.257223563; // flattening
export const WGS84_B = 6356752.314245; // semi-minor axis in meters

/**
 * Calculate geodesic distance between two points on WGS-84 ellipsoid using Vincenty inverse formula.
 * @param {{lat: number, lng: number}} p1 
 * @param {{lat: number, lng: number}} p2 
 * @returns {number} Distance in meters
 */
export function vincentyDistance(p1, p2) {
    if (!p1 || !p2) return 0;
    if (p1.lat === p2.lat && p1.lng === p2.lng) return 0;

    const lat1 = p1.lat * Math.PI / 180;
    const lon1 = p1.lng * Math.PI / 180;
    const lat2 = p2.lat * Math.PI / 180;
    const lon2 = p2.lng * Math.PI / 180;

    const a = WGS84_A;
    const f = WGS84_F;
    const b = WGS84_B;

    const L = lon2 - lon1;
    const U1 = Math.atan((1 - f) * Math.tan(lat1));
    const U2 = Math.atan((1 - f) * Math.tan(lat2));

    const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1);
    const sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);

    let lambda = L;
    let lambdaP;
    let iterLimit = 100;
    let cosSqAlpha = 0;
    let cos2SigmaM = 0;
    let sinSigma = 0;
    let cosSigma = 0;
    let sigma = 0;

    do {
        const sinLambda = Math.sin(lambda);
        const cosLambda = Math.cos(lambda);
        sinSigma = Math.sqrt(
            (cosU2 * sinLambda) * (cosU2 * sinLambda) +
            (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) * (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda)
        );
        if (sinSigma === 0) return 0; // coincident points

        cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
        sigma = Math.atan2(sinSigma, cosSigma);

        const sinAlpha = cosU1 * cosU2 * sinLambda / sinSigma;
        cosSqAlpha = 1 - sinAlpha * sinAlpha;
        cos2SigmaM = (cosSqAlpha === 0) ? 0 : cosSigma - 2 * sinU1 * sinU2 / cosSqAlpha;

        const C = f / 16 * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
        lambdaP = lambda;
        lambda = L + (1 - C) * f * sinAlpha * (
            sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM))
        );
    } while (Math.abs(lambda - lambdaP) > 1e-12 && --iterLimit > 0);

    if (iterLimit === 0) {
        // Fallback to Haversine if Vincenty fails to converge (antipodal)
        return haversineDistanceMeters(p1, p2);
    }

    const uSq = cosSqAlpha * (a * a - b * b) / (b * b);
    const A = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
    const B = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
    const deltaSigma = B * sinSigma * (
        cos2SigmaM + B / 4 * (
            cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
            B / 6 * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)
        )
    );

    const s = b * A * (sigma - deltaSigma);
    return s; // in meters
}

/**
 * Geodesic initial bearing (forward azimuth) from p1 to p2 on WGS-84 in radians [-PI, PI].
 */
export function vincentyBearing(p1, p2) {
    if (!p1 || !p2) return 0;
    const lat1 = p1.lat * Math.PI / 180;
    const lon1 = p1.lng * Math.PI / 180;
    const lat2 = p2.lat * Math.PI / 180;
    const lon2 = p2.lng * Math.PI / 180;

    const f = WGS84_F;
    const L = lon2 - lon1;
    const U1 = Math.atan((1 - f) * Math.tan(lat1));
    const U2 = Math.atan((1 - f) * Math.tan(lat2));

    const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1);
    const sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);

    let lambda = L;
    let lambdaP;
    let iterLimit = 100;
    let sinSigma = 0;
    let cosSigma = 0;
    let sigma = 0;
    let sinAlpha = 0;
    let cosSqAlpha = 0;
    let cos2SigmaM = 0;

    do {
        const sinLambda = Math.sin(lambda);
        const cosLambda = Math.cos(lambda);
        sinSigma = Math.sqrt(
            (cosU2 * sinLambda) * (cosU2 * sinLambda) +
            (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) * (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda)
        );
        if (sinSigma === 0) return 0;

        cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
        sigma = Math.atan2(sinSigma, cosSigma);

        sinAlpha = cosU1 * cosU2 * sinLambda / sinSigma;
        cosSqAlpha = 1 - sinAlpha * sinAlpha;
        cos2SigmaM = (cosSqAlpha === 0) ? 0 : cosSigma - 2 * sinU1 * sinU2 / cosSqAlpha;

        const C = f / 16 * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
        lambdaP = lambda;
        lambda = L + (1 - C) * f * sinAlpha * (
            sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM))
        );
    } while (Math.abs(lambda - lambdaP) > 1e-12 && --iterLimit > 0);

    const y = cosU2 * Math.sin(lambda);
    const x = cosU1 * sinU2 - sinU1 * cosU2 * Math.cos(lambda);
    return Math.atan2(y, x); // radians [-PI, PI]
}

/**
 * Direct geodesic problem: Calculate destination point from start point, distance (meters), and bearing (radians).
 * Using Vincenty direct formula on WGS-84 ellipsoid.
 * @param {{lat: number, lng: number}} start 
 * @param {number} distMeters 
 * @param {number} brngRad Bearing in radians
 * @returns {{lat: number, lng: number}}
 */
export function vincentyDestination(start, distMeters, brngRad) {
    if (distMeters === 0) return { lat: start.lat, lng: start.lng };

    const a = WGS84_A;
    const b = WGS84_B;
    const f = WGS84_F;

    const lat1 = start.lat * Math.PI / 180;
    const lon1 = start.lng * Math.PI / 180;
    const alpha1 = brngRad;

    const sinAlpha1 = Math.sin(alpha1);
    const cosAlpha1 = Math.cos(alpha1);

    const tanU1 = (1 - f) * Math.tan(lat1);
    const cosU1 = 1 / Math.sqrt(1 + tanU1 * tanU1);
    const sinU1 = tanU1 * cosU1;

    const sigma1 = Math.atan2(tanU1, cosAlpha1);
    const sinAlpha = cosU1 * sinAlpha1;
    const cosSqAlpha = 1 - sinAlpha * sinAlpha;

    const uSq = cosSqAlpha * (a * a - b * b) / (b * b);
    const A = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
    const B = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));

    let sigma = distMeters / (b * A);
    let sigmaP = 2 * Math.PI;
    let cos2SigmaM = 0;
    let sinSigma = 0;
    let cosSigma = 0;
    let deltaSigma = 0;

    let iter = 100;
    while (Math.abs(sigma - sigmaP) > 1e-12 && --iter > 0) {
        cos2SigmaM = Math.cos(2 * sigma1 + sigma);
        sinSigma = Math.sin(sigma);
        cosSigma = Math.cos(sigma);

        deltaSigma = B * sinSigma * (
            cos2SigmaM + B / 4 * (
                cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
                B / 6 * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)
            )
        );
        sigmaP = sigma;
        sigma = distMeters / (b * A) + deltaSigma;
    }

    const tmp = sinU1 * sinSigma - cosU1 * cosSigma * cosAlpha1;
    const lat2 = Math.atan2(
        sinU1 * cosSigma + cosU1 * sinSigma * cosAlpha1,
        (1 - f) * Math.sqrt(sinAlpha * sinAlpha + tmp * tmp)
    );

    const lambda = Math.atan2(
        sinSigma * sinAlpha1,
        cosU1 * cosSigma - sinU1 * sinSigma * cosAlpha1
    );

    const C = f / 16 * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
    const L = lambda - (1 - C) * f * sinAlpha * (
        sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM))
    );

    let lon2 = lon1 + L;
    lon2 = ((lon2 * 180 / Math.PI + 540) % 360) - 180; // normalize [-180, 180]

    return {
        lat: lat2 * 180 / Math.PI,
        lng: lon2
    };
}

/**
 * Haversine fallback distance in meters.
 */
export function haversineDistanceMeters(p1, p2) {
    const R = 6371000; // Earth mean radius in meters
    const dLat = (p2.lat - p1.lat) * Math.PI / 180;
    const dLon = (p2.lng - p1.lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Calculate the deflection angle at vertex pCurr between incoming leg (pPrev -> pCurr)
 * and outgoing leg (pCurr -> pNext).
 * 0° means flying straight ahead in the same direction.
 * 90° means a 90° turn.
 * 180° means a complete 180° hairpin reversal.
 * @param {{lat: number, lng: number}} pPrev 
 * @param {{lat: number, lng: number}} pCurr 
 * @param {{lat: number, lng: number}} pNext 
 * @returns {number} Deflection angle in degrees [0, 180]
 */
export function deflectionAngle(pPrev, pCurr, pNext) {
    if (!pPrev || !pCurr || !pNext) return 0;
    const brngIn = (vincentyBearing(pPrev, pCurr) * 180 / Math.PI + 360) % 360;
    const brngOut = (vincentyBearing(pCurr, pNext) * 180 / Math.PI + 360) % 360;

    let diff = Math.abs(brngOut - brngIn);
    if (diff > 180) {
        diff = 360 - diff;
    }
    return diff;
}

/**
 * Round a value to 2 significant figures and clamp within [minMeters, maxMeters].
 * e.g., 432 -> 430, 995 -> 1000, 1240 -> 1200, 25700 -> 26000
 * @param {number} meters 
 * @param {number} minMeters (default 400)
 * @param {number} maxMeters (default 300000)
 * @returns {number}
 */
export function roundTo2SigFigs(meters, minMeters = 400, maxMeters = 300000) {
    const val = Math.max(minMeters, Math.min(maxMeters, meters));
    const magnitude = Math.floor(Math.log10(val));
    const factor = Math.pow(10, magnitude - 1);
    const rounded = Math.round(val / factor) * factor;
    return Math.max(minMeters, Math.min(maxMeters, Math.round(rounded)));
}

/**
 * Generate all possible discrete 2-significant-figure values between minMeters and maxMeters.
 */
export function getDiscrete2SigFigValues(minMeters = 400, maxMeters = 300000) {
    const values = [];
    let startMag = Math.floor(Math.log10(minMeters));
    let endMag = Math.floor(Math.log10(maxMeters));

    for (let mag = startMag; mag <= endMag; mag++) {
        const step = Math.pow(10, mag - 1);
        for (let mult = 10; mult < 100; mult++) {
            const val = mult * step;
            if (val >= minMeters && val <= maxMeters) {
                if (values.length === 0 || values[values.length - 1] !== val) {
                    values.push(val);
                }
            }
        }
    }
    return values;
}

/**
 * Format meters into paragliding display (m or km)
 * @param {number} meters 
 * @returns {string} e.g. "400m", "1.5km", "25km"
 */
export function formatRadiusDisplay(meters) {
    const m = Math.round(meters);
    if (m < 1000) {
        return `${m}m`;
    }
    const km = m / 1000;
    return `${parseFloat(km.toFixed(3))}km`;
}

/**
 * Compute approximate distance in meters from a point (lat, lng) to a line segment (s1, s2).
 * Uses flat-earth equirectangular approximation local to the segment.
 * @param {{lat: number, lng: number}} p
 * @param {{lat: number, lng: number}} s1
 * @param {{lat: number, lng: number}} s2
 * @returns {number} distance in meters
 */
export function distanceToSegmentMeters(p, s1, s2) {
    if (!p || !s1 || !s2) return Infinity;
    const midLatRad = ((s1.lat + s2.lat) / 2) * Math.PI / 180;
    const mPerDegLat = 111132.95;
    const mPerDegLng = 111412.84 * Math.cos(midLatRad);

    const px = (p.lng - s1.lng) * mPerDegLng;
    const py = (p.lat - s1.lat) * mPerDegLat;

    const vx = (s2.lng - s1.lng) * mPerDegLng;
    const vy = (s2.lat - s1.lat) * mPerDegLat;

    const segLenSq = vx * vx + vy * vy;
    if (segLenSq < 1e-6) {
        return Math.sqrt(px * px + py * py);
    }

    const t = Math.max(0, Math.min(1, (px * vx + py * vy) / segLenSq));
    const projX = t * vx;
    const projY = t * vy;

    const dx = px - projX;
    const dy = py - projY;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate the minimum distance in meters from a point p to a polyline.
 * @param {{lat: number, lng: number}} p
 * @param {Array<{lat: number, lng: number}>} polyline
 * @returns {number}
 */
export function distanceToPolylineMeters(p, polyline) {
    if (!polyline || polyline.length < 2) return Infinity;
    let minDist = Infinity;
    for (let i = 0; i < polyline.length - 1; i++) {
        const d = distanceToSegmentMeters(p, polyline[i], polyline[i + 1]);
        if (d < minDist) {
            minDist = d;
        }
    }
    return minDist;
}

/**
 * Resample a polyline into M uniformly spaced points along its cumulative distance.
 * @param {Array<{lat: number, lng: number}>} points
 * @param {number} sampleCount
 * @returns {Array<{lat: number, lng: number}>}
 */
export function samplePolylineUniformly(points, sampleCount = 40) {
    if (!points || points.length === 0) return [];
    if (points.length === 1 || sampleCount <= 1) return [{ lat: points[0].lat, lng: points[0].lng }];

    const segDistances = [];
    let totalDist = 0;
    for (let i = 0; i < points.length - 1; i++) {
        const d = vincentyDistance(points[i], points[i + 1]);
        segDistances.push(d);
        totalDist += d;
    }

    if (totalDist <= 0) {
        return Array(sampleCount).fill({ lat: points[0].lat, lng: points[0].lng });
    }

    const sampled = [];
    for (let k = 0; k < sampleCount; k++) {
        const targetDist = (k / (sampleCount - 1)) * totalDist;
        let accumulated = 0;
        let placed = false;

        for (let i = 0; i < segDistances.length; i++) {
            const segLen = segDistances[i];
            if (accumulated + segLen >= targetDist || i === segDistances.length - 1) {
                const u = segLen > 0 ? (targetDist - accumulated) / segLen : 0;
                const clampedU = Math.max(0, Math.min(1, u));
                sampled.push({
                    lat: points[i].lat + clampedU * (points[i + 1].lat - points[i].lat),
                    lng: points[i].lng + clampedU * (points[i + 1].lng - points[i].lng)
                });
                placed = true;
                break;
            }
            accumulated += segLen;
        }

        if (!placed) {
            sampled.push({ lat: points[points.length - 1].lat, lng: points[points.length - 1].lng });
        }
    }

    return sampled;
}

/**
 * Compute route overlap percentage between two polylines (0 to 100%).
 * Evaluates what percentage of the flight route falls within corridorMeters of the other route.
 * @param {Array<{lat: number, lng: number}>} polylineA
 * @param {Array<{lat: number, lng: number}>} polylineB
 * @param {number} corridorMeters (default 2000m = 2km)
 * @param {number} sampleCount (default 40)
 * @returns {number} Overlap percentage [0, 100]
 */
export function calculatePolylineOverlapPercent(polylineA, polylineB, corridorMeters = 2000, sampleCount = 40) {
    if (!polylineA || polylineA.length < 2 || !polylineB || polylineB.length < 2) {
        return 0;
    }

    const samplesA = samplePolylineUniformly(polylineA, sampleCount);
    const samplesB = samplePolylineUniformly(polylineB, sampleCount);

    let overlapA = 0;
    for (const pt of samplesA) {
        if (distanceToPolylineMeters(pt, polylineB) <= corridorMeters) {
            overlapA++;
        }
    }

    let overlapB = 0;
    for (const pt of samplesB) {
        if (distanceToPolylineMeters(pt, polylineA) <= corridorMeters) {
            overlapB++;
        }
    }

    const ratioA = overlapA / samplesA.length;
    const ratioB = overlapB / samplesB.length;

    // Use average mutual overlap percentage
    return Math.round(((ratioA + ratioB) / 2) * 100);
}

