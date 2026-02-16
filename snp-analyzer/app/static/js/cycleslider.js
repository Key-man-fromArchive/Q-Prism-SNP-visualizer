let isPlaying = false;
let animTimer = null;
let onCycleChange = null;

export function initCycleSlider(maxCycle, callback) {
    onCycleChange = callback;
    const slider = document.getElementById("cycle-slider");
    const valueEl = document.getElementById("cycle-value");
    const maxEl = document.getElementById("cycle-max");
    const playBtn = document.getElementById("play-btn");

    slider.min = 1;
    slider.max = maxCycle;
    slider.value = maxCycle;
    valueEl.textContent = maxCycle;
    maxEl.textContent = maxCycle;

    // Hide slider if only 1 cycle
    const control = document.getElementById("cycle-control");
    if (maxCycle <= 1) {
        control.classList.add("hidden");
    } else {
        control.classList.remove("hidden");
    }

    let debounceTimer = null;
    slider.addEventListener("input", () => {
        valueEl.textContent = slider.value;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            if (onCycleChange) onCycleChange(parseInt(slider.value));
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
        if (onCycleChange) onCycleChange(current);
    }, 500);
}

function stopAnimation() {
    if (animTimer) {
        clearInterval(animTimer);
        animTimer = null;
    }
}

export function getCurrentCycle() {
    return parseInt(document.getElementById("cycle-slider").value);
}
