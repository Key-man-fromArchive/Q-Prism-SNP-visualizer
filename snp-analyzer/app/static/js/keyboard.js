// Keyboard shortcuts module for SNP Discrimination Analyzer
// Provides keyboard navigation and shortcuts help overlay

let helpOverlay = null;
let callbacks = {};

/**
 * Initialize keyboard shortcuts
 * @param {Object} callbacksObj - Object containing callback functions
 * @param {Function} callbacksObj.togglePlay - Space key - Toggle cycle animation
 * @param {Function} callbacksObj.prevCycle - Left arrow - Previous cycle
 * @param {Function} callbacksObj.nextCycle - Right arrow - Next cycle
 * @param {Function} callbacksObj.exportCSV - Ctrl+E - Export results to CSV
 * @param {Function} callbacksObj.toggleDarkMode - D key - Toggle dark/light mode
 * @param {Function} callbacksObj.assignWellType - 1-7 keys - Assign well type to selected wells
 */
export function initKeyboard(callbacksObj) {
    callbacks = callbacksObj;

    document.addEventListener('keydown', handleKeyDown);

    // Auto-dismiss help on scroll
    window.addEventListener('scroll', () => {
        if (helpOverlay && helpOverlay.style.display !== 'none') {
            hideShortcutsHelp();
        }
    });
}

function handleKeyDown(e) {
    // Skip if user is typing in an input/textarea/select
    const target = e.target;
    if (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT') {
        return;
    }

    // Skip if any modifier key is pressed (except Ctrl+E)
    const hasModifier = e.altKey || e.shiftKey || e.metaKey;
    if (hasModifier && !(e.key === 'e' && (e.ctrlKey || e.metaKey))) {
        return;
    }

    switch(e.key) {
        case ' ':
            e.preventDefault();
            callbacks.togglePlay?.();
            break;

        case 'ArrowLeft':
            e.preventDefault();
            callbacks.prevCycle?.();
            break;

        case 'ArrowRight':
            e.preventDefault();
            callbacks.nextCycle?.();
            break;

        case 'e':
        case 'E':
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                callbacks.exportCSV?.();
            }
            break;

        case 'd':
        case 'D':
            if (!e.ctrlKey && !e.metaKey) {
                callbacks.toggleDarkMode?.();
            }
            break;

        case '1':
            callbacks.assignWellType?.('NTC');
            break;

        case '2':
            callbacks.assignWellType?.('Unknown');
            break;

        case '3':
            callbacks.assignWellType?.('Positive Control');
            break;

        case '4':
            callbacks.assignWellType?.('Allele 1 Homo');
            break;

        case '5':
            callbacks.assignWellType?.('Allele 2 Homo');
            break;

        case '6':
            callbacks.assignWellType?.('Heterozygous');
            break;

        case '7':
            callbacks.assignWellType?.('Undetermined');
            break;

        case '?':
        case '/':
            if (e.shiftKey || e.key === '?') {
                e.preventDefault();
                toggleShortcutsHelp();
            }
            break;

        case 'Escape':
            if (helpOverlay && helpOverlay.style.display !== 'none') {
                e.preventDefault();
                hideShortcutsHelp();
            }
            break;
    }
}

/**
 * Show keyboard shortcuts help overlay
 */
export function showShortcutsHelp() {
    if (!helpOverlay) {
        createHelpOverlay();
    }

    helpOverlay.style.display = 'flex';
    // Focus the overlay for accessibility
    helpOverlay.focus();
}

/**
 * Hide keyboard shortcuts help overlay
 */
export function hideShortcutsHelp() {
    if (helpOverlay) {
        helpOverlay.style.display = 'none';
    }
}

/**
 * Toggle keyboard shortcuts help overlay
 */
function toggleShortcutsHelp() {
    if (helpOverlay && helpOverlay.style.display !== 'none') {
        hideShortcutsHelp();
    } else {
        showShortcutsHelp();
    }
}

/**
 * Create the help overlay DOM element
 */
