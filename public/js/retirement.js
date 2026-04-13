// retirement.js — Retirement accounts dashboard

// ─── Auth guard + event wiring ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
    setupModalEventListeners();

    fetch('/api/check-auth')
        .then(r => r.json())
        .then(data => {
            if (!data.authenticated) {
                window.location.href = '/login.html';
            } else {
                loadRetirementDashboard();
            }
        })
        .catch(() => {
            window.location.href = '/login.html';
        });
});

// ─── Constants ─────────────────────────────────────────────────────────────

// Human-readable labels for each supported retirement account type.
const RETIREMENT_TYPE_LABELS = {
    '401k':       '401(k)',
    '401a':       '401(a)',
    '403b':       '403(b)',
    '457b':       '457(b)',
    'ira':        'IRA',
    'roth':       'Roth IRA',   // Plaid subtype for Roth IRA
    'roth_ira':   'Roth IRA',   // alias used in seed data / manual accounts
    'roth 401k':  'Roth 401(k)',
    'rrsp':       'RRSP',
    'tfsa':       'TFSA',
    'lira':       'LIRA',
    'rrif':       'RRIF',
    'resp':       'RESP',
    'pension':    'Pension',
    'retirement': 'Retirement',
};

// CSS class suffix applied to account-type tag badges.
const RETIREMENT_TYPE_TAG_CLASS = {
    '401k':       'tag-401k',
    '401a':       'tag-401k',
    '403b':       'tag-401k',
    '457b':       'tag-401k',
    'ira':        'tag-ira',
    'roth':       'tag-ira',
    'roth_ira':   'tag-ira',
    'roth 401k':  'tag-ira',
    'rrsp':       'tag-rrsp',
    'tfsa':       'tag-tfsa',
    'lira':       'tag-lira',
    'rrif':       'tag-lira',
    'resp':       'tag-tfsa',
    'pension':    'tag-pension',
    'retirement': 'tag-pension',
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatCAD(amount) {
    return new Intl.NumberFormat('en-CA', {
        style: 'currency',
        currency: 'CAD',
        minimumFractionDigits: 2,
    }).format(amount);
}

function formatNative(amount, currency) {
    return new Intl.NumberFormat('en-CA', {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: 2,
    }).format(amount);
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-CA', {
        year: 'numeric', month: 'short', day: 'numeric',
    });
}

function typeLabel(accountType) {
    return RETIREMENT_TYPE_LABELS[accountType] || accountType.toUpperCase();
}

function typeTagClass(accountType) {
    return RETIREMENT_TYPE_TAG_CLASS[accountType] || 'tag-other';
}

// ─── Data loading ──────────────────────────────────────────────────────────

async function loadRetirementDashboard() {
    try {
        const [summaryData, balancesData] = await Promise.all([
            fetch('/api/retirement_summary').then(r => {
                if (!r.ok) throw new Error('retirement_summary failed');
                return r.json();
            }),
            fetch('/api/retirement_balances').then(r => {
                if (!r.ok) throw new Error('retirement_balances failed');
                return r.json();
            }),
        ]);

        renderSummaryCards(summaryData);
        renderAccountBalances(balancesData);
        await renderTrendChart('90d');
        setupChartButtons();
    } catch (error) {
        console.error('Error loading retirement dashboard:', error);
        document.getElementById('summaryPanel').innerHTML =
            '<p style="color:#e74c3c;padding:20px;">Failed to load retirement data. Please refresh the page.</p>';
    }
}

// ─── Summary cards ─────────────────────────────────────────────────────────

