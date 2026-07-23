// nell-nutrition/index.js — FULL REWRITE v2

import {
    chat, chat_metadata, this_chid, characters,
    setExtensionPrompt, extension_prompt_types, extension_prompt_roles,
    saveChatDebounced, name1,
} from '../../../../script.js';

import { eventSource, event_types } from '../../../../scripts/events.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════
const MODULE = 'nellNutrition';
const META_KEY = 'nellNutritionState';
const PROMPT_KEY = 'nell_nutrition_state';
const ENABLED_LS_KEY = 'nellNutrition_enabled';
const POS_LS_KEY = 'nellNutrition_cardPos';

// ═══════════════════════════════════════════════════════════════
// ENABLE / DISABLE
// ═══════════════════════════════════════════════════════════════
function isEnabled() {
    return localStorage.getItem(ENABLED_LS_KEY) !== 'false';
}

function setEnabled(val) {
    localStorage.setItem(ENABLED_LS_KEY, val ? 'true' : 'false');
    const chk = document.getElementById('nn-chk-enabled');
    if (chk) chk.checked = val;
    if (!val) {
        setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.IN_CHAT, 2, true, extension_prompt_roles.SYSTEM);
    }
    renderMiniBar();
    renderCard();
}

// ═══════════════════════════════════════════════════════════════
// STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════
let state = null;

function defaultCharState(name = '', charId = '') {
    return {
        charId,
        name,
        calories: 0,
        calorieGoal: 2200,
        water: 100,
        satiety: 100,
        energy: 100,
        health: 100,
        weight: 65,
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

// ═══════════════════════════════════════════════════════════════
// UI: TOGGLE BUTTON
// ═══════════════════════════════════════════════════════════════
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

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleCard();
    });

    btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        toggleCard();
    });
}

// ═══════════════════════════════════════════════════════════════
// UI: MINI BAR (above input field)
// ═══════════════════════════════════════════════════════════════
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

    let status = 'OK';
    if (u.diseases.length > 0) status = '⚠ ' + u.diseases[0].name;
    else if (u.debuffs.length > 0) status = u.debuffs[0].name;
    else if (u.satiety < 30) status = 'Hungry';
    else if (u.energy > 80 && u.health > 80) status = 'Healthy';
    if (statusEl) statusEl.textContent = status;
}

// ═══════════════════════════════════════════════════════════════
// UI: MAIN CARD — BUILD DOM
// ═══════════════════════════════════════════════════════════════
let cardOpen = false;
let activeTab = 'overview';

function buildCard() {
    if (document.getElementById('nn-card')) return;

    const card = document.createElement('div');
    card.id = 'nn-card';
    card.className = 'nn-hidden';
    card.innerHTML = `
        <!-- HEADER -->
        <div class="nn-header">
            <div class="nn-header-left">
                <div class="nn-drag-handle" id="nn-drag-handle">⁙</div>
                <span class="nn-header-title">Nutrition Framework</span>
                <span class="nn-header-sparkle">✦</span>
            </div>
            <div class="nn-header-right">
                <button class="nn-header-btn" id="nn-btn-help" title="Help">?</button>
                <button class="nn-header-btn" id="nn-btn-close" title="Close">✕</button>
            </div>
        </div>

        <!-- TABS -->
        <div class="nn-tabs" id="nn-tabs">
            <button class="nn-tab nn-tab-active" data-tab="overview">Overview</button>
            <button class="nn-tab" data-tab="nutrition">Nutrition</button>
            <button class="nn-tab" data-tab="hydration">Hydration</button>
            <button class="nn-tab" data-tab="status">Status</button>
            <button class="nn-tab" data-tab="conditions">Conditions</button>
            <button class="nn-tab" data-tab="history">History</button>
            <button class="nn-tab" data-tab="settings">Settings</button>
        </div>

        <!-- BODY -->
        <div class="nn-body" id="nn-body">
            <!-- Content rendered dynamically -->
        </div>

        <!-- FOOTER -->
        <div class="nn-footer">
            <div class="nn-footer-left">
                <span>⏱</span>
                <span id="nn-footer-time">Updated: just now</span>
            </div>
            <div class="nn-footer-tip">
                <span>✦</span>
                <span>Regular meals and hydration are key to survival.</span>
            </div>
            <button class="nn-footer-btn" id="nn-footer-note-btn">
                <span>📝</span> Add Note
            </button>
        </div>
    `;

    // Wrapper
    let wrapper = document.getElementById('nn-card-wrapper');
    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.id = 'nn-card-wrapper';
        document.body.appendChild(wrapper);
    }
    wrapper.appendChild(card);

    // Events
    document.getElementById('nn-btn-close').addEventListener('click', () => setCard(false));

    // Tabs
    card.querySelectorAll('.nn-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            activeTab = tab.dataset.tab;
            card.querySelectorAll('.nn-tab').forEach(t => t.classList.remove('nn-tab-active'));
            tab.classList.add('nn-tab-active');
            renderCardBody();
        });
    });

    // Drag (desktop only)
    makeDraggable(card, document.getElementById('nn-drag-handle'));
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
    renderCardBody();
}

