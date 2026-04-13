// dark-mode.js — Shared dark mode utility.
// Placed as the first <script> inside <body> so the class is applied before
// the page renders, preventing a flash of the wrong theme.
//
// Exposes:
//   window.toggleDarkMode()  — called by the toggle button on each page
//   window.applyTheme(theme) — 'dark' | 'light'

(function () {
    const STORAGE_KEY = 'theme';
    const DARK_CLASS  = 'dark';
    const ICON_DARK   = '🌙';
    const ICON_LIGHT  = '☀️';

    // Apply the persisted theme immediately (before DOM is ready) to prevent FOUC
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark') {
        document.body.classList.add(DARK_CLASS);
    }

    function _updateButtonIcon() {
        const btn = document.getElementById('darkModeToggleBtn');
        if (!btn) return;
        const isDark = document.body.classList.contains(DARK_CLASS);
        btn.textContent = isDark ? ICON_LIGHT : ICON_DARK;
        btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
    }

    window.applyTheme = function (theme) {
        if (theme === 'dark') {
            document.body.classList.add(DARK_CLASS);
            localStorage.setItem(STORAGE_KEY, 'dark');
        } else {
            document.body.classList.remove(DARK_CLASS);
            localStorage.setItem(STORAGE_KEY, 'light');
        }
        _updateButtonIcon();
    };

    window.toggleDarkMode = function () {
        const isDark = document.body.classList.contains(DARK_CLASS);
        window.applyTheme(isDark ? 'light' : 'dark');
    };

    // Once the DOM is ready, sync the button icon to the current state
    document.addEventListener('DOMContentLoaded', _updateButtonIcon);
})();
