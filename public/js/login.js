document.getElementById('loginForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorMessage = document.getElementById('errorMessage');
    const loginButton = document.getElementById('loginButton');

    // Hide any previous errors
    errorMessage.classList.remove('show');

    // Disable button during login
    loginButton.disabled = true;
    loginButton.textContent = 'Logging in...';

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (response.ok) {
            // Login successful, redirect to dashboard
            window.location.href = '/';
        } else {
            // Show error message
            errorMessage.textContent = data.error || 'Invalid username or password';
            errorMessage.classList.add('show');
            loginButton.disabled = false;
            loginButton.textContent = 'Login';
        }
    } catch (error) {
        errorMessage.textContent = 'An error occurred. Please try again.';
        errorMessage.classList.add('show');
        loginButton.disabled = false;
        loginButton.textContent = 'Login';
    }
});

// Focus username field on load
document.getElementById('username').focus();
