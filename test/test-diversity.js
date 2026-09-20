import { parseCup } from '../js/parsers/cup-parser.js';
import { solveRandomizedTask } from '../js/optimizer/randomizer-solver.js';

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
let currentTask = [
    { waypoint: waypoints[0], radius: 1000, locked: true, type: "takeoff" },
    { waypoint: waypoints[2], radius: 2000, locked: false },
    { waypoint: waypoints[4], radius: 3000, locked: false },
    { waypoint: waypoints[1], radius: 400, locked: true, type: "goal" }
];

console.log("Testing 6 consecutive randomizations with recentSignatures tracking...");
const seenFingerprints = new Set();
const seenSignatures = new Set();

for (let r = 0; r < 6; r++) {
    const res = solveRandomizedTask({
        waypoints,
        currentTurnpoints: currentTask,
        targetDistanceKm: 65.0,
        numTurnpoints: 4,
        recentSignatures: seenSignatures,
        maxAttempts: 600
    });

    const fp = res.turnpoints.map(t => `${t.waypoint.name}(${t.radius})`).join(" -> ");
    console.log(`Run ${r + 1}: ${fp} [Dist: ${res.optimized.totalDistanceKm.toFixed(1)} km]`);
    seenFingerprints.add(fp);
    if (res.signature) seenSignatures.add(res.signature);
    currentTask = res.turnpoints; // simulate user state updating
}

console.log(`Unique multi-turnpoint tasks out of 6 runs: ${seenFingerprints.size}`);

console.log("\nTesting 4 consecutive single-turnpoint randomizations on TP 2 (index 1)...");
const singleSeenFingerprints = new Set();
const singleSeenSignatures = new Set();
let singleTask = [
    { waypoint: waypoints[0], radius: 1000, locked: true, type: "takeoff" },
    { waypoint: waypoints[2], radius: 2000, locked: false },
    { waypoint: waypoints[10], radius: 400, locked: true },
    { waypoint: waypoints[1], radius: 400, locked: true, type: "goal" }
];

for (let r = 0; r < 4; r++) {
    const res = solveRandomizedTask({
        waypoints,
        currentTurnpoints: singleTask,
        targetDistanceKm: 65.0,
        numTurnpoints: 4,
        targetIndex: 1,
        recentSignatures: singleSeenSignatures,
        maxAttempts: 600
    });

    if (res.success && res.turnpoints) {
        const fp = `${res.turnpoints[1].waypoint.name}(${res.turnpoints[1].radius})`;
        console.log(`Single Run ${r + 1}: TP 2 -> ${fp} [Dist: ${res.optimized.totalDistanceKm.toFixed(1)} km]`);
        singleSeenFingerprints.add(fp);
        if (res.signature) singleSeenSignatures.add(res.signature);
        singleTask = res.turnpoints;
    } else {
        console.log(`Single Run ${r + 1}: No solution`);
    }
}
console.log(`Unique single-turnpoint options out of 4 runs: ${singleSeenFingerprints.size}`);


