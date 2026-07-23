// nell-nutrition/index.js — STAGE 1: Skeleton + Mobile Test

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

function defaultState() {
    return {
        // Пользователь
        user: {
            calories: 0,
            calorieGoal: 2200,
            water: 100,       // % гидратации
            satiety: 100,     // % сытости
            weight: 65,       // кг
            energy: 100,      // %
            pregnant: false,
            pregnancyWeek: 0,
            diseases: [],     // [{id, name, severity, effects[], startedAt}]
            buffs: [],        // [{id, name, description, remainingHours}]
            debuffs: [],      // [{id, name, description, effects[], remainingHours}]
            lastMealTime: null,
            hoursSinceLastMeal: 0,
        },
        // Бот (массив для поддержки групповых чатов)
        characters: [],       // [{charId, name, avatar, calories, calorieGoal, water, ...same as user}]
        // Мета
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
    // Ensure user sub-fields
    for (const k of Object.keys(def.user)) {
        if (state.user[k] === undefined) state.user[k] = def.user[k];
    }
}

function saveState() {
    chat_metadata[META_KEY] = state;
    saveChatDebounced();
    renderMiniBar();
    renderCard();
}

// ─── PERSONA HELPERS ──────────────────────────────────────────
function getUserAvatar() {
    // SillyTavern stores active persona avatar
    const personaEl = document.querySelector('#user_avatar_block .avatar.selected img');
    if (personaEl) return personaEl.src;
    // fallback
    return '';
}

function getUserName() {
    return name1 || 'User';
}

// ─── UI: TOGGLE BUTTON (рядом с send) ────────────────────────
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

    btn.addEventListener('click', toggleCard);
}

// ─── UI: MINI BAR (вертикальная панель над нижним баром) ──────
function buildMiniBar() {
    if (document.getElementById('nn-minibar')) return;

    const bar = document.createElement('div');
    bar.id = 'nn-minibar';
    bar.innerHTML = `
        <div class="nn-mini-row nn-mini-cal">
            <span class="nn-mini-icon">🍎</span>
            <span class="nn-mini-val" id="nn-mini-cal">— / —</span>
        </div>
        <div class="nn-mini-row nn-mini-water">
            <span class="nn-mini-icon">💧</span>
            <span class="nn-mini-val" id="nn-mini-water">—%</span>
        </div>
        <div class="nn-mini-row nn-mini-status">
            <span class="nn-mini-icon">⚡</span>
            <span class="nn-mini-val" id="nn-mini-status">OK</span>
        </div>
    `;

    // Вставляем НАД формой отправки
    const form = document.getElementById('form_sheld') || document.getElementById('rightSendForm');
    if (form) {
        form.insertAdjacentElement('beforebegin', bar);
    } else {
        document.body.appendChild(bar);
    }

    bar.addEventListener('click', toggleCard);
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

    // Простой статус
    let status = 'OK';
    if (u.diseases.length > 0) status = '⚠ ' + u.diseases[0].name;
    else if (u.debuffs.length > 0) status = u.debuffs[0].name;
    else if (u.satiety < 30) status = 'Голод';
    else if (u.energy > 80) status = 'Здоров';
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
        <div class="nn-card-header">
            <div class="nn-card-avatar-wrap">
                <img id="nn-card-avatar" class="nn-card-avatar" src="" alt="">
            </div>
            <div class="nn-card-title-wrap">
                <div class="nn-card-name" id="nn-card-name">User</div>
                <div class="nn-card-subtitle">Nutrition Status</div>
            </div>
            <button id="nn-card-close" class="nn-card-close">✕</button>
        </div>

        <div class="nn-card-body">
            <!-- Calories -->
            <div class="nn-indicator">
                <div class="nn-indicator-top">
                    <span>🍎 Калории</span>
                    <span id="nn-ind-cal-val">0 / 2200</span>
                </div>
                <div class="nn-bar">
                    <div class="nn-bar-fill nn-bar-cal" id="nn-ind-cal-fill"></div>
                </div>
            </div>

            <!-- Hydration -->
            <div class="nn-indicator">
                <div class="nn-indicator-top">
                    <span>💧 Гидратация</span>
                    <span id="nn-ind-water-val">100%</span>
                </div>
                <div class="nn-bar">
                    <div class="nn-bar-fill nn-bar-water" id="nn-ind-water-fill"></div>
                </div>
            </div>

            <!-- Satiety -->
            <div class="nn-indicator">
                <div class="nn-indicator-top">
                    <span>🥄 Сытость</span>
                    <span id="nn-ind-sat-val">100%</span>
                </div>
                <div class="nn-bar">
                    <div class="nn-bar-fill nn-bar-sat" id="nn-ind-sat-fill"></div>
                </div>
            </div>

            <!-- Energy -->
            <div class="nn-indicator">
                <div class="nn-indicator-top">
                    <span>⚡ Энергия</span>
                    <span id="nn-ind-energy-val">100%</span>
                </div>
                <div class="nn-bar">
                    <div class="nn-bar-fill nn-bar-energy" id="nn-ind-energy-fill"></div>
                </div>
            </div>

            <!-- Weight -->
            <div class="nn-indicator">
                <div class="nn-indicator-top">
                    <span>⚖ Вес</span>
                    <span id="nn-ind-weight-val">65 кг</span>
                </div>
            </div>

            <!-- Pregnancy -->
            <div class="nn-section nn-pregnancy nn-hidden" id="nn-pregnancy-section">
                <div class="nn-section-title">🤰 Беременность</div>
                <div id="nn-pregnancy-info"></div>
            </div>

            <!-- Diseases -->
            <div class="nn-section nn-diseases" id="nn-diseases-section">
                <div class="nn-section-title">🦠 Болезни</div>
                <div id="nn-diseases-list" class="nn-section-body">
                    <span class="nn-empty">Нет заболеваний</span>
                </div>
            </div>

            <!-- Buffs -->
            <div class="nn-section nn-buffs" id="nn-buffs-section">
                <div class="nn-section-title">✨ Баффы</div>
                <div id="nn-buffs-list" class="nn-section-body">
                    <span class="nn-empty">Нет активных баффов</span>
                </div>
            </div>

            <!-- Debuffs -->
            <div class="nn-section nn-debuffs" id="nn-debuffs-section">
                <div class="nn-section-title">☠ Дебаффы</div>
                <div id="nn-debuffs-list" class="nn-section-body">
                    <span class="nn-empty">Нет дебаффов</span>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(card);
    document.getElementById('nn-card-close').addEventListener('click', () => setCard(false));
}