// ═══════════════════════════════════════════════════════════════
// RENDER CARD BODY (by active tab)
// ═══════════════════════════════════════════════════════════════
function renderCardBody() {
    const body = document.getElementById('nn-body');
    if (!body || !state) return;

    switch (activeTab) {
        case 'overview':  renderOverview(body); break;
        case 'nutrition': renderNutritionTab(body); break;
        case 'hydration': renderHydrationTab(body); break;
        case 'status':    renderStatusTab(body); break;
        case 'conditions':renderConditionsTab(body); break;
        case 'history':   renderHistoryTab(body); break;
        case 'settings':  renderSettingsTab(body); break;
        default:          renderOverview(body); break;
    }
}

// ─── OVERVIEW TAB ─────────────────────────────────────────────
function renderOverview(body) {
    const u = state.user;
    const b = getBotState();

    body.innerHTML = `
        <!-- Character cards -->
        <div class="nn-chars-row">
            ${renderCharCard(u, getUserAvatar(), getUserName(), true)}
            ${b ? renderCharCard(b, getBotAvatar(), getBotName(), false) : renderEmptyBotCard()}
        </div>

        <!-- Sections row -->
        <div class="nn-sections-row">
            ${renderConditionsSection()}
            ${renderBuffsSection()}
            ${renderDebuffsSection()}
        </div>
    `;
}

function renderCharCard(data, avatarSrc, charName, isUser) {
    const calPct = Math.min(100, Math.round((data.calories / data.calorieGoal) * 100));
    const overfill = data.calories > data.calorieGoal;

    let barClass = '';
    if (overfill) barClass = 'nn-overfill';
    else if (calPct < 30) barClass = 'nn-danger';
    else if (calPct < 60) barClass = 'nn-warn';

    const statusInfo = getOverallStatus(data);
    const icon = isUser ? '♛' : '♜';

    const avatarHtml = avatarSrc
        ? `<img src="${avatarSrc}" alt="${charName}">`
        : `<div class="nn-char-avatar-placeholder">👤</div>`;

    const pregnancyHtml = data.pregnant
        ? `<span class="nn-pregnancy-badge">🤰 ${data.pregnancyWeek > 0 ? data.pregnancyWeek + ' wk' : 'Early'}</span>`
        : '';

    return `
    <div class="nn-char-card">
        <button class="nn-char-menu-btn" title="Options">⋯</button>

        <div class="nn-char-top">
            <div class="nn-char-avatar">${avatarHtml}</div>
            <div class="nn-char-info">
                <div class="nn-char-name">
                    ${charName}
                    <span class="nn-char-name-icon">${icon}</span>
                </div>
                <div class="nn-char-subtitle">Daily Calories</div>
            </div>
        </div>

        <div class="nn-cal-block">
            <div class="nn-cal-numbers">
                <span class="nn-cal-current">${data.calories}</span>
                <span class="nn-cal-sep">/</span>
                <span class="nn-cal-goal">${data.calorieGoal}</span>
                <span class="nn-cal-unit">kcal</span>
            </div>
            <div class="nn-cal-bar-row">
                <div class="nn-cal-bar">
                    <div class="nn-cal-bar-fill ${barClass}" style="width:${Math.min(100, calPct)}%"></div>
                </div>
                <span class="nn-cal-pct">${calPct}%</span>
            </div>
        </div>

        <div class="nn-stats-grid">
            ${renderStatRow('🥄', 'Satiety', data.satiety, 'satiety')}
            ${renderStatRow('💧', 'Hydration', data.water, 'water')}
            ${renderStatRow('⚡', 'Energy', data.energy, 'energy')}
            ${renderStatRow('❤', 'Health', data.health, 'health')}
        </div>

        <div class="nn-weight-line">
            <span>⚖</span> <span>Weight</span> <b>${data.weight} kg</b>
            ${pregnancyHtml}
        </div>

        <div class="nn-status-circle-wrap">
            <div class="nn-status-circle ${statusInfo.cls}">
                ${statusInfo.icon}
            </div>
            <span class="nn-status-label">Status</span>
            <span class="nn-status-text">${statusInfo.text}</span>
        </div>
    </div>`;
}

