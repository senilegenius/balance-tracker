// payments.js — Recurring payments list: add, edit, stop/restart, delete.

// ─── Auth guard + event wiring ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
    setupEventListeners();
    buildFormOptions();

    fetch('/api/check-auth')
        .then(r => r.json())
        .then(data => {
            if (!data.authenticated) {
                window.location.href = '/login.html';
            } else {
                loadAccounts();
                loadPayments();
            }
        })
        .catch(() => {
            window.location.href = '/login.html';
        });
});

// ─── Constants ─────────────────────────────────────────────────────────────

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_BASED = ['monthly', 'bimonthly', 'quarterly', 'annual'];
const CHECKING_TYPES = ['checking', 'chequing'];

let payments = [];
let accounts = [];
let editingId = null;

// ─── Formatting ────────────────────────────────────────────────────────────

function formatCAD(amount) {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount);
}

// 'YYYY-MM-DD' → 'Mon, Nov 16' (parsed as a calendar date, never via local time)
function formatDate(dateStr, withYear = false) {
    if (!dateStr) return '–';
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    const text = `${WEEKDAYS[date.getUTCDay()]}, ${MONTH_NAMES[m - 1]} ${d}`;
    return withYear ? `${text}, ${y}` : text;
}

function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function describeDay(dayOfMonth) {
    if (dayOfMonth === -1) return 'the last day';
    if (dayOfMonth < 0) return `the ${ordinal(-dayOfMonth)}-last day`;
    return `the ${ordinal(dayOfMonth)}`;
}

// Collapses month lists into ranges: [9,10,11,12,1,...,7] → 'Sep–Jul'
function describeMonths(months) {
    if (!months || months.length === 0 || months.length === 12) return '';
    const set = new Set(months);
    // Start the run after a gap so wrap-around ranges (Sep–Jul) read naturally
    let start = months.find(m => !set.has(m === 1 ? 12 : m - 1)) || months[0];
    const runs = [];
    const seen = new Set();
    for (let i = 0; i < 12 && seen.size < set.size; i++) {
        const m = ((start - 1 + i) % 12) + 1;
        if (!set.has(m)) continue;
        seen.add(m);
        const prev = m === 1 ? 12 : m - 1;
        if (runs.length && runs[runs.length - 1].end === prev) {
            runs[runs.length - 1].end = m;
        } else {
            runs.push({ start: m, end: m });
        }
    }
    return runs.map(r => r.start === r.end
        ? MONTH_NAMES[r.start - 1]
        : `${MONTH_NAMES[r.start - 1]}–${MONTH_NAMES[r.end - 1]}`).join(', ');
}

function describeSchedule(p) {
    const [y, m, d] = p.anchor_date.split('-').map(Number);
    const anchorDow = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    const day = p.day_of_month ?? d;
    let text;
    switch (p.frequency) {
        case 'weekly':    text = `Weekly on ${anchorDow}`; break;
        case 'biweekly':  text = `Every 2 weeks on ${anchorDow}`; break;
        case 'monthly':   text = `Monthly on ${describeDay(day)}`; break;
        case 'bimonthly': text = `Every 2 months on ${describeDay(day)}`; break;
        case 'quarterly': text = `Every 3 months on ${describeDay(day)}`; break;
        case 'annual':    text = p.day_of_month < 0
            ? `Yearly on ${describeDay(day)} of ${MONTH_NAMES[m - 1]}`
            : `Yearly on ${MONTH_NAMES[m - 1]} ${day}`; break;
        case 'once':      text = `Once, ${formatDate(p.anchor_date, true)}`; break;
        default:          text = p.frequency;
    }
    const months = describeMonths(p.active_months);
    if (months) text += ` · ${months}`;
    return text;
}

function amountText(p) {
    return p.amount_max != null && p.amount_max !== p.amount
        ? `${formatCAD(p.amount)} <span class="muted">up to ${formatCAD(p.amount_max)}</span>`
        : formatCAD(p.amount);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

// ─── Data loading ──────────────────────────────────────────────────────────

async function apiFetch(url, options = {}) {
    const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        ...options,
    });
    if (res.status === 401) {
        window.location.href = '/login.html';
        throw new Error('Not signed in');
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
}