function toggleCard() { setCard(!cardOpen); }

function setCard(open) {
    cardOpen = open;
    const card = document.getElementById('nn-card');
    if (!card) return;
    if (open) {
        card.classList.remove('nn-hidden');
        renderCard();
    } else {
        card.classList.add('nn-hidden');
    }
}

function renderCard() {
    if (!state || !cardOpen) return;
    const u = state.user;

    // Avatar + Name
    const avatarEl = document.getElementById('nn-card-avatar');
    const nameEl = document.getElementById('nn-card-name');
    if (avatarEl) avatarEl.src = getUserAvatar();
    if (nameEl) nameEl.textContent = getUserName();

    // Indicators
    const calPct = Math.min(100, (u.calories / u.calorieGoal) * 100);
    setBar('nn-ind-cal-fill', calPct, u.calories >= u.calorieGoal);
    setText('nn-ind-cal-val', `${u.calories} / ${u.calorieGoal}`);

    setBar('nn-ind-water-fill', u.water);
    setText('nn-ind-water-val', `${u.water}%`);

    setBar('nn-ind-sat-fill', u.satiety);
    setText('nn-ind-sat-val', `${u.satiety}%`);

    setBar('nn-ind-energy-fill', u.energy);
    setText('nn-ind-energy-val', `${u.energy}%`);

    setText('nn-ind-weight-val', `${u.weight} кг`);

    // Pregnancy
    const pregSection = document.getElementById('nn-pregnancy-section');
    if (pregSection) {
        if (u.pregnant) {
            pregSection.classList.remove('nn-hidden');
            const info = document.getElementById('nn-pregnancy-info');
            if (info) info.textContent = `Неделя ${u.pregnancyWeek} · Норма калорий: ${u.calorieGoal}`;
        } else {
            pregSection.classList.add('nn-hidden');
        }
    }

    // Diseases
    const diseaseList = document.getElementById('nn-diseases-list');
    if (diseaseList) {
        if (u.diseases.length === 0) {
            diseaseList.innerHTML = '<span class="nn-empty">Нет заболеваний</span>';
        } else {
            diseaseList.innerHTML = u.diseases.map(d => `
                <div class="nn-disease-item nn-severity-${d.severity || 'mild'}">
                    <span class="nn-disease-name">⚠ ${d.name}</span>
                    <span class="nn-disease-severity">${d.severity || 'mild'}</span>
                    ${d.effects ? `<div class="nn-disease-effects">${d.effects.join(' · ')}</div>` : ''}
                </div>
            `).join('');
        }
    }

    // Buffs
    const buffList = document.getElementById('nn-buffs-list');
    if (buffList) {
        if (u.buffs.length === 0) {
            buffList.innerHTML = '<span class="nn-empty">Нет активных баффов</span>';
        } else {
            buffList.innerHTML = u.buffs.map(b => `
                <div class="nn-buff-item">
                    <span>✨ ${b.name}</span>
                    ${b.remainingHours ? `<span class="nn-buff-time">${b.remainingHours}ч</span>` : ''}
                </div>
            `).join('');
        }
    }

    // Debuffs
    const debuffList = document.getElementById('nn-debuffs-list');
    if (debuffList) {
        if (u.debuffs.length === 0) {
            debuffList.innerHTML = '<span class="nn-empty">Нет дебаффов</span>';
        } else {
            debuffList.innerHTML = u.debuffs.map(d => `
                <div class="nn-debuff-item">
                    <span>☠ ${d.name}</span>
                    ${d.effects ? `<div class="nn-debuff-effects">${d.effects.join(' · ')}</div>` : ''}
                </div>
            `).join('');
        }
    }
}