function renderEmptyBotCard() {
    return `
    <div class="nn-char-card" style="opacity:0.5;display:flex;align-items:center;justify-content:center;min-height:200px;">
        <span class="nn-empty">No character loaded</span>
    </div>`;
}

function renderStatRow(icon, label, value, type) {
    const clamped = Math.max(0, Math.min(100, value));
    return `
    <div class="nn-stat-row">
        <span class="nn-stat-icon">${icon}</span>
        <span class="nn-stat-label">${label}</span>
        <div class="nn-stat-bar">
            <div class="nn-stat-bar-fill nn-fill-${type}" style="width:${clamped}%"></div>
        </div>
        <span class="nn-stat-val">${Math.round(value)}%</span>
    </div>`;
}

function getOverallStatus(data) {
    if (data.diseases.some(d => d.severity === 'critical' || d.severity === 'severe')) {
        return { text: 'Critical', icon: '💔', cls: 'nn-status-danger' };
    }
    if (data.diseases.length > 0 || data.health < 40 || data.energy < 20) {
        return { text: 'Unstable', icon: '⚠', cls: 'nn-status-warn' };
    }
    if (data.satiety < 30 || data.water < 30) {
        return { text: 'Stressed', icon: '⚡', cls: 'nn-status-warn' };
    }
    if (data.health > 70 && data.energy > 60 && data.satiety > 50) {
        return { text: 'Healthy', icon: '♥', cls: '' };
    }
    return { text: 'Stable', icon: '♥', cls: '' };
}
// ─── SECTIONS (bottom of Overview) ────────────────────────────
function renderConditionsSection() {
    const allDiseases = [
        ...state.user.diseases.map(d => ({ ...d, owner: getUserName() })),
        ...(getBotState()?.diseases || []).map(d => ({ ...d, owner: getBotName() })),
    ];

    const items = allDiseases.length > 0
        ? allDiseases.slice(0, 3).map(d => {
            const sevCls = d.severity === 'severe' ? 'nn-sev-severe'
                         : d.severity === 'critical' ? 'nn-sev-critical' : '';
            const effectsHtml = (d.effects || []).map(e => `
                <div class="nn-condition-effect">
                    <span class="nn-condition-effect-name">⚡ ${e}</span>
                </div>`).join('');

            return `
            <div class="nn-condition-item ${sevCls}">
                <div class="nn-condition-top">
                    <span class="nn-condition-name">⊘ ${d.name}${d.severity ? ` (${d.severity})` : ''}</span>
                    <span class="nn-condition-time">${d.since || ''}</span>
                </div>
                <div class="nn-condition-effects">${effectsHtml}</div>
            </div>`;
        }).join('')
        : '<span class="nn-empty">No conditions</span>';

    return `
    <div class="nn-section">
        <div class="nn-section-header">
            <span class="nn-section-icon">⚠</span>
            <span class="nn-section-title">Conditions</span>
        </div>
        <div class="nn-section-body">${items}</div>
        <div class="nn-section-footer">
            <button class="nn-section-footer-btn" data-goto="conditions">View All Conditions ›</button>
        </div>
    </div>`;
}