async function loadAccounts() {
    try {
        const all = await apiFetch('/api/accounts');
        accounts = all.filter(a => a.is_active && !a.is_liability && a.account_category === 'liquid');
    } catch (error) {
        accounts = [];
    }
}

async function loadPayments() {
    try {
        const data = await apiFetch('/api/recurring_payments');
        payments = data.payments;
        renderTotals(data.monthly_totals);
        renderTables();
        showStatus('');
    } catch (error) {
        showStatus(`Couldn't load recurring payments: ${error.message}`);
    }
}

function showStatus(message) {
    const el = document.getElementById('statusMessage');
    el.textContent = message;
    el.style.display = message ? 'block' : 'none';
}

// ─── Rendering ─────────────────────────────────────────────────────────────

function renderTotals(totals) {
    document.getElementById('totalMustHave').textContent = formatCAD(totals.must_have);
    document.getElementById('totalDiscretionary').textContent = formatCAD(totals.discretionary);
    document.getElementById('totalIncome').textContent = formatCAD(totals.income);
    const net = document.getElementById('totalNet');
    net.textContent = formatCAD(totals.net);
    net.classList.toggle('value-negative', totals.net < 0);
}

function renderTables() {
    const running = payments.filter(p => p.status !== 'ended');
    const ended = payments.filter(p => p.status === 'ended');
    const byNextDate = (a, b) => (a.next_date || '9999').localeCompare(b.next_date || '9999');

    renderRows('outflowRows', running.filter(p => p.direction === 'outflow').sort(byNextDate),
        'No payments yet — add your mortgage, loans and bills.');
    renderRows('inflowRows', running.filter(p => p.direction === 'inflow').sort(byNextDate),
        'No income yet — add the paycheques that land in this account.');

    document.getElementById('endedCount').textContent = ended.length ? `(${ended.length})` : '';
    document.getElementById('endedPanel').style.display = ended.length ? '' : 'none';
    document.getElementById('endedRows').innerHTML = ended.map(p => `
        <tr>
            <td><div class="payment-name">${escapeHtml(p.name)}</div></td>
            <td data-label="Schedule">${escapeHtml(describeSchedule(p))}</td>
            <td data-label="Ended">${formatDate(p.end_date, true)}</td>
            <td class="num" data-label="Amount">${amountText(p)}</td>
            <td class="actions">
                <button class="btn-row" data-action="restart" data-id="${p.id}">Restart</button>
                <button class="btn-row" data-action="edit" data-id="${p.id}">Edit</button>
                <button class="btn-row danger" data-action="delete" data-id="${p.id}">Delete</button>
            </td>
        </tr>`).join('');
}