// Helpers
function setBar(id, pct, overfill = false) {
    const el = document.getElementById(id);
    if (!el) return;
    const clamped = Math.max(0, Math.min(100, pct));
    el.style.width = clamped + '%';
    // Color shift
    if (overfill) {
        el.style.background = 'var(--nn-bar-overfill)';
    } else if (clamped > 60) {
        el.style.background = 'var(--nn-bar-good)';
    } else if (clamped > 30) {
        el.style.background = 'var(--nn-bar-warn)';
    } else {
        el.style.background = 'var(--nn-bar-danger)';
    }
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

// ─── SETTINGS PANEL (Extensions tab) ─────────────────────────
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
                        <div class="nn-set-row">
                            <label>Статус:</label>
                            <span id="nn-set-status">—</span>
                        </div>
                        <div class="nn-set-row">
                            <button id="nn-btn-reset" class="menu_button">Сбросить прогресс чата</button>
                        </div>
                        <div class="nn-set-row nn-set-debug">
                            <button id="nn-btn-test-hunger" class="menu_button">🧪 Тест: голод -30%</button>
                            <button id="nn-btn-test-feed" class="menu_button">🧪 Тест: покормить +500</button>
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
        if (!confirm('Сбросить питание текущего чата?')) return;
        chat_metadata[META_KEY] = defaultState();
        loadState();
        saveState();
    });

    // Debug buttons for testing on mobile
    document.getElementById('nn-btn-test-hunger')?.addEventListener('click', () => {
        if (!state) return;
        state.user.satiety = Math.max(0, state.user.satiety - 30);
        state.user.water = Math.max(0, state.user.water - 15);
        state.user.energy = Math.max(0, state.user.energy - 20);
        if (state.user.satiety <= 10) {
            state.user.debuffs = [{ id: 'hunger', name: 'Голод', effects: ['Энергия -20%', 'Концентрация -15%'], remainingHours: 4 }];
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
        if (state.user.satiety > 80) {
            state.user.buffs = [{ id: 'well_fed', name: 'Сытость', description: 'Энергия +10%', remainingHours: 6 }];
        }
        saveState();
    });
}

// ─── EVENTS (заглушки — механики будут в Stage 2) ─────────────
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
