// nell-nutrition/notifications.js
// Система всплывающих уведомлений (тосты)

const NN_NOTIFY_ICONS = {
    info: '✦',
    success: '✧',
    warning: '⚠',
    error: '✘',
    food: '🍽',
    water: '💧',
    disease: '🦠',
    buff: '✨',
    debuff: '☠',
    weight: '⚖',
};

let container = null;

function ensureContainer() {
    if (container && document.body.contains(container)) return;
    container = document.createElement('div');
    container.id = 'nn-notify-container';
    document.body.appendChild(container);
}

/**
 * Показать уведомление.
 * @param {string} text — текст
 * @param {string} type — info | success | warning | error | food | water | disease | buff | debuff | weight
 * @param {number} duration — мс
 */
export function notify(text, type = 'info', duration = 4000) {
    ensureContainer();

    const el = document.createElement('div');
    el.className = `nn-notify nn-notify-${type}`;
    el.innerHTML = `
        <span class="nn-notify-ico">${NN_NOTIFY_ICONS[type] || '✦'}</span>
        <span class="nn-notify-text">${text}</span>
    `;
    container.appendChild(el);

    requestAnimationFrame(() => el.classList.add('nn-notify-show'));

    const timer = setTimeout(() => dismiss(el), duration);

    el.addEventListener('click', () => {
        clearTimeout(timer);
        dismiss(el);
    });
}

function dismiss(el) {
    el.classList.remove('nn-notify-show');
    el.classList.add('nn-notify-hide');
    setTimeout(() => el.remove(), 400);
}

// Очередь «тихих» уведомлений (показываются после ответа бота)
let pendingQueue = [];
let silent = false;

export function setSilent(val) { silent = val; }

export function queueNotify(text, type = 'info', duration = 4000) {
    if (silent) {
        pendingQueue.push({ text, type, duration });
    } else {
        notify(text, type, duration);
    }
}

export function flushQueue() {
    for (const n of pendingQueue) {
        notify(n.text, n.type, n.duration);
    }
    pendingQueue = [];
}