function renderBuffsSection() {
    const allBuffs = [
        ...state.user.buffs.map(b => ({ ...b, owner: getUserName() })),
        ...(getBotState()?.buffs || []).map(b => ({ ...b, owner: getBotName() })),
    ];

    const items = allBuffs.length > 0
        ? allBuffs.slice(0, 4).map(b => `
            <div class="nn-buff-item">
                <div class="nn-buff-left">
                    <span class="nn-buff-icon">${b.icon || '🌿'}</span>
                    <span class="nn-buff-name">${b.name}</span>
                </div>
                <span class="nn-buff-val">${b.effect || ''}</span>
            </div>`).join('')
        : '<span class="nn-empty">No buffs</span>';

    return `
    <div class="nn-section">
        <div class="nn-section-header">
            <span class="nn-section-icon">✨</span>
            <span class="nn-section-title">Buffs</span>
        </div>
        <div class="nn-section-body">${items}</div>
        <div class="nn-section-footer">
            <button class="nn-section-footer-btn" data-goto="status">View All Buffs ›</button>
        </div>
    </div>`;
}

function renderDebuffsSection() {
    const allDebuffs = [
        ...state.user.debuffs.map(d => ({ ...d, owner: getUserName() })),
        ...(getBotState()?.debuffs || []).map(d => ({ ...d, owner: getBotName() })),
    ];

    const items = allDebuffs.length > 0
        ? allDebuffs.slice(0, 4).map(d => `
            <div class="nn-debuff-item">
                <div class="nn-debuff-left">
                    <span class="nn-debuff-icon">${d.icon || '☠'}</span>
                    <span class="nn-debuff-name">${d.name}</span>
                </div>
                <span class="nn-debuff-val">${d.effect || ''}</span>
            </div>`).join('')
        : '<span class="nn-empty">No debuffs</span>';

    return `
    <div class="nn-section">
        <div class="nn-section-header">
            <span class="nn-section-icon">☠</span>
            <span class="nn-section-title">Debuffs</span>
        </div>
        <div class="nn-section-body">${items}</div>
        <div class="nn-section-footer">
            <button class="nn-section-footer-btn" data-goto="status">View All Debuffs ›</button>
        </div>
    </div>`;
}
// ═══════════════════════════════════════════════════════════════
// TAB RENDERS — PLACEHOLDERS (will be expanded in Stage 2-4)
// ═══════════════════════════════════════════════════════════════

