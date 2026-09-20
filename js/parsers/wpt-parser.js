// task-planner/js/parsers/wpt-parser.js

/**
 * Parses CompeGPS (.wpt), GeoFormat ($FormatGEO), and OziExplorer (.wpt) files.
 * Preserves elevation, comments/descriptions, and styles.
 * 
 * @param {string} text 
 * @returns {Array<Object>} List of waypoints
 */
export function parseWpt(text) {
    const waypoints = [];
    const lines = text.split(/\r?\n/);
    let isGeoFormat = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        if (line.startsWith('$FormatGEO')) {
            isGeoFormat = true;
            continue;
        }

        if (line.startsWith('W ')) {
            // CompeGPS format: W NAME A LAT LON DATE TIME ALT [DESC]
            const parts = line.split(/\s+/);
            if (parts.length >= 5) {
                const name = parts[1];
                let lat = parseCompeGpsCoord(parts[3]);
                let lng = parseCompeGpsCoord(parts[4]);

                let elev = 0;
                let desc = name;
                if (parts.length >= 8) {
                    elev = parseFloat(parts[7].replace(/[^\d.-]/g, ''));
                    if (isNaN(elev)) elev = 0;
                }
                if (parts.length >= 9) {
                    desc = parts.slice(8).join(' ').trim();
                }

                if (!isNaN(lat) && !isNaN(lng)) {
                    const fullName = (desc && desc !== name) ? desc : name;
                    waypoints.push({
                        id: name,
                        code: name,
                        name: fullName,
                        lat: lat,
                        lng: lng,
                        elev: Math.round(elev),
                        desc: desc,
                        source: 'CompeGPS'
                    });
                }
            }
        } else if (isGeoFormat) {
            // e.g.: MANSFL N 47 49 03.66 W 119 38 36.30 693 MANSFL
            const parts = line.split(/\s+/);
            if (parts.length >= 10) {
                const id = parts[0];
                const latDir = parts[1].toUpperCase();
                const latDeg = parseInt(parts[2], 10);
                const latMin = parseInt(parts[3], 10);
                const latSec = parseFloat(parts[4]);

                const lonDir = parts[5].toUpperCase();
                const lonDeg = parseInt(parts[6], 10);
                const lonMin = parseInt(parts[7], 10);
                const lonSec = parseFloat(parts[8]);

                let elev = parseFloat(parts[9]);
                if (isNaN(elev)) elev = 0;

                let lat = latDeg + (latMin / 60) + (latSec / 3600);
                if (latDir === 'S') lat = -lat;

                let lng = lonDeg + (lonMin / 60) + (lonSec / 3600);
                if (lonDir === 'W') lng = -lng;

                const name = parts.length >= 11 ? parts.slice(10).join(' ') : id;

                if (!isNaN(lat) && !isNaN(lng)) {
                    waypoints.push({
                        id: id,
                        code: id,
                        name: name,
                        lat: lat,
                        lng: lng,
                        elev: Math.round(elev),
                        desc: name,
                        source: 'GEO'
                    });
                }
            }
        } else if (line.includes(',')) {
            // OziExplorer format:
            // Line: 1, Name, Lat, Lng, Date, 0, 1, 5, 0, 65535, Desc, 0, 0, 0, Elev
            const parts = line.split(',');
            if (parts.length >= 4) {
                const lat = parseFloat(parts[2].trim());
                const lng = parseFloat(parts[3].trim());
                if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
                    const id = parts[0].trim();
                    const name = parts[1].trim() || id;
                    let desc = parts.length >= 11 ? parts[10].trim() : name;
                    let elev = parts.length >= 15 ? parseFloat(parts[14].trim()) : 0;
                    if (isNaN(elev)) elev = 0;

                    waypoints.push({
                        id: id || name,
                        code: name,
                        name: name,
                        lat: lat,
                        lng: lng,
                        elev: Math.round(elev),
                        desc: desc,
                        source: 'OziExplorer'
                    });
                }
            }
        }
    }

    return waypoints;
}

function parseCompeGpsCoord(str) {
    if (!str) return NaN;
    const clean = str.replace(/[º°]/g, '').trim();
    const dir = clean.charAt(clean.length - 1).toUpperCase();
    const val = parseFloat(clean.substring(0, clean.length - 1));
    if (isNaN(val)) return NaN;
    if (dir === 'S' || dir === 'W') return -val;
    return val;
}
