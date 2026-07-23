// nell-nutrition/index.js — STAGE 1 FIXED v2

import {
    chat, chat_metadata, this_chid, characters,
    setExtensionPrompt, extension_prompt_types, extension_prompt_roles,
    saveChatDebounced, name1,
} from '../../../../script.js';

import { eventSource, event_types } from '../../../../scripts/events.js';

const MODULE = 'nellNutrition';
const META_KEY = 'nellNutritionState';
const PROMPT_KEY = 'nell_nutrition_state';
const ENABLED_LS_KEY = 'nellNutrition_enabled';
const POS_LS_KEY = 'nellNutrition_cardPos';

// ─── ENABLE / DISABLE ─────────────────────────────────────────
function isEnabled() {
    return localStorage.getItem(ENABLED_LS_KEY) !== 'false';
}

function setEnabled(val) {
    localStorage.setItem(ENABLED_LS_KEY, val ? 'true' : 'false');
    const chk = document.getElementById('nn-chk-enabled');
    if (chk) chk.checked = val;
    renderMiniBar();
    renderCard();
}

// ─── STATE ────────────────────────────────────────────────────
let state = null;

function defaultCharState(name = '', charId = '') {
    return {
        charId,
        name,
        calories: 0,
        calorieGoal: 2200,
        water: 100,
        satiety: 100,
        weight: 65,
        energy: 100,
        pregnant: false,
        pregnancyWeek: 0,
        diseases: [],
        buffs: [],
        debuffs: [],
        lastMealTime: null,
        hoursSinceLastMeal: 0,
    };
}

function defaultState() {
    return {
        user: defaultCharState('User', 'user'),
        characters: [],
        lastGameTime: null,
        lastProcessedMsgId: null,
        version: 1,
    };
}

function loadState() {
    if (!chat_metadata[META_KEY]) {
        chat_metadata[META_KEY] = defaultState();
    }
    state = chat_metadata[META_KEY];
    const def = defaultState();
    for (const k of Object.keys(def)) {
        if (state[k] === undefined) state[k] = def[k];
    }
    for (const k of Object.keys(def.user)) {
        if (state.user[k] === undefined) state.user[k] = def.user[k];
    }
    ensureBotState();
}

function saveState() {
    chat_metadata[META_KEY] = state;
    saveChatDebounced();
    renderMiniBar();
    renderCard();
}

// ─── BOT STATE ────────────────────────────────────────────────
function getCurrentBot() {
    if (this_chid === undefined || !characters[this_chid]) return null;
    return characters[this_chid];
}

function ensureBotState() {
    const bot = getCurrentBot();
    if (!bot) return null;
    const id = bot.avatar || bot.name;
    let existing = state.characters.find(c => c.charId === id);
    if (!existing) {
        existing = defaultCharState(bot.name, id);
        state.characters.push(existing);
    }
    existing.name = bot.name;
    return existing;
}

function getBotState() {
    const bot = getCurrentBot();
    if (!bot) return null;
    const id = bot.avatar || bot.name;
    return state.characters.find(c => c.charId === id) || null;
}

// ─── PERSONA / AVATAR HELPERS ─────────────────────────────────
function getUserAvatar() {
    const selectors = [
        '#user_avatar_block .avatar.selected img',
        '#user_avatar_block .avatar_img.selected',
        '.selected_avatar img',
        '#avatar_img_me',
    ];
    for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
            const src = el.src || el.style?.backgroundImage?.replace(/url\(['"]?|['"]?\)/g, '');
            if (src && src !== '' && !src.includes('undefined')) return src;
        }
    }
    const userMsg = document.querySelector('.mes[is_user="true"] .avatar img');
    if (userMsg?.src) return userMsg.src;
    return '';
}

function getBotAvatar() {
    const bot = getCurrentBot();
    if (!bot) return '';
    if (bot.avatar) return `/characters/${bot.avatar}`;
    const botMsg = document.querySelector('.mes:not([is_user="true"]) .avatar img');
    if (botMsg?.src) return botMsg.src;
    return '';
}

function getUserName() {
    return name1 || 'User';
}

function getBotName() {
    const bot = getCurrentBot();
    return bot?.name || 'Bot';
}

// ─── UI: TOGGLE BUTTON ───────────────────────────────────────
function buildToggleButton() {
    if (document.getElementById('nn-toggle')) return;

    const btn = document.createElement('button');
    btn.id = 'nn-toggle';
    btn.title = 'Nutrition';
    btn.innerHTML = `<span class="nn-toggle-icon">🍎</span>`;

    const sendBut = document.getElementById('send_but');
    if (sendBut) {
        sendBut.insertAdjacentElement('afterend', btn);
    } else {
        const form = document.getElementById('rightSendForm');
        if (form) form.appendChild(btn);
        else document.body.appendChild(btn);
    }

    // SIMPLE click — no drag on toggle button
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleCard();
    });

    // Prevent any touch weirdness
    btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        toggleCard();
    });
}