function createHelpOverlay() {
    // Create overlay backdrop
    helpOverlay = document.createElement('div');
    helpOverlay.className = 'keyboard-help-overlay';
    helpOverlay.tabIndex = -1; // Make focusable

    // Create help panel
    const helpPanel = document.createElement('div');
    helpPanel.className = 'keyboard-help-panel';

    // Header
    const header = document.createElement('div');
    header.className = 'keyboard-help-header';
    header.innerHTML = `
        <h2>Keyboard Shortcuts</h2>
        <button class="keyboard-help-close" aria-label="Close shortcuts help">&times;</button>
    `;

    // Content
    const content = document.createElement('div');
    content.className = 'keyboard-help-content';
    content.innerHTML = `
        <div class="keyboard-help-section">
            <h3>Navigation</h3>
            <div class="keyboard-help-shortcuts">
                <div class="keyboard-help-item">
                    <kbd>Space</kbd>
                    <span>Toggle cycle animation</span>
                </div>
                <div class="keyboard-help-item">
                    <kbd>←</kbd>
                    <span>Previous cycle</span>
                </div>
                <div class="keyboard-help-item">
                    <kbd>→</kbd>
                    <span>Next cycle</span>
                </div>
            </div>
        </div>

        <div class="keyboard-help-section">
            <h3>Actions</h3>
            <div class="keyboard-help-shortcuts">
                <div class="keyboard-help-item">
                    <kbd>Ctrl</kbd> + <kbd>E</kbd>
                    <span>Export results to CSV</span>
                </div>
                <div class="keyboard-help-item">
                    <kbd>D</kbd>
                    <span>Toggle dark mode</span>
                </div>
            </div>
        </div>

        <div class="keyboard-help-section">
            <h3>Well Type Assignment</h3>
            <div class="keyboard-help-shortcuts">
                <div class="keyboard-help-item">
                    <kbd>1</kbd>
                    <span>NTC (No Template Control)</span>
                </div>
                <div class="keyboard-help-item">
                    <kbd>2</kbd>
                    <span>Unknown</span>
                </div>
                <div class="keyboard-help-item">
                    <kbd>3</kbd>
                    <span>Positive Control</span>
                </div>
                <div class="keyboard-help-item">
                    <kbd>4</kbd>
                    <span>Allele 1 Homozygous</span>
                </div>
                <div class="keyboard-help-item">
                    <kbd>5</kbd>
                    <span>Allele 2 Homozygous</span>
                </div>
                <div class="keyboard-help-item">
                    <kbd>6</kbd>
                    <span>Heterozygous</span>
                </div>
                <div class="keyboard-help-item">
                    <kbd>7</kbd>
                    <span>Undetermined</span>
                </div>
            </div>
        </div>

        <div class="keyboard-help-section">
            <h3>Help</h3>
            <div class="keyboard-help-shortcuts">
                <div class="keyboard-help-item">
                    <kbd>?</kbd>
                    <span>Show/hide this help</span>
                </div>
                <div class="keyboard-help-item">
                    <kbd>Esc</kbd>
                    <span>Close this help</span>
                </div>
            </div>
        </div>
    `;

    // Footer
    const footer = document.createElement('div');
    footer.className = 'keyboard-help-footer';
    footer.innerHTML = `
        <p class="keyboard-help-tip">💡 Tip: Select wells in the scatter plot or plate view before using well type shortcuts</p>
    `;

    helpPanel.appendChild(header);
    helpPanel.appendChild(content);
    helpPanel.appendChild(footer);
    helpOverlay.appendChild(helpPanel);

    // Add styles
    addHelpStyles();

    // Event listeners
    const closeBtn = header.querySelector('.keyboard-help-close');
    closeBtn.addEventListener('click', hideShortcutsHelp);

    // Close on overlay click (but not panel click)
    helpOverlay.addEventListener('click', (e) => {
        if (e.target === helpOverlay) {
            hideShortcutsHelp();
        }
    });

    // Close on Escape key
    helpOverlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            hideShortcutsHelp();
        }
    });

    // Append to body
    document.body.appendChild(helpOverlay);
}

