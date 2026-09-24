// task-planner/js/qr/xctrack-qr.js

/**
 * Google's Polyline Algorithm variable-length integer encoder.
 * Used by XCTrack Format 2 for compact coordinate and radius representation.
 */
export function encodePolylineNumber(num) {
    let v = num < 0 ? ~(num << 1) : (num << 1);
    let str = "";
    while (v >= 0x20) {
        str += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
        v >>= 5;
    }
    str += String.fromCharCode(v + 63);
    return str;
}

/**
 * Google's Polyline Algorithm integer decoder.
 */
export function decodePolylineNextNumber(str, offset) {
    let result = 0, shift = 0, b;
    let idx = offset;
    do {
        b = str.charCodeAt(idx++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
    } while (b >= 0x20);
    const dval = ((result & 1) ? ~(result >> 1) : (result >> 1));
    return { value: dval, nextOffset: idx };
}

/**
 * Compresses 4 turnpoint parameters (lon, lat, alt, radius) into a single polyline string (z).
 * lon and lat scaled by 1e5; alt and radius in whole meters.
 */
export function encodeTurnpointCoords(lon, lat, alt, radius) {
    return encodePolylineNumber(Math.round(lon * 1e5)) +
           encodePolylineNumber(Math.round(lat * 1e5)) +
           encodePolylineNumber(Math.round(alt || 0)) +
           encodePolylineNumber(Math.round(radius || 400));
}

/**
 * Decodes a polyline string (z) back to { lon, lat, alt, radius }.
 */
export function decodeTurnpointCoords(z) {
    let offset = 0;
    const r1 = decodePolylineNextNumber(z, offset);
    const lon = r1.value / 1e5;
    const r2 = decodePolylineNextNumber(z, r1.nextOffset);
    const lat = r2.value / 1e5;
    const r3 = decodePolylineNextNumber(z, r2.nextOffset);
    const alt = r3.value;
    const r4 = decodePolylineNextNumber(z, r3.nextOffset);
    const radius = r4.value;
    return { lon, lat, alt, radius };
}

/**
 * Generates the official XCTrack Format 2 QR code payload prefixed with 'XCTSK:'.
 * Format 2 produces a compact JSON payload (~150-250 characters) resulting in
 * a low-density, coarse QR code with large pixel modules that scan instantly in sunlight.
 * 
 * @param {Array<Object>} turnpoints - Task turnpoints
 * @param {Object} [taskMeta] - Optional metadata (startTime)
 * @returns {string} e.g. "XCTSK:{\"taskType\":\"CLASSIC\",\"version\":2,...}"
 */
export function taskToXcTrackQrString(turnpoints, taskMeta = {}) {
    if (!turnpoints || turnpoints.length === 0) {
        return "XCTSK:" + JSON.stringify({ taskType: "CLASSIC", version: 2, t: [] });
    }

    const t = turnpoints.map((tp, idx) => {
        const wp = tp.waypoint;
        const z = encodeTurnpointCoords(wp.lng, wp.lat, wp.elev, tp.radius);
        const code = wp.code || wp.name || `TP${idx + 1}`;
        const item = {
            z,
            n: code
        };
        const desc = (wp.name && wp.name !== code) ? wp.name : (wp.desc || '');
        if (desc) {
            item.d = desc;
        }

        const tpType = (tp.type || '').toLowerCase();
        if (tpType === 'sss') {
            item.t = 2; // SSS
        } else if (tpType === 'ess') {
            item.t = 3; // ESS
        }
        return item;
    });

    const sssTp = turnpoints.find(tp => tp.type === 'sss') || turnpoints[1] || turnpoints[0];
    const isSssExit = (sssTp && (sssTp.direction || 'exit').toLowerCase() === 'exit');
    const goalTp = turnpoints[turnpoints.length - 1];
    const isGoalLine = goalTp && goalTp.goalType === 'line';

    const obj = {
        taskType: "CLASSIC",
        version: 2,
        t: t,
        s: {
            g: [taskMeta.startTime || "12:00:00Z"],
            d: isSssExit ? 2 : 1, // 1 = ENTRY, 2 = EXIT
            t: 1 // 1 = RACE
        },
        g: {
            t: isGoalLine ? 1 : 2 // 1 = LINE, 2 = CYLINDER
        }
    };

    return "XCTSK:" + JSON.stringify(obj);
}

/**
 * Encodes a task into official XCTrack Format 1 JSON for storing as a .xctsk file.
 * Conforms strictly to XCTrack Competition Interfaces specifications.
 * 
 * @param {Array<Object>} turnpoints - Task turnpoints
 * @param {Object} [taskMeta] - Optional metadata (startTime, windowOpen, windowClose)
 * @returns {string} Standard XCTrack JSON string
 */
export function taskToXcTrackJson(turnpoints, taskMeta = {}) {
    if (!turnpoints || turnpoints.length === 0) {
        return JSON.stringify({ taskType: "CLASSIC", version: 1, turnpoints: [] }, null, 2);
    }

    const hasExplicitSss = turnpoints.some(tp => (tp.type || '').toLowerCase() === 'sss');
    const hasExplicitEss = turnpoints.some(tp => (tp.type || '').toLowerCase() === 'ess');
    const sssTargetIdx = hasExplicitSss 
        ? turnpoints.findIndex(tp => (tp.type || '').toLowerCase() === 'sss') 
        : Math.min(1, turnpoints.length - 1);
    const essTargetIdx = hasExplicitEss 
        ? turnpoints.findIndex(tp => (tp.type || '').toLowerCase() === 'ess') 
        : (turnpoints.length - 1);

    const sssTp = turnpoints[sssTargetIdx] || turnpoints[0];
    const sssDirection = (sssTp && (sssTp.direction || 'exit').toLowerCase() === 'exit') ? 'EXIT' : 'ENTER';
    const goalTp = turnpoints[turnpoints.length - 1];
    const isGoalLine = goalTp && goalTp.goalType === 'line';

    const xcTurnpoints = turnpoints.map((tp, idx) => {
        const wp = tp.waypoint;
        const code = wp.code || wp.name || `TP${idx + 1}`;
        const desc = (wp.name && wp.name !== code) ? wp.name : (wp.desc || wp.name || "");

        const item = {
            radius: Math.round(tp.radius || 400),
            waypoint: {
                name: code,
                lat: parseFloat(wp.lat.toFixed(6)),
                lon: parseFloat(wp.lng.toFixed(6)),
                altSmoothed: Math.round(wp.elev || 0),
                description: desc
            }
        };

        const tpType = (tp.type || '').toLowerCase();
        if (tpType === 'takeoff' && idx === 0) {
            item.type = "TAKEOFF";
        } else if (idx === sssTargetIdx) {
            item.type = "SSS";
        } else if (idx === essTargetIdx) {
            item.type = "ESS";
        }
        // Normal intermediate turnpoints and non-ESS goal omit the type field per XCTrack specification

        return item;
    });

    const xcTask = {
        taskType: "CLASSIC",
        version: 1,
        earthModel: "WGS84",
        turnpoints: xcTurnpoints,
        sss: {
            type: "RACE",
            direction: sssDirection,
            timeGates: [taskMeta.startTime || "12:00:00Z"]
        },
        goal: {
            type: isGoalLine ? "LINE" : "CYLINDER"
        }
    };

    if (taskMeta.windowOpen || taskMeta.windowClose) {
        xcTask.takeoff = {
            timeOpen: taskMeta.windowOpen || "10:00:00Z",
            timeClose: taskMeta.windowClose || "18:00:00Z"
        };
    }

    return JSON.stringify(xcTask, null, 2);
}

/**
 * Decodes an XCTrack QR or JSON string back into the task planner internal format.
 * Supports:
 * - XCTSK: Format 2 QR payloads (compact polyline encoded)
 * - XCTSK: Format 1 QR payloads
 * - Plain Format 1 JSON files (.xctsk)
 * 
 * @param {string} rawStr 
 * @returns {{ turnpoints: Array<Object>, taskMeta: Object }}
 */
export function xcTrackJsonToTask(rawStr) {
    let cleanStr = (rawStr || '').trim();
    if (cleanStr.startsWith("XCTSK:")) {
        cleanStr = cleanStr.substring(6).trim();
    } else if (cleanStr.startsWith("XCTSKZ:")) {
        cleanStr = cleanStr.substring(7).trim();
    }

    const data = JSON.parse(cleanStr);

    // Format 2: compact QR format
    if (data.version === 2 && Array.isArray(data.t)) {
        const sssDirection = (data.s && data.s.d === 1) ? 'enter' : 'exit';
        const isGoalLine = (data.g && data.g.t === 1);

        const turnpoints = data.t.map((item, idx) => {
            const coords = decodeTurnpointCoords(item.z);
            let type = 'turnpoint';
            if (idx === 0) type = 'takeoff';
            if (item.t === 2) type = 'sss';
            if (item.t === 3) type = 'ess';
            if (idx === data.t.length - 1) type = 'goal';

            return {
                id: `TP_${idx + 1}_${item.n || idx}`,
                waypoint: {
                    id: item.n || `WP_${idx + 1}`,
                    name: item.n || `WP_${idx + 1}`,
                    code: item.n || `WP_${idx + 1}`,
                    lat: coords.lat,
                    lng: coords.lon,
                    elev: coords.alt,
                    desc: item.d || ""
                },
                radius: coords.radius,
                type: type,
                direction: type === 'sss' ? sssDirection : 'enter',
                goalType: isGoalLine ? 'line' : 'cylinder',
                locked: false
            };
        });

        return {
            turnpoints,
            taskMeta: {
                startTime: (data.s && data.s.g && data.s.g[0]) ? data.s.g[0] : "",
                windowOpen: "",
                windowClose: ""
            }
        };
    }

    // Format 1: full JSON format
    if (data.turnpoints && Array.isArray(data.turnpoints)) {
        const sssDirection = (data.sss && data.sss.direction) ? data.sss.direction.toLowerCase() : 'exit';
        const isGoalLine = (data.goal && data.goal.type === 'LINE');

        const turnpoints = data.turnpoints.map((tp, idx) => {
            const rawWp = tp.waypoint || {};
            const lat = rawWp.lat !== undefined ? rawWp.lat : 0;
            const lng = rawWp.lon !== undefined ? rawWp.lon : (rawWp.lng || 0);

            let type = 'turnpoint';
            const rawType = (tp.type || '').toUpperCase();
            if (rawType === 'TAKEOFF' || idx === 0) type = 'takeoff';
            else if (rawType === 'START' || rawType === 'SSS') type = 'sss';
            else if (rawType === 'ESS') type = 'ess';
            if (idx === data.turnpoints.length - 1) type = 'goal';

            return {
                id: `TP_${idx + 1}_${rawWp.name || idx}`,
                waypoint: {
                    id: rawWp.name || `WP_${idx + 1}`,
                    name: rawWp.name || `WP_${idx + 1}`,
                    code: rawWp.name || `WP_${idx + 1}`,
                    lat: lat,
                    lng: lng,
                    elev: rawWp.altSmoothed !== undefined ? rawWp.altSmoothed : (rawWp.alt || 0),
                    desc: rawWp.description || ""
                },
                radius: tp.radius || 400,
                type: type,
                direction: type === 'sss' ? sssDirection : 'enter',
                goalType: isGoalLine ? 'line' : 'cylinder',
                locked: false
            };
        });

        return {
            turnpoints,
            taskMeta: {
                startTime: (data.sss && data.sss.timeGates && data.sss.timeGates[0]) ? data.sss.timeGates[0] : "",
                windowOpen: data.takeoff ? (data.takeoff.timeOpen || "") : "",
                windowClose: data.takeoff ? (data.takeoff.timeClose || "") : ""
            }
        };
    }

    throw new Error("Invalid XCTrack task format: missing turnpoints");
}


/**
 * Exports task in SeeYou (.cup) format containing the waypoints and task header.
 */
export function taskToCupString(turnpoints, taskName = "PG Task") {
    let out = 'name,code,country,lat,lon,elev,style,rwdir,rwlen,rwwidth,freq,desc\n';
    
    // Waypoints
    const seen = new Set();
    turnpoints.forEach(tp => {
        const wp = tp.waypoint;
        if (!seen.has(wp.id)) {
            seen.add(wp.id);
            // Format coordinates to DDMM.mmmN/S
            const latStr = toCupCoord(wp.lat, true);
            const lonStr = toCupCoord(wp.lng, false);
            out += `"${wp.name}","${wp.code || wp.name || wp.id}","",${latStr},${lonStr},${wp.elev || 0}m,1,,,,,"${wp.desc || ''}"\n`;
        }
    });

    out += '-----TASKS-----\n';
    const wpCodes = turnpoints.map(tp => `"${tp.waypoint.code || tp.waypoint.name}"`).join(',');
    out += `"${taskName}",${wpCodes}\n`;

    return out;
}

function toCupCoord(decDeg, isLat) {
    const isNeg = decDeg < 0;
    const absDeg = Math.abs(decDeg);
    const deg = Math.floor(absDeg);
    const min = (absDeg - deg) * 60;
    const minStr = min.toFixed(3).padStart(6, '0');

    if (isLat) {
        const degStr = deg.toString().padStart(2, '0');
        const dir = isNeg ? 'S' : 'N';
        return `${degStr}${minStr}${dir}`;
    } else {
        const degStr = deg.toString().padStart(3, '0');
        const dir = isNeg ? 'W' : 'E';
        return `${degStr}${minStr}${dir}`;
    }
}

/**
 * Shares task using Android Web Share API (WhatsApp, Telegram, etc.)
 * with fallback to file download.
 */
export async function shareTask({ turnpoints, optimizedDistKm, filename = "task.xctsk" }) {
    const jsonStr = taskToXcTrackJson(turnpoints);
    const title = `Paragliding Task (${optimizedDistKm.toFixed(1)} km)`;
    const text = `Paragliding Task: ${turnpoints.length} turnpoints, ${optimizedDistKm.toFixed(1)} km optimized distance.`;

    if (navigator.canShare && navigator.share) {
        try {
            const file = new File([jsonStr], filename, { type: "application/json" });
            if (navigator.canShare({ files: [file] })) {
                await navigator.share({
                    files: [file],
                    title: title,
                    text: text
                });
                return { shared: true };
            } else {
                await navigator.share({
                    title: title,
                    text: `${text}\n\nTask JSON:\n${jsonStr}`
                });
                return { shared: true };
            }
        } catch (e) {
            if (e.name !== 'AbortError') {
                console.error("Share error:", e);
            }
        }
    }

    // Fallback: download file
    downloadFile(jsonStr, filename, "application/json");
    return { downloaded: true };
}

export function downloadFile(content, filename, mimeType = "text/plain") {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

/**
 * Uploads task directly to XContest Cloud (https://tools.xcontest.org/api/xctsk/save).
 * Returns { taskCode, taskHash } where taskCode is a 4-letter alphanumeric string.
 * 
 * @param {Array<Object>} turnpoints - Task turnpoints
 * @param {Object} [taskMeta] - Optional metadata (startTime, windowOpen, windowClose)
 * @param {string} [author] - Optional author identifier (ASCII only)
 * @returns {Promise<{ taskCode: string, taskHash: string }>}
 */
export async function uploadTaskToXContest(turnpoints, taskMeta = {}, author = 'PG Task Planner') {
    if (!turnpoints || turnpoints.length === 0) {
        throw new Error("Cannot upload empty task");
    }

    const jsonStr = taskToXcTrackJson(turnpoints, taskMeta);
    const cleanAuthor = String(author || 'PG Task Planner').replace(/[^\x20-\x7E]/g, '');

    const headers = {
        'Content-Type': 'application/json',
        'Author': cleanAuthor
    };

    let response;
    try {
        // Try direct call to XContest (CORS enabled on tools.xcontest.org)
        response = await fetch('https://tools.xcontest.org/api/xctsk/save', {
            method: 'POST',
            headers: headers,
            body: jsonStr
        });
    } catch (directErr) {
        // If direct call fails (e.g. localhost environment), try local proxy
        try {
            response = await fetch('/api/xctsk/save', {
                method: 'POST',
                headers: headers,
                body: jsonStr
            });
        } catch (proxyErr) {
            throw new Error(`Connection to XContest failed: ${directErr.message || directErr}`);
        }
    }

    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`XContest returned error ${response.status}: ${errText || response.statusText}`);
    }

    const data = await response.json();
    if (!data.taskCode) {
        throw new Error("XContest response did not include a taskCode");
    }

    return data;
}
