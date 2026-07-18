let linkHandler = null;

// Load connected banks on page load
document.addEventListener('DOMContentLoaded', function () {
    loadConnectedBanks();
});

// ─── Data loading ──────────────────────────────────────────────────────────

async function loadConnectedBanks() {
    try {
        const response = await fetch('/api/accounts');
        const accounts = await response.json();

        if (!accounts.length) return;

        // Split into Plaid-managed vs manually-tracked
        const plaidAccounts   = accounts.filter(a => a.is_plaid_connected && a.is_active);
        const manualAccounts  = accounts.filter(a => !a.is_plaid_connected && a.is_active);

        renderPlaidInstitutions(plaidAccounts);
        renderManualAccounts(manualAccounts);

    } catch (error) {
        console.error('Error loading connected banks:', error);
    }
}

// ─── Plaid institutions ────────────────────────────────────────────────────

function renderPlaidInstitutions(accounts) {
    if (!accounts.length) return;

    // Group by institution name, preserving server sort order.
    // Also capture the plaid_item_id for the "Fix connection" button.
    const groups = new Map();
    accounts.forEach(acc => {
        if (!groups.has(acc.institution_name)) {
            groups.set(acc.institution_name, {
                plaid_item_id:  acc.plaid_item_id || null,
                login_required: false,
                sync_paused:    false,
                sync_paused_at: null,
                accounts: [],
            });
        }
        const g = groups.get(acc.institution_name);
        if (acc.login_required) g.login_required = true;
        if (acc.sync_paused) {
            g.sync_paused = true;
            g.sync_paused_at = acc.sync_paused_at || null;
        }
        g.accounts.push(acc);
    });

    const list = document.getElementById('banksList');
    list.innerHTML = '';

    groups.forEach((info, institution) => {
        list.appendChild(buildInstitutionGroup(institution, info));
    });

    document.getElementById('connectedBanks').style.display = 'block';
}

// ─── Manual accounts ───────────────────────────────────────────────────────

function renderManualAccounts(accounts) {
    if (!accounts.length) return;

    // Group by institution name (manual accounts can share an institution label)
    const groups = new Map();
    accounts.forEach(acc => {
        if (!groups.has(acc.institution_name)) {
            groups.set(acc.institution_name, {
                plaid_item_id:  null,
                login_required: false,
                sync_paused:    false,
                sync_paused_at: null,
                accounts: [],
            });
        }
        groups.get(acc.institution_name).accounts.push(acc);
    });

    const list = document.getElementById('manualList');
    list.innerHTML = '';

    groups.forEach((info, institution) => {
        list.appendChild(buildInstitutionGroup(institution, info));
    });

    document.getElementById('manualSection').style.display = 'block';
}

// ─── DOM builders ──────────────────────────────────────────────────────────

/**
 * Builds a collapsible institution group containing its account rows.
 * Works for both Plaid and manual institutions.
 */
function buildInstitutionGroup(institutionName, info) {
    const group = document.createElement('div');
    group.className = 'institution-group';

    // ── Header ──────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'institution-header';

    const countLabel = `${info.accounts.length} account${info.accounts.length !== 1 ? 's' : ''}`;
    const chevronId  = `chevron-${institutionName.replace(/\s+/g, '-')}`;

    // Badge priority: paused > login required > account count.
    // While paused, the fix button is hidden — re-auth only matters once
    // syncing resumes.
    let badgeHtml;
    if (info.sync_paused) {
        const since = info.sync_paused_at
            ? ` since ${new Date(info.sync_paused_at).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' })}`
            : '';
        badgeHtml = `<span class="sync-paused-badge">Paused${since} - manual updates</span>`;
    } else if (info.login_required) {
        badgeHtml = '<span class="login-required-badge">Login required</span>';
    } else {
        badgeHtml = `<span class="account-count-badge">${countLabel}</span>`;
    }

    header.innerHTML = `
        <div class="institution-header-left">
            <span class="institution-name">${institutionName}</span>
        </div>
        <div class="institution-header-right">
            ${badgeHtml}
            ${info.login_required && !info.sync_paused && info.plaid_item_id
                ? `<button class="fix-button"
                       data-item-id="${info.plaid_item_id}"
                       data-institution="${institutionName}">Fix connection</button>`
                : ''}
            ${info.plaid_item_id
                ? `<button class="sync-toggle-button"
                       data-item-id="${info.plaid_item_id}"
                       data-paused="${info.sync_paused}">${info.sync_paused ? 'Resume sync' : 'Pause sync'}</button>`
                : ''}
            <span class="chevron" id="${chevronId}">▼</span>
        </div>
    `;

    // Toggle expansion on header click (but not on the buttons)
    header.addEventListener('click', e => {
        if (e.target.classList.contains('fix-button')) return;
        if (e.target.classList.contains('sync-toggle-button')) return;
        const body    = group.querySelector('.institution-accounts');
        const chevron = group.querySelector('.chevron');
        const isOpen  = !body.classList.contains('collapsed');
        body.classList.toggle('collapsed', isOpen);
        chevron.classList.toggle('open', !isOpen);
    });

    // ── Fix-connection button handler ────────────────────────────────────
    const fixBtn = header.querySelector('.fix-button');
    if (fixBtn) {
        fixBtn.addEventListener('click', () => {
            initializePlaidUpdateMode(fixBtn.dataset.itemId, fixBtn.dataset.institution, fixBtn);
        });
    }

    // ── Pause/resume sync button handler ─────────────────────────────────
    const syncBtn = header.querySelector('.sync-toggle-button');
    if (syncBtn) {
        syncBtn.addEventListener('click', () => {
            toggleSyncPaused(syncBtn.dataset.itemId, syncBtn.dataset.paused !== 'true', syncBtn);
        });
    }

    // ── Account rows ─────────────────────────────────────────────────────
    const body = document.createElement('div');
    body.className = 'institution-accounts'; // open by default

    info.accounts.forEach(acc => {
        body.appendChild(buildAccountRow(acc));
    });

    group.appendChild(header);
    group.appendChild(body);
    return group;
}

