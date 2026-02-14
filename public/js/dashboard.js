document.addEventListener('DOMContentLoaded', function() {
    // Check auth first
    fetch('/api/check-auth')
        .then(r => r.json())
        .then(data => {
            if (!data.authenticated) {
                window.location.href = '/login.html';
            } else {
                loadDashboard();
                setupEventListeners();
            }
        })
        .catch(() => {
            window.location.href = '/login.html';
        });
});

function setupEventListeners() {
    // Refresh button
    document.getElementById('refreshBtn').addEventListener('click', refreshBalances);

    // Date range buttons
    document.querySelectorAll('.date-range-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            setDateRange(this.dataset.range);
        });
    });

    // Side panel overlay click (close when clicking outside)
    document.getElementById('sidePanelOverlay').addEventListener('click', function(e) {
        if (e.target === this) {
            closeSidePanel();
        }
    });

    // Side panel content click (prevent closing when clicking inside)
    document.getElementById('sidePanel').addEventListener('click', function(e) {
        e.stopPropagation();
    });

    // Close side panel button
    document.getElementById('closeSidePanelBtn').addEventListener('click', closeSidePanel);

    // Manual balance modal close button
    document.getElementById('closeManualModalBtn').addEventListener('click', closeManualBalanceModal);

    // Manual balance modal buttons
    document.getElementById('cancelManualBtn').addEventListener('click', cancelManualBalances);
    document.getElementById('saveManualBtn').addEventListener('click', saveManualBalances);

    // Escape key to close panels
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeSidePanel();
            closeManualBalanceModal();
        }
    });
}

async function loadDashboard() {
    try {
        const [summaryData, balancesData] = await Promise.all([
            fetch('/api/summary').then(r => r.json()),
            fetch('/api/latest_balances').then(r => r.json())
        ]);

        updateSummaryCards(summaryData);
        updateAccountBalances(balancesData);

        // Load trend chart with default range (90d)
        await renderTrendChart('90d');

    } catch (error) {
        console.error('Error loading dashboard:', error);
        alert('Error loading dashboard data. Please check the console.');
    }
}

function updateSummaryCards(data) {
    document.querySelector('.card.primary .card-value').textContent = formatCurrency(data.liquidCashCad);

    const liquidChange = data.liquidChange;
    const liquidChangeEl = document.querySelector('.card.primary .card-change');
    liquidChangeEl.textContent = (liquidChange >= 0 ? '▲' : '▼') + ' ' + formatCurrency(Math.abs(liquidChange)) + ' from last update (' + formatDate(data.previousDate) + ')';
    liquidChangeEl.className = 'card-change ' + (liquidChange >= 0 ? 'positive' : 'negative');

    const cards = document.querySelectorAll('.card:not(.primary)');

    cards[0].querySelector('.card-value').textContent = formatCurrency(data.totalCad);
    const cadChange = data.previousTotalCad ? data.totalCad - data.previousTotalCad : 0;
    cards[0].querySelector('.card-change').textContent = (cadChange >= 0 ? '▲' : '▼') + ' ' + formatCurrency(Math.abs(cadChange));
    cards[0].querySelector('.card-change').className = 'card-change ' + (cadChange >= 0 ? 'positive' : 'negative');

    cards[1].querySelector('.card-value').textContent = formatCurrency(data.ccDebtCad);
    const cadCcChange = data.previousCcDebtCad ? data.ccDebtCad - data.previousCcDebtCad : 0;
    cards[1].querySelector('.card-change').textContent = (cadCcChange >= 0 ? '▲' : '▼') + ' ' + formatCurrency(Math.abs(cadCcChange));
    cards[1].querySelector('.card-change').className = 'card-change ' + (cadCcChange >= 0 ? 'positive' : 'negative');

    cards[2].querySelector('.card-value').textContent = formatCurrency(data.totalUsd);
    const usdChange = data.previousTotalUsd ? data.totalUsd - data.previousTotalUsd : 0;
    cards[2].querySelector('.card-change').textContent = (usdChange >= 0 ? '▲' : '▼') + ' ' + formatCurrency(Math.abs(usdChange));
    cards[2].querySelector('.card-change').className = 'card-change ' + (usdChange >= 0 ? 'positive' : 'negative');

    cards[3].querySelector('.card-value').textContent = formatCurrency(data.ccDebtUsd);
    const usdCcChange = data.previousCcDebtUsd ? data.ccDebtUsd - data.previousCcDebtUsd : 0;
    cards[3].querySelector('.card-change').textContent = (usdCcChange >= 0 ? '▲' : '▼') + ' ' + formatCurrency(Math.abs(usdCcChange));
    cards[3].querySelector('.card-change').className = 'card-change ' + (usdCcChange >= 0 ? 'positive' : 'negative');

    document.querySelector('.balances-panel h2 span').textContent = 'as of ' + formatDate(data.date);
}

