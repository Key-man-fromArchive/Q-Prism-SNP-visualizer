let isPlaying = false;
let animTimer = null;
let onCycleChange = null;
let dataWindows = null;
let activeWindowIdx = 0;

export function initCycleSlider(maxCycle, windows, callback) {
    onCycleChange = callback;
    dataWindows = windows;

    const slider = document.getElementById("cycle-slider");
    const valueEl = document.getElementById("cycle-value");
    const maxEl = document.getElementById("cycle-max");
    const playBtn = document.getElementById("play-btn");
    const control = document.getElementById("cycle-control");
    const windowSelector = document.getElementById("window-selector");

    // Build window buttons (only if multiple windows)
    windowSelector.innerHTML = "";
    if (windows && windows.length > 1) {
        windowSelector.classList.remove("hidden");
        windows.forEach((w, idx) => {
            const btn = document.createElement("button");
            btn.className = "window-btn";
            btn.textContent = w.name;
            btn.addEventListener("click", () => selectWindow(idx));
            windowSelector.appendChild(btn);
        });
    } else {
        windowSelector.classList.add("hidden");
    }

    let debounceTimer = null;
    slider.addEventListener("input", () => {
        valueEl.textContent = slider.value;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            if (onCycleChange) onCycleChange(relativeToAbsolute(parseInt(slider.value)));
        }, 150);
    });

    playBtn.addEventListener("click", () => {
        isPlaying = !isPlaying;
        playBtn.textContent = isPlaying ? "\u23F8" : "\u25B6";
        if (isPlaying) {
            startAnimation(slider, valueEl);
        } else {
            stopAnimation();
        }
    });

    // Default to Amplification window if present, otherwise first
    if (windows && windows.length > 1) {
        const ampIdx = windows.findIndex(w => w.name === "Amplification");
        selectWindow(ampIdx >= 0 ? ampIdx : 0);
    } else {
        // Single window — behave as before
        selectWindow(0);
    }
}

function selectWindow(idx) {
    stopAnimation();
    activeWindowIdx = idx;

    const slider = document.getElementById("cycle-slider");
    const valueEl = document.getElementById("cycle-value");
    const maxEl = document.getElementById("cycle-max");
    const control = document.getElementById("cycle-control");
    const cycleLabel = document.getElementById("cycle-label");
    const sliderRow = control.querySelector(".slider-row");
    const windowSelector = document.getElementById("window-selector");

    // Update active button
    const buttons = windowSelector.querySelectorAll(".window-btn");
    buttons.forEach((btn, i) => btn.classList.toggle("active", i === idx));

    const win = dataWindows ? dataWindows[idx] : null;
    const windowCycles = win ? (win.end_cycle - win.start_cycle + 1) : parseInt(slider.max);

    if (!win) {
        // No window metadata — legacy mode
        control.classList.toggle("hidden", parseInt(slider.max) <= 1);
        return;
    }

    if (windowCycles <= 1) {
        // Single-point window: hide slider row and cycle label
        cycleLabel.classList.add("hidden");
        sliderRow.classList.add("hidden");
        control.classList.remove("hidden");
    } else {
        // Multi-point window: show slider
        cycleLabel.classList.remove("hidden");
        sliderRow.classList.remove("hidden");
        control.classList.remove("hidden");
        slider.min = 1;
        slider.max = windowCycles;
        slider.value = windowCycles;
        valueEl.textContent = windowCycles;
        maxEl.textContent = windowCycles;
    }

    // Hide entire control if single window + single cycle
    if ((!dataWindows || dataWindows.length <= 1) && windowCycles <= 1) {
        control.classList.add("hidden");
    }

    // Trigger data load with absolute cycle
    if (onCycleChange) {
        const absCycle = windowCycles <= 1 ? win.start_cycle : relativeToAbsolute(windowCycles);
        onCycleChange(absCycle);
    }
}

function relativeToAbsolute(relative) {
    if (!dataWindows || !dataWindows[activeWindowIdx]) return relative;
    const win = dataWindows[activeWindowIdx];
    return win.start_cycle + relative - 1;
}

function absoluteToRelative(absolute) {
    if (!dataWindows || !dataWindows[activeWindowIdx]) return absolute;
    const win = dataWindows[activeWindowIdx];
    return absolute - win.start_cycle + 1;
}

function startAnimation(slider, valueEl) {
    const max = parseInt(slider.max);
    let current = parseInt(slider.value);
    if (current >= max) current = 0;

    animTimer = setInterval(() => {
        current++;
        if (current > max) {
            current = 1;
        }
        slider.value = current;
        valueEl.textContent = current;
        if (onCycleChange) onCycleChange(relativeToAbsolute(current));
    }, 500);
}

function stopAnimation() {
    isPlaying = false;
    const playBtn = document.getElementById("play-btn");
    if (playBtn) playBtn.textContent = "\u25B6";
    if (animTimer) {
        clearInterval(animTimer);
        animTimer = null;
    }
}

export function getCurrentCycle() {
    const slider = document.getElementById("cycle-slider");
    return relativeToAbsolute(parseInt(slider.value));
}

export function togglePlay() {
    const playBtn = document.getElementById("play-btn");
    if (playBtn) playBtn.click();
}

export function setCycle(delta) {
    const slider = document.getElementById("cycle-slider");
    if (!slider) return;
    const newVal = Math.max(parseInt(slider.min), Math.min(parseInt(slider.max), parseInt(slider.value) + delta));
    slider.value = newVal;
    slider.dispatchEvent(new Event("input"));
}
