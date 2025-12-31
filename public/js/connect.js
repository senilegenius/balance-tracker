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
            // Group by institution
            const grouped = {};
            accounts.forEach(acc => {
                if (!grouped[acc.institution_name]) {
                    grouped[acc.institution_name] = 0;
                }
                if (acc.is_active) {
                    grouped[acc.institution_name]++;
                }
            });

            // Display connected banks
            const banksList = document.getElementById('banksList');
            banksList.innerHTML = '';

            Object.keys(grouped).forEach(institution => {
                const item = document.createElement('div');
                item.className = 'bank-item';
                item.innerHTML = `
                    <span class="bank-name">${institution}</span>
                    <span class="account-count">${grouped[institution]} accounts</span>
                `;
                banksList.appendChild(item);
            });

            document.getElementById('connectedBanks').style.display = 'block';
        }
    } catch (error) {
        console.error('Error loading connected banks:', error);
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