function updateAccountBalances(data) {
    // Define old account IDs that need warning labels
    const oldAccountIds = [5, 6, 7, 8, 14, 16];

    // Group accounts by type and currency
    const grouped = {};
    data.accounts.forEach(account => {
        let sectionName;

        // Determine which section this account belongs to
        if (account.is_liability) {
            sectionName = 'Liabilities';
        } else if (account.account_type === 'credit' || account.account_type === 'credit card') {
            sectionName = account.currency === 'CAD' ? 'CAD Credit Cards' : 'USD Credit Cards';
        } else if (account.account_type === 'checking') {
            sectionName = account.currency === 'CAD' ? 'CAD Checking Accounts' : 'USD Checking Accounts';
        } else if (account.account_type === 'savings') {
            sectionName = account.currency === 'CAD' ? 'CAD Savings Accounts' : 'USD Savings Accounts';
        } else {
            sectionName = 'Other Accounts';
        }

        if (!grouped[sectionName]) {
            grouped[sectionName] = [];
        }
        grouped[sectionName].push(account);
    });

    // Sort accounts within each section: new first, old last
    Object.keys(grouped).forEach(sectionName => {
        grouped[sectionName].sort((a, b) => {
            const aIsOld = oldAccountIds.includes(a.id);
            const bIsOld = oldAccountIds.includes(b.id);

            // Old accounts go to end
            if (aIsOld && !bIsOld) return 1;
            if (!aIsOld && bIsOld) return -1;

            // Within same group (both old or both new), maintain original order by ID
            return a.id - b.id;
        });
    });

    const balancesPanel = document.querySelector('.balances-panel');
    const institutions = balancesPanel.querySelectorAll('.institution');
    institutions.forEach(inst => inst.remove());

    // Define section order and display names
    const sectionOrder = [
        'CAD Checking Accounts',
        'CAD Savings Accounts',
        'USD Checking Accounts',
        'USD Savings Accounts',
        'CAD Credit Cards',
        'USD Credit Cards',
        'Liabilities',
        'Other Accounts'
    ];

    const displayNames = {
        'CAD Checking Accounts': 'CAD Checking Accounts',
        'CAD Savings Accounts': 'CAD Savings Accounts',
        'USD Checking Accounts': 'USD Checking Accounts',
        'USD Savings Accounts': 'USD Savings Accounts',
        'CAD Credit Cards': 'CAD Credit Cards',
        'USD Credit Cards': 'USD Credit Cards',
        'Liabilities': 'Liabilities (Not Included in Liquid Cash)',
        'Other Accounts': 'Other Accounts'
    };

    sectionOrder.forEach(sectionName => {
        if (!grouped[sectionName]) return;

        const sectionDiv = document.createElement('div');
        sectionDiv.className = 'institution';

        const headerName = displayNames[sectionName] || sectionName;

        const header = document.createElement('div');
        header.className = 'institution-header';
        header.onclick = function() { toggleInstitution(this); };
        header.innerHTML = '<span>' + headerName + '</span><span class="chevron ' + (sectionName === 'Liabilities' ? 'open' : '') + '">▼</span>';

        const accountsDiv = document.createElement('div');
        accountsDiv.className = 'institution-accounts' + (sectionName === 'Liabilities' ? ' collapsed' : '');

        if (sectionName === 'Liabilities') {
            const note = document.createElement('div');
            note.className = 'liability-note';
            note.textContent = 'ℹ️ These accounts are tracked but do not affect your liquid cash total';
            accountsDiv.appendChild(note);
        }

        grouped[sectionName].forEach(account => {
            const accountRow = document.createElement('div');
            accountRow.className = 'account-row';
            accountRow.onclick = function() { showHistory(account.id, account.account_name, account.currency, account.account_type); };

            const isOld = oldAccountIds.includes(account.id);
            const displayName = isOld ? '⚠️ Old - ' + account.account_name : account.account_name;
            const nameClass = isOld ? 'account-name old' : 'account-name';

            const balance = parseFloat(account.balance);
            const balanceClass = balance < 0 ? 'negative' : (balance > 0 ? 'positive' : '');

            accountRow.innerHTML = '<div><div class="' + nameClass + '">' + displayName + '</div><div class="account-type">' + account.institution_name + (account.account_mask ? ' • ' + account.account_mask : '') + '</div></div><div></div><div class="account-balance ' + balanceClass + '">' + formatCurrency(Math.abs(balance)) + '</div><div class="view-history">View History →</div>';

            accountsDiv.appendChild(accountRow);
        });

        sectionDiv.appendChild(header);
        sectionDiv.appendChild(accountsDiv);
        balancesPanel.appendChild(sectionDiv);
    });
}

