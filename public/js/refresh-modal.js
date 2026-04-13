// refresh-modal.js — Shared "refresh + manual balances" modal used by all pages.
//
// Usage:
//   triggerRefresh(category, triggerBtn, reloadFn)
//     category   – 'liquid' | 'retirement' | null (null = all)
//     triggerBtn – the <button> element that was clicked (disabled during operation)
//     reloadFn   – function to call after a successful save to refresh page data

(function () {
    // ─── Inject modal CSS once ──────────────────────────────────────────────

    const STYLE_ID = 'refresh-modal-styles';
    if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .refresh-balance-modal {
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.5);
                z-index: 2000;
                display: none;
                justify-content: center;
                align-items: center;
                padding: 20px;
            }
            .refresh-balance-modal.show { display: flex; }

            .refresh-balance-content {
                background: white;
                border-radius: 16px;
                max-width: 600px;
                width: 100%;
                max-height: 80vh;
                display: flex;
                flex-direction: column;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            }

            .refresh-balance-header {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 24px;
                border-radius: 16px 16px 0 0;
                position: relative;
            }
            .refresh-balance-header h2 { margin: 0; font-size: 1.5rem; }
            .refresh-balance-header p  { margin: 8px 0 0; opacity: 0.9; font-size: 0.9rem; }

            .refresh-balance-close {
                position: absolute;
                top: 20px; right: 20px;
                background: rgba(255,255,255,0.2);
                border: none;
                color: white;
                width: 32px; height: 32px;
                border-radius: 50%;
                font-size: 1.3rem;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                line-height: 1;
            }
            .refresh-balance-close:hover { background: rgba(255,255,255,0.3); }

            .refresh-balance-body {
                padding: 24px;
                overflow-y: auto;
                flex: 1;
            }

            .refresh-account-item {
                margin-bottom: 24px;
                padding-bottom: 24px;
                border-bottom: 1px solid #e0e0e0;
            }
            .refresh-account-item:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }

            .refresh-account-name    { font-weight: 600; color: #2c3e50; margin-bottom: 4px; }
            .refresh-account-current { color: #7f8c8d; font-size: 0.85rem; margin-bottom: 8px; }

            .refresh-account-input-group { display: flex; gap: 8px; align-items: center; }

            .refresh-account-input {
                flex: 1;
                padding: 10px 12px;
                border: 1px solid #ddd;
                border-radius: 6px;
                font-size: 1rem;
                font-family: monospace;
            }
            .refresh-account-input:focus { outline: none; border-color: #667eea; }

            .refresh-account-currency { color: #7f8c8d; font-size: 0.9rem; font-weight: 600; min-width: 40px; }

            .refresh-liability-help {
                background: #fff3cd;
                border-left: 4px solid #ffc107;
                padding: 12px;
                border-radius: 4px;
                margin-top: 16px;
                font-size: 0.85rem;
                color: #856404;
            }

            .refresh-balance-footer {
                padding: 20px 24px;
                border-top: 1px solid #e0e0e0;
                display: flex;
                gap: 12px;
                justify-content: flex-end;
            }

            .refresh-balance-btn {
                padding: 10px 24px;
                border: none;
                border-radius: 6px;
                font-size: 1rem;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
            }
            .refresh-balance-btn.cancel { background: #f8f9fa; color: #2c3e50; }
            .refresh-balance-btn.cancel:hover { background: #e9ecef; }
            .refresh-balance-btn.save { background: #667eea; color: white; }
            .refresh-balance-btn.save:hover { background: #5568d3; }
            .refresh-balance-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        `;
        document.head.appendChild(style);
    }

    // ─── Inject modal HTML once ─────────────────────────────────────────────

    const MODAL_ID = 'refreshBalanceModal';
    if (!document.getElementById(MODAL_ID)) {
        const modal = document.createElement('div');
        modal.className = 'refresh-balance-modal';
        modal.id = MODAL_ID;
        modal.innerHTML = `
            <div class="refresh-balance-content">
                <div class="refresh-balance-header">
                    <button class="refresh-balance-close" id="closeRefreshModalBtn">×</button>
                    <h2 id="refreshModalTitle">💰 Update Manual Account Balances</h2>
                    <p id="refreshModalSubtitle"></p>
                </div>
                <div class="refresh-balance-body" id="refreshModalBody"></div>
                <div class="refresh-balance-footer">
                    <button class="refresh-balance-btn cancel" id="cancelRefreshModalBtn">Cancel</button>
                    <button class="refresh-balance-btn save"   id="saveRefreshModalBtn">Save Balances</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Wire up close/cancel buttons and Escape key
        document.getElementById('closeRefreshModalBtn').addEventListener('click', _cancelModal);
        document.getElementById('cancelRefreshModalBtn').addEventListener('click', _cancelModal);
        document.getElementById('saveRefreshModalBtn').addEventListener('click', () => saveRefreshBalances());
        modal.addEventListener('click', e => { if (e.target === modal) _cancelModal(); });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && modal.classList.contains('show')) _cancelModal();
        });
    }

    // ─── Module state ───────────────────────────────────────────────────────

    let _triggerBtn   = null;   // button that started the refresh
    let _reloadFn     = null;   // page-specific data reload function
    let _plaidPromise = null;   // background Plaid refresh promise
    let _plaidResult  = null;   // resolved Plaid result (stored for save step)

    // ─── Public API ─────────────────────────────────────────────────────────

    /**
     * Kick off a scoped refresh:
     *   1. Fetch manual accounts for the given category (or all).
     *   2. Fire the Plaid refresh in the background.
     *   3. If there are manual accounts, show the modal immediately.
     *      Otherwise wait for Plaid and show a success alert.
     *
     * @param {string|null} category  'liquid' | 'retirement' | null
     * @param {HTMLElement} triggerBtn  The button that was clicked.
     * @param {Function}    reloadFn    Called after a successful save.
     */
    window.triggerRefresh = async function (category, triggerBtn, reloadFn) {
        _triggerBtn  = triggerBtn;
        _reloadFn    = reloadFn;
        _plaidResult = null;

        const originalLabel = triggerBtn.textContent;
        triggerBtn.disabled = true;
        triggerBtn.textContent = '⏳ Refreshing...';

        try {
            // Step 1 — fetch manual accounts for this scope (fast)
            const manualUrl = category
                ? `/api/manual_accounts?category=${category}`
                : '/api/manual_accounts';
            const manualAccounts = await fetch(manualUrl).then(r => r.json());

            // Step 2 — fire Plaid refresh in background
            const body = category ? { category } : {};
            _plaidPromise = fetch('/api/refresh_balances', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }).then(r => r.json());

            if (manualAccounts.length > 0) {
                // Step 3a — show manual modal immediately (Plaid still running)
                const rateData = await fetch('/api/exchange_rate').then(r => r.json());
                const today = new Date().toLocaleDateString('en-CA');
                _showModal(manualAccounts, today, rateData.rate, category);

                // Store Plaid result when it lands
                _plaidPromise
                    .then(result  => { _plaidResult = result; })
                    .catch(err    => { console.error('Background Plaid refresh failed:', err); });
            } else {
                // Step 3b — no manual accounts, just wait for Plaid
                const result = await _plaidPromise;
                _restoreButton(originalLabel);
                if (result.success) {
                    _showSuccess(result);
                    reloadFn();
                } else {
                    alert('❌ Plaid refresh failed.');
                }
            }
        } catch (err) {
            alert('❌ Error: ' + err.message);
            _restoreButton(originalLabel);
        }
    };

    // ─── Modal internals ────────────────────────────────────────────────────

    const TITLES = {
        liquid:     '💰 Update Manual Cash Balances',
        retirement: '💰 Update Manual Retirement Balances',
        null:       '💰 Update Manual Account Balances',
    };

    function _showModal(accounts, date, exchangeRate, category) {
        const modal    = document.getElementById(MODAL_ID);
        const body     = document.getElementById('refreshModalBody');
        const title    = document.getElementById('refreshModalTitle');
        const subtitle = document.getElementById('refreshModalSubtitle');
        const saveBtn  = document.getElementById('saveRefreshModalBtn');

        title.textContent    = TITLES[category] ?? TITLES[null];
        subtitle.textContent = `Date: ${date}  |  Exchange Rate: ${parseFloat(exchangeRate).toFixed(4)}`;

        saveBtn.disabled    = false;
        saveBtn.textContent = 'Save Balances';

        body.innerHTML = '';
        let hasLiabilities = false;

        accounts.forEach(account => {
            if (account.is_liability) hasLiabilities = true;

            const lastBalance = account.last_balance !== null
                ? Math.abs(parseFloat(account.last_balance))
                : '';

            const item = document.createElement('div');
            item.className = 'refresh-account-item';

            const nameEl = document.createElement('div');
            nameEl.className = 'refresh-account-name';
            nameEl.textContent = account.account_name;

            const currentEl = document.createElement('div');
            currentEl.className = 'refresh-account-current';
            currentEl.textContent = [
                account.account_type,
                account.currency,
                account.last_balance !== null
                    ? `Current: ${_formatCurrency(account.last_balance, account.currency)}`
                    : null,
            ].filter(Boolean).join(' • ');

            const inputGroup = document.createElement('div');
            inputGroup.className = 'refresh-account-input-group';

            const input = document.createElement('input');
            input.type = 'number';
            input.step = '0.01';
            input.className = 'refresh-account-input';
            input.dataset.accountId  = account.id;
            input.dataset.isLiability = account.is_liability;
            input.value = lastBalance;
            input.placeholder = 'Enter balance';

            const currencyEl = document.createElement('span');
            currencyEl.className = 'refresh-account-currency';
            currencyEl.textContent = account.currency;

            inputGroup.appendChild(input);
            inputGroup.appendChild(currencyEl);
            item.appendChild(nameEl);
            item.appendChild(currentEl);
            item.appendChild(inputGroup);
            body.appendChild(item);
        });

        if (hasLiabilities) {
            const help = document.createElement('div');
            help.className = 'refresh-liability-help';
            help.innerHTML = 'ℹ️ <strong>Liability accounts:</strong> Enter positive numbers (e.g. 15606.10). They will be saved as negative automatically.';
            body.appendChild(help);
        }

        modal.classList.add('show');
    }

    function _cancelModal() {
        document.getElementById(MODAL_ID).classList.remove('show');

        // Still wait for Plaid and show success if it lands
        if (_plaidPromise) {
            _plaidPromise
                .then(result => {
                    if (result.success) { _showSuccess(result); _reloadFn?.(); }
                })
                .catch(err => console.error('Plaid refresh error:', err));
        }

        if (_triggerBtn) _restoreButton(_triggerBtn._originalLabel ?? '🔄 Refresh');
    }

    // ─── Save handler ───────────────────────────────────────────────────────

    window.saveRefreshBalances = async function () {
        const saveBtn   = document.getElementById('saveRefreshModalBtn');
        const cancelBtn = document.getElementById('cancelRefreshModalBtn');

        saveBtn.disabled   = true;
        cancelBtn.disabled = true;

        const inputs = document.querySelectorAll(`#${MODAL_ID} .refresh-account-input`);
        const manualBalances = {};

        inputs.forEach(input => {
            const val = input.value.trim();
            if (val !== '') manualBalances[input.dataset.accountId] = val;
        });

        try {
            // Wait for Plaid to finish first
            saveBtn.textContent = 'Waiting for Plaid...';
            const plaidResult = await _plaidPromise;

            if (!plaidResult.success) {
                alert('❌ Plaid refresh failed. Manual balances not saved.');
                saveBtn.disabled   = false;
                cancelBtn.disabled = false;
                saveBtn.textContent = 'Save Balances';
                return;
            }

            // Save manual balances
            saveBtn.textContent = 'Saving...';
            const res = await fetch('/api/refresh_balances', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ manualBalances }),
            });
            const result = await res.json();

            if (result.success) {
                document.getElementById(MODAL_ID).classList.remove('show');
                _showSuccess({
                    success: true,
                    accountsUpdated: plaidResult.accountsUpdated + result.manualAccountsUpdated,
                    date: result.date,
                    exchangeRate: result.exchangeRate,
                });
                _reloadFn?.();
            } else {
                alert('❌ Failed to save manual balances.');
                saveBtn.disabled   = false;
                cancelBtn.disabled = false;
                saveBtn.textContent = 'Save Balances';
            }
        } catch (err) {
            alert('❌ Error: ' + err.message);
            saveBtn.disabled   = false;
            cancelBtn.disabled = false;
            saveBtn.textContent = 'Save Balances';
        } finally {
            cancelBtn.disabled = false;
            if (_triggerBtn) _restoreButton(_triggerBtn._originalLabel ?? '🔄 Refresh');
        }
    };

    // ─── Helpers ────────────────────────────────────────────────────────────

    function _restoreButton(label) {
        if (_triggerBtn) {
            _triggerBtn.disabled    = false;
            _triggerBtn.textContent = label;
        }
    }

    function _showSuccess(result) {
        alert(
            `✅ Successfully refreshed ${result.accountsUpdated} accounts!\n\n` +
            `Date: ${result.date}\n` +
            `Exchange Rate: ${parseFloat(result.exchangeRate).toFixed(4)}`
        );
    }

    function _formatCurrency(amount, currency = 'CAD') {
        return new Intl.NumberFormat('en-CA', {
            style: 'currency',
            currency,
            minimumFractionDigits: 2,
        }).format(amount);
    }
})();
