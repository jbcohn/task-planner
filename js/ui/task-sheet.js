import { formatRadiusDisplay } from '../geo-math.js';

export class TaskSheet {
    constructor({
        containerId,
        onUpdateTurnpoint,
        onRemoveTurnpoint,
        onReorderTurnpoints,
        onRandomizeSingleTurnpoint,
        onApplyCandidateTurnpoint,
        onSetTurnpoints,
        onOpenCutPointAlternatives,
        onCloseCutPointAlternatives,
        onFocusTurnpoint,
        onExitFocus
    }) {
        this.container = document.getElementById(containerId);
        this.onUpdateTurnpoint = onUpdateTurnpoint;
        this.onRemoveTurnpoint = onRemoveTurnpoint;
        this.onReorderTurnpoints = onReorderTurnpoints;
        this.onRandomizeSingleTurnpoint = onRandomizeSingleTurnpoint;
        this.onApplyCandidateTurnpoint = onApplyCandidateTurnpoint;
        this.onSetTurnpoints = onSetTurnpoints;
        this.onOpenCutPointAlternatives = onOpenCutPointAlternatives;
        this.onCloseCutPointAlternatives = onCloseCutPointAlternatives;
        this.onFocusTurnpoint = onFocusTurnpoint;
        this.onExitFocus = onExitFocus;

        this.turnpoints = [];
        this.focusedIndex = null;

        this.reverseCyclePanel = document.getElementById('reverse-cycle-panel');
        this.candidateList = [];
        this.currentCandidateIndex = 0;
        this.activeCutPointTurnpointIndex = null;
        this.initialCutPointWaypoint = null;
        this.initialCutPointRadius = null;

        this.initReverseCyclePanel();
    }

    initReverseCyclePanel() {
        if (!this.reverseCyclePanel) return;

        const btnPrev = document.getElementById('btn-candidate-prev');
        const btnNext = document.getElementById('btn-candidate-next');
        const btnAccept = document.getElementById('btn-candidate-accept');
        const btnCancel = document.getElementById('btn-candidate-cancel');
        const btnClose = document.getElementById('btn-candidate-close');

        if (btnPrev) {
            btnPrev.addEventListener('click', () => this.stepCandidate(-1));
        }
        if (btnNext) {
            btnNext.addEventListener('click', () => this.stepCandidate(1));
        }
        if (btnAccept) {
            btnAccept.addEventListener('click', () => {
                this.closeReverseCycle();
            });
        }
        if (btnCancel) {
            btnCancel.addEventListener('click', () => {
                this.cancelReverseCycle();
            });
        }
        if (btnClose) {
            btnClose.addEventListener('click', () => {
                this.closeReverseCycle();
            });
        }
    }

    setFocusedTurnpoint(idx) {
        if (idx < 0 || idx >= this.turnpoints.length) return;
        this.focusedIndex = idx;
        const bottomSheet = document.getElementById('bottom-sheet');
        if (bottomSheet) bottomSheet.classList.add('sheet-focus-mode');
        if (this.onFocusTurnpoint) {
            this.onFocusTurnpoint(idx);
        }
        this.render();
    }

    exitFocusMode() {
        this.focusedIndex = null;
        const bottomSheet = document.getElementById('bottom-sheet');
        if (bottomSheet) bottomSheet.classList.remove('sheet-focus-mode');
        if (this.onExitFocus) {
            this.onExitFocus();
        }
        this.render();
    }

    calculateSteppedRadius(currentR, step) {
        let r = (currentR || 400) + step;
        if (r < 100) r = 100;
        if (r > 300000) r = 300000;
        return Math.round(r);
    }

    showReverseCycle(turnpointIndex, candidates, initialWp, initialRadius) {
        this.activeCutPointTurnpointIndex = turnpointIndex;
        this.initialCutPointWaypoint = initialWp || (this.turnpoints[turnpointIndex] && this.turnpoints[turnpointIndex].waypoint);
        this.initialCutPointRadius = initialRadius || (this.turnpoints[turnpointIndex] && this.turnpoints[turnpointIndex].radius);
        this.candidateList = candidates || [];
        this.currentCandidateIndex = 0;

        if (!this.reverseCyclePanel) return;

        if (this.candidateList.length === 0) {
            this.reverseCyclePanel.style.display = 'block';
            document.getElementById('candidate-name').textContent = "No alternative waypoints";
            document.getElementById('candidate-details').textContent = "No other waypoints meet radius & angle constraints for this cut-point.";
            return;
        }

        this.reverseCyclePanel.style.display = 'block';
        this.applyCurrentCandidate();
    }