function renderRows(tbodyId, rows, emptyText) {
    const tbody = document.getElementById(tbodyId);
    if (rows.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="6">${escapeHtml(emptyText)}</td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map(p => {
        const tags = [
            p.status === 'scheduled' ? '<span class="tag scheduled">starts later</span>' : '',
            p.category === 'discretionary' ? '<span class="tag discretionary">discretionary</span>' : '',
        ].join('');
        const ends = p.end_date ? `<div class="muted">until ${formatDate(p.end_date, true)}</div>` : '';
        const nextAmount = p.next_amount != null && p.next_amount !== p.amount
            ? `<div class="muted">next: ${formatCAD(p.next_amount)}</div>` : '';
        return `
        <tr>
            <td>
                <div class="payment-name">${escapeHtml(p.name)}${tags}</div>
                ${p.notes ? `<div class="payment-notes">${escapeHtml(p.notes)}</div>` : ''}
            </td>
            <td data-label="Schedule">${escapeHtml(describeSchedule(p))}${ends}</td>
            <td data-label="Next">${formatDate(p.next_date)}</td>
            <td class="num" data-label="Amount">${amountText(p)}${nextAmount}</td>
            <td class="num" data-label="Per month">${p.monthly_equivalent ? formatCAD(p.monthly_equivalent) : '–'}</td>
            <td class="actions">
                <button class="btn-row" data-action="edit" data-id="${p.id}">Edit</button>
                <button class="btn-row" data-action="stop" data-id="${p.id}">Stop</button>
                <button class="btn-row danger" data-action="delete" data-id="${p.id}">Delete</button>
            </td>
        </tr>`;
    }).join('');
}

// ─── Row actions ───────────────────────────────────────────────────────────

// PUT replaces the whole rule, so send every editable field
function toRequestBody(p) {
    return {
        name: p.name,
        account_id: p.account_id,
        direction: p.direction,
        category: p.category,
        amount: p.amount,
        amount_max: p.amount_max,
        frequency: p.frequency,
        anchor_date: p.anchor_date,
        day_of_month: p.day_of_month,
        active_months: p.active_months,
        weekend_rule: p.weekend_rule,
        start_date: p.start_date,
        end_date: p.end_date,
        payee_match: p.payee_match,
        notes: p.notes,
    };
}

function todayLocal() {
    return new Date().toLocaleDateString('en-CA');
}

async function handleRowAction(action, id) {
    const p = payments.find(x => x.id === id);
    if (!p) return;
    try {
        if (action === 'edit') {
            openModal(p);
            return;
        }
        if (action === 'stop') {
            if (!confirm(`Stop "${p.name}"? Payments after today won't be planned. You can restart it later.`)) return;
            const today = todayLocal();
            const start = p.start_date || p.anchor_date;
            // end_date can't be before the start; a not-yet-started payment just ends on its start
            const end = today < start ? start : today;
            await apiFetch(`/api/recurring_payments/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ ...toRequestBody(p), end_date: end }),
            });
        } else if (action === 'restart') {
            await apiFetch(`/api/recurring_payments/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ ...toRequestBody(p), end_date: null }),
            });
        } else if (action === 'delete') {
            if (!confirm(`Delete "${p.name}"? To pause it instead, use Stop.`)) return;
            await apiFetch(`/api/recurring_payments/${id}`, { method: 'DELETE' });
        }
        await loadPayments();
    } catch (error) {
        showStatus(error.message);
    }
}

// ─── Add / edit modal ──────────────────────────────────────────────────────

function buildFormOptions() {
    const day = document.getElementById('fDayOfMonth');
    const options = ['<option value="">Same day as the known date</option>'];
    for (let i = 1; i <= 31; i++) options.push(`<option value="${i}">${ordinal(i)}</option>`);
    options.push('<option value="-1">Last day of the month</option>');
    for (let i = 2; i <= 7; i++) options.push(`<option value="-${i}">${ordinal(i)}-last day of the month</option>`);
    day.innerHTML = options.join('');

    document.getElementById('monthGrid').innerHTML = MONTH_NAMES.map((name, i) =>
        `<label><input type="checkbox" value="${i + 1}" checked> ${name}</label>`).join('');
}

function fillAccountOptions(selectedId) {
    const select = document.getElementById('fAccount');
    const options = ['<option value="">Not set</option>'].concat(accounts.map(a =>
        `<option value="${a.id}">${escapeHtml(a.institution_name)} – ${escapeHtml(a.account_name)}</option>`));
    select.innerHTML = options.join('');
    if (selectedId != null) {
        select.value = String(selectedId);
    } else {
        // Default to the checking account — the one this feature plans for
        const checking = accounts.find(a => CHECKING_TYPES.includes((a.account_type || '').toLowerCase()));
        if (checking) select.value = String(checking.id);
    }
}

function updateFrequencyFields() {
    const frequency = document.getElementById('fFrequency').value;
    document.getElementById('fDayOfMonth').parentElement.style.display = MONTH_BASED.includes(frequency) ? '' : 'none';
    document.getElementById('monthsField').style.display = frequency === 'monthly' ? '' : 'none';
}