let trendChart;
let currentGranularity = 'weekly';

// Calculate linear regression
function calculateLinearRegression(xValues, yValues) {
    const n = xValues.length;
    if (n < 2) return null;

    const sumX = xValues.reduce((a, b) => a + b, 0);
    const sumY = yValues.reduce((a, b) => a + b, 0);
    const sumXY = xValues.reduce((sum, x, i) => sum + x * yValues[i], 0);
    const sumXX = xValues.reduce((sum, x) => sum + x * x, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    return { slope, intercept };
}

async function renderTrendChart(range) {
    const ctx = document.getElementById('trendChart');
    if (!ctx) return;

    // Determine granularity based on range
    let granularity;
    if (range === 'all') {
        granularity = 'monthly';
    } else if (range === '90d') {
        granularity = 'weekly';
    } else {
        granularity = 'daily';  // Both '30d' and '7d' use daily
    }

    currentGranularity = granularity;

    // Fetch aggregated data from server
    const response = await fetch(`/api/trend_data?granularity=${granularity}`);
    const allData = await response.json();

    // Filter data by date range (client-side)
    let filteredData = allData;

    if (range !== 'all') {
        const days = parseInt(range);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        const cutoffStr = cutoffDate.toLocaleDateString('en-CA');

        filteredData = allData.filter(d => d.date >= cutoffStr);
    }

    const labels = filteredData.map(d => formatDate(d.date));
    const values = filteredData.map(d => parseFloat(d.liquid_cash_cad));

    // Fetch ALL daily data for trend line calculation (more accurate)
    let trendLineData = null;
    const showTrendLine = range === 'all' || range === '90d' || range === '30d';

    if (showTrendLine && filteredData.length >= 2) {
        // Fetch daily data for trend calculation
        const dailyResponse = await fetch(`/api/trend_data?granularity=daily`);
        const dailyData = await dailyResponse.json();

        // Filter daily data by same date range
        let filteredDailyData = dailyData;
        if (range !== 'all') {
            const days = parseInt(range);
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - days);
            const cutoffStr = cutoffDate.toLocaleDateString('en-CA');

            filteredDailyData = dailyData.filter(d => d.date >= cutoffStr);
        }

        if (filteredDailyData.length >= 2) {
            // Convert dates to numeric values (days since first date)
            const parseUTC = s => { const [y,m,d] = s.split('-').map(Number); return Date.UTC(y, m-1, d); };
            const firstDateMs = parseUTC(filteredDailyData[0].date);
            const msPerDay = 1000 * 60 * 60 * 24;
            const xValues = filteredDailyData.map(d => {
                return (parseUTC(d.date) - firstDateMs) / msPerDay;
            });
            const yValues = filteredDailyData.map(d => parseFloat(d.liquid_cash_cad));

            const regression = calculateLinearRegression(xValues, yValues);

            if (regression) {
                // Create trend line points matching the chart's x-axis (using aggregated data dates)
                trendLineData = filteredData.map(d => {
                    const daysDiff = (parseUTC(d.date) - firstDateMs) / msPerDay;
                    return regression.slope * daysDiff + regression.intercept;
                });
            }
        }
    }

    if (trendChart) {
        trendChart.destroy();
    }

    const datasets = [{
        label: 'CAD Liquid Minus CC Debt',
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
        pointBorderWidth: 2
    }];

    // Add trend line if calculated
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
            tension: 0
        });
    }

    trendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: showTrendLine,
                    position: 'top',
                    align: 'end',
                    labels: {
                        usePointStyle: true,
                        boxWidth: 6
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    padding: 12,
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: '#667eea',
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            if (context.dataset.label === 'Trend') {
                                return 'Trend: $' + context.parsed.y.toLocaleString('en-US', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2
                                });
                            }
                            return '$' + context.parsed.y.toLocaleString('en-US', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2
                            });
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    ticks: {
                        callback: function(value) {
                            return '$' + value.toLocaleString();
                        }
                    },
                    grid: {
                        color: 'rgba(0,0,0,0.05)'
                    }
                },
                x: {
                    grid: {
                        display: false
                    }
                }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            }
        }
    });
}