    stepCandidate(direction) {
        if (!this.candidateList || this.candidateList.length === 0) return;
        this.currentCandidateIndex = (this.currentCandidateIndex + direction + this.candidateList.length) % this.candidateList.length;
        this.applyCurrentCandidate();
    }

    applyCurrentCandidate() {
        const cand = this.candidateList[this.currentCandidateIndex];
        if (!cand) return;

        const nameEl = document.getElementById('candidate-name');
        const detailsEl = document.getElementById('candidate-details');
        const counterEl = document.getElementById('candidate-counter');

        const code = cand.waypoint.code || cand.waypoint.id;
        const name = (cand.waypoint.name && cand.waypoint.name !== code) ? cand.waypoint.name : '';
        if (nameEl) nameEl.textContent = `${code} ${name ? '• ' + name : ''}`;
        if (detailsEl) {
            detailsEl.textContent = `Radius: ${formatRadiusDisplay(cand.radius)} • Opt Dist: ${cand.optimizedDistanceKm.toFixed(1)} km (Δ ${cand.diffKm.toFixed(1)} km)`;
        }
        if (counterEl) {
            counterEl.textContent = `${this.currentCandidateIndex + 1} / ${this.candidateList.length}`;
        }

        if (this.onApplyCandidateTurnpoint) {
            this.onApplyCandidateTurnpoint(this.activeCutPointTurnpointIndex, cand.waypoint, cand.radius);
        }
    }

    cancelReverseCycle() {
        if (this.onApplyCandidateTurnpoint && this.activeCutPointTurnpointIndex !== null && this.initialCutPointWaypoint) {
            this.onApplyCandidateTurnpoint(this.activeCutPointTurnpointIndex, this.initialCutPointWaypoint, this.initialCutPointRadius);
        }
        this.closeReverseCycle();
    }

    closeReverseCycle() {
        if (this.reverseCyclePanel) {
            this.reverseCyclePanel.style.display = 'none';
        }
        this.candidateList = [];
        this.activeCutPointTurnpointIndex = null;
        this.initialCutPointWaypoint = null;
        this.initialCutPointRadius = null;
        if (this.onCloseCutPointAlternatives) {
            this.onCloseCutPointAlternatives();
        }
    }