function renderNutritionTab(body) {
    const u = state.user;
    const calPct = Math.min(100, Math.round((u.calories / u.calorieGoal) * 100));

    body.innerHTML = `
        <div class="nn-tab-content">
            <div class="nn-section">
                <div class="nn-section-header">
                    <span class="nn-section-icon">🍎</span>
                    <span class="nn-section-title">Calorie Intake — ${getUserName()}</span>
                </div>
                <div class="nn-section-body">
                    <div class="nn-cal-block">
                        <div class="nn-cal-numbers">
                            <span class="nn-cal-current">${u.calories}</span>
                            <span class="nn-cal-sep">/</span>
                            <span class="nn-cal-goal">${u.calorieGoal}</span>
                            <span class="nn-cal-unit">kcal</span>
                        </div>
                        <div class="nn-cal-bar-row">
                            <div class="nn-cal-bar">
                                <div class="nn-cal-bar-fill ${calPct < 30 ? 'nn-danger' : calPct < 60 ? 'nn-warn' : ''}" style="width:${Math.min(100, calPct)}%"></div>
                            </div>
                            <span class="nn-cal-pct">${calPct}%</span>
                        </div>
                    </div>

                    <div class="nn-info-grid">
                        <div class="nn-info-item">
                            <span class="nn-info-label">Satiety</span>
                            <span class="nn-info-value">${u.satiety}%</span>
                        </div>
                        <div class="nn-info-item">
                            <span class="nn-info-label">Hours since meal</span>
                            <span class="nn-info-value">${u.hoursSinceLastMeal}h</span>
                        </div>
                        <div class="nn-info-item">
                            <span class="nn-info-label">Daily goal</span>
                            <span class="nn-info-value">${u.calorieGoal} kcal</span>
                        </div>
                        <div class="nn-info-item">
                            <span class="nn-info-label">Weight</span>
                            <span class="nn-info-value">${u.weight} kg</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="nn-section">
                <div class="nn-section-header">
                    <span class="nn-section-icon">📊</span>
                    <span class="nn-section-title">How It Works</span>
                </div>
                <div class="nn-section-body">
                    <p class="nn-help-text">Calories are consumed automatically as game time passes. Eating restores calories and satiety. Going too long without food leads to debuffs, diseases, and physical deterioration.</p>
                    <p class="nn-help-text">The AI detects meals in the narrative and updates your state accordingly.</p>
                </div>
            </div>
        </div>
    `;
}

function renderHydrationTab(body) {
    const u = state.user;

    body.innerHTML = `
        <div class="nn-tab-content">
            <div class="nn-section">
                <div class="nn-section-header">
                    <span class="nn-section-icon">💧</span>
                    <span class="nn-section-title">Hydration — ${getUserName()}</span>
                </div>
                <div class="nn-section-body">
                    <div class="nn-stat-row" style="grid-template-columns: 24px 80px 1fr 40px;">
                        <span class="nn-stat-icon">💧</span>
                        <span class="nn-stat-label">Water</span>
                        <div class="nn-stat-bar">
                            <div class="nn-stat-bar-fill nn-fill-water" style="width:${u.water}%"></div>
                        </div>
                        <span class="nn-stat-val">${u.water}%</span>
                    </div>

                    <div class="nn-info-grid" style="margin-top:12px;">
                        <div class="nn-info-item">
                            <span class="nn-info-label">Hydration level</span>
                            <span class="nn-info-value">${u.water >= 70 ? 'Good' : u.water >= 40 ? 'Low' : 'Critical'}</span>
                        </div>
                        <div class="nn-info-item">
                            <span class="nn-info-label">Dehydration risk</span>
                            <span class="nn-info-value" style="color:${u.water < 30 ? 'var(--nn-red)' : u.water < 50 ? 'var(--nn-orange)' : 'var(--nn-green)'}">
                                ${u.water < 30 ? 'High' : u.water < 50 ? 'Moderate' : 'Low'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="nn-section">
                <div class="nn-section-header">
                    <span class="nn-section-icon">ℹ</span>
                    <span class="nn-section-title">About Hydration</span>
                </div>
                <div class="nn-section-body">
                    <p class="nn-help-text">Water drops over time. Drinking restores it. Below 30% you risk dehydration debuffs. Below 15% — critical condition with severe penalties.</p>
                </div>
            </div>
        </div>
    `;
}