function formatCurrency(value) {
    return '$' + parseFloat(value).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function formatDate(dateString) {
    if (!dateString) return '';
    const [year, month, day] = dateString.split('-');
    return parseInt(month) + '/' + parseInt(day) + '/' + year.slice(-2);
}

function toggleInstitution(header) {
    const accounts = header.nextElementSibling;
    const chevron = header.querySelector('.chevron');

    accounts.classList.toggle('collapsed');
    chevron.classList.toggle('open');
}

function setDateRange(range) {
    // Update button styles
    document.querySelectorAll('.date-range-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.range === range) {
            btn.classList.add('active');
        }
    });

    // Re-render chart with selected range
    renderTrendChart(range);
}

let accountHistoryChart;

function showHistory(accountId, accountName, currency, accountType) {
    openAccountHistory(accountId, accountName, currency, accountType);
}

async function openAccountHistory(accountId, accountName, currency, accountType) {
    try {
        document.getElementById('sidePanelOverlay').classList.add('show');
        document.querySelector('.container').style.filter = 'blur(3px) brightness(0.7)';

        const typeLabel = accountType === 'credit' || accountType === 'credit card' ? 'Credit Card' :
                         accountType === 'checking' ? 'Checking Account' :
                         accountType === 'savings' ? 'Savings Account' :
                         accountType.charAt(0).toUpperCase() + accountType.slice(1);

        document.getElementById('panelAccountName').textContent = accountName;
        document.getElementById('panelAccountSubtitle').textContent = currency + ' ' + typeLabel + ' • Monthly Trend';

        const response = await fetch('/api/account_history/' + accountId);
        const data = await response.json();

        if (!data.monthlyData || data.monthlyData.length === 0) {
            document.getElementById('statsContent').innerHTML = 'No history available for this account.';
            return;
        }

        if (data.stats) {
            const changeClass = data.stats.totalChange >= 0 ? 'positive' : 'negative';
            const changeSign = data.stats.totalChange >= 0 ? '+' : '';

            document.getElementById('statsContent').innerHTML =
                '<span class="stat-label">Minimum:</span> <span class="stat-value">' + formatCurrency(data.stats.min) + '</span> <span style="color: #95a5a6;">(' + formatDate(data.stats.minDate) + ')</span>' +
                '<br>' +
                '<span class="stat-label">Maximum:</span> <span class="stat-value">' + formatCurrency(data.stats.max) + '</span> <span style="color: #95a5a6;">(' + formatDate(data.stats.maxDate) + ')</span>' +
                '<br>' +
                '<span class="stat-label">Total Change:</span> <span class="stat-value ' + changeClass + '">' + changeSign + formatCurrency(Math.abs(data.stats.totalChange)) + '</span> <span style="color: #95a5a6;">(3 months)</span>';
        } else {
            document.getElementById('statsContent').innerHTML = 'Not enough data for statistics.';
        }

        const labels = data.monthlyData.map(d => d.month);
        const balances = data.monthlyData.map(d => d.balance);

        const ctx2 = document.getElementById('accountHistoryChart');

        if (accountHistoryChart) {
            accountHistoryChart.destroy();
        }

        accountHistoryChart = new Chart(ctx2, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Balance',
                    data: balances,
                    borderColor: '#667eea',
                    backgroundColor: 'rgba(102, 126, 234, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 6,
                    pointHoverRadius: 8,
                    pointBackgroundColor: '#667eea',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        backgroundColor: 'rgba(0,0,0,0.8)',
                        padding: 12,
                        callbacks: {
                            title: function(context) {
                                return context[0].label;
                            },
                            label: function(context) {
                                return 'Balance: $' + context.parsed.y.toLocaleString('en-US', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2
                                });
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        ticks: {
                            callback: function(value) {
                                return '$' + value.toLocaleString();
                            }
                        },
                        grid: {
                            color: 'rgba(0,0,0,0.05)'
                        }
                    },
                    x: {
                        grid: {
                            display: false
                        }
                    }
                }
            }
        });

    } catch (error) {
        console.error('Error loading account history:', error);
        alert('Error loading account history');
    }
}