function openModal(p = null) {
    editingId = p ? p.id : null;
    document.getElementById('modalTitle').textContent = p ? `Edit ${p.name}` : 'Add Recurring Payment';
    document.getElementById('formError').style.display = 'none';

    document.getElementById('fName').value = p ? p.name : '';
    document.getElementById('fDirection').value = p ? p.direction : 'outflow';
    document.getElementById('fCategory').value = p ? p.category : 'must_have';
    document.getElementById('fAmount').value = p ? p.amount : '';
    document.getElementById('fAmountMax').value = p && p.amount_max != null ? p.amount_max : '';
    document.getElementById('fFrequency').value = p ? p.frequency : 'monthly';
    document.getElementById('fAnchorDate').value = p ? p.anchor_date : todayLocal();
    document.getElementById('fDayOfMonth').value = p && p.day_of_month != null ? String(p.day_of_month) : '';
    document.getElementById('fWeekendRule').value = p ? p.weekend_rule : 'next';
    document.getElementById('fStartDate').value = p && p.start_date ? p.start_date : '';
    document.getElementById('fEndDate').value = p && p.end_date ? p.end_date : '';
    document.getElementById('fNotes').value = p && p.notes ? p.notes : '';

    const activeMonths = p && p.active_months ? new Set(p.active_months) : null;
    document.querySelectorAll('#monthGrid input').forEach(box => {
        box.checked = !activeMonths || activeMonths.has(Number(box.value));
    });

    fillAccountOptions(p ? p.account_id : null);
    updateFrequencyFields();
    document.getElementById('paymentModal').classList.add('show');
    document.getElementById('fName').focus();
}

function closeModal() {
    document.getElementById('paymentModal').classList.remove('show');
    editingId = null;
}

function readForm() {
    const frequency = document.getElementById('fFrequency').value;
    const months = [...document.querySelectorAll('#monthGrid input:checked')].map(b => Number(b.value));
    const existing = editingId ? payments.find(x => x.id === editingId) : null;
    return {
        name: document.getElementById('fName').value,
        direction: document.getElementById('fDirection').value,
        category: document.getElementById('fCategory').value,
        amount: document.getElementById('fAmount').value,
        amount_max: document.getElementById('fAmountMax').value || null,
        frequency,
        anchor_date: document.getElementById('fAnchorDate').value,
        day_of_month: MONTH_BASED.includes(frequency) ? (document.getElementById('fDayOfMonth').value || null) : null,
        active_months: frequency === 'monthly' && months.length < 12 ? months : null,
        weekend_rule: document.getElementById('fWeekendRule').value,
        start_date: document.getElementById('fStartDate').value || null,
        end_date: document.getElementById('fEndDate').value || null,
        account_id: document.getElementById('fAccount').value || null,
        payee_match: existing ? existing.payee_match : null,
        notes: document.getElementById('fNotes').value,
    };
}

async function savePayment() {
    const errorEl = document.getElementById('formError');
    const body = readForm();
    if (body.frequency === 'monthly' && body.active_months && body.active_months.length === 0) {
        errorEl.textContent = 'Pick at least one month.';
        errorEl.style.display = 'block';
        return;
    }

    const saveBtn = document.getElementById('saveModalBtn');
    saveBtn.disabled = true;
    try {
        await apiFetch(editingId ? `/api/recurring_payments/${editingId}` : '/api/recurring_payments', {
            method: editingId ? 'PUT' : 'POST',
            body: JSON.stringify(body),
        });
        closeModal();
        await loadPayments();
    } catch (error) {
        errorEl.textContent = error.message;
        errorEl.style.display = 'block';
    } finally {
        saveBtn.disabled = false;
    }
}

function setupEventListeners() {
    document.getElementById('darkModeToggleBtn').addEventListener('click', function () {
        window.toggleDarkMode();
    });
    document.getElementById('addPaymentBtn').addEventListener('click', () => openModal());
    document.getElementById('closeModalBtn').addEventListener('click', closeModal);
    document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
    document.getElementById('saveModalBtn').addEventListener('click', savePayment);
    document.getElementById('paymentForm').addEventListener('submit', e => {
        e.preventDefault();
        savePayment();
    });
    document.getElementById('fFrequency').addEventListener('change', updateFrequencyFields);
    document.getElementById('fDirection').addEventListener('change', e => {
        // Keep category in step with the type unless the user picked otherwise
        const category = document.getElementById('fCategory');
        if (e.target.value === 'inflow') category.value = 'income';
        else if (category.value === 'income') category.value = 'must_have';
    });
    document.getElementById('paymentModal').addEventListener('click', e => {
        if (e.target.id === 'paymentModal') closeModal();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeModal();
    });

    // Row buttons are re-rendered on every load, so delegate from the container
    document.querySelector('.container').addEventListener('click', e => {
        const btn = e.target.closest('button[data-action]');
        if (btn) handleRowAction(btn.dataset.action, Number(btn.dataset.id));
    });
}