function renderStatusTab(body) {
    const u = state.user;
    const b = getBotState();

    const allBuffs = [
        ...u.buffs.map(x => ({ ...x, owner: getUserName() })),
        ...(b?.buffs || []).map(x => ({ ...x, owner: getBotName() })),
    ];
    const allDebuffs = [
        ...u.debuffs.map(x => ({ ...x, owner: getUserName() })),
        ...(b?.debuffs || []).map(x => ({ ...x, owner: getBotName() })),
    ];

    const buffsHtml = allBuffs.length > 0
        ? allBuffs.map(bf => `
            <div class="nn-buff-item">
                <div class="nn-buff-left">
                    <span class="nn-buff-icon">${bf.icon || '🌿'}</span>
                    <span class="nn-buff-name">${bf.name}</span>
                </div>
                <span class="nn-buff-val">${bf.effect || ''}</span>
            </div>`).join('')
        : '<span class="nn-empty">No active buffs</span>';

    const debuffsHtml = allDebuffs.length > 0
        ? allDebuffs.map(df => `
            <div class="nn-debuff-item">
                <div class="nn-debuff-left">
                    <span class="nn-debuff-icon">${df.icon || '☠'}</span>
                    <span class="nn-debuff-name">${df.name}</span>
                </div>
                <span class="nn-debuff-val">${df.effect || ''}</span>
            </div>`).join('')
        : '<span class="nn-empty">No active debuffs</span>';

    body.innerHTML = `
        <div class="nn-tab-content">
            <div class="nn-section">
                <div class="nn-section-header">
                    <span class="nn-section-icon">✨</span>
                    <span class="nn-section-title">Active Buffs</span>
                </div>
                <div class="nn-section-body">${buffsHtml}</div>
            </div>
            <div class="nn-section">
                <div class="nn-section-header">
                    <span class="nn-section-icon">☠</span>
                    <span class="nn-section-title">Active Debuffs</span>
                </div>
                <div class="nn-section-body">${debuffsHtml}</div>
            </div>
        </div>
    `;
}

function renderConditionsTab(body) {
    const u = state.user;
    const b = getBotState();

    const all = [
        ...u.diseases.map(d => ({ ...d, owner: getUserName() })),
        ...(b?.diseases || []).map(d => ({ ...d, owner: getBotName() })),
    ];

    const itemsHtml = all.length > 0
        ? all.map(d => {
            const sevCls = d.severity === 'severe' ? 'nn-sev-severe'
                         : d.severity === 'critical' ? 'nn-sev-critical' : '';
            const effectsHtml = (d.effects || []).map(e => `
                <div class="nn-condition-effect">
                    <span class="nn-condition-effect-name">⚡ ${e}</span>
                </div>`).join('');

            return `
            <div class="nn-condition-item ${sevCls}">
                <div class="nn-condition-top">
                    <span class="nn-condition-name">⊘ ${d.name}${d.severity ? ` (${d.severity})` : ''}</span>
                    <span class="nn-condition-time">${d.owner}</span>
                </div>
                <div class="nn-condition-effects">${effectsHtml}</div>
            </div>`;
        }).join('')
        : '<span class="nn-empty">No active conditions — keep eating well!</span>';

    body.innerHTML = `
        <div class="nn-tab-content">
            <div class="nn-section">
                <div class="nn-section-header">
                    <span class="nn-section-icon">🦠</span>
                    <span class="nn-section-title">All Conditions & Diseases</span>
                </div>
                <div class="nn-section-body">${itemsHtml}</div>
            </div>
        </div>
    `;
}