// ─── UI: MINI BAR ────────────────────────────────────────────
function buildMiniBar() {
    if (document.getElementById('nn-minibar')) return;

    const bar = document.createElement('div');
    bar.id = 'nn-minibar';
    bar.innerHTML = `
        <div class="nn-mini-row">
            <span class="nn-mini-icon">🍎</span>
            <span class="nn-mini-val" id="nn-mini-cal">— / —</span>
        </div>
        <div class="nn-mini-row">
            <span class="nn-mini-icon">💧</span>
            <span class="nn-mini-val" id="nn-mini-water">—%</span>
        </div>
        <div class="nn-mini-row">
            <span class="nn-mini-icon">⚡</span>
            <span class="nn-mini-val" id="nn-mini-status">OK</span>
        </div>
    `;

    const form = document.getElementById('form_sheld') || document.getElementById('rightSendForm');
    if (form) {
        form.insertAdjacentElement('beforebegin', bar);
    } else {
        document.body.appendChild(bar);
    }

    bar.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleCard();
    });

    bar.addEventListener('touchend', (e) => {
        e.preventDefault();
        toggleCard();
    });
}

function renderMiniBar() {
    if (!state) return;
    const bar = document.getElementById('nn-minibar');
    if (!bar) return;

    if (!isEnabled()) {
        bar.classList.add('nn-hidden');
        return;
    }
    bar.classList.remove('nn-hidden');

    const u = state.user;
    const calEl = document.getElementById('nn-mini-cal');
    const waterEl = document.getElementById('nn-mini-water');
    const statusEl = document.getElementById('nn-mini-status');

    if (calEl) calEl.textContent = `${u.calories} / ${u.calorieGoal}`;
    if (waterEl) waterEl.textContent = `${u.water}%`;

    let status = 'Здоров';
    if (u.diseases.length > 0) status = '⚠ ' + u.diseases[0].name;
    else if (u.debuffs.length > 0) status = u.debuffs[0].name;
    else if (u.satiety < 30) status = 'Голод';
    if (statusEl) statusEl.textContent = status;
}

// ─── UI: MAIN CARD ───────────────────────────────────────────
let cardOpen = false;

