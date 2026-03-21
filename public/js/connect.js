let linkHandler = null;

// Load connected banks on page load
document.addEventListener('DOMContentLoaded', function() {
    loadConnectedBanks();
});

async function loadConnectedBanks() {
    try {
        const response = await fetch('/api/accounts');
        const accounts = await response.json();

        if (accounts.length > 0) {
            // Group by institution, tracking count and error state
            const grouped = {};
            accounts.forEach(acc => {
                if (!grouped[acc.institution_name]) {
                    grouped[acc.institution_name] = {
                        count: 0,
                        login_required: false,
                        plaid_item_id: acc.plaid_item_id || null,
                    };
                }
                if (acc.is_active) {
                    grouped[acc.institution_name].count++;
                }
                if (acc.login_required) {
                    grouped[acc.institution_name].login_required = true;
                }
            });

            // Display connected banks
            const banksList = document.getElementById('banksList');
            banksList.innerHTML = '';

            Object.keys(grouped).forEach(institution => {
                const info = grouped[institution];
                const item = document.createElement('div');
                item.className = 'bank-item';

                if (info.login_required && info.plaid_item_id) {
                    item.innerHTML = `
                        <span class="bank-name">${institution}</span>
                        <div class="bank-item-right">
                            <span class="login-required-badge">Login required</span>
                            <button class="fix-button" data-item-id="${info.plaid_item_id}" data-institution="${institution}">Fix connection</button>
                        </div>
                    `;
                } else {
                    item.innerHTML = `
                        <span class="bank-name">${institution}</span>
                        <span class="account-count">${info.count} accounts</span>
                    `;
                }

                banksList.appendChild(item);
            });

            // Attach fix button handlers
            banksList.querySelectorAll('.fix-button').forEach(btn => {
                btn.addEventListener('click', () => {
                    const plaidItemId = btn.dataset.itemId;
                    const institution = btn.dataset.institution;
                    initializePlaidUpdateMode(plaidItemId, institution, btn);
                });
            });

            document.getElementById('connectedBanks').style.display = 'block';
        }
    } catch (error) {
        console.error('Error loading connected banks:', error);
    }
}

// Initialize Plaid Link in update mode for a specific item
async function initializePlaidUpdateMode(plaidItemId, institution, btn) {
    btn.disabled = true;
    btn.textContent = 'Loading...';

    try {
        const response = await fetch('/api/create_link_token_update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plaid_item_id: plaidItemId }),
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to create update token');
        }

        const handler = Plaid.create({
            token: data.link_token,
            onSuccess: async (_public_token, _metadata) => {
                // In update mode the item is restored automatically — just clear the flag
                await fetch('/api/clear_item_error', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ plaid_item_id: plaidItemId }),
                });

                document.getElementById('successMessage').innerHTML =
                    `<strong>✅ ${institution} reconnected successfully!</strong><br>Your connection has been restored.`;
                document.getElementById('successMessage').classList.add('show');

                // Reload the banks list to remove the error state
                loadConnectedBanks();
            },
            onExit: (err, _metadata) => {
                if (err != null) {
                    console.error('Link exit with error:', err);
                }
                btn.disabled = false;
                btn.textContent = 'Fix connection';
            },
        });

        handler.open();
    } catch (error) {
        console.error('Error initializing update mode:', error);
        alert('Error: ' + error.message);
        btn.disabled = false;
        btn.textContent = 'Fix connection';
    }
}

// Initialize Plaid Link
async function initializePlaidLink() {
    try {
        const response = await fetch('/api/create_link_token', {
            method: 'POST',
        });

        const data = await response.json();

        linkHandler = Plaid.create({
            token: data.link_token,
            onSuccess: async (public_token, metadata) => {
                console.log('Link success!', metadata);

                // Show loading state
                document.getElementById('linkButton').disabled = true;
                document.getElementById('linkButton').textContent = 'Connecting...';

                // Exchange public token for access token
                const exchangeResponse = await fetch('/api/exchange_public_token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ public_token }),
                });

                if (exchangeResponse.ok) {
                    // Show success message
                    document.getElementById('successMessage').innerHTML =
                        '<strong>✅ Bank connected successfully!</strong><br>Your accounts have been added to the database.';
                    document.getElementById('successMessage').classList.add('show');
                    document.getElementById('linkButton').textContent = 'Connect Another Bank';
                    document.getElementById('linkButton').disabled = false;

                    // Reload connected banks list
                    loadConnectedBanks();
                } else {
                    alert('Error connecting bank. Please try again.');
                    document.getElementById('linkButton').disabled = false;
                    document.getElementById('linkButton').textContent = 'Connect Bank Account';
                }
            },
            onExit: (err, metadata) => {
                if (err != null) {
                    console.error('Link exit with error:', err);
                }
                document.getElementById('linkButton').disabled = false;
            },
        });
    } catch (error) {
        console.error('Error initializing Plaid Link:', error);
        alert('Error: ' + error.message);
    }
}

// Connect button click handler
document.getElementById('linkButton').addEventListener('click', () => {
    if (linkHandler) {
        linkHandler.open();
    } else {
        initializePlaidLink().then(() => linkHandler.open());
    }
});