function renderHistoryTab(body) {
    body.innerHTML = `
        <div class="nn-tab-content">
            <div class="nn-section">
                <div class="nn-section-header">
                    <span class="nn-section-icon">📜</span>
                    <span class="nn-section-title">Meal History</span>
                </div>
                <div class="nn-section-body">
                    <span class="nn-empty">Meal tracking will appear here as the story progresses.</span>
                    <p class="nn-help-text" style="margin-top:8px;">Every detected meal, drink, or snack will be logged with approximate calories and time.</p>
                </div>
            </div>
        </div>
    `;
}
// ═══════════════════════════════════════════════════════════════
// SETTINGS TAB (inside the card)
// ═══════════════════════════════════════════════════════════════
function renderSettingsTab(body) {
    const u = state.user;
    const b = getBotState();

    body.innerHTML = `
        <div class="nn-tab-content">
            <div class="nn-section">
                <div class="nn-section-header">
                    <span class="nn-section-icon">⚙</span>
                    <span class="nn-section-title">General</span>
                </div>
                <div class="nn-section-body">
                    <div class="nn-settings-row">
                        <label>Extension enabled</label>
                        <input type="checkbox" id="nn-set-enabled" ${isEnabled() ? 'checked' : ''}>
                    </div>
                    <div class="nn-settings-row">
                        <label>User calorie goal</label>
                        <input type="number" id="nn-set-cal-goal" value="${u.calorieGoal}" min="800" max="5000" style="width:80px;">
                    </div>
                    <div class="nn-settings-row">
                        <label>User weight (kg)</label>
                        <input type="number" id="nn-set-weight" value="${u.weight}" min="30" max="300" step="0.1" style="width:80px;">
                    </div>
                    <div class="nn-settings-row">
                        <label>Pregnancy</label>
                        <input type="checkbox" id="nn-set-pregnant" ${u.pregnant ? 'checked' : ''}>
                        <input type="number" id="nn-set-preg-week" value="${u.pregnancyWeek}" min="0" max="42" style="width:60px;margin-left:8px;" placeholder="week">
                    </div>
                </div>
            </div>

            <div class="nn-section">
                <div class="nn-section-header">
                    <span class="nn-section-icon">🧪</span>
                    <span class="nn-section-title">Debug & Testing</span>
                </div>
                <div class="nn-section-body">
                    <div class="nn-settings-row nn-settings-btns">
                        <button class="nn-set-btn" id="nn-dbg-hunger">🧪 Hunger</button>
                        <button class="nn-set-btn" id="nn-dbg-feed">🧪 Feed</button>
                        <button class="nn-set-btn" id="nn-dbg-disease">🧪 Disease</button>
                        <button class="nn-set-btn" id="nn-dbg-drink">🧪 Drink</button>
                        <button class="nn-set-btn" id="nn-dbg-clear">🧹 Clear All</button>
                    </div>
                </div>
            </div>

            <div class="nn-section">
                <div class="nn-section-header">
                    <span class="nn-section-icon">⚠</span>
                    <span class="nn-section-title">Danger Zone</span>
                </div>
                <div class="nn-section-body">
                    <div class="nn-settings-row">
                        <button class="nn-set-btn nn-set-btn-danger" id="nn-dbg-reset">Reset All Progress</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Bind settings events
    document.getElementById('nn-set-enabled')?.addEventListener('change', (e) => {
        setEnabled(e.target.checked);
    });

    document.getElementById('nn-set-cal-goal')?.addEventListener('change', (e) => {
        const val = parseInt(e.target.value);
        if (!isNaN(val) && val >= 800 && val <= 5000) {
            state.user.calorieGoal = val;
            saveState();
        }
    });

    document.getElementById('nn-set-weight')?.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val >= 30 && val <= 300) {
            state.user.weight = val;
            saveState();
        }
    });

    document.getElementById('nn-set-pregnant')?.addEventListener('change', (e) => {
        state.user.pregnant = e.target.checked;
        if (!e.target.checked) state.user.pregnancyWeek = 0;
        saveState();
    });

    document.getElementById('nn-set-preg-week')?.addEventListener('change', (e) => {
        const val = parseInt(e.target.value);
        if (!isNaN(val) && val >= 0 && val <= 42) {
            state.user.pregnancyWeek = val;
            if (val > 0) state.user.pregnant = true;
            saveState();
        }
    });

    // Debug buttons
    document.getElementById('nn-dbg-hunger')?.addEventListener('click', () => {
        state.user.satiety = Math.max(0, state.user.satiety - 30);
        state.user.water = Math.max(0, state.user.water - 15);
        state.user.energy = Math.max(0, state.user.energy - 20);
        state.user.calories = Math.max(0, state.user.calories - 200);
        if (state.user.satiety <= 20 && !state.user.debuffs.find(d => d.id === 'hunger')) {
            state.user.debuffs.push({
                id: 'hunger', name: 'Hunger', icon: '🍽',
                effect: '-20% Energy',
                effects: ['Energy -20%', 'Focus -15%'],
            });
        }
        saveState();
    });

    document.getElementById('nn-dbg-feed')?.addEventListener('click', () => {
        state.user.calories = Math.min(state.user.calorieGoal + 500, state.user.calories + 600);
        state.user.satiety = Math.min(100, state.user.satiety + 40);
        state.user.energy = Math.min(100, state.user.energy + 15);
        state.user.debuffs = state.user.debuffs.filter(d => d.id !== 'hunger');
        if (state.user.satiety > 80 && !state.user.buffs.find(b => b.id === 'well_fed')) {
            state.user.buffs.push({
                id: 'well_fed', name: 'Well Fed', icon: '🍲',
                effect: '+15% Energy',
            });
        }
        saveState();
    });

    document.getElementById('nn-dbg-drink')?.addEventListener('click', () => {
        state.user.water = Math.min(100, state.user.water + 30);
        state.user.debuffs = state.user.debuffs.filter(d => d.id !== 'dehydration');
        saveState();
    });

    document.getElementById('nn-dbg-disease')?.addEventListener('click', () => {
        if (!state.user.diseases.find(d => d.id === 'hypoglycemia')) {
            state.user.diseases.push({
                id: 'hypoglycemia', name: 'Hypoglycemia',
                severity: 'moderate',
                effects: ['Dizziness', 'Weakness', 'Tremor'],
                since: 'Since 2h ago',
            });
        }
        saveState();
    });

    document.getElementById('nn-dbg-clear')?.addEventListener('click', () => {
        state.user.diseases = [];
        state.user.buffs = [];
        state.user.debuffs = [];
        state.user.satiety = 100;
        state.user.water = 100;
        state.user.energy = 100;
        state.user.health = 100;
        state.user.calories = 0;
        saveState();
    });

    document.getElementById('nn-dbg-reset')?.addEventListener('click', () => {
        if (!confirm('Reset ALL nutrition progress for this chat?')) return;
        chat_metadata[META_KEY] = defaultState();
        loadState();
        saveState();
    });
}
// ═══════════════════════════════════════════════════════════════
// DRAG (desktop only, via handle)
// ═══════════════════════════════════════════════════════════════
function makeDraggable(el, handle) {
    if (!el || !handle) return;
    if (window.innerWidth <= 768) return;

    let startX, startY, origX, origY, dragging = false;

    handle.style.touchAction = 'none';

    handle.addEventListener('pointerdown', (e) => {
        if (window.innerWidth <= 768) return;
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

// ═══════════════════════════════════════════════════════════════
// SETTINGS PANEL (Extensions sidebar — minimal)
// ═══════════════════════════════════════════════════════════════
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
                            <label for="nn-chk-enabled">Enable extension:</label>
                            <input type="checkbox" id="nn-chk-enabled" ${isEnabled() ? 'checked' : ''}>
                        </div>
                        <p style="font-size:0.7rem;opacity:0.6;margin:6px 0;">
                            Full settings available inside the Nutrition card (🍎 button → Settings tab).
                        </p>
                    </div>
                </div>
            `);
            const chk = document.getElementById('nn-chk-enabled');
            if (chk) chk.addEventListener('change', () => setEnabled(chk.checked));
        }
        if (attempts >= 40) clearInterval(interval);
    }, 250);
}
// ═══════════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════════
function onChatChanged() {
    loadState();
    renderMiniBar();
    renderCard();
}

function onMessageReceived(messageId) {
    if (!isEnabled()) return;
    if (!state) loadState();
    const msg = chat[messageId];
    if (!msg || msg.is_user) return;

    // Placeholder — in Stage 2 this will parse AI response for meals,
    // time passage, and update calories/water/energy accordingly.
    // For now, just mark as processed.
    state.lastProcessedMsgId = Number(messageId);
    saveState();
}

function onMessageSent(messageId) {
    if (!isEnabled()) return;
    if (!state) loadState();
    // Placeholder — in Stage 2 this will detect player actions
    // like "I eat" or "I drink water" and pre-process them.
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
function init() {
    console.log('[Nutrition Framework] init v2');
    buildToggleButton();
    buildMiniBar();
    buildCard();
    injectSettingsPanel();
    loadState();
    renderMiniBar();

    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    eventSource.on(event_types.MESSAGE_SENT, onMessageSent);
}

jQuery(() => init());
export { init };