    render(turnpoints, optimized) {
        if (turnpoints !== undefined) {
            this.turnpoints = turnpoints || [];
        }
        if (!this.container) return;

        if (this.focusedIndex !== null && (this.focusedIndex < 0 || this.focusedIndex >= this.turnpoints.length)) {
            this.focusedIndex = null;
        }

        const bottomSheet = document.getElementById('bottom-sheet');
        if (bottomSheet) {
            bottomSheet.classList.toggle('sheet-focus-mode', this.focusedIndex !== null);
        }

        this.container.innerHTML = '';

        if (this.turnpoints.length === 0) {
            this.container.innerHTML = `
                <div style="text-align: center; color: var(--text-secondary); padding: 20px 0;">
                    <p style="font-weight: 600; margin-bottom: 6px;">Task is empty</p>
                    <p style="font-size: 12px;">Upload a waypoint file (.cup or .wpt), tap waypoints on the map, or draw a freehand path.</p>
                </div>
            `;
            return;
        }

        // Render Focus Mode Banner if in single turnpoint focus mode
        if (this.focusedIndex !== null) {
            const focusedTp = this.turnpoints[this.focusedIndex];
            const focusedWp = focusedTp.waypoint;
            const focusedCode = focusedWp.code || focusedWp.id || '';
            const focusedName = (focusedWp.name && focusedWp.name !== focusedCode) ? focusedWp.name : '';

            const banner = document.createElement('div');
            banner.className = 'focus-mode-banner';
            banner.innerHTML = `
                <div class="focus-mode-info">
                    <span class="focus-mode-badge">FOCUS MODE</span>
                    <span class="focus-mode-title">#${this.focusedIndex + 1} ${focusedCode} ${focusedName}</span>
                    <span class="focus-mode-hint">• Map visible above</span>
                </div>
                <button type="button" class="btn-exit-focus" id="btn-exit-focus" title="Exit single turnpoint focus and show all">
                    ✕ Show All Turnpoints
                </button>
            `;
            this.container.appendChild(banner);
            banner.querySelector('#btn-exit-focus').addEventListener('click', (e) => {
                e.stopPropagation();
                this.exitFocusMode();
            });
        }

        const indicesToRender = this.focusedIndex !== null 
            ? [this.focusedIndex] 
            : this.turnpoints.map((_, i) => i);

        indicesToRender.forEach((idx) => {
            const tp = this.turnpoints[idx];
            const wp = tp.waypoint;
            const card = document.createElement('div');
            card.className = 'tp-card';

            const badgeClass = (tp.type || 'turnpoint').toLowerCase();
            const radiusM = tp.radius || 400;

            const code = wp.code || wp.id || '';
            const name = (wp.name && wp.name !== code) ? wp.name : '';
            const isIntermediate = idx > 0 && idx < this.turnpoints.length - 1;

            card.innerHTML = `
                <div class="tp-row-main">
                    <div class="tp-info">
                        <div class="tp-badge ${badgeClass}">#${idx + 1}</div>
                        <div>
                            <div class="tp-name">
                                <span class="tp-code-badge">${code}</span>
                                ${name ? `<span class="tp-name-text">${name}</span>` : ''}
                            </div>
                            <div class="tp-meta">Alt: ${wp.elev || 0}m ${tp.locked ? '• 🔒 Locked' : ''}</div>
                        </div>
                    </div>
                    <div class="tp-actions">
                        <button class="btn-lock ${this.focusedIndex === idx ? 'active' : ''}" id="btn-focus-tp-${idx}" title="${this.focusedIndex === idx ? 'Exit single turnpoint view' : 'Show only this turnpoint to see changes on map'}" style="font-size: 12px; ${this.focusedIndex === idx ? 'background: #0284c7; color: #ffffff;' : ''}">
                            ${this.focusedIndex === idx ? '✕ Exit' : '🔍 Focus'}
                        </button>
                        ${isIntermediate ? `<button class="btn-lock" id="btn-cutpoint-${idx}" title="🎯 Find route alternatives through this touchpoint" style="font-size: 13px;">🎯</button>` : ''}
                        <button class="btn-lock" id="btn-rnd-tp-${idx}" title="Randomize this waypoint" style="font-size: 13px;">🎲</button>
                        <button class="btn-lock ${tp.locked ? 'locked' : ''}" id="btn-lock-${idx}" title="${tp.locked ? 'Unlock turnpoint' : 'Lock turnpoint for randomizer'}">
                            ${tp.locked ? '🔒' : '🔓'}
                        </button>
                        <button class="btn-lock" id="btn-up-${idx}" title="Move up" ${idx === 0 ? 'disabled style="opacity:0.3"' : ''}>⬆️</button>
                        <button class="btn-lock" id="btn-down-${idx}" title="Move down" ${idx === this.turnpoints.length - 1 ? 'disabled style="opacity:0.3"' : ''}>⬇️</button>
                        <button class="btn-lock" id="btn-del-${idx}" title="Remove" style="color: var(--accent-red)">✕</button>
                    </div>
                </div>

                <div class="tp-row-controls">
                    <select class="type-select" id="select-type-${idx}">
                        <option value="takeoff" ${tp.type === 'takeoff' ? 'selected' : ''}>Takeoff</option>
                        <option value="sss-exit" ${tp.type === 'sss' && tp.direction === 'exit' ? 'selected' : ''}>SSS (Exit)</option>
                        <option value="sss-enter" ${tp.type === 'sss' && tp.direction === 'enter' ? 'selected' : ''}>SSS (Enter)</option>
                        <option value="turnpoint" ${tp.type === 'turnpoint' ? 'selected' : ''}>Turnpoint (Enter)</option>
                        <option value="ess" ${tp.type === 'ess' ? 'selected' : ''}>ESS (Enter)</option>
                        <option value="goal-cyl" ${tp.type === 'goal' && tp.goalType !== 'line' ? 'selected' : ''}>Goal (Cylinder - Enter)</option>
                        <option value="goal-line" ${tp.type === 'goal' && tp.goalType === 'line' ? 'selected' : ''}>Goal (Line)</option>
                    </select>

                    <div class="radius-badge" id="radius-badge-${idx}">
                        ${formatRadiusDisplay(radiusM)}
                    </div>
                </div>

                <div class="quick-radius-row">
                    <div class="radius-chip ${radiusM === 400 ? 'active' : ''}" data-radius="400">400m</div>
                    <div class="radius-chip ${radiusM === 1000 ? 'active' : ''}" data-radius="1000">1km</div>
                    <div class="radius-chip ${radiusM === 2000 ? 'active' : ''}" data-radius="2000">2km</div>
                    <div class="radius-chip ${radiusM === 5000 ? 'active' : ''}" data-radius="5000">5km</div>
                    <div class="radius-chip ${radiusM === 10000 ? 'active' : ''}" data-radius="10000">10km</div>
                    <div class="radius-chip ${radiusM === 50000 ? 'active' : ''}" data-radius="50000">50km</div>
                    <div class="radius-chip ${radiusM === 100000 ? 'active' : ''}" data-radius="100000">100km</div>
                </div>

                <div class="radius-stepper-row">
                    <button type="button" class="radius-step-btn" data-step="-100" title="Decrease radius by 100 m">-100m</button>
                    <button type="button" class="radius-step-btn" data-step="100" title="Increase radius by 100 m">+100m</button>
                    <button type="button" class="radius-step-btn" data-step="-1000" title="Decrease radius by 1 km">-1km</button>
                    <button type="button" class="radius-step-btn" data-step="1000" title="Increase radius by 1 km">+1km</button>
                    <button type="button" class="radius-step-btn" data-step="-10000" title="Decrease radius by 10 km">-10km</button>
                    <button type="button" class="radius-step-btn" data-step="10000" title="Increase radius by 10 km">+10km</button>
                </div>
            `;

            // Focus button
            const focusBtn = card.querySelector(`#btn-focus-tp-${idx}`);
            if (focusBtn) {
                focusBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this.focusedIndex === idx) {
                        this.exitFocusMode();
                    } else {
                        this.setFocusedTurnpoint(idx);
                    }
                });
            }