/**
 * Add CSS styles for the help overlay
 */
function addHelpStyles() {
    if (document.getElementById('keyboard-help-styles')) {
        return; // Styles already added
    }

    const style = document.createElement('style');
    style.id = 'keyboard-help-styles';
    style.textContent = `
        .keyboard-help-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(4px);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            animation: keyboard-help-fade-in 0.2s ease-out;
        }

        @keyframes keyboard-help-fade-in {
            from {
                opacity: 0;
            }
            to {
                opacity: 1;
            }
        }

        .keyboard-help-panel {
            background: var(--surface, #ffffff);
            border: 1px solid var(--border, #e0e4e8);
            border-radius: 12px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            max-width: 600px;
            width: 90%;
            max-height: 85vh;
            overflow-y: auto;
            animation: keyboard-help-slide-up 0.3s ease-out;
        }

        @keyframes keyboard-help-slide-up {
            from {
                transform: translateY(20px);
                opacity: 0;
            }
            to {
                transform: translateY(0);
                opacity: 1;
            }
        }

        .keyboard-help-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 20px 24px;
            border-bottom: 1px solid var(--border, #e0e4e8);
            position: sticky;
            top: 0;
            background: var(--surface, #ffffff);
            z-index: 1;
        }

        .keyboard-help-header h2 {
            font-size: 20px;
            font-weight: 600;
            color: var(--text, #1a1a2e);
            margin: 0;
        }

        .keyboard-help-close {
            background: none;
            border: none;
            font-size: 28px;
            line-height: 1;
            color: var(--text-muted, #6b7280);
            cursor: pointer;
            padding: 0;
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 6px;
            transition: all 0.2s;
        }

        .keyboard-help-close:hover {
            background: var(--border, #e0e4e8);
            color: var(--text, #1a1a2e);
        }

        .keyboard-help-content {
            padding: 24px;
        }

        .keyboard-help-section {
            margin-bottom: 28px;
        }

        .keyboard-help-section:last-child {
            margin-bottom: 0;
        }

        .keyboard-help-section h3 {
            font-size: 14px;
            font-weight: 600;
            color: var(--text-muted, #6b7280);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin: 0 0 12px 0;
        }

        .keyboard-help-shortcuts {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .keyboard-help-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 8px 0;
        }

        .keyboard-help-item kbd {
            display: inline-block;
            padding: 4px 8px;
            font-family: 'Courier New', monospace;
            font-size: 13px;
            font-weight: 600;
            color: var(--text, #1a1a2e);
            background: var(--bg, #f5f7fa);
            border: 1px solid var(--border, #e0e4e8);
            border-radius: 4px;
            box-shadow: 0 2px 0 var(--border, #e0e4e8);
            min-width: 32px;
            text-align: center;
        }

        .keyboard-help-item span {
            color: var(--text, #1a1a2e);
            font-size: 14px;
        }

        .keyboard-help-footer {
            padding: 16px 24px;
            border-top: 1px solid var(--border, #e0e4e8);
            background: var(--bg, #f5f7fa);
        }

        .keyboard-help-tip {
            margin: 0;
            font-size: 13px;
            color: var(--text-muted, #6b7280);
            line-height: 1.5;
        }

        /* Responsive */
        @media (max-width: 640px) {
            .keyboard-help-panel {
                width: 95%;
                max-height: 90vh;
            }

            .keyboard-help-header {
                padding: 16px;
            }

            .keyboard-help-content {
                padding: 16px;
            }

            .keyboard-help-item {
                flex-direction: column;
                align-items: flex-start;
                gap: 4px;
            }
        }
    `;

    document.head.appendChild(style);
}

/**
 * Cleanup function to remove event listeners
 */
export function cleanup() {
    document.removeEventListener('keydown', handleKeyDown);
    if (helpOverlay && helpOverlay.parentNode) {
        helpOverlay.parentNode.removeChild(helpOverlay);
        helpOverlay = null;
    }
}