function closeSidePanel() {
    document.getElementById('sidePanelOverlay').classList.remove('show');
    document.querySelector('.container').style.filter = '';
}

function closeManualBalanceModal() {
    document.getElementById('manualBalanceModal').classList.remove('show');
}

let plaidRefreshResult = null;
let plaidRefreshPromise = null;

async function refreshBalances() {
    const btn = document.getElementById('refreshBtn');

    btn.disabled = true;
    btn.textContent = '⏳ Refreshing...';

    try {
        // Step 1: Check for manual accounts FIRST (fast query)
        const manualAccountsResponse = await fetch('/api/manual_accounts');
        const manualAccounts = await manualAccountsResponse.json();

        // Step 2: Start Plaid refresh in background (don't await yet)
        plaidRefreshPromise = fetch('/api/refresh_balances', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }).then(r => r.json());

        // Step 3: Show manual modal immediately if needed
        if (manualAccounts.length > 0) {
            // Get exchange rate for modal display
            const rateResponse = await fetch('/api/exchange_rate');
            const rateData = await rateResponse.json();
            const today = new Date().toLocaleDateString('en-CA');

            // Show modal NOW (Plaid still running in background)
            showManualBalanceModal(manualAccounts, today, rateData.rate);

            // Store the result when Plaid finishes
            plaidRefreshPromise.then(result => {
                plaidRefreshResult = result;
            }).catch(error => {
                console.error('Background Plaid refresh failed:', error);
            });
        } else {
            // No manual accounts, wait for Plaid and show success
            const result = await plaidRefreshPromise;
            if (result.success) {
                showFinalSuccess(result);
            } else {
                alert('❌ Failed to refresh Plaid accounts.');
            }
            btn.disabled = false;
            btn.textContent = '🔄 Refresh Balances';
        }

    } catch (error) {
        alert('❌ Error: ' + error.message);
        btn.disabled = false;
        btn.textContent = '🔄 Refresh Balances';
    }
}

