// task-planner/js/parsers/cup-parser.js

/**
 * Parses SeeYou (.cup) waypoint files and optional embedded task blocks.
 * Preserves elevation, style, runway, and description metadata.
 * 
 * @param {string} text - Content of the .cup file
 * @returns {{ waypoints: Array<Object>, task: Object|null }}
 */
export function parseCup(text) {
    const waypoints = [];
    const waypointMap = new Map();
    const lines = text.split(/\r?\n/);
    
    let isTaskSection = false;
    const taskLines = [];

    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i].trim();
        if (!rawLine) continue;

        if (rawLine.startsWith('-----TASKS-----') || rawLine.startsWith('-----Task')) {
            isTaskSection = true;
            continue;
        }

        if (isTaskSection) {
            taskLines.push(rawLine);
            continue;
        }

        // Header line skip
        if (i === 0 && (rawLine.toLowerCase().includes('name') && rawLine.toLowerCase().includes('lat'))) {
            continue;
        }

        // Waypoint lines in SeeYou format:
        // "Name","Code",Country,Lat,Lon,Elev,Style,RwDir,RwLen,Freq,Desc...
        const row = parseCsvLine(rawLine);
        if (row.length < 5) continue;

        const name = (row[0] || '').replace(/^"|"$/g, '').trim();
        const code = (row[1] || '').replace(/^"|"$/g, '').trim() || name;
        const country = (row[2] || '').replace(/^"|"$/g, '').trim();
        const latStr = (row[3] || '').trim();
        const lonStr = (row[4] || '').trim();
        const elevStr = (row[5] || '').trim();
        const style = (row[6] || '').trim();
        const rwDir = (row[7] || '').trim();
        const rwLen = (row[8] || '').trim();
        const freq = (row[9] || '').trim();
        const desc = (row[10] || '').replace(/^"|"$/g, '').trim();

        const lat = parseCupCoord(latStr, true);
        const lng = parseCupCoord(lonStr, false);

        if (isNaN(lat) || isNaN(lng)) continue;

        let elev = 0;
        if (elevStr) {
            const num = parseFloat(elevStr.replace(/[^\d.-]/g, ''));
            if (!isNaN(num)) {
                if (elevStr.toLowerCase().includes('ft')) {
                    elev = Math.round(num * 0.3048);
                } else {
                    elev = Math.round(num);
                }
            }
        }

        const wp = {
            id: code || name || `WP_${waypoints.length + 1}`,
            code: code || name,
            name: name || code,
            country: country,
            lat: lat,
            lng: lng,
            elev: elev,
            style: style,
            rwDir: rwDir,
            rwLen: rwLen,
            freq: freq,
            desc: desc,
            source: 'CUP'
        };

        waypoints.push(wp);
        waypointMap.set(wp.code.toUpperCase(), wp);
        waypointMap.set(wp.name.toUpperCase(), wp);
    }

    let parsedTask = null;
    if (taskLines.length > 0) {
        parsedTask = parseCupTaskBlock(taskLines, waypointMap);
    }

    return { waypoints, task: parsedTask };
}

/**
 * Parses SeeYou coordinate strings:
 * Lat: DDMM.mmmN/S or DDMM.mmN/S or +/-DD.dddd
 * Lon: DDDMM.mmmE/W or DDDMM.mmE/W or +/-DDD.dddd
 */
function parseCupCoord(str, isLat) {
    if (!str) return NaN;
    str = str.replace(/"/g, '').trim();
    if (!str) return NaN;

    // Check decimal format fallback: e.g. 44.1234 or -119.5
    if (/^[+-]?\d+(\.\d+)?$/.test(str)) {
        return parseFloat(str);
    }

    const dir = str.charAt(str.length - 1).toUpperCase();
    if (dir !== 'N' && dir !== 'S' && dir !== 'E' && dir !== 'W') {
        return NaN;
    }

    const valStr = str.substring(0, str.length - 1);
    const degLen = isLat ? 2 : 3;
    if (valStr.length < degLen) return NaN;

    const deg = parseInt(valStr.substring(0, degLen), 10);
    const min = parseFloat(valStr.substring(degLen));
    if (isNaN(deg) || isNaN(min)) return NaN;

    let dec = deg + (min / 60);
    if (dir === 'S' || dir === 'W') {
        dec = -dec;
    }
    return dec;
}

/**
 * CSV splitter that handles quoted commas.
 */
function parseCsvLine(line) {
    const res = [];
    let curr = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            inQuotes = !inQuotes;
            curr += c;
        } else if (c === ',' && !inQuotes) {
            res.push(curr.trim());
            curr = '';
        } else {
            curr += c;
        }
    }
    res.push(curr.trim());
    return res;
}

/**
 * Optional parser for SeeYou task block
 */
function parseCupTaskBlock(taskLines, waypointMap) {
    // Usually: "TaskName","TAKEOFF","TP1","TP2",..."GOAL"
    for (const line of taskLines) {
        const row = parseCsvLine(line);
        if (row.length >= 2) {
            const taskName = row[0].replace(/"/g, '').trim();
            const turnpoints = [];
            for (let i = 1; i < row.length; i++) {
                const wpKey = row[i].replace(/"/g, '').trim().toUpperCase();
                if (!wpKey) continue;
                const wp = waypointMap.get(wpKey);
                if (wp) {
                    turnpoints.push({
                        waypoint: wp,
                        radius: i === 1 ? 1000 : 400,
                        type: i === 1 ? 'takeoff' : (i === 2 ? 'sss' : (i === row.length - 1 ? 'goal' : 'turnpoint')),
                        direction: (i === 2) ? 'exit' : 'enter',
                        locked: false
                    });
                }
            }
            if (turnpoints.length >= 2) {
                return { name: taskName, turnpoints };
            }
        }
    }
    return null;
}