/**
 * Builds a single account row showing name, type, currency, category, and mask.
 */
function buildAccountRow(acc) {
    const row = document.createElement('div');
    row.className = 'account-row';

    const currencyClass = acc.currency === 'CAD' ? 'cad' : 'usd';
    const maskHtml = acc.account_mask
        ? `<span class="account-mask">····${acc.account_mask}</span>`
        : '';
    const categoryHtml = acc.account_category === 'retirement'
        ? '<span class="category-badge">Retirement</span>'
        : '';

    row.innerHTML = `
        <div class="account-row-left">
            <span class="account-name">${acc.account_name}</span>
            <div class="account-meta">
                <span class="type-tag">${acc.account_type}</span>
                <span class="currency-badge ${currencyClass}">${acc.currency}</span>
                ${categoryHtml}
                ${maskHtml}
            </div>
        </div>
    `;

    return row;
}

// ─── Pause/resume Plaid sync ───────────────────────────────────────────────

async function toggleSyncPaused(plaidItemId, pause, btn) {
    const confirmMsg = pause
        ? 'Pause Plaid syncing for this institution? Its accounts will be updated manually via the Refresh flow until you resume.'
        : 'Resume Plaid syncing for this institution? Its accounts will be updated automatically again.';
    if (!confirm(confirmMsg)) return;

    btn.disabled = true;

    try {
        const response = await fetch('/api/set_sync_paused', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ plaid_item_id: plaidItemId, sync_paused: pause }),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to update sync setting');

        loadConnectedBanks();
    } catch (error) {
        console.error('Error toggling sync:', error);
        alert('Error: ' + error.message);
        btn.disabled = false;
    }
}

// ─── Plaid update mode ─────────────────────────────────────────────────────

async function initializePlaidUpdateMode(plaidItemId, institution, btn) {
    btn.disabled  = true;
    btn.textContent = 'Loading...';

    try {
        const response = await fetch('/api/create_link_token_update', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ plaid_item_id: plaidItemId }),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to create update token');

        const handler = Plaid.create({
            token: data.link_token,
            onSuccess: async (_public_token, _metadata) => {
                await fetch('/api/clear_item_error', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ plaid_item_id: plaidItemId }),
                });

                const msg = document.getElementById('successMessage');
                msg.innerHTML = `<strong>✅ ${institution} reconnected successfully!</strong><br>Your connection has been restored.`;
                msg.classList.add('show');

                loadConnectedBanks();
            },
            onExit: (err) => {
                if (err != null) console.error('Link exit with error:', err);
                btn.disabled    = false;
                btn.textContent = 'Fix connection';
            },
        });

        handler.open();
    } catch (error) {
        console.error('Error initializing update mode:', error);
        alert('Error: ' + error.message);
        btn.disabled    = false;
        btn.textContent = 'Fix connection';
    }
}

// ─── Plaid Link (new connection) ───────────────────────────────────────────

async function initializePlaidLink() {
    try {
        const response = await fetch('/api/create_link_token', { method: 'POST' });
        const data     = await response.json();

        linkHandler = Plaid.create({
            token: data.link_token,
            onSuccess: async (public_token) => {
                const linkBtn = document.getElementById('linkButton');
                linkBtn.disabled    = true;
                linkBtn.textContent = 'Connecting...';

                const exchangeResponse = await fetch('/api/exchange_public_token', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ public_token }),
                });

                if (exchangeResponse.ok) {
                    const msg = document.getElementById('successMessage');
                    msg.innerHTML = '<strong>✅ Bank connected successfully!</strong><br>Your accounts have been added to the database.';
                    msg.classList.add('show');
                    linkBtn.textContent = 'Connect Another Bank';
                    linkBtn.disabled    = false;
                    loadConnectedBanks();
                } else {
                    alert('Error connecting bank. Please try again.');
                    linkBtn.disabled    = false;
                    linkBtn.textContent = 'Connect Bank Account';
                }
            },
            onExit: (err) => {
                if (err != null) console.error('Link exit with error:', err);
                document.getElementById('linkButton').disabled = false;
            },
        });
    } catch (error) {
        console.error('Error initializing Plaid Link:', error);
        alert('Error: ' + error.message);
    }
}

document.getElementById('linkButton').addEventListener('click', () => {
    if (linkHandler) {
        linkHandler.open();
    } else {
        initializePlaidLink().then(() => linkHandler.open());
    }
});
