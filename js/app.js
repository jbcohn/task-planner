// task-planner/js/app.js
import { parseCup } from './parsers/cup-parser.js';
import { parseWpt } from './parsers/wpt-parser.js';
import { vincentyDistance } from './geo-math.js';
import { optimizeTaskRoute } from './optimizer/task-optimizer.js';
import { solveRandomizedTask } from './optimizer/randomizer-solver.js';
import { findCandidateWaypointsForCutPoint } from './optimizer/reverse-cycle.js';
import { translateFreehandStrokeToTask } from './drawing/freehand-tracer.js';
import { taskToXcTrackJson, taskToXcTrackQrString, xcTrackJsonToTask, taskToCupString, shareTask, downloadFile, uploadTaskToXContest } from './qr/xctrack-qr.js';
import { downloadAreaTiles, getOfflineTileCount, clearOfflineTiles } from './offline/tile-cache.js';
import { MapController } from './ui/map-controller.js';
import { TaskSheet } from './ui/task-sheet.js';

class App {
    constructor() {
        this.state = {
            waypoints: [],
            turnpoints: [],
            optimized: null,
            targetDistanceKm: 65.0,
            distanceToleranceKm: 0.5,
            maxOverlapPercent: 80,
            numTurnpoints: 5
        };

        this.mapController = null;
        this.taskSheet = null;
        this.qrCodeInstance = null;
        this.html5QrScanner = null;
        this.toastTimeout = null;

        // History of generated unique tasks
        this.taskHistory = [];
        this.historyIndex = -1;
        this.generatedSignatures = new Set();
    }