            // Cut-point button
            const cutBtn = card.querySelector(`#btn-cutpoint-${idx}`);
            if (cutBtn) {
                cutBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this.onOpenCutPointAlternatives) {
                        this.onOpenCutPointAlternatives(idx);
                    }
                });
            }

            // Randomize this single turnpoint button
            const rndBtn = card.querySelector(`#btn-rnd-tp-${idx}`);
            if (rndBtn) {
                rndBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this.onRandomizeSingleTurnpoint) {
                        this.onRandomizeSingleTurnpoint(idx);
                    }
                });
            }

            // Lock button
            const lockBtn = card.querySelector(`#btn-lock-${idx}`);
            lockBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                tp.locked = !tp.locked;
                if (this.onUpdateTurnpoint) this.onUpdateTurnpoint(idx, tp);
            });

            // Delete button
            const delBtn = card.querySelector(`#btn-del-${idx}`);
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.focusedIndex === idx) {
                    this.exitFocusMode();
                } else if (this.focusedIndex > idx) {
                    this.focusedIndex--;
                }
                if (this.onRemoveTurnpoint) this.onRemoveTurnpoint(idx);
            });

            // Up / Down buttons
            const upBtn = card.querySelector(`#btn-up-${idx}`);
            if (idx > 0) {
                upBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this.onReorderTurnpoints) this.onReorderTurnpoints(idx, idx - 1);
                });
            }

            const downBtn = card.querySelector(`#btn-down-${idx}`);
            if (idx < this.turnpoints.length - 1) {
                downBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this.onReorderTurnpoints) this.onReorderTurnpoints(idx, idx + 1);
                });
            }

            // Type selector
            const selectType = card.querySelector(`#select-type-${idx}`);
            selectType.addEventListener('change', (e) => {
                const val = e.target.value;
                if (val === 'takeoff') {
                    tp.type = 'takeoff';
                    tp.direction = 'enter';
                } else if (val === 'sss-exit') {
                    tp.type = 'sss';
                    tp.direction = 'exit';
                } else if (val === 'sss-enter') {
                    tp.type = 'sss';
                    tp.direction = 'enter';
                } else if (val === 'turnpoint') {
                    tp.type = 'turnpoint';
                    tp.direction = 'enter';
                } else if (val === 'ess') {
                    tp.type = 'ess';
                    tp.direction = 'enter';
                } else if (val === 'goal-cyl') {
                    tp.type = 'goal';
                    tp.direction = 'enter';
                    tp.goalType = 'cylinder';
                } else if (val === 'goal-line') {
                    tp.type = 'goal';
                    tp.direction = 'enter';
                    tp.goalType = 'line';
                }
                if (this.onUpdateTurnpoint) this.onUpdateTurnpoint(idx, tp);
            });

            // Quick chips
            card.querySelectorAll('.radius-chip').forEach(chip => {
                chip.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const r = parseInt(chip.getAttribute('data-radius'), 10);
                    tp.radius = r;
                    if (this.onUpdateTurnpoint) this.onUpdateTurnpoint(idx, tp);
                });
            });

            // Radius Stepper Buttons (-100m, +100m, -1km, +1km, -10km, +10km)
            card.querySelectorAll('.radius-step-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const step = parseInt(btn.getAttribute('data-step'), 10);
                    tp.radius = this.calculateSteppedRadius(tp.radius, step);
                    if (this.onUpdateTurnpoint) this.onUpdateTurnpoint(idx, tp);
                });
            });

            this.container.appendChild(card);
        });
    }
}
