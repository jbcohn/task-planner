// task-planner/js/ui/task-sheet.js
import { formatRadiusDisplay, roundTo2SigFigs, getDiscrete2SigFigValues } from '../geo-math.js';

export class TaskSheet {
    constructor({
        containerId,
        onUpdateTurnpoint,
        onRemoveTurnpoint,
        onReorderTurnpoints,
        onRandomizeSingleTurnpoint,
        onApplyCandidateTurnpoint,
        onSetTurnpoints,
        onSelectionChange,
        onOpenCutPointAlternatives,
        onCloseCutPointAlternatives
    }) {
        this.container = document.getElementById(containerId);
        this.onUpdateTurnpoint = onUpdateTurnpoint;
        this.onRemoveTurnpoint = onRemoveTurnpoint;
        this.onReorderTurnpoints = onReorderTurnpoints;
        this.onRandomizeSingleTurnpoint = onRandomizeSingleTurnpoint;
        this.onApplyCandidateTurnpoint = onApplyCandidateTurnpoint;
        this.onSetTurnpoints = onSetTurnpoints;
        this.onSelectionChange = onSelectionChange;
        this.onOpenCutPointAlternatives = onOpenCutPointAlternatives;
        this.onCloseCutPointAlternatives = onCloseCutPointAlternatives;

        this.turnpoints = [];
        this.selectedIndices = new Set();

        this.reverseCyclePanel = document.getElementById('reverse-cycle-panel');
        this.candidateList = [];
        this.currentCandidateIndex = 0;
        this.activeCutPointTurnpointIndex = null;
        this.initialCutPointWaypoint = null;
        this.initialCutPointRadius = null;

        this.initReverseCyclePanel();
        this.initMultiSelectToolbar();
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

    initMultiSelectToolbar() {
        const btnSelectAll = document.getElementById('btn-ms-select-all');
        const btnInvert = document.getElementById('btn-ms-invert');
        const btnReverse = document.getElementById('btn-ms-reverse');
        const btnDuplicate = document.getElementById('btn-ms-duplicate');
        const btnLock = document.getElementById('btn-ms-lock');
        const btnDelete = document.getElementById('btn-ms-delete');
        const btnClear = document.getElementById('btn-ms-clear');

        if (btnSelectAll) {
            btnSelectAll.addEventListener('click', () => {
                if (this.selectedIndices.size === this.turnpoints.length) {
                    this.selectedIndices.clear();
                } else {
                    this.selectedIndices = new Set(this.turnpoints.map((_, i) => i));
                }
                this.handleSelectionUpdated();
            });
        }

        if (btnInvert) {
            btnInvert.addEventListener('click', () => {
                const next = new Set();
                for (let i = 0; i < this.turnpoints.length; i++) {
                    if (!this.selectedIndices.has(i)) next.add(i);
                }
                this.selectedIndices = next;
                this.handleSelectionUpdated();
            });
        }

        if (btnReverse) {
            btnReverse.addEventListener('click', () => {
                this.reverseSelected();
            });
        }

        if (btnDuplicate) {
            btnDuplicate.addEventListener('click', () => {
                this.duplicateSelected();
            });
        }

        if (btnLock) {
            btnLock.addEventListener('click', () => {
                this.toggleLockSelected();
            });
        }

        if (btnDelete) {
            btnDelete.addEventListener('click', () => {
                this.deleteSelected();
            });
        }

        if (btnClear) {
            btnClear.addEventListener('click', () => {
                this.selectedIndices.clear();
                this.handleSelectionUpdated();
            });
        }
    }

    handleSelectionUpdated() {
        if (this.onSelectionChange) {
            this.onSelectionChange(new Set(this.selectedIndices));
        }
        this.renderSelectionState();
    }

    reverseSelected() {
        if (this.selectedIndices.size < 2) return;
        const sorted = Array.from(this.selectedIndices).sort((a, b) => a - b);
        const selectedItems = sorted.map(i => this.turnpoints[i]);
        selectedItems.reverse();

        const updated = [...this.turnpoints];
        sorted.forEach((origIdx, pos) => {
            updated[origIdx] = selectedItems[pos];
        });

        if (this.onSetTurnpoints) {
            this.onSetTurnpoints(updated, this.selectedIndices);
        }
    }

    duplicateSelected() {
        if (this.selectedIndices.size === 0) return;
        const updated = [];
        const newSelection = new Set();

        this.turnpoints.forEach((tp, idx) => {
            updated.push(tp);
            if (this.selectedIndices.has(idx)) {
                const dup = JSON.parse(JSON.stringify(tp));
                dup.id = `TP_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                // If duplicating takeoff/goal, set type to standard turnpoint unless customized
                if (dup.type === 'takeoff') {
                    dup.type = 'turnpoint';
                    dup.radius = 1000;
                }
                updated.push(dup);
                newSelection.add(updated.length - 1);
            }
        });

        this.selectedIndices = newSelection;
        if (this.onSetTurnpoints) {
            this.onSetTurnpoints(updated, this.selectedIndices);
        }
    }

    toggleLockSelected() {
        if (this.selectedIndices.size === 0) return;
        const hasUnlocked = Array.from(this.selectedIndices).some(i => !this.turnpoints[i].locked);
        const shouldLock = hasUnlocked;
        const updated = this.turnpoints.map((tp, idx) => {
            if (this.selectedIndices.has(idx)) {
                return { ...tp, locked: shouldLock };
            }
            return tp;
        });
        if (this.onSetTurnpoints) {
            this.onSetTurnpoints(updated, this.selectedIndices);
        }
    }

    deleteSelected() {
        if (this.selectedIndices.size === 0) return;
        const updated = this.turnpoints.filter((_, idx) => !this.selectedIndices.has(idx));
        this.selectedIndices.clear();
        if (this.onSetTurnpoints) {
            this.onSetTurnpoints(updated, this.selectedIndices);
        }
    }

    setSelectedIndices(indices) {
        this.selectedIndices = new Set(indices);
        this.renderSelectionState();
    }

    renderSelectionState() {
        // Update cards highlight
        const cards = this.container.querySelectorAll('.tp-card');
        cards.forEach((card, idx) => {
            const isSelected = this.selectedIndices.has(idx);
            card.classList.toggle('selected', isSelected);
            const chk = card.querySelector('.tp-select-chk');
            if (chk) chk.checked = isSelected;
        });

        // Update toolbar
        const toolbar = document.getElementById('multiselect-toolbar');
        if (!toolbar) return;

        if (this.selectedIndices.size === 0) {
            toolbar.style.display = 'none';
            return;
        }

        toolbar.style.display = 'flex';
        const countEl = document.getElementById('multiselect-count');
        const sorted = Array.from(this.selectedIndices).sort((a, b) => a - b);
        const indicesStr = sorted.map(i => `#${i + 1}`).join(', ');
        if (countEl) {
            countEl.textContent = `${this.selectedIndices.size} Selected (${indicesStr})`;
        }

        // Shared Properties Editor
        const propsEl = document.getElementById('multiselect-props');
        if (!propsEl) return;

        const selectedTps = sorted.map(i => this.turnpoints[i]);
        const allCylinders = selectedTps.every(t => !t.goalType || t.goalType === 'cylinder');
        const allLines = selectedTps.every(t => t.type === 'goal' && t.goalType === 'line');

        const discreteRadii = getDiscrete2SigFigValues(400, 300000);

        if (allCylinders) {
            const firstR = selectedTps[0].radius || 400;
            const sameRadius = selectedTps.every(t => (t.radius || 400) === firstR);
            const displayR = sameRadius ? formatRadiusDisplay(firstR) : 'Mixed';

            propsEl.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                    <span style="font-size: 11px; font-weight: 600; color: var(--text-secondary);">Batch Radius:</span>
                    <span class="radius-badge" id="batch-radius-badge">${displayR}</span>
                </div>
                <div class="quick-radius-row" style="margin-bottom: 6px;">
                    <div class="radius-chip ${sameRadius && firstR === 400 ? 'active' : ''}" data-radius="400">400m</div>
                    <div class="radius-chip ${sameRadius && firstR === 1000 ? 'active' : ''}" data-radius="1000">1km</div>
                    <div class="radius-chip ${sameRadius && firstR === 2000 ? 'active' : ''}" data-radius="2000">2km</div>
                    <div class="radius-chip ${sameRadius && firstR === 3000 ? 'active' : ''}" data-radius="3000">3km</div>
                    <div class="radius-chip ${sameRadius && firstR === 5000 ? 'active' : ''}" data-radius="5000">5km</div>
                    <div class="radius-chip ${sameRadius && firstR === 10000 ? 'active' : ''}" data-radius="10000">10km</div>
                    <div class="radius-chip ${sameRadius && firstR === 20000 ? 'active' : ''}" data-radius="20000">20km</div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 10px; color: var(--text-secondary);">400m</span>
                    <input type="range" min="0" max="${discreteRadii.length - 1}" 
                           value="${sameRadius && discreteRadii.indexOf(firstR) !== -1 ? discreteRadii.indexOf(firstR) : 0}" 
                           id="batch-radius-slider" style="flex: 1; accent-color: var(--accent-blue); cursor: pointer;">
                    <span style="font-size: 10px; color: var(--text-secondary);">300km</span>
                </div>
            `;

            propsEl.querySelectorAll('.radius-chip').forEach(chip => {
                chip.addEventListener('click', () => {
                    const r = parseInt(chip.getAttribute('data-radius'), 10);
                    this.applyBatchRadius(r);
                });
            });

            const slider = propsEl.querySelector('#batch-radius-slider');
            if (slider) {
                slider.addEventListener('input', (e) => {
                    const r = discreteRadii[parseInt(e.target.value, 10)];
                    const badge = propsEl.querySelector('#batch-radius-badge');
                    if (badge) badge.textContent = formatRadiusDisplay(r);
                });
                slider.addEventListener('change', (e) => {
                    const r = discreteRadii[parseInt(e.target.value, 10)];
                    this.applyBatchRadius(r);
                });
            }
        } else if (allLines) {
            propsEl.innerHTML = `
                <div style="font-size: 11px; color: var(--text-secondary);">All selected are Goal Lines (fixed width 200m).</div>
            `;
        } else {
            propsEl.innerHTML = `
                <div style="font-size: 11px; color: var(--text-secondary); font-style: italic;">
                    Mixed geometry (Cylinders & Goal Line) - geometry properties cannot be batch-edited.
                </div>
            `;
        }
    }

    applyBatchRadius(newRadius) {
        const updated = this.turnpoints.map((tp, idx) => {
            if (this.selectedIndices.has(idx)) {
                return { ...tp, radius: newRadius };
            }
            return tp;
        });
        if (this.onSetTurnpoints) {
            this.onSetTurnpoints(updated, this.selectedIndices);
        }
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
        this.turnpoints = turnpoints || [];
        if (!this.container) return;

        // Prune out-of-range selected indices
        for (const idx of Array.from(this.selectedIndices)) {
            if (idx >= this.turnpoints.length) {
                this.selectedIndices.delete(idx);
            }
        }

        this.container.innerHTML = '';

        if (this.turnpoints.length === 0) {
            this.container.innerHTML = `
                <div style="text-align: center; color: var(--text-secondary); padding: 20px 0;">
                    <p style="font-weight: 600; margin-bottom: 6px;">Task is empty</p>
                    <p style="font-size: 12px;">Upload a waypoint file (.cup or .wpt), tap waypoints on the map, or draw a freehand path.</p>
                </div>
            `;
            this.renderSelectionState();
            return;
        }

        const discreteRadii = getDiscrete2SigFigValues(400, 300000);

        this.turnpoints.forEach((tp, idx) => {
            const wp = tp.waypoint;
            const card = document.createElement('div');
            const isSelected = this.selectedIndices.has(idx);
            card.className = `tp-card ${isSelected ? 'selected' : ''}`;

            const badgeClass = (tp.type || 'turnpoint').toLowerCase();
            const radiusM = tp.radius || 400;

            const code = wp.code || wp.id || '';
            const name = (wp.name && wp.name !== code) ? wp.name : '';
            const isIntermediate = idx > 0 && idx < this.turnpoints.length - 1;

            card.innerHTML = `
                <div class="tp-row-main">
                    <div class="tp-info">
                        <input type="checkbox" class="tp-select-chk" data-index="${idx}" ${isSelected ? 'checked' : ''}>
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
                    <div class="radius-chip ${radiusM === 3000 ? 'active' : ''}" data-radius="3000">3km</div>
                    <div class="radius-chip ${radiusM === 5000 ? 'active' : ''}" data-radius="5000">5km</div>
                    <div class="radius-chip ${radiusM === 10000 ? 'active' : ''}" data-radius="10000">10km</div>
                    <div class="radius-chip ${radiusM === 20000 ? 'active' : ''}" data-radius="20000">20km</div>
                </div>

                <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
                    <span style="font-size: 10px; color: var(--text-secondary);">400m</span>
                    <input type="range" min="0" max="${discreteRadii.length - 1}" value="${discreteRadii.indexOf(radiusM) !== -1 ? discreteRadii.indexOf(radiusM) : 0}" 
                           id="radius-slider-${idx}" style="flex: 1; accent-color: var(--accent-blue); cursor: pointer;">
                    <span style="font-size: 10px; color: var(--text-secondary);">300km</span>
                </div>
            `;

            // Selection Checkbox
            const chk = card.querySelector('.tp-select-chk');
            chk.addEventListener('change', (e) => {
                e.stopPropagation();
                if (e.target.checked) {
                    this.selectedIndices.add(idx);
                } else {
                    this.selectedIndices.delete(idx);
                }
                this.handleSelectionUpdated();
            });

            // Card click selection (if not clicking on interactive child elements)
            card.addEventListener('click', (e) => {
                if (['BUTTON', 'SELECT', 'INPUT'].includes(e.target.tagName)) return;
                if (this.selectedIndices.has(idx)) {
                    this.selectedIndices.delete(idx);
                } else {
                    this.selectedIndices.add(idx);
                }
                this.handleSelectionUpdated();
            });

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

            // Slider
            const slider = card.querySelector(`#radius-slider-${idx}`);
            slider.addEventListener('input', (e) => {
                const discreteIndex = parseInt(e.target.value, 10);
                const r = discreteRadii[discreteIndex];
                tp.radius = r;
                const badge = card.querySelector(`#radius-badge-${idx}`);
                if (badge) badge.textContent = formatRadiusDisplay(r);
            });

            slider.addEventListener('change', (e) => {
                const discreteIndex = parseInt(e.target.value, 10);
                tp.radius = discreteRadii[discreteIndex];
                if (this.onUpdateTurnpoint) this.onUpdateTurnpoint(idx, tp);
            });

            this.container.appendChild(card);
        });

        this.renderSelectionState();
    }
}
