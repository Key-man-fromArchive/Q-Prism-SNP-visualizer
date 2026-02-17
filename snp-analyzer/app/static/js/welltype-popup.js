import { WELL_TYPES } from "./welltypes.js";
import { setManualWellTypes } from "./clustering.js";

let onPopupOutsideClick = null;

export function showWellTypePopup(x, y, wells, sessionId, onDone) {
    removePopup();

    const popup = document.createElement("div");
    popup.className = "welltype-popup";
    popup.innerHTML = `<div class="welltype-popup-header">Assign type to ${wells.length} well${wells.length > 1 ? "s" : ""}</div>`;

    for (const [type, info] of Object.entries(WELL_TYPES)) {
        const btn = document.createElement("button");
        btn.className = "welltype-btn";
        btn.style.borderLeftColor = info.color;
        btn.textContent = info.label;
        btn.addEventListener("click", async () => {
            if (sessionId) {
                await setManualWellTypes(sessionId, wells, type);
            }
            removePopup();
            if (onDone) onDone();
        });
        popup.appendChild(btn);
    }

    // Cancel button
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "welltype-btn welltype-cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => {
        removePopup();
        if (onDone) onDone();
    });
    popup.appendChild(cancelBtn);

    // Position popup
    popup.style.left = Math.min(x, window.innerWidth - 220) + "px";
    popup.style.top = Math.min(y, window.innerHeight - 300) + "px";

    document.body.appendChild(popup);

    // Close on outside click
    setTimeout(() => {
        onPopupOutsideClick = (e) => {
            const p = document.querySelector(".welltype-popup");
            if (p && !p.contains(e.target)) {
                removePopup();
                if (onDone) onDone();
            }
        };
        document.addEventListener("mousedown", onPopupOutsideClick);
    }, 50);
}

export function removePopup() {
    const popup = document.querySelector(".welltype-popup");
    if (popup) popup.remove();
    if (onPopupOutsideClick) {
        document.removeEventListener("mousedown", onPopupOutsideClick);
        onPopupOutsideClick = null;
    }
}