function showManualBalanceModal(accounts, date, exchangeRate) {
    const modal = document.getElementById('manualBalanceModal');
    const body = document.getElementById('manualBalanceBody');
    const subtitle = document.getElementById('manualModalSubtitle');

    subtitle.textContent = `Date: ${date}  |  Exchange Rate: ${exchangeRate.toFixed(4)}`;

    // Build the form
    body.innerHTML = '';

    let hasLiabilities = false;

    accounts.forEach(account => {
        if (account.is_liability) hasLiabilities = true;

        const item = document.createElement('div');
        item.className = 'manual-account-item';

        const lastBalance = account.last_balance !== null ? Math.abs(parseFloat(account.last_balance)) : '';

        item.innerHTML = `
            <div class="manual-account-name">${account.account_name}</div>
            <div class="manual-account-current">
                ${account.account_type} • ${account.currency}
                ${account.last_balance !== null ? ` • Current: ${formatCurrency(account.last_balance)}` : ''}
            </div>
            <div class="manual-account-input-group">
                <input
                    type="number"
                    step="0.01"
                    class="manual-account-input"
                    id="manual-input-${account.id}"
                    data-account-id="${account.id}"
                    data-is-liability="${account.is_liability}"
                    value="${lastBalance}"
                    placeholder="Enter balance"
                >
                <span class="manual-account-currency">${account.currency}</span>
            </div>
        `;

        body.appendChild(item);
    });

    // Add liability help note if needed
    if (hasLiabilities) {
        const helpNote = document.createElement('div');
        helpNote.className = 'liability-help';
        helpNote.innerHTML = 'ℹ️ <strong>Liability accounts:</strong> Enter positive numbers (e.g., 15606.10). They will be saved as negative automatically.';
        body.appendChild(helpNote);
    }

    modal.classList.add('show');
}

function closeManualBalanceModal() {
    document.getElementById('manualBalanceModal').classList.remove('show');
}

function cancelManualBalances() {
    closeManualBalanceModal();

    // Wait for Plaid to finish before showing success
    if (plaidRefreshPromise) {
        plaidRefreshPromise.then(result => {
            if (result.success) {
                showFinalSuccess(result);
            }
        }).catch(error => {
            console.error('Plaid refresh error:', error);
        });
    }

    // Re-enable refresh button
    const btn = document.getElementById('refreshBtn');
    btn.disabled = false;
    btn.textContent = '🔄 Refresh Balances';
}

async function saveManualBalances() {
    const saveBtn = document.querySelector('.manual-balance-btn.save');
    const cancelBtn = document.querySelector('.manual-balance-btn.cancel');

    // Disable buttons
    saveBtn.disabled = true;
    cancelBtn.disabled = true;

    const inputs = document.querySelectorAll('.manual-account-input');
    const manualBalances = {};

    inputs.forEach(input => {
        const accountId = input.dataset.accountId;
        const value = input.value.trim();

        if (value !== '') {
            manualBalances[accountId] = value;
        }
    });

    try {
        // Wait for Plaid to finish first
        saveBtn.textContent = 'Waiting for Plaid refresh...';
        const plaidResult = await plaidRefreshPromise;

        if (!plaidResult.success) {
            alert('❌ Plaid refresh failed. Manual balances not saved.');
            saveBtn.disabled = false;
            cancelBtn.disabled = false;
            saveBtn.textContent = 'Save Balances';
            return;
        }

        // Now save manual balances
        saveBtn.textContent = 'Saving manual balances...';
        const response = await fetch('/api/refresh_balances', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ manualBalances })
        });

        const result = await response.json();

        if (result.success) {
            closeManualBalanceModal();

            // Combine totals from both calls
            const combinedResult = {
                success: true,
                accountsUpdated: plaidResult.accountsUpdated + result.manualAccountsUpdated,
                date: result.date,
                exchangeRate: result.exchangeRate
            };

            showFinalSuccess(combinedResult);
            loadDashboard();
        } else {
            alert('❌ Failed to save manual balances.');
            saveBtn.disabled = false;
            cancelBtn.disabled = false;
            saveBtn.textContent = 'Save Balances';
        }

    } catch (error) {
        alert('❌ Error: ' + error.message);
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
        saveBtn.textContent = 'Save Balances';
    } finally {
        // Re-enable refresh button
        const btn = document.getElementById('refreshBtn');
        btn.disabled = false;
        btn.textContent = '🔄 Refresh Balances';
    }
}

function showFinalSuccess(result) {
    alert(`✅ Successfully refreshed ${result.accountsUpdated} accounts!\n\nDate: ${result.date}\nExchange Rate: ${result.exchangeRate.toFixed(4)}`);
    loadDashboard();
}