function renderSummaryCards(data) {
    const panel = document.getElementById('summaryPanel');
    panel.innerHTML = '';

    const rateNote = data.usdToCadRate
        ? ` · USD/CAD ${parseFloat(data.usdToCadRate).toFixed(4)}`
        : '';
    const dateNote = data.date ? `as of ${formatDate(data.date)}` : 'no data yet';

    // Primary card — grand total
    const primary = document.createElement('div');
    primary.className = 'card primary';
    primary.innerHTML = `
        <div class="card-label">Total Retirement (CAD)</div>
        <div class="card-value">${formatCAD(data.totalRetirementCad || 0)}</div>
        <div class="card-sub">${dateNote}${rateNote}</div>
    `;
    panel.appendChild(primary);

    // One card per account type that has a non-zero balance
    (data.byType || []).forEach(type => {
        const label = typeLabel(type.accountType);
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <div class="card-label">${label}</div>
            <div class="card-value type-positive">${formatCAD(type.totalCad)}</div>
            <div class="card-sub">${type.accountCount} account${type.accountCount !== 1 ? 's' : ''}</div>
        `;
        panel.appendChild(card);
    });

    // Update the balances panel header date
    const balancesHeading = document.querySelector('.balances-panel-header h2 span');
    if (balancesHeading) {
        balancesHeading.textContent = data.date ? 'as of ' + formatDate(data.date) : '';
    }
}

// ─── Account list ──────────────────────────────────────────────────────────

function renderAccountBalances(data) {
    const panel = document.querySelector('.balances-panel');

    // Remove any previously rendered institution sections
    panel.querySelectorAll('.institution').forEach(el => el.remove());

    if (!data.accounts || data.accounts.length === 0) {
        const msg = document.createElement('p');
        msg.style.cssText = 'color:#7f8c8d;padding:20px 0;';
        msg.textContent = 'No retirement accounts found. Add accounts to get started.';
        panel.appendChild(msg);
        return;
    }

    // Group accounts by institution, preserving server sort order
    const byInstitution = new Map();
    data.accounts.forEach(account => {
        if (!byInstitution.has(account.institution_name)) {
            byInstitution.set(account.institution_name, []);
        }
        byInstitution.get(account.institution_name).push(account);
    });

    byInstitution.forEach((accounts, institutionName) => {
        const section = document.createElement('div');
        section.className = 'institution';

        const header = document.createElement('div');
        header.className = 'institution-header';
        header.onclick = function () { toggleInstitution(this); };
        header.innerHTML = `<span>${institutionName}</span><span class="chevron">▼</span>`;

        const accountsDiv = document.createElement('div');
        accountsDiv.className = 'institution-accounts';

        accounts.forEach(account => {
            const balance = parseFloat(account.balance);
            const rate = account.usd_to_cad_rate ? parseFloat(account.usd_to_cad_rate) : 1;
            const balanceCad = account.currency === 'USD' ? balance * rate : balance;
            const balanceClass = balance < 0 ? 'negative' : (balance > 0 ? 'positive' : '');
            const label = typeLabel(account.account_type);
            const tagClass = typeTagClass(account.account_type);

            // Show the native USD amount alongside the converted CAD figure
            const usdNote = account.currency === 'USD'
                ? `<span class="currency-note">${formatNative(balance, 'USD')} USD</span>`
                : '';

            const maskNote = account.account_mask ? ` · ····${account.account_mask}` : '';

            const row = document.createElement('div');
            row.className = 'account-row';
            row.innerHTML = `
                <div>
                    <div class="account-name">${account.account_name}</div>
                    <div class="account-type">${label}${maskNote}</div>
                </div>
                <div class="account-usd-note">${usdNote}</div>
                <div class="account-balance ${balanceClass}">${formatCAD(balanceCad)}</div>
                <div class="account-tag"><span class="tag ${tagClass}">${label}</span></div>
            `;

            accountsDiv.appendChild(row);
        });

        section.appendChild(header);
        section.appendChild(accountsDiv);
        panel.appendChild(section);
    });
}

// ─── Trend chart ───────────────────────────────────────────────────────────

let retirementChart = null;

// Map range key → granularity for the API request
function rangeToGranularity(range) {
    if (range === '1y' || range === 'all') return 'monthly';
    if (range === '90d' || range === '6m') return 'weekly';
    return 'daily'; // 30d
}

// Return a cutoff Date for client-side filtering, or null for all time
function rangeCutoffDate(range) {
    const now = new Date();
    switch (range) {
        case '30d': { const d = new Date(now); d.setDate(d.getDate() - 30);       return d; }
        case '90d': { const d = new Date(now); d.setDate(d.getDate() - 90);       return d; }
        case '6m':  { const d = new Date(now); d.setMonth(d.getMonth() - 6);      return d; }
        case '1y':  { const d = new Date(now); d.setFullYear(d.getFullYear() - 1); return d; }
        default: return null; // 'all'
    }
}

function calculateLinearRegression(xValues, yValues) {
    const n = xValues.length;
    if (n < 2) return null;
    const sumX  = xValues.reduce((a, b) => a + b, 0);
    const sumY  = yValues.reduce((a, b) => a + b, 0);
    const sumXY = xValues.reduce((s, x, i) => s + x * yValues[i], 0);
    const sumXX = xValues.reduce((s, x) => s + x * x, 0);
    const slope     = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    return { slope, intercept };
}

async function renderTrendChart(range) {
    const granularity = rangeToGranularity(range);
    const cutoff      = rangeCutoffDate(range);
    const cutoffStr   = cutoff ? cutoff.toLocaleDateString('en-CA') : null;

    // Fetch aggregated data
    const allData = await fetch(`/api/retirement_trend_data?granularity=${granularity}`)
        .then(r => r.json());

    const filteredData = cutoffStr
        ? allData.filter(d => d.date >= cutoffStr)
        : allData;

    const labels = filteredData.map(d => formatDate(d.date));
    const values = filteredData.map(d => parseFloat(d.total_retirement_cad));

    // Trend line — fetch daily data for accuracy, then project onto display points
    let trendLineData = null;
    if (filteredData.length >= 2) {
        const dailyAll = await fetch('/api/retirement_trend_data?granularity=daily')
            .then(r => r.json());
        const dailyFiltered = cutoffStr
            ? dailyAll.filter(d => d.date >= cutoffStr)
            : dailyAll;

        if (dailyFiltered.length >= 2) {
            const parseUTC  = s => { const [y,m,d] = s.split('-').map(Number); return Date.UTC(y, m-1, d); };
            const firstMs   = parseUTC(dailyFiltered[0].date);
            const msPerDay  = 86400000;
            const xVals     = dailyFiltered.map(d => (parseUTC(d.date) - firstMs) / msPerDay);
            const yVals     = dailyFiltered.map(d => parseFloat(d.total_retirement_cad));
            const regression = calculateLinearRegression(xVals, yVals);
            if (regression) {
                trendLineData = filteredData.map(d => {
                    const days = (parseUTC(d.date) - firstMs) / msPerDay;
                    return regression.slope * days + regression.intercept;
                });
            }
        }
    }

    if (retirementChart) retirementChart.destroy();

    const datasets = [{
        label: 'Total Retirement (CAD)',
        data: values,
        borderColor: '#667eea',
        backgroundColor: 'rgba(102, 126, 234, 0.1)',
        borderWidth: 3,
        fill: true,
        tension: 0.4,
        pointRadius: 5,
        pointHoverRadius: 7,
        pointBackgroundColor: '#667eea',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
    }];

    if (trendLineData) {
        datasets.push({
            label: 'Trend',
            data: trendLineData,
            borderColor: 'rgba(149, 165, 166, 0.8)',
            borderWidth: 2,
            borderDash: [5, 5],
            fill: false,
            pointRadius: 0,
            pointHoverRadius: 0,
            tension: 0,
        });
    }

    retirementChart = new Chart(document.getElementById('retirementTrendChart'), {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: !!trendLineData,
                    position: 'top',
                    align: 'end',
                    labels: { usePointStyle: true, boxWidth: 6 },
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    padding: 12,
                    borderColor: '#667eea',
                    borderWidth: 1,
                    callbacks: {
                        label(context) {
                            const prefix = context.dataset.label === 'Trend' ? 'Trend: ' : '';
                            return prefix + formatCAD(context.parsed.y);
                        },
                    },
                },
            },
            scales: {
                y: {
                    beginAtZero: false,
                    ticks: { callback: v => '$' + v.toLocaleString() },
                    grid:  { color: 'rgba(0,0,0,0.05)' },
                },
                x: {
                    grid: { display: false },
                },
            },
            interaction: { mode: 'nearest', axis: 'x', intersect: false },
        },
    });
}

function setupChartButtons() {
    document.querySelectorAll('.date-range-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.date-range-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            renderTrendChart(this.dataset.range);
        });
    });
}

// ─── UI interactions ───────────────────────────────────────────────────────

function toggleInstitution(header) {
    const accountsDiv = header.nextElementSibling;
    const chevron = header.querySelector('.chevron');
    accountsDiv.classList.toggle('collapsed');
    chevron.classList.toggle('open');
}

// ─── Add Account modal ─────────────────────────────────────────────────────

function showAddAccountModal() {
    // Clear form
    document.getElementById('addInstitution').value = '';
    document.getElementById('addAccountName').value = '';
    document.getElementById('addAccountType').value = 'roth';
    document.getElementById('addCurrency').value = 'CAD';
    document.getElementById('addInitialBalance').value = '';
    setAddAccountError('');

    const btn = document.getElementById('saveAddAccountBtn');
    btn.disabled = false;
    btn.textContent = 'Save Account';

    document.getElementById('addAccountModal').classList.add('show');
    document.getElementById('addInstitution').focus();
}

function closeAddAccountModal() {
    document.getElementById('addAccountModal').classList.remove('show');
}

function setAddAccountError(msg) {
    const el = document.getElementById('addAccountError');
    el.textContent = msg;
    el.style.display = msg ? 'block' : 'none';
}

async function saveNewAccount() {
    const institution_name = document.getElementById('addInstitution').value.trim();
    const account_name = document.getElementById('addAccountName').value.trim();
    const account_type = document.getElementById('addAccountType').value;
    const currency = document.getElementById('addCurrency').value;
    const initialBalanceRaw = document.getElementById('addInitialBalance').value.trim();

    if (!institution_name) { setAddAccountError('Institution name is required.'); return; }
    if (!account_name)     { setAddAccountError('Account name is required.'); return; }

    const initial_balance = initialBalanceRaw !== '' ? parseFloat(initialBalanceRaw) : undefined;
    if (initialBalanceRaw !== '' && isNaN(initial_balance)) {
        setAddAccountError('Initial balance must be a valid number.');
        return;
    }

    const btn = document.getElementById('saveAddAccountBtn');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    setAddAccountError('');

    try {
        const res = await fetch('/api/accounts/manual', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ institution_name, account_name, account_type, currency, initial_balance }),
        });
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Failed to save account');
        }

        closeAddAccountModal();
        await loadRetirementDashboard();
    } catch (err) {
        setAddAccountError(err.message || 'Something went wrong. Please try again.');
        btn.disabled = false;
        btn.textContent = 'Save Account';
    }
}


// ─── Modal event listeners (called on DOMContentLoaded) ────────────────────

function setupModalEventListeners() {
    // Dark mode toggle
    document.getElementById('darkModeToggleBtn').addEventListener('click', function () {
        if (typeof toggleDarkMode === 'function') toggleDarkMode();
    });

    // Panel action buttons
    document.getElementById('addAccountBtn').addEventListener('click', showAddAccountModal);

    // Refresh buttons — delegate to shared triggerRefresh() from refresh-modal.js
    document.getElementById('refreshRetirementBtn').addEventListener('click', function () {
        triggerRefresh('retirement', this, loadRetirementDashboard);
    });
    document.getElementById('refreshAllBtn').addEventListener('click', function () {
        triggerRefresh(null, this, loadRetirementDashboard);
    });

    // Add Account modal
    document.getElementById('closeAddAccountBtn').addEventListener('click', closeAddAccountModal);
    document.getElementById('cancelAddAccountBtn').addEventListener('click', closeAddAccountModal);
    document.getElementById('saveAddAccountBtn').addEventListener('click', saveNewAccount);
    document.getElementById('addAccountModal').addEventListener('click', function (e) {
        if (e.target === this) closeAddAccountModal();
    });

    // Escape key closes Add Account modal (refresh modal handles its own Escape)
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && document.getElementById('addAccountModal').classList.contains('show')) {
            closeAddAccountModal();
        }
    });
}