    init() {
        // Register Service Worker for offline PWA
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js').then((reg) => {
                reg.update().catch(() => {});
            }).catch(err => {
                console.warn('ServiceWorker registration error:', err);
            });

            navigator.serviceWorker.addEventListener('controllerchange', () => {
                window.location.reload();
            });
        }

        // Initialize Map Controller
        this.mapController = new MapController({
            mapElementId: 'map',
            drawCanvasId: 'draw-canvas',
            onAddWaypointToTask: (wp) => this.addWaypointToTask(wp),
            onRemoveWaypointFromTask: (wp) => this.removeWaypointFromTask(wp),
            onSetLaunchWaypoint: (wp) => this.setLaunchWaypoint(wp),
            onSetGoalWaypoint: (wp) => this.setGoalWaypoint(wp),
            onCutPointSelected: (idx, cutPoint) => this.handleCutPointSelected(idx, cutPoint),
            onFreehandStrokeComplete: (stroke) => this.handleFreehandComplete(stroke),
            onToggleTurnpointSelection: (idx) => this.toggleTurnpointSelection(idx),
            onRemoveTurnpoint: (idx) => this.removeTurnpoint(idx),
            onFocusTurnpoint: (idx) => this.taskSheet.setFocusedTurnpoint(idx)
        });
        this.mapController.init();

        // Initialize Task Sheet
        this.taskSheet = new TaskSheet({
            containerId: 'turnpoints-container',
            onUpdateTurnpoint: (idx, tp) => this.updateTurnpoint(idx, tp),
            onRemoveTurnpoint: (idx) => this.removeTurnpoint(idx),
            onReorderTurnpoints: (fromIdx, toIdx) => this.reorderTurnpoints(fromIdx, toIdx),
            onRandomizeSingleTurnpoint: (idx) => this.runRandomizerSolver(idx),
            onApplyCandidateTurnpoint: (idx, wp, radius) => this.applyCandidateTurnpoint(idx, wp, radius),
            onSetTurnpoints: (turnpoints, selectedIndices) => this.setAllTurnpoints(turnpoints, selectedIndices),
            onSelectionChange: (selectedIndices) => this.handleSelectionChange(selectedIndices),
            onOpenCutPointAlternatives: (idx) => this.openCutPointAlternativesForTurnpoint(idx),
            onCloseCutPointAlternatives: () => this.mapController.clearActiveCutPoint(),
            onFocusTurnpoint: (idx) => this.handleFocusTurnpoint(idx),
            onExitFocus: () => this.handleExitFocus()
        });

        this.setupSearchableDropdowns();
        this.bindEvents();
        this.loadSampleWaypoints();
    }

    showToast(message, type = 'normal', duration = 3000) {
        const toast = document.getElementById('toast-notification');
        if (!toast) return;

        if (this.toastTimeout) {
            clearTimeout(this.toastTimeout);
        }

        toast.textContent = message;
        toast.className = `show ${type}`;

        this.toastTimeout = setTimeout(() => {
            toast.className = '';
        }, duration);
    }

    recordTaskHistory(turnpoints, optimized) {
        if (!turnpoints || turnpoints.length < 2) return;

        const signature = turnpoints
            .map(t => (t && t.waypoint ? `${t.waypoint.id}:${t.radius}` : ''))
            .join('|');

        this.generatedSignatures.add(signature);

        // Append to history
        const snapshot = {
            turnpoints: JSON.parse(JSON.stringify(turnpoints)),
            optimized: optimized ? JSON.parse(JSON.stringify(optimized)) : null,
            signature: signature
        };

        this.taskHistory.push(snapshot);
        this.historyIndex = this.taskHistory.length - 1;
        this.updateHistoryUI();
    }

    navigateHistory(direction) {
        const targetIdx = this.historyIndex + direction;
        if (targetIdx < 0 || targetIdx >= this.taskHistory.length) return;

        this.historyIndex = targetIdx;
        const entry = this.taskHistory[this.historyIndex];

        this.state.turnpoints = JSON.parse(JSON.stringify(entry.turnpoints));
        this.state.optimized = entry.optimized || optimizeTaskRoute(this.state.turnpoints);

        this.updateTaskDistances(true, false); // don't push new history entry
        this.mapController.fitTask(this.state.turnpoints);
        this.updateHistoryUI();

        this.showToast(`Viewing Option ${this.historyIndex + 1} of ${this.taskHistory.length}`);
    }

    updateHistoryUI() {
        const total = this.taskHistory.length;
        const current = this.historyIndex >= 0 ? this.historyIndex + 1 : 1;
        const text = total > 0 ? `${current}/${total}` : `1/1`;

        const topCounter = document.getElementById('history-counter');
        const sheetCounter = document.getElementById('sheet-history-counter');
        if (topCounter) topCounter.textContent = text;
        if (sheetCounter) sheetCounter.textContent = text;

        const topPrev = document.getElementById('btn-history-prev');
        const topNext = document.getElementById('btn-history-next');
        const sheetPrev = document.getElementById('btn-sheet-prev');
        const sheetNext = document.getElementById('btn-sheet-next');

        const canGoBack = this.historyIndex > 0;
        const canGoForward = this.historyIndex < total - 1;

        if (topPrev) topPrev.disabled = !canGoBack;
        if (sheetPrev) sheetPrev.disabled = !canGoBack;
        if (topNext) topNext.disabled = !canGoForward;
        if (sheetNext) sheetNext.disabled = !canGoForward;
    }

    bindEvents() {
        // History Navigation Buttons
        const topPrev = document.getElementById('btn-history-prev');
        const topNext = document.getElementById('btn-history-next');
        const sheetPrev = document.getElementById('btn-sheet-prev');
        const sheetNext = document.getElementById('btn-sheet-next');

        if (topPrev) topPrev.addEventListener('click', () => this.navigateHistory(-1));
        if (sheetPrev) sheetPrev.addEventListener('click', () => this.navigateHistory(-1));
        if (topNext) topNext.addEventListener('click', () => this.navigateHistory(1));
        if (sheetNext) sheetNext.addEventListener('click', () => this.navigateHistory(1));

        // File Upload
        const fileInput = document.getElementById('waypoint-file-input');
        const btnUpload = document.getElementById('btn-upload-waypoints');
        if (btnUpload && fileInput) {
            btnUpload.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', (e) => this.handleFileUpload(e));
        }

        // Freehand Draw Button
        const btnDraw = document.getElementById('btn-draw-task');
        const drawBanner = document.getElementById('drawing-banner');
        const btnCancelDraw = document.getElementById('btn-cancel-draw');
        if (btnDraw) {
            btnDraw.addEventListener('click', () => {
                const isActive = !this.mapController.isDrawingMode;
                this.mapController.setDrawingMode(isActive);
                btnDraw.classList.toggle('active', isActive);
                if (drawBanner) drawBanner.style.display = isActive ? 'flex' : 'none';
            });
        }
        if (btnCancelDraw) {
            btnCancelDraw.addEventListener('click', () => {
                this.mapController.setDrawingMode(false);
                if (btnDraw) btnDraw.classList.remove('active');
                if (drawBanner) drawBanner.style.display = 'none';
            });
        }

        // Target Distance Input in bottom sheet
        const targetInput = document.getElementById('input-target-dist');
        if (targetInput) {
            targetInput.value = this.state.targetDistanceKm;
            targetInput.addEventListener('change', (e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val) && val > 0) {
                    this.state.targetDistanceKm = val;
                    this.updateTaskDistances(true, true);
                }
            });
        }

        // 1-Click Randomize Buttons (Direct execution without dialog)
        const btnRandomize = document.getElementById('btn-randomize');
        const btnSheetRandomize = document.getElementById('btn-sheet-randomize');
        const handleDirectRandomize = () => {
            this.runRandomizerSolver();
        };
        if (btnRandomize) btnRandomize.addEventListener('click', handleDirectRandomize);
        if (btnSheetRandomize) btnSheetRandomize.addEventListener('click', handleDirectRandomize);

        // Cycle Waypoint Labels (Codes -> Codes+Names -> Off -> Codes)
        const btnToggleLabels = document.getElementById('btn-toggle-labels');
        const updateLabelButtonUI = (mode) => {
            if (!btnToggleLabels) return;
            if (mode === 'none') {
                btnToggleLabels.classList.remove('active');
                btnToggleLabels.title = 'Waypoint Labels: Hidden (Click to show Codes)';
            } else if (mode === 'all') {
                btnToggleLabels.classList.add('active');
                btnToggleLabels.title = 'Waypoint Labels: Codes + Names (Click to hide)';
            } else {
                // codes
                btnToggleLabels.classList.add('active');
                btnToggleLabels.title = 'Waypoint Labels: Codes Only (Click to show Names)';
            }
        };

        if (btnToggleLabels) {
            updateLabelButtonUI(this.mapController.getWaypointLabelMode ? this.mapController.getWaypointLabelMode() : 'codes');
            btnToggleLabels.addEventListener('click', () => {
                const mode = this.mapController.cycleWaypointLabelMode();
                updateLabelButtonUI(mode);
                if (mode === 'none') {
                    this.showToast("🏷️ Waypoint labels: Off");
                } else if (mode === 'all') {
                    this.showToast("🏷️ Waypoint labels: Codes + Names");
                } else {
                    this.showToast("🏷️ Waypoint labels: Codes Only");
                }
            });
        }

        // Separate Randomization Settings Modal
        const btnOpenSettings = document.getElementById('btn-open-randomize-settings');
        const btnSheetSettings = document.getElementById('btn-sheet-settings');
        const modalSettings = document.getElementById('modal-randomize-settings');
        const btnCloseSettings = document.getElementById('btn-close-randomize-settings');
        const btnSaveSettings = document.getElementById('btn-save-randomize-settings');
        const settingsDistInput = document.getElementById('solver-target-distance');
        const settingsTolInput = document.getElementById('solver-distance-tolerance');
        const settingsCountInput = document.getElementById('solver-tp-count');
        const settingsOverlapSlider = document.getElementById('solver-overlap-percent');
        const settingsLaunchSelect = document.getElementById('solver-launch-select');
        const settingsGoalSelect = document.getElementById('solver-goal-select');
        const settingsLockLaunch = document.getElementById('solver-lock-launch');
        const settingsLockGoal = document.getElementById('solver-lock-goal');
        const labelOverlapVal = document.getElementById('label-overlap-val');
        const summaryTolVal = document.getElementById('summary-tolerance-val');
        const summaryOverlapVal = document.getElementById('summary-overlap-val');
        const settingLineColorInput = document.getElementById('setting-route-line-color');

        const openSettingsModal = () => {
            if (modalSettings) {
                modalSettings.style.display = 'flex';
                if (settingsDistInput) settingsDistInput.value = this.state.targetDistanceKm;
                if (settingsTolInput) settingsTolInput.value = this.state.distanceToleranceKm || 0.5;
                if (settingsCountInput) settingsCountInput.value = Math.max(2, this.state.numTurnpoints || this.state.turnpoints.length || 5);
                if (settingsOverlapSlider) settingsOverlapSlider.value = this.state.maxOverlapPercent !== undefined ? this.state.maxOverlapPercent : 80;
                if (labelOverlapVal) labelOverlapVal.textContent = `${this.state.maxOverlapPercent || 80}%`;
                if (summaryTolVal) summaryTolVal.textContent = this.state.distanceToleranceKm || 0.5;
                if (summaryOverlapVal) summaryOverlapVal.textContent = this.state.maxOverlapPercent || 80;

                const curColor = this.mapController.getRouteColor ? this.mapController.getRouteColor() : '#0f172a';
                if (settingLineColorInput) settingLineColorInput.value = curColor;
                document.querySelectorAll('#route-color-swatches .color-swatch-btn').forEach(btn => {
                    btn.classList.toggle('active', (btn.dataset.color || '').toLowerCase() === curColor.toLowerCase());
                });

                const curLaunch = this.state.turnpoints.find(t => t.type === 'takeoff') || this.state.turnpoints[0];
                const curGoal = this.state.turnpoints.length > 1
                    ? (this.state.turnpoints.slice().reverse().find(t => t.type === 'goal') || this.state.turnpoints[this.state.turnpoints.length - 1])
                    : null;

                if (settingsLockLaunch) settingsLockLaunch.checked = curLaunch ? (curLaunch.locked !== false) : true;
                if (settingsLockGoal) settingsLockGoal.checked = curGoal ? (curGoal.locked !== false) : true;

                if (this._refreshLaunchDropdown) this._refreshLaunchDropdown();
                if (this._refreshGoalDropdown) this._refreshGoalDropdown();
            }
        };

        if (settingLineColorInput) {
            settingLineColorInput.addEventListener('input', (e) => {
                const color = e.target.value;
                document.querySelectorAll('#route-color-swatches .color-swatch-btn').forEach(btn => {
                    btn.classList.toggle('active', (btn.dataset.color || '').toLowerCase() === color.toLowerCase());
                });
            });
        }

        document.querySelectorAll('#route-color-swatches .color-swatch-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const color = btn.dataset.color;
                if (settingLineColorInput) settingLineColorInput.value = color;
                document.querySelectorAll('#route-color-swatches .color-swatch-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        if (settingsOverlapSlider) {
            settingsOverlapSlider.addEventListener('input', (e) => {
                const val = e.target.value;
                if (labelOverlapVal) labelOverlapVal.textContent = `${val}%`;
                if (summaryOverlapVal) summaryOverlapVal.textContent = val;
            });
        }

        if (settingsTolInput) {
            settingsTolInput.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val) && summaryTolVal) summaryTolVal.textContent = val.toFixed(1);
            });
        }

        if (btnOpenSettings) btnOpenSettings.addEventListener('click', openSettingsModal);
        if (btnSheetSettings) btnSheetSettings.addEventListener('click', openSettingsModal);

        if (btnCloseSettings && modalSettings) {
            btnCloseSettings.addEventListener('click', () => {
                modalSettings.style.display = 'none';
            });
        }

        if (btnSaveSettings && modalSettings) {
            btnSaveSettings.addEventListener('click', () => {
                const newDist = parseFloat(settingsDistInput.value);
                const newTol = parseFloat(settingsTolInput.value);
                const newCount = parseInt(settingsCountInput.value, 10);
                const newOverlap = parseInt(settingsOverlapSlider.value, 10);

                if (!isNaN(newDist) && newDist > 0) {
                    this.state.targetDistanceKm = newDist;
                    if (targetInput) targetInput.value = newDist;
                }
                if (!isNaN(newTol) && newTol > 0) {
                    this.state.distanceToleranceKm = newTol;
                }
                if (!isNaN(newCount) && newCount >= 2) {
                    this.state.numTurnpoints = newCount;
                }
                if (!isNaN(newOverlap) && newOverlap >= 10 && newOverlap <= 100) {
                    this.state.maxOverlapPercent = newOverlap;
                }

                // Apply Route Line Color
                if (settingLineColorInput && settingLineColorInput.value && this.mapController.setRouteColor) {
                    this.mapController.setRouteColor(settingLineColorInput.value);
                }

                // Apply Launch Selection
                if (settingsLaunchSelect && settingsLaunchSelect.value) {
                    const selWp = this.state.waypoints.find(w => w.id === settingsLaunchSelect.value);
                    if (selWp) {
                        this.setLaunchWaypoint(selWp);
                    }
                }
                if (settingsLockLaunch && this.state.turnpoints.length > 0) {
                    this.state.turnpoints[0].locked = settingsLockLaunch.checked;
                }

                // Apply Goal Selection
                if (settingsGoalSelect && settingsGoalSelect.value) {
                    const selWp = this.state.waypoints.find(w => w.id === settingsGoalSelect.value);
                    if (selWp) {
                        this.setGoalWaypoint(selWp);
                    }
                }
                if (settingsLockGoal && this.state.turnpoints.length > 1) {
                    const last = this.state.turnpoints.length - 1;
                    this.state.turnpoints[last].locked = settingsLockGoal.checked;
                }

                modalSettings.style.display = 'none';
                this.showToast(`Settings saved: ${this.state.targetDistanceKm} km (±${this.state.distanceToleranceKm} km), ${this.state.numTurnpoints || 5} TPs`);
                this.updateTaskDistances(true, true);
            });
        }

        // Share & QR Modal Controls
        const btnOpenShare = document.getElementById('btn-open-share');
        const modalShare = document.getElementById('modal-share');
        const btnCloseShare = document.getElementById('btn-close-share');
        const btnNativeShare = document.getElementById('btn-native-share');
        const btnExportXctsk = document.getElementById('btn-export-xctsk');
        const btnExportCup = document.getElementById('btn-export-cup');

        if (btnOpenShare && modalShare) {
            btnOpenShare.addEventListener('click', () => {
                modalShare.style.display = 'flex';
                this.renderQrCode();
            });
        }
        if (btnCloseShare && modalShare) {
            btnCloseShare.addEventListener('click', () => {
                modalShare.style.display = 'none';
                if (this.html5QrScanner) {
                    this.html5QrScanner.stop().catch(() => {});
                }
            });
        }
        if (btnNativeShare) {
            btnNativeShare.addEventListener('click', () => {
                shareTask({
                    turnpoints: this.state.turnpoints,
                    optimizedDistKm: this.state.optimized ? this.state.optimized.totalDistanceKm : 0
                });
            });
        }
        if (btnExportXctsk) {
            btnExportXctsk.addEventListener('click', () => {
                const json = taskToXcTrackJson(this.state.turnpoints);
                downloadFile(json, 'task.xctsk', 'application/json');
            });
        }
        if (btnExportCup) {
            btnExportCup.addEventListener('click', () => {
                const cup = taskToCupString(this.state.turnpoints);
                downloadFile(cup, 'task.cup', 'text/plain');
            });
        }

        // XContest Cloud Upload
        const btnUploadXcontest = document.getElementById('btn-upload-xcontest');
        const xcontestResultContainer = document.getElementById('xcontest-result-container');
        const xcontestTaskCode = document.getElementById('xcontest-task-code');
        const xcontestWebLink = document.getElementById('xcontest-web-link');
        const xcontestStatusBadge = document.getElementById('xcontest-status-badge');
        const btnCopyTaskCode = document.getElementById('btn-copy-task-code');

        if (btnUploadXcontest) {
            btnUploadXcontest.addEventListener('click', async () => {
                if (!this.state.turnpoints || this.state.turnpoints.length < 2) {
                    this.showToast('⚠️ Task must have at least 2 turnpoints to upload to XContest', 'warning');
                    return;
                }

                const originalHtml = btnUploadXcontest.innerHTML;
                btnUploadXcontest.disabled = true;
                btnUploadXcontest.innerHTML = '<span>⏳ Uploading to XContest...</span>';
                if (xcontestStatusBadge) xcontestStatusBadge.textContent = 'Uploading...';

                try {
                    const result = await uploadTaskToXContest(this.state.turnpoints, { startTime: "12:00:00Z" });
                    const code = result.taskCode;

                    if (xcontestResultContainer) xcontestResultContainer.style.display = 'block';
                    if (xcontestTaskCode) xcontestTaskCode.textContent = code;
                    if (xcontestWebLink) {
                        xcontestWebLink.href = `https://tools.xcontest.org/xctsk/load?taskCode=${code}`;
                    }
                    if (xcontestStatusBadge) {
                        xcontestStatusBadge.textContent = 'Uploaded ✓';
                        xcontestStatusBadge.style.color = '#86efac';
                    }

                    // Automatically copy code to clipboard
                    try {
                        await navigator.clipboard.writeText(code);
                    } catch (e) {}

                    this.showToast(`☁️ Task uploaded! Code: ${code} (copied to clipboard)`, 'success');
                } catch (err) {
                    console.error('XContest upload error:', err);
                    if (xcontestStatusBadge) {
                        xcontestStatusBadge.textContent = 'Failed';
                        xcontestStatusBadge.style.color = '#f87171';
                    }
                    this.showToast(`⚠️ XContest upload failed: ${err.message}`, 'error');
                } finally {
                    btnUploadXcontest.disabled = false;
                    btnUploadXcontest.innerHTML = originalHtml;
                }
            });
        }

        if (btnCopyTaskCode && xcontestTaskCode) {
            btnCopyTaskCode.addEventListener('click', async () => {
                const code = xcontestTaskCode.textContent.trim();
                if (code && code !== '----') {
                    try {
                        await navigator.clipboard.writeText(code);
                        this.showToast(`📋 Task code '${code}' copied!`, 'success');
                    } catch (e) {
                        this.showToast(`Code: ${code}`);
                    }
                }
            });
        }

        // Camera QR Scanner tab
        const btnTabScan = document.getElementById('tab-btn-scan');
        const btnTabQr = document.getElementById('tab-btn-qr');
        const tabQrContent = document.getElementById('tab-qr-content');
        const tabScanContent = document.getElementById('tab-scan-content');

        if (btnTabScan && btnTabQr) {
            btnTabScan.addEventListener('click', () => {
                btnTabScan.classList.add('active');
                btnTabQr.classList.remove('active');
                tabScanContent.style.display = 'block';
                tabQrContent.style.display = 'none';
                this.startQrCameraScanner();
            });
            btnTabQr.addEventListener('click', () => {
                btnTabQr.classList.add('active');
                btnTabScan.classList.remove('active');
                tabQrContent.style.display = 'block';
                tabScanContent.style.display = 'none';
                if (this.html5QrScanner) {
                    this.html5QrScanner.stop().catch(() => {});
                }
            });
        }

        // Map Style & Offline Maps Modal Controls
        const btnOpenOffline = document.getElementById('btn-open-offline');
        const modalOffline = document.getElementById('modal-offline');
        const btnCloseOffline = document.getElementById('btn-close-offline');
        const btnCacheArea = document.getElementById('btn-cache-area');
        const btnClearTiles = document.getElementById('btn-clear-tiles');

        if (btnOpenOffline && modalOffline) {
            btnOpenOffline.addEventListener('click', async () => {
                modalOffline.style.display = 'flex';
                // Sync currently active map style
                const currentKey = this.mapController.getActiveBaseLayerKey ? this.mapController.getActiveBaseLayerKey() : 'esritopo';
                const activeRadio = document.querySelector(`input[name="map-style"][value="${currentKey}"]`);
                if (activeRadio) activeRadio.checked = true;

                const count = await getOfflineTileCount();
                const countEl = document.getElementById('offline-tile-count');
                if (countEl) countEl.textContent = `${count} tiles saved`;
            });

            // Handle map style radio changes
            document.querySelectorAll('input[name="map-style"]').forEach(radio => {
                radio.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        const newKey = e.target.value;
                        if (this.mapController.setBaseLayer) {
                            this.mapController.setBaseLayer(newKey);
                        }
                        const cfg = this.mapController.getActiveTileConfig();
                        this.showToast(`Switched map to ${cfg.name}`);
                    }
                });
            });
        }
        if (btnCloseOffline && modalOffline) {
            btnCloseOffline.addEventListener('click', () => {
                modalOffline.style.display = 'none';
            });
        }
        if (btnCacheArea) {
            btnCacheArea.addEventListener('click', () => this.runCacheAreaDownload());
        }
        if (btnClearTiles) {
            btnClearTiles.addEventListener('click', async () => {
                await clearOfflineTiles();
                const countEl = document.getElementById('offline-tile-count');
                if (countEl) countEl.textContent = "0 tiles saved";
            });
        }

        // Bottom Sheet Expand / Collapse Toggle & Swipe Gestures
        const sheetHeader = document.querySelector('.sheet-header');
        const bottomSheet = document.getElementById('bottom-sheet');
        const sheetTitleBtn = document.getElementById('sheet-title-btn');
        const sheetToggleArrow = document.getElementById('sheet-toggle-arrow');

        if (sheetHeader && bottomSheet) {
            let expanded = false;

            const updateSheetState = (isExpanded) => {
                expanded = isExpanded;
                if (expanded) {
                    bottomSheet.classList.add('expanded');
                    bottomSheet.classList.remove('collapsed');
                    bottomSheet.style.transform = 'translateY(0)';
                    if (sheetToggleArrow) sheetToggleArrow.textContent = '▼';
                } else {
                    bottomSheet.classList.remove('expanded');
                    bottomSheet.classList.add('collapsed');
                    bottomSheet.style.transform = 'translateY(calc(100% - 68px))';
                    if (sheetToggleArrow) sheetToggleArrow.textContent = '▲';
                }
            };

            this.updateSheetState = updateSheetState;

            // Set initial state
            updateSheetState(false);

            // Title Button click toggle
            if (sheetTitleBtn) {
                sheetTitleBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    updateSheetState(!expanded);
                });
            }

            // Click / Tap handler on header background
            sheetHeader.addEventListener('click', (e) => {
                if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) return;
                updateSheetState(!expanded);
            });

            // Touch Swipe handling (Swipe up to expand, swipe down to collapse)
            let touchStartY = 0;
            let touchStartX = 0;
            let touchStartTime = 0;
            let isSwiping = false;

            sheetHeader.addEventListener('touchstart', (e) => {
                if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) return;
                if (e.touches && e.touches.length === 1) {
                    touchStartY = e.touches[0].clientY;
                    touchStartX = e.touches[0].clientX;
                    touchStartTime = Date.now();
                    isSwiping = true;
                }
            }, { passive: true });

            sheetHeader.addEventListener('touchmove', (e) => {
                if (!isSwiping || !e.touches || e.touches.length !== 1) return;
                const currentY = e.touches[0].clientY;
                const diffY = currentY - touchStartY;
                if (Math.abs(diffY) > 8 && e.cancelable) {
                    e.preventDefault();
                }
            }, { passive: false });

            sheetHeader.addEventListener('touchend', (e) => {
                if (!isSwiping) return;
                isSwiping = false;
                if (!e.changedTouches || e.changedTouches.length === 0) return;

                const endY = e.changedTouches[0].clientY;
                const endX = e.changedTouches[0].clientX;
                const diffY = endY - touchStartY;
                const diffX = endX - touchStartX;

                // Check for vertical swipe gesture
                if (Math.abs(diffY) > Math.abs(diffX) && Math.abs(diffY) > 20) {
                    if (diffY < -20) {
                        // Swiped UP -> expand
                        updateSheetState(true);
                    } else if (diffY > 20) {
                        // Swiped DOWN -> collapse
                        updateSheetState(false);
                    }
                }
            }, { passive: true });
        }
    }

    async handleFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const text = await file.text();
        const filename = file.name.toLowerCase();

        if (filename.endsWith('.cup')) {
            const res = parseCup(text);
            this.state.waypoints = res.waypoints;
            if (res.task && res.task.turnpoints && res.task.turnpoints.length >= 2) {
                this.state.turnpoints = res.task.turnpoints;
            }
        } else {
            this.state.waypoints = parseWpt(text);
        }

        this.taskHistory = [];
        this.historyIndex = -1;
        this.generatedSignatures.clear();

        this.mapController.renderWaypoints(this.state.waypoints);
        this.showToast(`Loaded ${this.state.waypoints.length} waypoints from ${file.name}`);
        this.updateTaskDistances(true, true);
    }

    setLaunchWaypoint(wp) {
        const codeUpper = (wp.code || wp.name || '').toUpperCase();
        if (!codeUpper.startsWith('T')) {
            this.showToast("⚠️ Only waypoints with codes starting with 'T' can be used for Takeoffs", "warning");
            return;
        }

        const launchTp = {
            id: `TP_1_${wp.id}_${Date.now()}`,
            waypoint: wp,
            radius: 1000,
            type: 'takeoff',
            direction: 'enter',
            goalType: 'cylinder',
            locked: true
        };

        if (!this.state.turnpoints || this.state.turnpoints.length === 0) {
            this.state.turnpoints = [
                launchTp,
                {
                    id: `TP_SSS_${wp.id}_${Date.now()}`,
                    waypoint: wp,
                    radius: 2000,
                    type: 'sss',
                    direction: 'exit',
                    goalType: 'cylinder',
                    locked: false
                }
            ];
        } else {
            this.state.turnpoints[0] = launchTp;
            // Rule: Default SSS is 2km exit around the launch waypoint
            const sssIdx = this.state.turnpoints.findIndex(t => t.type === 'sss');
            if (sssIdx !== -1) {
                this.state.turnpoints[sssIdx].waypoint = wp;
                this.state.turnpoints[sssIdx].radius = 2000;
                this.state.turnpoints[sssIdx].direction = 'exit';
            } else if (this.state.turnpoints.length >= 2) {
                this.state.turnpoints.splice(1, 0, {
                    id: `TP_SSS_${wp.id}_${Date.now()}`,
                    waypoint: wp,
                    radius: 2000,
                    type: 'sss',
                    direction: 'exit',
                    goalType: 'cylinder',
                    locked: false
                });
            } else {
                this.state.turnpoints.push({
                    id: `TP_SSS_${wp.id}_${Date.now()}`,
                    waypoint: wp,
                    radius: 2000,
                    type: 'sss',
                    direction: 'exit',
                    goalType: 'cylinder',
                    locked: false
                });
            }
        }
        this.updateTaskDistances(true, true);
        this.showToast(`🚀 Set [${wp.code || wp.name}] as Launch with 2km SSS`);
    }

    setGoalWaypoint(wp) {
        const codeUpper = (wp.code || wp.name || '').toUpperCase();
        const descUpper = (wp.desc || wp.description || '').toUpperCase();
        const isGoalEligible = codeUpper.startsWith('G') || descUpper.includes('GOAL');
        if (!isGoalEligible) {
            this.showToast("⚠️ Only waypoints with codes starting with 'G' or 'goal' in description can be used for Goals", "warning");
            return;
        }

        const goalTp = {
            id: `TP_GOAL_${wp.id}_${Date.now()}`,
            waypoint: wp,
            radius: 400,
            type: 'goal',
            direction: 'enter',
            goalType: 'cylinder',
            locked: true
        };

        const essTp = {
            id: `TP_ESS_${wp.id}_${Date.now()}`,
            waypoint: wp,
            radius: 2000,
            type: 'ess',
            direction: 'enter',
            goalType: 'cylinder',
            locked: false
        };

        if (!this.state.turnpoints || this.state.turnpoints.length === 0) {
            this.state.turnpoints = [essTp, goalTp];
        } else {
            const existingGoalIdx = this.state.turnpoints.findIndex(t => t.type === 'goal');
            if (existingGoalIdx !== -1) {
                this.state.turnpoints[existingGoalIdx] = goalTp;
            } else {
                this.state.turnpoints.push(goalTp);
            }

            // Rule: Default ESS is 2km enter around the goal waypoint, placed before Goal
            const finalGoalIdx = this.state.turnpoints.findIndex(t => t.type === 'goal');
            const essIdx = this.state.turnpoints.findIndex(t => t.type === 'ess');
            if (essIdx !== -1) {
                this.state.turnpoints[essIdx].waypoint = wp;
                this.state.turnpoints[essIdx].radius = 2000;
                this.state.turnpoints[essIdx].direction = 'enter';
            } else {
                this.state.turnpoints.splice(finalGoalIdx, 0, essTp);
            }
        }
        this.updateTaskDistances(true, true);
        this.showToast(`🏁 Set [${wp.code || wp.name}] as Goal with 2km ESS`);
    }

    addWaypointToTask(wp) {
        const N = this.state.turnpoints.length;
        const newId = `TP_${Date.now()}_${Math.random().toString(36).substr(2, 5)}_${wp.id}`;

        // If there's an ESS or Goal at the end, insert new waypoint before them
        const goalIdx = this.state.turnpoints.findIndex(t => t.type === 'goal');
        const essIdx = this.state.turnpoints.findIndex(t => t.type === 'ess');
        let insertPos = N;
        if (essIdx !== -1) {
            insertPos = essIdx;
        } else if (goalIdx !== -1) {
            insertPos = goalIdx;
        }

        if (insertPos < N) {
            const newTp = {
                id: newId,
                waypoint: wp,
                radius: 400,
                type: 'turnpoint',
                direction: 'enter',
                goalType: 'cylinder',
                locked: false
            };
            this.state.turnpoints.splice(insertPos, 0, newTp);
            this.showToast(`Added [${wp.code || wp.name}] to task`);
        } else {
            let type = 'turnpoint';
            let radius = 400;

            if (N === 0) {
                const codeUpper = (wp.code || wp.name || '').toUpperCase();
                type = codeUpper.startsWith('T') ? 'takeoff' : 'turnpoint';
                radius = type === 'takeoff' ? 1000 : 400;
            }

            this.state.turnpoints.push({
                id: newId,
                waypoint: wp,
                radius: radius,
                type: type,
                direction: 'enter',
                goalType: 'cylinder',
                locked: (type === 'takeoff')
            });
            this.showToast(`Added [${wp.code || wp.name}] to task`);
        }

        this.updateTaskDistances(true, true);
    }

    toggleTurnpointSelection(idx) {
        if (!this.taskSheet) return;
        if (this.taskSheet.selectedIndices.has(idx)) {
            this.taskSheet.selectedIndices.delete(idx);
        } else {
            this.taskSheet.selectedIndices.add(idx);
        }
        this.taskSheet.handleSelectionUpdated();
    }

    setAllTurnpoints(turnpoints, selectedIndices) {
        this.state.turnpoints = turnpoints;
        if (selectedIndices) {
            this.mapController.setSelectedTurnpoints(selectedIndices);
        }
        this.updateTaskDistances(true, true);
    }

    handleSelectionChange(selectedIndices) {
        this.mapController.setSelectedTurnpoints(selectedIndices);
    }

    handleFocusTurnpoint(idx) {
        if (this.updateSheetState) {
            this.updateSheetState(true);
        }
        this.mapController.focusTurnpoint(idx);
    }

    handleExitFocus() {
        // Exiting focus mode restores all turnpoint cards
    }

    openCutPointAlternativesForTurnpoint(idx) {
        const tp = this.state.turnpoints[idx];
        if (!tp) return;
        const cutPt = (this.state.optimized && this.state.optimized.touchPoints && this.state.optimized.touchPoints[idx])
            ? this.state.optimized.touchPoints[idx]
            : { lat: tp.waypoint.lat, lng: tp.waypoint.lng };
        this.mapController.setActiveCutPoint(idx, cutPt);
        this.handleCutPointSelected(idx, cutPt);
    }

    updateTurnpoint(idx, updatedTp) {
        if (this.state.turnpoints[idx]) {
            this.state.turnpoints[idx] = { ...this.state.turnpoints[idx], ...updatedTp };
            this.updateTaskDistances(true, true);
        }
    }

    removeWaypointFromTask(wp) {
        if (!wp) return;
        const initialCount = this.state.turnpoints.length;
        this.state.turnpoints = this.state.turnpoints.filter(tp => tp.waypoint && tp.waypoint.id !== wp.id);
        if (this.state.turnpoints.length < initialCount) {
            this.showToast(`Removed [${wp.code || wp.name}] from task`);
            this.updateTaskDistances(true, true);
        }
    }

    removeTurnpoint(idx) {
        if (idx < 0 || idx >= this.state.turnpoints.length) return;
        const tp = this.state.turnpoints[idx];
        const name = tp && tp.waypoint ? (tp.waypoint.code || tp.waypoint.name) : `Turnpoint #${idx + 1}`;
        this.state.turnpoints.splice(idx, 1);
        this.showToast(`Removed [${name}] from task`);
        this.updateTaskDistances(true, true);
    }

    reorderTurnpoints(fromIdx, toIdx) {
        if (fromIdx < 0 || fromIdx >= this.state.turnpoints.length || toIdx < 0 || toIdx >= this.state.turnpoints.length) {
            return;
        }
        const item = this.state.turnpoints.splice(fromIdx, 1)[0];
        this.state.turnpoints.splice(toIdx, 0, item);
        this.updateTaskDistances(true, true);
    }

    handleCutPointSelected(idx, cutPoint) {
        const candidates = findCandidateWaypointsForCutPoint({
            waypoints: this.state.waypoints,
            turnpoints: this.state.turnpoints,
            turnpointIndex: idx,
            cutPoint: cutPoint,
            targetDistanceKm: this.state.targetDistanceKm
        });

        const initialWp = this.state.turnpoints[idx] ? this.state.turnpoints[idx].waypoint : null;
        const initialRadius = this.state.turnpoints[idx] ? this.state.turnpoints[idx].radius : 400;
        this.taskSheet.showReverseCycle(idx, candidates, initialWp, initialRadius);
    }

    applyCandidateTurnpoint(idx, wp, radius) {
        if (this.state.turnpoints[idx]) {
            this.state.turnpoints[idx].waypoint = wp;
            this.state.turnpoints[idx].radius = radius;
            this.updateTaskDistances(false, true);
        }
    }

    handleFreehandComplete(stroke) {
        const res = translateFreehandStrokeToTask(stroke, this.state.waypoints);
        if (res.turnpoints && res.turnpoints.length >= 2) {
            this.state.turnpoints = res.turnpoints;
            this.updateTaskDistances(true, true);
            const drawBanner = document.getElementById('drawing-banner');
            if (drawBanner) drawBanner.style.display = 'none';
            const btnDraw = document.getElementById('btn-draw-task');
            if (btnDraw) btnDraw.classList.remove('active');
            this.showToast(`Generated ${res.turnpoints.length}-TP task matching drawn inflection points!`);
        }
    }

    setupSearchableDropdowns() {
        const settingsLaunchSelect = document.getElementById('solver-launch-select');
        const settingsGoalSelect = document.getElementById('solver-goal-select');
        const launchSearch = document.getElementById('launch-search-input');
        const launchSort = document.getElementById('launch-sort-select');
        const goalSearch = document.getElementById('goal-search-input');
        const goalSort = document.getElementById('goal-sort-select');

        const updateLaunch = () => {
            const mapCenter = (this.mapController && this.mapController.map) ? this.mapController.map.getCenter() : { lat: 44.0, lng: 6.5 };
            const curLaunch = this.state.turnpoints.find(t => t.type === 'takeoff') || this.state.turnpoints[0];
            const selId = settingsLaunchSelect ? settingsLaunchSelect.value : (curLaunch && curLaunch.waypoint ? curLaunch.waypoint.id : null);
            this.renderSearchableDropdown({
                selectEl: settingsLaunchSelect,
                searchEl: launchSearch,
                sortEl: launchSort,
                codePrefix: 'T',
                currentSelectedId: selId,
                referencePoint: mapCenter
            });
        };

        const updateGoal = () => {
            const curLaunch = this.state.turnpoints.find(t => t.type === 'takeoff') || this.state.turnpoints[0];
            const refPt = (curLaunch && curLaunch.waypoint) ? curLaunch.waypoint : ((this.mapController && this.mapController.map) ? this.mapController.map.getCenter() : { lat: 44.0, lng: 6.5 });
            const curGoal = this.state.turnpoints.slice().reverse().find(t => t.type === 'goal') || this.state.turnpoints[this.state.turnpoints.length - 1];
            const selId = settingsGoalSelect ? settingsGoalSelect.value : (curGoal && curGoal.waypoint ? curGoal.waypoint.id : null);
            this.renderSearchableDropdown({
                selectEl: settingsGoalSelect,
                searchEl: goalSearch,
                sortEl: goalSort,
                codePrefix: 'G',
                currentSelectedId: selId,
                referencePoint: refPt
            });
        };

        if (launchSearch) launchSearch.addEventListener('input', updateLaunch);
        if (launchSort) launchSort.addEventListener('change', updateLaunch);
        if (goalSearch) goalSearch.addEventListener('input', updateGoal);
        if (goalSort) goalSort.addEventListener('change', updateGoal);

        this._refreshLaunchDropdown = updateLaunch;
        this._refreshGoalDropdown = updateGoal;
    }

    renderSearchableDropdown({ selectEl, searchEl, sortEl, codePrefix, currentSelectedId, referencePoint }) {
        if (!selectEl) return;
        const wps = this.state.waypoints || [];
        const searchTerm = (searchEl ? searchEl.value : '').toLowerCase().trim();
        const sortMode = sortEl ? sortEl.value : 'alpha';

        // Filter by code prefix if applicable (e.g. 'T' for takeoff, 'G' for goal)
        let eligible = wps;
        if (codePrefix) {
            const prefixMatched = wps.filter(w => {
                const codeUpper = (w.code || w.name || '').toUpperCase();
                if (codeUpper.startsWith(codePrefix)) return true;
                if (codePrefix === 'G') {
                    const descUpper = (w.desc || w.description || '').toUpperCase();
                    if (descUpper.includes('GOAL')) return true;
                }
                return false;
            });
            if (prefixMatched.length > 0) {
                eligible = prefixMatched;
            }
        }

        // Filter by search query
        let filtered = eligible.filter(w => {
            if (!searchTerm) return true;
            const code = (w.code || '').toLowerCase();
            const name = (w.name || '').toLowerCase();
            return code.includes(searchTerm) || name.includes(searchTerm);
        });

        // Sort
        const refPt = referencePoint || ((this.mapController && this.mapController.map) ? this.mapController.map.getCenter() : { lat: 44.0, lng: 6.5 });
        if (sortMode === 'dist') {
            filtered.sort((a, b) => {
                const distA = vincentyDistance(refPt, a);
                const distB = vincentyDistance(refPt, b);
                return distA - distB;
            });
        } else {
            filtered.sort((a, b) => {
                const codeA = (a.code || a.name || '').toUpperCase();
                const codeB = (b.code || b.name || '').toUpperCase();
                return codeA.localeCompare(codeB);
            });
        }

        const previousVal = selectEl.value || currentSelectedId;
        selectEl.innerHTML = '<option value="">(None / Randomize)</option>';
        filtered.forEach(w => {
            const opt = document.createElement('option');
            opt.value = w.id;
            const distKm = (vincentyDistance(refPt, w) / 1000).toFixed(1);
            const code = w.code || w.id;
            opt.textContent = `[${code}] ${w.name} - ${w.elev || 0}m (${distKm} km)`;
            if (previousVal && previousVal === w.id) {
                opt.selected = true;
            }
            selectEl.appendChild(opt);
        });
    }

    runRandomizerSolver(targetIndex = null) {
        const targetDist = this.state.targetDistanceKm || 65.0;
        const tpCount = Math.max(2, this.state.numTurnpoints || (this.state.turnpoints ? this.state.turnpoints.length : 4));

        if (targetIndex !== null && targetIndex !== undefined) {
            this.showToast(`🎲 Randomizing Turnpoint ${targetIndex + 1}...`);
        } else {
            this.showToast("🎲 Generating new unique task option...");
        }

        setTimeout(() => {
            const res = solveRandomizedTask({
                waypoints: this.state.waypoints,
                currentTurnpoints: this.state.turnpoints,
                targetDistanceKm: targetDist,
                numTurnpoints: tpCount,
                targetIndex: targetIndex,
                distanceToleranceKm: this.state.distanceToleranceKm || 0.5,
                maxOverlapPercent: this.state.maxOverlapPercent !== undefined ? this.state.maxOverlapPercent : 80,
                recentTasks: this.taskHistory,
                recentSignatures: this.generatedSignatures,
                maxAttempts: 400
            });

            if (res.turnpoints && res.turnpoints.length >= 2) {
                this.state.turnpoints = res.turnpoints;
                this.updateTaskDistances(true, true); // records into taskHistory
                this.mapController.fitTask(this.state.turnpoints);

                const optionNum = this.historyIndex + 1;
                const diff = (res.optimized.totalDistanceKm - targetDist).toFixed(1);
                const diffStr = diff >= 0 ? `+${diff}` : `${diff}`;

                if (targetIndex !== null && targetIndex !== undefined) {
                    const wpName = res.turnpoints[targetIndex].waypoint.name;
                    this.showToast(`🎲 Option ${optionNum}: TP ${targetIndex + 1} -> ${wpName} (${res.optimized.totalDistanceKm.toFixed(1)} km)`, res.success ? 'normal' : 'warning');
                } else {
                    this.showToast(`🎲 Option ${optionNum}: ${res.optimized.totalDistanceKm.toFixed(1)} km (${diffStr} km)`, res.success ? 'normal' : 'warning');
                }
            } else {
                this.showToast(res.error || "All unique options matching constraints have been generated! Use ◀ Back to browse previous options.", "warning", 4000);
            }
        }, 30);
    }

    renderQrCode() {
        const qrContainer = document.getElementById('qrcode-display');
        if (!qrContainer) return;
        qrContainer.innerHTML = '';

        const qrText = taskToXcTrackQrString(this.state.turnpoints);

        try {
            this.qrCodeInstance = new QRCode(qrContainer, {
                text: qrText,
                width: 256,
                height: 256,
                colorDark: "#000000",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.M
            });
        } catch (e) {
            console.error("QR Code render error:", e);
        }
    }

    startQrCameraScanner() {
        const scanContainerId = 'camera-scanner-view';
        if (typeof Html5Qrcode === 'undefined') return;

        if (this.html5QrScanner) {
            this.html5QrScanner.stop().catch(() => {});
        }

        this.html5QrScanner = new Html5Qrcode(scanContainerId);
        this.html5QrScanner.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 250, height: 250 } },
            (decodedText) => {
                try {
                    const parsed = xcTrackJsonToTask(decodedText);
                    if (parsed.turnpoints && parsed.turnpoints.length >= 2) {
                        this.state.turnpoints = parsed.turnpoints;
                        this.updateTaskDistances(true, true);
                        this.mapController.fitTask(this.state.turnpoints);
                        this.html5QrScanner.stop().catch(() => {});
                        const modal = document.getElementById('modal-share');
                        if (modal) modal.style.display = 'none';
                        this.showToast(`Imported ${parsed.turnpoints.length}-TP task from QR!`);
                    }
                } catch (e) {
                    console.warn("Non-task QR code scanned:", decodedText);
                }
            },
            () => {}
        ).catch(err => {
            console.warn("Camera start error:", err);
        });
    }

    async runCacheAreaDownload() {
        const bounds = this.mapController.getBounds();
        const progressEl = document.getElementById('cache-progress-fill');
        const statusText = document.getElementById('cache-status-text');

        const activeTileCfg = this.mapController.getActiveTileConfig();
        const layerId = (activeTileCfg && activeTileCfg.options && activeTileCfg.options.layerId) || 'opentopo';
        const urlTemplate = (activeTileCfg && activeTileCfg.url) || 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';

        try {
            await downloadAreaTiles({
                bounds: bounds,
                minZoom: 9,
                maxZoom: 13,
                urlTemplate: urlTemplate,
                layerId: layerId,
                onProgress: (completed, total) => {
                    const pct = Math.round((completed / total) * 100);
                    if (progressEl) progressEl.style.width = `${pct}%`;
                    if (statusText) statusText.textContent = `Caching: ${completed} / ${total} tiles (${pct}%)`;
                }
            });

            const count = await getOfflineTileCount();
            const countEl = document.getElementById('offline-tile-count');
            if (countEl) countEl.textContent = `${count} tiles saved`;
            if (statusText) statusText.textContent = "Area successfully cached for offline use!";
        } catch (e) {
            if (statusText) statusText.textContent = `Cache error: ${e.message}`;
        }
    }

    updateTaskDistances(renderSheet = true, recordHistory = false) {
        this.state.optimized = optimizeTaskRoute(this.state.turnpoints);

        // Update Top Badges
        const distValEl = document.getElementById('distance-val');
        const deltaTag = document.getElementById('delta-tag');
        const targetInput = document.getElementById('input-target-dist');

        const optKm = this.state.optimized ? this.state.optimized.totalDistanceKm : 0;
        if (distValEl) distValEl.textContent = `${optKm.toFixed(1)} km`;

        const diff = optKm - this.state.targetDistanceKm;
        const tol = this.state.distanceToleranceKm || 0.5;
        if (deltaTag) {
            const isMatch = Math.abs(diff) <= tol;
            deltaTag.textContent = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} km`;
            deltaTag.className = `delta-tag ${isMatch ? 'matched' : ''}`;
            deltaTag.title = `Tolerance: ±${tol} km`;
        }
        if (targetInput && targetInput.value !== this.state.targetDistanceKm.toString()) {
            targetInput.value = this.state.targetDistanceKm;
        }

        // Re-render map and task list
        this.mapController.renderTask(this.state.turnpoints, this.state.optimized);
        if (renderSheet) {
            this.taskSheet.render(this.state.turnpoints, this.state.optimized);
        }

        if (recordHistory) {
            this.recordTaskHistory(this.state.turnpoints, this.state.optimized);
        }
    }

    loadSampleWaypoints() {
        const sampleCup = `
"name","code","country","lat","lon","elev","style","rwdir","rwlen","rwwidth","freq","desc"
"St Andre Chalvet","T01",FR,4358.150N,00631.200E,1530m,1,,,,,"Main Takeoff West"
"Landing Aerodrome","G01",FR,4357.500N,00630.100E,910m,1,,,,,"Official Goal Landing"
"Col des Robines","B02",FR,4358.900N,00633.400E,1480m,1,,,,,"Pass East"
"Chamatte Sud","C03",FR,4355.200N,00632.000E,1870m,1,,,,,"South Ridge"
"Dormillouse","D04",FR,4412.500N,00620.000E,2505m,1,,,,,"North Big Turnpoint"
"Col d Allos","A05",FR,4415.000N,00635.400E,2250m,1,,,,,"Pass North East"
"Cheval Blanc","E06",FR,4407.200N,00628.100E,2323m,1,,,,,"High Mountain Turn"
"Coupe","F07",FR,4403.500N,00631.800E,1750m,1,,,,,"Local Ridge"
"Thorame Haute Takeoff","T02",FR,4405.300N,00634.500E,1650m,1,,,,,"North Launch"
"Pic de Rent","P09",FR,4402.000N,00626.500E,1996m,1,,,,,"West Ridge"
"Mourre de Chanier","M10",FR,4352.000N,00624.000E,1930m,1,,,,,"South West Corner"
"Montagne de Lure","L11",FR,4407.000N,00547.000E,1826m,1,,,,,"Far West Outlying"
"Castellane","C12",FR,4350.800N,00630.700E,724m,1,,,,,"South River Gate"
"Barcelonnette","B13",FR,4423.200N,00639.100E,1135m,1,,,,,"North Valley"
"Puget Theniers","P14",FR,4357.400N,00653.800E,410m,1,,,,,"East River Valley"
"Annot","A15",FR,4357.900N,00640.100E,700m,1,,,,,"East Village"
"Gorde Sud Goal","G02",FR,4359.800N,00623.500E,1620m,1,,,,,"Valley Goal Field"
"Entrevaux","E17",FR,4356.900N,00648.600E,470m,1,,,,,"Citadel Landing"
"La Mure","L18",FR,4400.800N,00635.200E,1050m,1,,,,,"Intermediate Pass"
"Verdon Lake","V19",FR,4348.000N,00615.000E,480m,1,,,,,"Lake South Gate"
`;

        const parsed = parseCup(sampleCup);
        this.state.waypoints = parsed.waypoints;
        this.mapController.renderWaypoints(this.state.waypoints);

        const wpT01 = this.state.waypoints.find(w => w.code === 'T01') || this.state.waypoints[0];
        const wpG01 = this.state.waypoints.find(w => w.code === 'G01') || this.state.waypoints[1];
        const wpD04 = this.state.waypoints.find(w => w.code === 'D04') || this.state.waypoints[4];

        this.state.turnpoints = [
            { id: 'TP_1_T01', waypoint: wpT01, radius: 1000, type: 'takeoff', direction: 'enter', locked: true },
            { id: 'TP_2_SSS_T01', waypoint: wpT01, radius: 2000, type: 'sss', direction: 'exit', locked: false },
            { id: 'TP_3_D04', waypoint: wpD04, radius: 3000, type: 'turnpoint', direction: 'enter', locked: false },
            { id: 'TP_4_ESS_G01', waypoint: wpG01, radius: 2000, type: 'ess', direction: 'enter', locked: false },
            { id: 'TP_5_G01', waypoint: wpG01, radius: 400, type: 'goal', direction: 'enter', goalType: 'cylinder', locked: true }
        ];

        this.updateTaskDistances(true, true);
        this.mapController.fitTask(this.state.turnpoints);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
    window.app = app;
});