function buildCard() {
    if (document.getElementById('nn-card')) return;

    const card = document.createElement('div');
    card.id = 'nn-card';
    card.className = 'nn-hidden';
    card.innerHTML = `
        <div class="nn-card-topbar">
            <div class="nn-card-drag-handle" id="nn-card-drag">⁙</div>
            <span class="nn-card-topbar-title">Nutrition</span>
            <button id="nn-card-close" class="nn-card-close">✕</button>
        </div>

        <div class="nn-card-columns">
            <div class="nn-card-col">
                <div class="nn-card-char-header">
                    <div class="nn-card-avatar-wrap">
                        <img id="nn-card-avatar-user" class="nn-card-avatar" src="" alt="">
                    </div>
                    <div class="nn-card-char-name" id="nn-card-name-user">User</div>
                </div>
                <div class="nn-card-indicators" id="nn-indicators-user"></div>
            </div>
            <div class="nn-card-col">
                <div class="nn-card-char-header">
                    <div class="nn-card-avatar-wrap">
                        <img id="nn-card-avatar-bot" class="nn-card-avatar" src="" alt="">
                    </div>
                    <div class="nn-card-char-name" id="nn-card-name-bot">Bot</div>
                </div>
                <div class="nn-card-indicators" id="nn-indicators-bot"></div>
            </div>
        </div>

        <div class="nn-card-sections">
            <div class="nn-section">
                <div class="nn-section-title">🦠 Болезни</div>
                <div id="nn-diseases-list" class="nn-section-body">
                    <span class="nn-empty">Нет заболеваний</span>
                </div>
            </div>
            <div class="nn-section">
                <div class="nn-section-title">✨ Баффы</div>
                <div id="nn-buffs-list" class="nn-section-body">
                    <span class="nn-empty">Нет баффов</span>
                </div>
            </div>
            <div class="nn-section">
                <div class="nn-section-title">☠ Дебаффы</div>
                <div id="nn-debuffs-list" class="nn-section-body">
                    <span class="nn-empty">Нет дебаффов</span>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(card);

    document.getElementById('nn-card-close').addEventListener('click', () => setCard(false));

    // Drag — ONLY on the handle, not the whole card
    makeDraggable(card, document.getElementById('nn-card-drag'));
}

function toggleCard() { setCard(!cardOpen); }

function setCard(open) {
    cardOpen = open;
    const card = document.getElementById('nn-card');
    if (!card) return;
    if (open) {
        card.classList.remove('nn-hidden');
        restoreCardPos(card);
        renderCard();
    } else {
        card.classList.add('nn-hidden');
    }
}

function renderCard() {
    if (!state || !cardOpen) return;

    // USER
    const avatarUser = document.getElementById('nn-card-avatar-user');
    const nameUser = document.getElementById('nn-card-name-user');
    if (avatarUser) {
        const src = getUserAvatar();
        avatarUser.src = src || '';
        avatarUser.style.display = src ? '' : 'none';
    }
    if (nameUser) nameUser.textContent = getUserName();
    renderIndicators('nn-indicators-user', state.user);

    // BOT
    const avatarBot = document.getElementById('nn-card-avatar-bot');
    const nameBot = document.getElementById('nn-card-name-bot');
    const botState = getBotState();

    if (avatarBot) {
        const src = getBotAvatar();
        avatarBot.src = src || '';
        avatarBot.style.display = src ? '' : 'none';
    }
    if (nameBot) nameBot.textContent = getBotName();

    if (botState) {
        renderIndicators('nn-indicators-bot', botState);
    } else {
        const container = document.getElementById('nn-indicators-bot');
        if (container) container.innerHTML = '<span class="nn-empty">Нет данных</span>';
    }

    renderDiseases();
    renderBuffs();
    renderDebuffs();
}

function renderIndicators(containerId, charData) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const calPct = Math.min(100, (charData.calories / charData.calorieGoal) * 100);
    const overfill = charData.calories > charData.calorieGoal;

    container.innerHTML = `
        ${makeBar('🍎 Калории', `${charData.calories} / ${charData.calorieGoal}`, calPct, overfill)}
        ${makeBar('💧 Вода', `${charData.water}%`, charData.water)}
        ${makeBar('🥄 Сытость', `${charData.satiety}%`, charData.satiety)}
        ${makeBar('⚡ Энергия', `${charData.energy}%`, charData.energy)}
        <div class="nn-weight-row">
            <span>⚖ ${charData.weight} кг</span>
            ${charData.pregnant ? `<span class="nn-pregnant-badge">🤰 ${charData.pregnancyWeek} нед.</span>` : ''}
        </div>
    `;
}

function makeBar(label, valueText, pct, overfill = false) {
    const clamped = Math.max(0, Math.min(100, pct));
    let color;
    if (overfill) color = 'var(--nn-bar-overfill)';
    else if (clamped > 60) color = 'var(--nn-bar-good)';
    else if (clamped > 30) color = 'var(--nn-bar-warn)';
    else color = 'var(--nn-bar-danger)';

    return `
        <div class="nn-indicator">
            <div class="nn-indicator-top">
                <span>${label}</span>
                <span>${valueText}</span>
            </div>
            <div class="nn-bar">
                <div class="nn-bar-fill" style="width:${clamped}%;background:${color};"></div>
            </div>
        </div>
    `;
}

function renderDiseases() {
    const list = document.getElementById('nn-diseases-list');
    if (!list) return;
    const all = [
        ...state.user.diseases.map(d => ({ ...d, owner: getUserName() })),
        ...(getBotState()?.diseases || []).map(d => ({ ...d, owner: getBotName() })),
    ];
    if (all.length === 0) {
        list.innerHTML = '<span class="nn-empty">Нет заболеваний</span>';
        return;
    }
    list.innerHTML = all.map(d => `
        <div class="nn-disease-item nn-severity-${d.severity || 'mild'}">
            <div class="nn-disease-top">
                <span class="nn-disease-name">⚠ ${d.name}</span>
                <span class="nn-disease-owner">${d.owner}</span>
                <span class="nn-disease-severity">${d.severity || 'mild'}</span>
            </div>
            ${d.effects ? `<div class="nn-disease-effects">${d.effects.join(' · ')}</div>` : ''}
        </div>
    `).join('');
}

function renderBuffs() {
    const list = document.getElementById('nn-buffs-list');
    if (!list) return;
    const all = [
        ...state.user.buffs.map(b => ({ ...b, owner: getUserName() })),
        ...(getBotState()?.buffs || []).map(b => ({ ...b, owner: getBotName() })),
    ];
    if (all.length === 0) {
        list.innerHTML = '<span class="nn-empty">Нет баффов</span>';
        return;
    }
    list.innerHTML = all.map(b => `
        <div class="nn-buff-item">
            <span>✨ ${b.name}</span>
            <span class="nn-buff-owner">${b.owner}</span>
            ${b.remainingHours ? `<span class="nn-buff-time">${b.remainingHours}ч</span>` : ''}
        </div>
    `).join('');
}

function renderDebuffs() {
    const list = document.getElementById('nn-debuffs-list');
    if (!list) return;
    const all = [
        ...state.user.debuffs.map(d => ({ ...d, owner: getUserName() })),
        ...(getBotState()?.debuffs || []).map(d => ({ ...d, owner: getBotName() })),
    ];
    if (all.length === 0) {
        list.innerHTML = '<span class="nn-empty">Нет дебаффов</span>';
        return;
    }
    list.innerHTML = all.map(d => `
        <div class="nn-debuff-item">
            <span>☠ ${d.name}</span>
            <span class="nn-debuff-owner">${d.owner}</span>
            ${d.effects ? `<div class="nn-debuff-effects">${d.effects.join(' · ')}</div>` : ''}
        </div>
    `).join('');
}

// ─── DRAG (only desktop, only via handle) ─────────────────────
function makeDraggable(el, handle) {
    if (!el || !handle) return;
    // Skip drag on mobile entirely — prevents tap issues
    if (window.innerWidth <= 768) return;

    let startX, startY, origX, origY, dragging = false;

    handle.style.touchAction = 'none';

    handle.addEventListener('pointerdown', (e) => {
        if (window.innerWidth <= 768) return; // double-check
        dragging = true;
        const rect = el.getBoundingClientRect();
        el.style.left = rect.left + 'px';
        el.style.top = rect.top + 'px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        el.style.transform = 'none';
        origX = rect.left;
        origY = rect.top;
        startX = e.clientX;
        startY = e.clientY;
        handle.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    handle.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        let nx = origX + dx;
        let ny = origY + dy;
        nx = Math.max(0, Math.min(window.innerWidth - 100, nx));
        ny = Math.max(0, Math.min(window.innerHeight - 60, ny));
        el.style.left = nx + 'px';
        el.style.top = ny + 'px';
    });

    handle.addEventListener('pointerup', (e) => {
        if (!dragging) return;
        dragging = false;
        handle.releasePointerCapture(e.pointerId);
        saveCardPos(el);
    });
}

function saveCardPos(el) {
    const rect = el.getBoundingClientRect();
    localStorage.setItem(POS_LS_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
}

function restoreCardPos(el) {
    // Mobile: center with CSS, don't restore position
    if (window.innerWidth <= 768) {
        el.style.left = '';
        el.style.top = '';
        el.style.right = '';
        el.style.bottom = '';
        el.style.transform = '';
        return;
    }
    const saved = localStorage.getItem(POS_LS_KEY);
    if (!saved) return;
    try {
        const { left, top } = JSON.parse(saved);
        const nx = Math.max(0, Math.min(window.innerWidth - 200, left));
        const ny = Math.max(0, Math.min(window.innerHeight - 100, top));
        el.style.left = nx + 'px';
        el.style.top = ny + 'px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        el.style.transform = 'none';
    } catch {}
}

// ─── SETTINGS PANEL ──────────────────────────────────────────
function injectSettingsPanel() {
    let attempts = 0;
    const interval = setInterval(() => {
        attempts++;
        const container = document.querySelector('#extensions_settings2')
                       || document.querySelector('#extensions_settings');
        if (container) {
            clearInterval(interval);
            container.insertAdjacentHTML('beforeend', `
                <div class="inline-drawer" id="nn-settings-drawer">
                    <div class="inline-drawer-toggle inline-drawer-header">
                        <b>Nutrition Framework</b>
                        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                    </div>
                    <div class="inline-drawer-content" id="nn-settings-content">
                        <div class="nn-set-row">
                            <label for="nn-chk-enabled">Включить расширение:</label>
                            <input type="checkbox" id="nn-chk-enabled" ${isEnabled() ? 'checked' : ''}>
                        </div>
                        <hr>
                        <div class="nn-set-row">
                            <button id="nn-btn-reset" class="menu_button">Сбросить прогресс</button>
                        </div>
                        <p style="font-size:0.72rem;opacity:0.5;margin:8px 0 4px;">Тест:</p>
                        <div class="nn-set-row nn-set-debug">
                            <button id="nn-btn-test-hunger" class="menu_button">🧪 Голод</button>
                            <button id="nn-btn-test-feed" class="menu_button">🧪 Еда</button>
                            <button id="nn-btn-test-disease" class="menu_button">🧪 Болезнь</button>
                        </div>
                    </div>
                </div>
            `);
            bindSettingsEvents();
        }
        if (attempts >= 40) clearInterval(interval);
    }, 250);
}

function bindSettingsEvents() {
    const chk = document.getElementById('nn-chk-enabled');
    if (chk) chk.addEventListener('change', () => setEnabled(chk.checked));

    document.getElementById('nn-btn-reset')?.addEventListener('click', () => {
        if (!confirm('Сбросить питание?')) return;
        chat_metadata[META_KEY] = defaultState();
        loadState();
        saveState();
    });

    document.getElementById('nn-btn-test-hunger')?.addEventListener('click', () => {
        if (!state) return;
        state.user.satiety = Math.max(0, state.user.satiety - 30);
        state.user.water = Math.max(0, state.user.water - 15);
        state.user.energy = Math.max(0, state.user.energy - 20);
        state.user.calories = Math.max(0, state.user.calories - 200);
        if (state.user.satiety <= 20 && !state.user.debuffs.find(d => d.id === 'hunger')) {
            state.user.debuffs.push({
                id: 'hunger', name: 'Голод',
                effects: ['Энергия -20%', 'Концентрация -15%'],
                remainingHours: 4,
            });
        }
        saveState();
    });

    document.getElementById('nn-btn-test-feed')?.addEventListener('click', () => {
        if (!state) return;
        state.user.calories = Math.min(state.user.calorieGoal + 500, state.user.calories + 500);
        state.user.satiety = Math.min(100, state.user.satiety + 40);
        state.user.water = Math.min(100, state.user.water + 20);
        state.user.energy = Math.min(100, state.user.energy + 15);
        state.user.debuffs = state.user.debuffs.filter(d => d.id !== 'hunger');
        if (state.user.satiety > 80 && !state.user.buffs.find(b => b.id === 'well_fed')) {
            state.user.buffs.push({
                id: 'well_fed', name: 'Сытость',
                description: 'Энергия +10%', remainingHours: 6,
            });
        }
        saveState();
    });

    document.getElementById('nn-btn-test-disease')?.addEventListener('click', () => {
        if (!state) return;
        if (!state.user.diseases.find(d => d.id === 'hypoglycemia')) {
            state.user.diseases.push({
                id: 'hypoglycemia', name: 'Гипогликемия',
                severity: 'moderate',
                effects: ['Головокружение', 'Слабость', 'Тремор'],
                startedAt: Date.now(),
            });
        }
        saveState();
    });
}

// ─── EVENTS ──────────────────────────────────────────────────
function onChatChanged() {
    loadState();
    renderMiniBar();
    renderCard();
}

// ─── INIT ─────────────────────────────────────────────────────
function init() {
    console.log('[Nutrition Framework] init');
    buildToggleButton();
    buildMiniBar();
    buildCard();
    injectSettingsPanel();
    loadState();
    renderMiniBar();
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
}

jQuery(() => init());
export { init };
