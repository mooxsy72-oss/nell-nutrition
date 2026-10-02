// nell-nutrition/notifications.js
// Всплывающие уведомления (иконки — Font Awesome, цвета — из темы таверны)

const NN_NOTIFY_ICONS = {
    info: 'fa-circle-info',
    success: 'fa-circle-check',
    warning: 'fa-triangle-exclamation',
    error: 'fa-circle-xmark',
    food: 'fa-utensils',
    water: 'fa-droplet',
    disease: 'fa-virus',
    mental: 'fa-brain',
    buff: 'fa-star',
    debuff: 'fa-skull',
    weight: 'fa-weight-scale',
};

let container = null;
let enabled = true;

export function setToastsEnabled(v) { enabled = !!v; }

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function ensureContainer() {
    if (container && document.body.contains(container)) return;
    container = document.createElement('div');
    container.id = 'nn-notify-container';
    document.body.appendChild(container);
}

/**
 * Показать уведомление.
 * @param {string} text
 * @param {string} type — info | success | warning | error | food | water | disease | mental | buff | debuff | weight
 * @param {number} duration — мс
 * @param {boolean} force — показать, даже если тосты отключены (ответ на действие пользователя)
 */
export function notify(text, type = 'info', duration = 4000, force = false) {
    if (!enabled && !force) return;
    ensureContainer();

    const el = document.createElement('div');
    el.className = `nn-notify nn-notify-${type}`;
    el.innerHTML = `
        <i class="fa-solid ${NN_NOTIFY_ICONS[type] || NN_NOTIFY_ICONS.info} nn-notify-ico"></i>
        <span class="nn-notify-text">${escapeHtml(text)}</span>
    `;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('nn-notify-show'));

    const timer = setTimeout(() => dismiss(el), duration);
    el.addEventListener('click', () => { clearTimeout(timer); dismiss(el); });
}

function dismiss(el) {
    el.classList.remove('nn-notify-show');
    el.classList.add('nn-notify-hide');
    setTimeout(() => el.remove(), 350);
}

// Очередь: уведомления копятся во время обработки ответа и показываются разом
let pendingQueue = [];
let silent = false;

export function setSilent(val) { silent = val; }

export function queueNotify(text, type = 'info', duration = 4000) {
    if (silent) pendingQueue.push({ text, type, duration });
    else notify(text, type, duration);
}

export function flushQueue() {
    for (const n of pendingQueue) notify(n.text, n.type, n.duration);
    pendingQueue = [];
}

export function clearQueue() { pendingQueue = []; }
