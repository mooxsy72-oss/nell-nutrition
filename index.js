// nell-nutrition/index.js — FULL REWRITE v2

import {
    chat, chat_metadata, this_chid, characters,
    setExtensionPrompt, extension_prompt_types, extension_prompt_roles,
    saveChatDebounced, name1,
} from '../../../../script.js';

import { eventSource, event_types } from '../../../../scripts/events.js';

import { power_user } from '../../../../scripts/power-user.js';

import {
    tickTime, applyMeal, applyDrink,
    getPhysicalStatus, updateWeight, resetDailyCalories,
    MEAL_CALORIES, HYDRATING_ITEMS,
    ACTIVITY_MULTIPLIERS, PREGNANCY_MULTIPLIER,
} from './nutrition-engine.js';

import {
    parseNnTag, detectFromText, parseGameTime,
} from './parser.js';

import {
    notify, queueNotify, flushQueue, setSilent,
} from './notifications.js';

import {
    evaluateConditions, buildConditionPrompt,
    getPregnancyStage, calculateImmunity, DISEASE_DB,
} from './conditions.js';

import {
    ACTIVITY_LEVELS, BUILD_TYPES, calculateCalorieGoal,
    buildCharacterParams, analyzeInitialState,
} from './analyzer.js';

import { PRODUCT_DB, PRODUCT_CATEGORIES } from './products.js';

// ═══════════════════════════════════════════════════════════════
// THEMES
// ═══════════════════════════════════════════════════════════════
const THEME_LS_KEY = 'nellNutrition_theme'; // 'violet' | 'rose' | 'adaptive'
const BG_LS_KEY = 'nellNutrition_bgImage';  // имя файла картинки в папке icons
const BG_OVERLAY_LS_KEY = 'nellNutrition_bgOverlay'; // 0–100 затемнение фона

// SVG-яблоко (красится через currentColor — само подстраивается под тему)
const NN_APPLE_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none"
    stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z"/>
    <path d="M10 2c1 .5 2 2 2 5"/>
</svg>`;

function getTheme() {
    return localStorage.getItem(THEME_LS_KEY) || 'violet';
}

function applyTheme(theme) {
    localStorage.setItem(THEME_LS_KEY, theme);
    const targets = [
        document.getElementById('nn-card'),
        document.getElementById('nn-minibar'),
        document.getElementById('nn-toggle'),
        document.getElementById('nn-notify-container'),
    ];
    for (const el of targets) {
        if (el) el.setAttribute('data-nn-theme', theme);
    }
    // Подсветить активную точку-переключатель
    document.querySelectorAll('.nn-theme-dot').forEach(d => {
        d.classList.toggle('nn-theme-dot-active', d.dataset.theme === theme);
    });
    applyCardBackground();
}

// Фоновая картинка карточки (лежит в папке icons расширения)
function applyCardBackground() {
    const card = document.getElementById('nn-card');
    if (!card) return;

    // Если пользователь ничего не вписал — используем bg.jpg по умолчанию
    const saved = localStorage.getItem(BG_LS_KEY);
    const bg = (saved && saved.trim() !== '') ? saved.trim() : 'bg.jpg';
    const overlay = parseInt(localStorage.getItem(BG_OVERLAY_LS_KEY) ?? '55');

    if (bg && bg.toLowerCase() !== 'none') {
        const url = `/scripts/extensions/third-party/nell-nutrition/icons/${bg}`;
        card.style.setProperty('--nn-bg-image', `url('${url}')`);
        card.style.setProperty('--nn-bg-overlay', (overlay / 100).toFixed(2));
        card.classList.add('nn-has-bg');
    } else {
        card.style.removeProperty('--nn-bg-image');
        card.style.removeProperty('--nn-bg-overlay');
        card.classList.remove('nn-has-bg');
    }
}


// Точки-переключатели тем в шапке карточки
function buildThemeSwitcher() {
    const right = document.querySelector('#nn-card .nn-header-right');
    if (!right || right.querySelector('.nn-theme-switcher')) return;

    const wrap = document.createElement('div');
    wrap.className = 'nn-theme-switcher';
    wrap.innerHTML = `
        <button class="nn-theme-dot nn-dot-violet" data-theme="violet" title="Тёмно-фиолетовая"></button>
        <button class="nn-theme-dot nn-dot-rose" data-theme="rose" title="Бело-розовая"></button>
        <button class="nn-theme-dot nn-dot-adaptive" data-theme="adaptive" title="Адаптивная (тема таверны)"></button>
    `;
    right.insertBefore(wrap, right.firstChild);

    wrap.querySelectorAll('.nn-theme-dot').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            applyTheme(btn.dataset.theme);
        });
    });
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════
const MODULE = 'nellNutrition';
const META_KEY = 'nellNutritionState';
const PROMPT_KEY = 'nell_nutrition_state';
const ENABLED_LS_KEY = 'nellNutrition_enabled';
const POS_LS_KEY = 'nellNutrition_cardPos';
const PINNED_LS_KEY  = 'nellNutrition_pinned';// карточка закреплена
const COMPACT_LS_KEY = 'nellNutrition_compact';  // компактный режим
const COMPACT_LAYOUT_LS_KEY = 'nellNutrition_compactLayout'; // 'vertical' | 'horizontal'

function isPinned(){ return localStorage.getItem(PINNED_LS_KEY)  ==='true'; }
function isCompact() { return localStorage.getItem(COMPACT_LS_KEY) === 'true'; }

// Русские названия всех состояний по их внутренним id (для уведомлений)
const NN_ID_NAMES = {
    // болезни
    hypoglycemia: 'Гипогликемия',
    dehydration_disease: 'Обезвоживание',
    starvation: 'Истощение (голод)',
    malnutrition: 'Недоедание',
    // дебаффы
    hunger: 'Голод',
    dehydration: 'Жажда',
    exhaustion: 'Истощение',
    drowsiness: 'Сонливость',
    overeating: 'Переедание',
    // баффы
    well_fed: 'Сытость',
    hydrated: 'Гидратация',
    high_energy: 'Бодрость',
    balanced: 'Баланс',
};

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
    const chk2 = document.getElementById('nn-set-enabled');
    if (chk2) chk2.checked = val;
    if (!val) {
        setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.IN_CHAT, 2, true, extension_prompt_roles.SYSTEM);
    } else {
        injectPrompt();
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
        // Физические параметры (влияют на норму калорий)
        gender: 'unknown',
        age: 28,
        height: 170,       // см
        weight: 65,        // кг
        build: 'average',  // slim | average | athletic | muscular | heavy
        activity: 'light', // sedentary | light | moderate | active | very_active

        // Норма калорий: если manualGoal != null — используется он (ручной ввод)
        calorieGoal: 2000,
        manualGoal: null,

        // Текущее состояние
        calories: 0,
        water: 80,
        satiety: 75,
        energy: 75,
        health: 100,

        pregnant: false,
        pregnancyWeek: 0,

        diseases: [],
        buffs: [],
        debuffs: [],

        lastMealTime: null,
        hoursSinceLastMeal: 0,
        daysWithDeficit: 0,

        analyzed: false,       // применён ли анализ карточки
        initialAnalyzed: false, // применён ли анализ первой сцены
    };
}

function defaultState() {
    return {
        user: defaultCharState('User', 'user'),
        characters: [],
        lastGameTime: null,
        lastProcessedMsgId: null,
        history: [],
        note: '',
        snapshots: [],
        dayCount: 1,        // счётчик игровых дней
        weightHistory: [],  // история веса
        version: 2,
    };
}


// ═══════════════════════════════════════════════════════════════
// МИГРАЦИЯ старых английских лейблов
// ═══════════════════════════════════════════════════════════════
const LABEL_MIGRATION = {
    'Well Fed': 'Сытость', 'Well Hydrated': 'Гидратация',
    'High Energy': 'Бодрость', 'Balanced Diet': 'Баланс',
    'Hunger': 'Голод', 'Dehydration': 'Жажда',
    'Exhaustion': 'Истощение', 'Drowsiness': 'Сонливость',
    'Overeating': 'Переедание', 'Vitamin Boost': 'Витамины',
};

function migrateLabels(charData) {
    if (!charData) return;
    for (const arr of [charData.buffs, charData.debuffs]) {
        if (!Array.isArray(arr)) continue;
        for (const item of arr) {
            if (LABEL_MIGRATION[item.name]) item.name = LABEL_MIGRATION[item.name];
            if (item.effect) {
                item.effect = item.effect
                    .replace(/Stamina/gi, 'Стамина')
                    .replace(/Energy/gi, 'Энергия')
                    .replace(/Health/gi, 'Здоровье')
                    .replace(/Immunity/gi, 'Иммунитет')
                    .replace(/Focus/gi, 'Фокус');
            }
        }
    }
}

function loadState() {
    try {
        if (!chat_metadata[META_KEY]) {
            chat_metadata[META_KEY] = defaultState();
        }
        state = chat_metadata[META_KEY];
        const def = defaultState();
        for (const k of Object.keys(def)) {
            if (state[k] === undefined) state[k] = def[k];
        }
        const defChar = defaultCharState();
        for (const k of Object.keys(defChar)) {
            if (state.user[k] === undefined) state.user[k] = defChar[k];
        }
        if (!Array.isArray(state.history)) state.history = [];
        if (!Array.isArray(state.snapshots)) state.snapshots = [];
        if (!state.dayCount) state.dayCount = 1;
        if (!Array.isArray(state.weightHistory)) state.weightHistory = [];
        if (!Array.isArray(state.user.diseases)) state.user.diseases = [];
        if (!Array.isArray(state.user.buffs)) state.user.buffs = [];
        if (!Array.isArray(state.user.debuffs)) state.user.debuffs = [];

        // Чистим старые болезни с устаревшим id
        state.user.diseases = state.user.diseases.filter(d =>
            ['hypoglycemia','dehydration_disease','starvation','malnutrition'].includes(d.id)
        );

        migrateLabels(state.user);
        for (const c of (state.characters || [])) {
            const defChar2 = defaultCharState();
            for (const k of Object.keys(defChar2)) {
                if (c[k] === undefined) c[k] = defChar2[k];
            }
            if (!Array.isArray(c.diseases)) c.diseases = [];
            if (!Array.isArray(c.buffs)) c.buffs = [];
            if (!Array.isArray(c.debuffs)) c.debuffs = [];
            c.diseases = c.diseases.filter(d =>
                ['hypoglycemia','dehydration_disease','starvation','malnutrition'].includes(d.id)
            );
            migrateLabels(c);
        }

        if (!state.user.analyzed) {
            analyzeUser();
        }

        ensureBotState();
        analyzeInitialSceneOnce();

    } catch (err) {
        console.warn('[NN] loadState failed, resetting to default:', err);
        chat_metadata[META_KEY] = defaultState();
        state = chat_metadata[META_KEY];
        try { analyzeUser(); } catch(e) {}
        try { ensureBotState(); } catch(e) {}
    }
}

function saveState() {
    chat_metadata[META_KEY] = state;
    saveChatDebounced();
    renderMiniBar();
    renderCard();
}

// ─── ФИНАЛЬНАЯ НОРМА КАЛОРИЙ (ручная или расчётная) ───
function effectiveGoal(charData) {
    if (charData.manualGoal != null) return charData.manualGoal;
    return charData.calorieGoal || 2000;
}

// ─── ПЕРЕСЧЁТ НОРМЫ по текущим параметрам ───
function recalcGoal(charData) {
    charData.calorieGoal = calculateCalorieGoal({
        gender: charData.gender,
        weight: charData.weight,
        height: charData.height,
        age: charData.age,
        activity: charData.activity,
        build: charData.build,
        pregnant: charData.pregnant,
        pregnancyWeek: charData.pregnancyWeek,
    });
}

// ═══════════════════════════════════════════════════════════════
// АНАЛИЗ ПЕРСОНЫ ЮЗЕРА
// ═══════════════════════════════════════════════════════════════
function getPersonaDescription() {
    try {
        return power_user?.persona_description || '';
    } catch { return ''; }
}

function analyzeUser() {
    const desc = getPersonaDescription();
    const name = getUserName();
    const combined = `${name} ${desc}`;

    if (combined.trim().length > 3) {
        const params = buildCharacterParams(combined);
        state.user.gender = params.gender;
        state.user.age = params.age;
        state.user.height = params.height;
        state.user.weight = params.weight;
        state.user.build = params.build;
        state.user.activity = params.activity;
        if (state.user.manualGoal == null) {
            state.user.calorieGoal = params.calorieGoal;
        }
    }
    state.user.analyzed = true;
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
        // Анализ карточки бота
        const cardText = `${bot.name} ${bot.description || ''} ${bot.personality || ''} ${bot.first_mes || ''}`;
        const params = buildCharacterParams(cardText);
        existing.gender = params.gender;
        existing.age = params.age;
        existing.height = params.height;
        existing.weight = params.weight;
        existing.build = params.build;
        existing.activity = params.activity;
        existing.calorieGoal = params.calorieGoal;
        existing.analyzed = true;
        state.characters.push(existing);
    }

    // Миграция недостающих полей
    const defChar = defaultCharState();
    for (const k of Object.keys(defChar)) {
        if (existing[k] === undefined) existing[k] = defChar[k];
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

// ═══════════════════════════════════════════════════════════════
// АНАЛИЗ ПЕРВОЙ СЦЕНЫ (стартовая сытость/вода/энергия)
// ═══════════════════════════════════════════════════════════════
function analyzeInitialSceneOnce() {
    // Берём первое НЕ-юзерское сообщение (приветствие персонажа)
    let firstBotMsg = null;
    for (const m of chat) {
        if (m && !m.is_user && m.mes) { firstBotMsg = m.mes; break; }
    }
    if (!firstBotMsg) {
        // Пробуем first_mes из карточки
        const bot = getCurrentBot();
        firstBotMsg = bot?.first_mes || '';
    }
    if (!firstBotMsg) return;

    const est = analyzeInitialState(firstBotMsg);

    if (!state.user.initialAnalyzed) {
        state.user.satiety = est.satiety;
        state.user.water = est.water;
        state.user.energy = est.energy;
        // Стартовые калории пропорциональны сытости
        state.user.calories = Math.round(effectiveGoal(state.user) * (est.satiety / 100) * 0.5);
        state.user.initialAnalyzed = true;
    }

    const botData = getBotState();
    if (botData && !botData.initialAnalyzed) {
        botData.satiety = est.satiety;
        botData.water = est.water;
        botData.energy = est.energy;
        botData.calories = Math.round(effectiveGoal(botData) * (est.satiety / 100) * 0.5);
        botData.initialAnalyzed = true;
    }
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
    btn.innerHTML = `<span class="nn-toggle-icon">${NN_APPLE_SVG}</span>`;

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
// SVG-иконки мини-бара (красятся через CSS)
const NN_ICO_APPLE = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z"/><path d="M10 2c1 .5 2 2 2 5"/></svg>`;
const NN_ICO_FORK = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>`;
const NN_ICO_DROP = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/></svg>`;

function buildMiniBar() {
    if (document.getElementById('nn-minibar')) return;

    const bar = document.createElement('div');
    bar.id = 'nn-minibar';
    bar.innerHTML = `
        <div class="nn-mini-char" id="nn-mini-user">
            <span class="nn-mini-name" id="nn-mini-user-name">User</span>
            <span class="nn-mini-stat"><span class="nn-mini-ico nn-ico-cal">${NN_ICO_APPLE}</span> <b id="nn-mini-user-cal">—</b></span>
            <span class="nn-mini-stat" id="nn-mini-user-sat"><span class="nn-mini-ico nn-ico-sat">${NN_ICO_FORK}</span> <b>—</b></span>
            <span class="nn-mini-stat" id="nn-mini-user-water"><span class="nn-mini-ico nn-ico-water">${NN_ICO_DROP}</span> <b>—</b></span>
            <span class="nn-mini-fx" id="nn-mini-user-fx"></span>
        </div>
        <div class="nn-mini-divider"></div>
        <div class="nn-mini-char" id="nn-mini-bot">
            <span class="nn-mini-name" id="nn-mini-bot-name">Bot</span>
            <span class="nn-mini-stat"><span class="nn-mini-ico nn-ico-cal">${NN_ICO_APPLE}</span> <b id="nn-mini-bot-cal">—</b></span>
            <span class="nn-mini-stat" id="nn-mini-bot-sat"><span class="nn-mini-ico nn-ico-sat">${NN_ICO_FORK}</span> <b>—</b></span>
            <span class="nn-mini-stat" id="nn-mini-bot-water"><span class="nn-mini-ico nn-ico-water">${NN_ICO_DROP}</span> <b>—</b></span>
            <span class="nn-mini-fx" id="nn-mini-bot-fx"></span>
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

    // ── Юзер ──
    const u = state.user;
    const uGoal = effectiveGoal(u);
    nnSetMiniText('nn-mini-user-name', getUserName());
    nnSetMiniText('nn-mini-user-cal', `${u.calories}/${uGoal}`);
    nnSetMiniStat('nn-mini-user-sat', u.satiety, `${u.satiety}%`);
    nnSetMiniStat('nn-mini-user-water', u.water, `${u.water}%`);
    nnSetMiniFx('nn-mini-user-fx', u);

    // ── Бот ──
    const b = getBotState();
    const botBlock = document.getElementById('nn-mini-bot');
    const divider = bar.querySelector('.nn-mini-divider');
    if (b) {
        if (botBlock) botBlock.style.display = '';
        if (divider) divider.style.display = '';
        const bGoal = effectiveGoal(b);
        nnSetMiniText('nn-mini-bot-name', getBotName());
        nnSetMiniText('nn-mini-bot-cal', `${b.calories}/${bGoal}`);
        nnSetMiniStat('nn-mini-bot-sat', b.satiety, `${b.satiety}%`);
        nnSetMiniStat('nn-mini-bot-water', b.water, `${b.water}%`);
        nnSetMiniFx('nn-mini-bot-fx', b);
    } else {
        if (botBlock) botBlock.style.display = 'none';
        if (divider) divider.style.display = 'none';
    }
}

// Хелперы мини-панели
function nnSetMiniText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}
// Компактные значки эффектов: ✦бафы ☠дебафы 🦠болезни
function nnSetMiniFx(id, data) {
    const el = document.getElementById(id);
    if (!el) return;
    let html = '';
    if (data.buffs.length) html += `<span class="nn-fx-buff">✦${data.buffs.length}</span>`;
    if (data.debuffs.length) html += `<span class="nn-fx-debuff">☠${data.debuffs.length}</span>`;
    if (data.diseases.length) html += `<span class="nn-fx-disease">🦠${data.diseases.length}</span>`;
    el.innerHTML = html;
    el.style.display = html ? '' : 'none';
}

// Устанавливает значение в <b> внутри блока + красит по уровню
function nnSetMiniStat(id, value, text) {
    const el = document.getElementById(id);
    if (!el) return;
    const b = el.querySelector('b');
    if (b) b.textContent = text;
    el.classList.remove('nn-mini-good', 'nn-mini-warn', 'nn-mini-danger');
    if (value > 60) el.classList.add('nn-mini-good');
    else if (value > 30) el.classList.add('nn-mini-warn');
    else el.classList.add('nn-mini-danger');
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
                <span class="nn-header-title">Калории и питание</span>
                <span class="nn-header-sparkle">✦</span>
            </div>
            <div class="nn-header-right">
                <button class="nn-header-btn nn-layout-only" id="nn-btn-layout" title="Повернуть карточки">⇄</button><button class="nn-header-btn" id="nn-btn-compact" title="Компактный режим">⊞</button>
                <button class="nn-header-btn" id="nn-btn-pin"title="Закрепить карточку">📌</button>
                <button class="nn-header-btn" id="nn-btn-help"    title="Help">?</button>
                <button class="nn-header-btn" id="nn-btn-close"   title="Close">✕</button>
            </div>
        </div>

        <!-- TABS -->
        <div class="nn-tabs">
            <button class="nn-tab nn-tab-active" data-tab="overview">Обзор</button>
            <button class="nn-tab" data-tab="weight">Вес</button>
            <button class="nn-tab" data-tab="products">Продукты</button>
            <button class="nn-tab" data-tab="settings">Настройки</button>
        </div>

        <!-- BODY -->
        <div class="nn-body" id="nn-body">
            <!-- Content rendered dynamically -->
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
    wrapper.style.display = 'none';

    // Events
    document.getElementById('nn-btn-close').addEventListener('click', () => setCard(false));
    document.getElementById('nn-btn-help').addEventListener('click', (e) => {
        e.stopPropagation();
        openHelpModal();
    });
    // Кнопка пина
    const btnPin = document.getElementById('nn-btn-pin');
    if (btnPin) {
        btnPin.addEventListener('click', (e) => {
            e.stopPropagation();
            const val = !isPinned();
            localStorage.setItem(PINNED_LS_KEY, val ? 'true' : 'false');
            const card = document.getElementById('nn-card');
            if (card) card.classList.toggle('nn-pinned', val);
            btnPin.classList.toggle('nn-btn-active', val);
            // Включить/выключить авто-закрытие
            if (val) {
                document.removeEventListener('pointerdown', onOutsideClick, true);
            } else {
                document.addEventListener('pointerdown', onOutsideClick, true);
            }
        });
        // Восстановить состояние при открытии
        btnPin.classList.toggle('nn-btn-active', isPinned());
    }

    // Кнопка компактного режима
    const btnCompact = document.getElementById('nn-btn-compact');
    if (btnCompact) {
        btnCompact.addEventListener('click', (e) => {
            e.stopPropagation();
            const val = !isCompact();
            localStorage.setItem(COMPACT_LS_KEY, val ? 'true' : 'false');
            const card = document.getElementById('nn-card');
            if (card) card.classList.toggle('nn-compact', val);
            btnCompact.classList.toggle('nn-btn-active', val);
            renderCard();
        });
        btnCompact.classList.toggle('nn-btn-active', isCompact());
    }

    // Кнопка поворота (только в compact)
    const btnLayout = document.getElementById('nn-btn-layout');
    if (btnLayout) {
        const _syncLayoutIcon = () => {
            const cur = localStorage.getItem(COMPACT_LAYOUT_LS_KEY) || 'vertical';
            btnLayout.textContent = cur === 'horizontal' ? '⇅' : '⇄';
            btnLayout.title = cur === 'horizontal' ?'Вертикальный порядок' : 'Горизонтальный порядок';
        };
        btnLayout.addEventListener('click', (e) => {
            e.stopPropagation();
            const cur = localStorage.getItem(COMPACT_LAYOUT_LS_KEY) || 'vertical';
            localStorage.setItem(COMPACT_LAYOUT_LS_KEY, cur === 'vertical' ? 'horizontal' : 'vertical');
            _syncLayoutIcon();
            renderCard();
        });
        _syncLayoutIcon();
    }

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
    makeDraggable(card, null);
}
//═══════════════════════════════════════════════════════════════
// HELP MODAL
// ═══════════════════════════════════════════════════════════════
function buildHelpModal() {
    if (document.getElementById('nn-help-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'nn-help-overlay';
    overlay.className = 'nn-hidden';

    overlay.innerHTML = `
    <div id="nn-help-modal">
        <div class="nn-help-header">
            <div class="nn-help-header-left">
                <span class="nn-help-section-icon">🍎</span>
                <span class="nn-help-title">Справка —<span class="nn-help-title-accent">Калории и питание</span></span>
            </div>
            <button class="nn-help-close" id="nn-help-close-btn">✕</button>
        </div>

        <div class="nn-help-body">

            <!--──ЧТОЭТО ── -->
            <div class="nn-help-section">
                <div class="nn-help-section-header">
                    <span class="nn-help-section-icon">💡</span>
                    <span class="nn-help-section-title">Что это такое?</span>
                </div>
                <div class="nn-help-section-body">
                    <p class="nn-help-p">Это расширение добавляет в ролевую игру <b>живую физиологию</b> — все приемы пищи персоны
                        и бота теперь отслеживаются. ИИ сам подсчитывает и обновляет показатели автоматически.
                    </p>
                    <p class="nn-help-p">
                        Расширение отслеживает <b>пять параметров</b> для каждого персонажа:
                    </p>
                    <div class="nn-help-row">
                        <span class="nn-help-row-icon">🍽</span>
                        <span class="nn-help-row-name">Калории</span>
                        <span class="nn-help-row-desc">Сколько энергии получено с едой за сегодня. Падает со временем.</span>
                    </div>
                    <div class="nn-help-row">
                        <span class="nn-help-row-icon">🥄</span>
                        <span class="nn-help-row-name">Сытость</span>
                        <span class="nn-help-row-desc">Насколько персонаж сыт прямо сейчас. Падает быстрее калорий.</span>
                    </div>
                    <div class="nn-help-row">
                        <span class="nn-help-row-icon">💧</span>
                        <span class="nn-help-row-name">Вода</span>
                        <span class="nn-help-row-desc">Уровень гидратации. Ниже 30% — головная боль, ниже 15% — опасно.</span>
                    </div>
                    <div class="nn-help-row">
                        <span class="nn-help-row-icon">⚡</span>
                        <span class="nn-help-row-name">Энергия</span>
                        <span class="nn-help-row-desc">Бодрость. Растёт во сне, падает при активности и голоде.</span>
                    </div>
                    <div class="nn-help-row">
                        <span class="nn-help-row-icon">❤</span>
                        <span class="nn-help-row-name">Здоровье</span>
                        <span class="nn-help-row-desc">Медленно восстанавливается само, если всё хорошо. Падает от болезней и голода.</span>
                    </div>
                </div>
            </div><div class="nn-help-divider"></div>

            <!-- ── КАК ОТКРЫТЬ ── -->
            <div class="nn-help-section">
                <div class="nn-help-section-header">
                    <span class="nn-help-section-icon">🖱</span>
                    <span class="nn-help-section-title">Как открыть карточку</span>
                </div>
                <div class="nn-help-section-body">
                    <p class="nn-help-p">
                        Рядом с кнопкой отправки сообщения появилась кнопка
                        <span class="nn-help-btn-mock">🍎</span> — нажми её, чтобы открыть
                        полную карточку питания.
                    </p>
                    <p class="nn-help-p">
                        Над полемввода сообщений находится <b>мини-бар</b> — краткая сводка калорий,
                        сытости и воды для обоих персонажей. Нажми на него — тоже откроется карточка.
                    </p>
                    <div class="nn-help-tip">
                        <span class="nn-help-tip-icon">📌</span>
                        <span>Кнопка <b>📌</b> в шапке карточки закрепляет её на экране — она перестанет
                        закрываться при клике мимо. Удобно, если хочешь следить за показателями во время игры.Карточку можно перетащить за края или углы.</span>
                    </div>
                </div>
            </div>

            <div class="nn-help-divider"></div>

            <!-- ── ВКЛАДКА ОБЗОР ── -->
            <div class="nn-help-section">
                <div class="nn-help-section-header">
                    <span class="nn-help-section-icon">📊</span>
                    <span class="nn-help-section-title">Вкладка «Обзор»</span>
                </div>
                <div class="nn-help-section-body">
                    <p class="nn-help-p">
                        Здесь видны карточки <b>твоего персонажа</b> и <b>персонажа ИИ</b> рядом.
                        На каждой — норма калорий, заполненность баров и общий статус здоровья.
                    </p>
                    <p class="nn-help-p">
                        Кнопка <span class="nn-help-btn-mock">⚙</span> в правом верхнем углу каждой
                        карточки открывает редактор параметров — можно задать пол, возраст, рост,
                        вес, уровень активности, телосложение, беременность и вручную установить
                        норму калорий. Расширение пытается определить всё это из карточки персонажа
                        автоматически, но если что-то не так — поправь здесь.
                    </p>
                    <p class="nn-help-p">Ниже карточек — три панели: <b>Состояния</b> (болезни),
                        <b>Баффы</b> (положительные эффекты) и <b>Дебаффы</b> (отрицательные).
                    </p>
                </div>
            </div>

            <div class="nn-help-divider"></div>

            <!-- ── БАФФЫ / ДЕБАФФЫ / БОЛЕЗНИ ── -->
            <div class="nn-help-section">
                <div class="nn-help-section-header">
                    <span class="nn-help-section-icon">⚠</span>
                    <span class="nn-help-section-title">Баффы, дебаффы и болезни</span>
                </div>
                <div class="nn-help-section-body">
                    <p class="nn-help-p">
                <b>Баффы</b> <span style="color:var(--nn-green-bright)">✦</span> — появляются,
                        когда персонаж в хорошей форме. Например, «Сытость» даёт бонус к энергии,
                        «Гидратация» ускоряет восстановление. Они исчезают сами, если показатели упадут.
                    </p>
                    <p class="nn-help-p">
                        <b>Дебаффы</b> <span style="color:var(--nn-orange-bright)">☠</span> — появляются
                        при низких показателях. Голод, жажда, сонливость, истощение — каждый штрафует
                        определённые действия в нарративе ИИ. Проходят постепенно после того, как
                        причина устранена (поел, попил, поспал).
                    </p>
                    <p class="nn-help-p">
                        <b>Болезни</b> <span style="color:var(--nn-red-bright)">🦠</span> — серьёзнее.
                        Гипогликемия, обезвоживание, истощение от голода и недоедание появляются при
                        длительном пренебрежении едой или водой. Имеют стадии от «лёгкой» до «критической».
                        Для выздоровления нужно устранить причину и подождать — мгновенно не проходят.
                    </p><div class="nn-help-tip">
                        <span class="nn-help-tip-icon">💬</span>
                        <span>Все состояния <b>автоматически передаются ИИ</b> — он обязан отыгрывать
                        симптомы в тексте. Если персонаж голодает — ИИ покажет дрожь в руках,
                        головокружение, слабость и т.д.</span>
                    </div>
                </div>
            </div>

            <div class="nn-help-divider"></div>

            <!-- ── ПРОДУКТЫ ── -->
            <div class="nn-help-section">
                <div class="nn-help-section-header">
                    <span class="nn-help-section-icon">🍽</span>
                    <span class="nn-help-section-title">Вкладка «Продукты»</span>
                </div>
                <div class="nn-help-section-body">
                    <p class="nn-help-p">
                        Здесь можно <b>покормить персонажа вручную</b>, не дожидаясь, пока это
                        произойдёт в сцене. Выбери категорию, найди продукт, нажми на него —
                        появится панель с граммовкой. Подбери нужное количество и нажми «Съесть»
                        или «Выпить». Важно: это не обязательная вкладка, всегда можно просто написать в ответе боту, что ест твой персонаж, и аи автоматически высчитает калорийность.
                    </p>
                    <p class="nn-help-p">
                        Кнопки вверху справа позволяют выбрать,
                        <b>кого</b> хотите покормить — бота или юзера.</p>
                </div>
            </div>

            <div class="nn-help-divider"></div>

            <!-- ── ВЕС ── -->
            <div class="nn-help-section">
                <div class="nn-help-section-header">
                    <span class="nn-help-section-icon">⚖</span>
                    <span class="nn-help-section-title">Вкладка «Вес»</span>
                </div>
                <div class="nn-help-section-body">
                    <p class="nn-help-p">
                        Вес персонажа меняется со временем. Когда ИИ сообщает, что прошло много
                        игрового времени (≥16 часов), расширение считает «игровой день» и пересчитывает вес:</p>
                    <div class="nn-help-row">
                        <span class="nn-help-row-icon">📈</span>
                        <span class="nn-help-row-name">Набор</span>
                        <span class="nn-help-row-desc">Если съедено заметно больше нормы — небольшой прирост.</span>
                    </div>
                    <div class="nn-help-row">
                        <span class="nn-help-row-icon">📉</span>
                        <span class="nn-help-row-name">Потеря</span>
                        <span class="nn-help-row-desc">Сильный дефицит калорий или голодание — вес постепенно снижается.</span>
                    </div>
                    <p class="nn-help-p" style="margin-top:4px">
                        Здесь же хранится вся история изменений с причинами и датами.</p>
                </div>
            </div>

            <div class="nn-help-divider"></div>

            <!-- ── НАСТРОЙКИ ── -->
            <div class="nn-help-section">
                <div class="nn-help-section-header">
                    <span class="nn-help-section-icon">🎨</span>
                    <span class="nn-help-section-title">Вкладка «Настройки»</span>
                </div>
                <div class="nn-help-section-body">
                    <p class="nn-help-p">
                        <b>Тема оформления</b> — три варианта:тёмно-фиолетовая, бело-розовая, и адаптивная (подстраивается под текущую
                        тему SillyTavern). Переключить можно также тремя точками в шапке карточки.
                    </p>
                    <p class="nn-help-p">
                        <b>Свой фон</b> — можно положить любую картинку в папку
                        <code>extensions/third-party/nell-nutrition/icons/</code>
                        и вписать её имя (например<code>myfon.jpg</code>).Ползунок рядом
                        регулирует затемнение, чтобы текст оставался читаемым. Чтобы убрать фон —
                        впиши <code>none</code>.
                    </p>
                    <p class="nn-help-p">
                        <b>Компактный режим</b> <span class="nn-help-btn-mock">⊞</span> — уменьшает
                        карточку, убирает вкладки и оставляет только самое важное. Кнопка
                        <span class="nn-help-btn-mock">⇄</span> меняет расположение карточек
                        персонажей — вертикально или горизонтально.
                    </p>
                </div>
            </div>

            <div class="nn-help-divider"></div>

            <!-- ── КАК РАБОТАЕТ АВТОМАТИКА ── -->
            <div class="nn-help-section">
                <div class="nn-help-section-header">
                    <span class="nn-help-section-icon">🤖</span>
                    <span class="nn-help-section-title">Как всё работает само</span>
                </div>
                <div class="nn-help-section-body">
                    <p class="nn-help-p">
                        После каждого ответа ИИ расширение читает скрытый тег в конце сообщения —
                        ИИ туда пишет, сколько игрового времени прошло, что съели и выпили.Ты этого не видишь, но именно так показатели обновляются автоматически.
                    </p>
                    <p class="nn-help-p">
                        Если ИИ забыл тег — расширение само попытается найти упоминания еды
                        и питья в тексте.
                    </p>
                    <div class="nn-help-tip">
                        <span class="nn-help-tip-icon">🔄</span>
                        <span>Если удалить сообщение ИИ — показатели <b>автоматически откатятся</b>
                        к состоянию до этого сообщения.</span>
                    </div>
                </div>
            </div>

        </div>

        <div class="nn-help-footer">
            Nutrition Framework · нажми в любом месте за пределами окна, чтобы закрыть
        </div>
    </div>`;

    document.body.appendChild(overlay);

    document.getElementById('nn-help-close-btn').addEventListener('click', () => {
        overlay.classList.add('nn-hidden');
    });

    overlay.addEventListener('pointerdown', (e) => {
        if (e.target === overlay) overlay.classList.add('nn-hidden');
    });
}

function openHelpModal() {
    const overlay = document.getElementById('nn-help-overlay');
    if (overlay) {
        overlay.classList.remove('nn-hidden');
    }
}
function toggleCard() { setCard(!cardOpen); }

function setCard(open) {
    cardOpen = open;
    const card = document.getElementById('nn-card');
    const wrapper = document.getElementById('nn-card-wrapper');
    if (!card) return;

if (open) {
    if (wrapper) wrapper.style.display = '';
    card.style.visibility = 'hidden';
    card.classList.remove('nn-hidden');
    card.classList.toggle('nn-compact', isCompact());
    // На мобилке compact всегда горизонтальный — ставим класс принудительно
    if (isCompact() && window.innerWidth <= 768) {
        card.classList.add('nn-compact-h');
    } else if (window.innerWidth <= 768) {
        card.classList.remove('nn-compact-h');
    }
    card.classList.toggle('nn-pinned', isPinned());
    restoreCardPos(card);
    requestAnimationFrame(() => {
        card.style.visibility = '';renderCard();
    });
    if (!isPinned()) {
        setTimeout(() => {
            document.addEventListener('pointerdown', onOutsideClick, true);
        }, 0);
    }
} else {
    card.classList.add('nn-hidden');
    if (wrapper) wrapper.style.display = 'none';
    document.removeEventListener('pointerdown', onOutsideClick, true);
}
}



// Закрытие карточки по клику в любом месте вне неё
function onOutsideClick(e) {
    const card = document.getElementById('nn-card');
    if (!card || card.classList.contains('nn-hidden')) return;
    if (card.contains(e.target)) return;                       // клик по карточке
    if (e.target.closest('#nn-toggle')) return;                // клик по кнопке 🍎
    if (e.target.closest('#nn-minibar')) return;               // клик по мини-панели
    if (e.target.closest('.nn-notify')) return;                // клик по уведомлению
    setCard(false);
}


function renderCard() {
    if (!state || !cardOpen) return;
    renderCardBody();
}

// ═══════════════════════════════════════════════════════════════
// PROMPT INJECTION — системный промпт для ИИ
// ═══════════════════════════════════════════════════════════════
// Оценка физической дееспособности персонажа для промпта
function getActionCapacity(data) {
    const hasCritical = data.diseases.some(d => !d.recovering && (d.severity === 'critical'));
    const hasSevere = data.diseases.some(d => !d.recovering && (d.severity === 'severe'));
    const hasDisease = data.diseases.length > 0;

    if (hasCritical || data.health <= 15) {
        return {
            label: 'INCAPACITATED',
            instruction: 'The body is shutting down. ANY demanding action fails outright: cannot run, fight, or even stand for long. Survival requires help from others.',
        };
    }
    if (hasSevere || data.energy <= 15 || data.health <= 35) {
        return {
            label: 'CRITICALLY WEAKENED',
            instruction: 'Demanding physical actions FAIL by default. Fleeing danger, fighting, climbing — the body betrays them mid-attempt. At best a desperate, costly partial success with lasting consequences.',
        };
    }
    if (hasDisease || data.energy <= 35 || data.satiety <= 20 || data.water <= 20) {
        return {
            label: 'WEAKENED',
            instruction: 'Physical actions succeed only with visible strain and at reduced effectiveness. Prolonged effort (a long chase, a long fight) is likely to fail partway.',
        };
    }
    if (data.energy >= 70 && data.satiety >= 50 && data.water >= 50) {
        return {
            label: 'STRONG',
            instruction: 'The body is well-maintained and responds fully. Physical actions succeed as attempted, movements are confident and capable.',
        };
    }
    return {
        label: 'NORMAL',
        instruction: 'Physical actions succeed normally, though the character is not at peak condition.',
    };
}

function buildSystemPrompt() {
    if (!state) return '';

    const userName = getUserName();
    const botName = getBotName();
    const u = state.user;
    const b = getBotState();

    const userStatus = getPhysicalStatus(u);
    const botStatus = b ? getPhysicalStatus(b) : 'unknown';

    const userDebuffs = u.debuffs.map(d => d.name).join(', ') || 'none';
    const userBuffs = u.buffs.map(d => d.name).join(', ') || 'none';
    const userDiseases = u.diseases.map(d => `${d.name} (${d.severity})`).join(', ') || 'none';

    const botBuffs = b ? (b.buffs.map(d => d.name).join(', ') || 'none') : 'n/a';
    const botDebuffs = b ? (b.debuffs.map(d => d.name).join(', ') || 'none') : 'n/a';
    const botDiseases = b ? (b.diseases.map(d => `${d.name} (${d.severity})`).join(', ') || 'none') : 'n/a';

    const pregnancyLine = u.pregnant
        ? `\n  Pregnancy: Week ${u.pregnancyWeek} — increased calorie and water needs, fatigue sensitivity.`
        : '';

    let prompt = `[NUTRITION FRAMEWORK — live physiological state. Weave naturally into narration, never quote numbers.]

═══ ${userName} (Player Character) ═══
  Calories today: ${u.calories} / ${u.calorieGoal} kcal
  Satiety: ${Math.round(u.satiety)}% | Hydration: ${Math.round(u.water)}% | Energy: ${Math.round(u.energy)}% | Health: ${Math.round(u.health)}%
  Weight: ${u.weight} kg | Hours since last meal: ${u.hoursSinceLastMeal}h
  Overall status: ${userStatus.toUpperCase()}
  Active buffs: ${userBuffs}
  Active debuffs: ${userDebuffs}
  Diseases: ${userDiseases}${pregnancyLine}

`;

    // Подробные симптомы (пользователь всегда, бот — если загружен)
    const userCondPrompt = buildConditionPrompt(u, userName);
    const botCondPrompt = b ? buildConditionPrompt(b, botName) : '';

    if (userCondPrompt || botCondPrompt) {
        prompt += `═══ ACTIVE CONDITIONS (show symptoms in narration) ═══${userCondPrompt}${botCondPrompt}\n\n`;
    }

    if (b) {
        const botPregnancy = b.pregnant
            ? `\n  Pregnancy: Week ${b.pregnancyWeek}`
            : '';

        prompt += `═══ ${botName} (NPC) ═══
  Calories today: ${b.calories} / ${b.calorieGoal} kcal
  Satiety: ${Math.round(b.satiety)}% | Hydration: ${Math.round(b.water)}% | Energy: ${Math.round(b.energy)}% | Health: ${Math.round(b.health)}%
  Weight: ${b.weight} kg | Hours since last meal: ${b.hoursSinceLastMeal}h
  Overall status: ${botStatus.toUpperCase()}
  Active buffs: ${botBuffs}
  Active debuffs: ${botDebuffs}
  Diseases: ${botDiseases}${botPregnancy}

`;
    }

    const capacity = getActionCapacity(u);
    const botCap = b ? getActionCapacity(b) : null;
    const botCapacityLine = botCap
        ? `\n- ${botName}'s current physical capacity: ${botCap.label}. ${botCap.instruction} This applies to ${botName}'s actions the same way: a weakened NPC cannot suddenly perform feats of strength.`
        : '';

    prompt += `═══ MECHANICAL TAG — REQUIRED ═══
At the END of every reply, on its own line, append ONE invisible HTML comment:

<!-- NN tp=VALUE | activity=VALUE | ate=ITEMS | drank=ITEMS -->

Field meanings:
  tp        = NUMBER: in-world hours elapsed since previous message (sleep counts! a night = 8, short scene = 0.5). ALWAYS include.
  activity  = ONE word: resting / normal / active / intense. ALWAYS include.
  sleeping  = true (ONLY if the character sleeps this turn, otherwise OMIT)

  ate / user_ate / bot_ate = FOOD eaten this turn.
  drank / user_drank / bot_drank = DRINKS this turn.

CRITICAL — WHO ate/drank WHAT (attribution rules, follow EXACTLY):
  • ${userName} is the POV character. Food/drinks with NO explicit owner go under "ate"/"drank" and count for ${userName} ONLY.
  • The MOMENT ${botName} (or any NPC) eats or drinks, you MUST use bot_ate / bot_drank. Never put NPC consumption in the generic "ate"/"drank".
  • NEVER list the same item in both a generic field and a user_/bot_ field — pick ONE. Duplicates are ignored.
  • If ONLY ${userName} eats, write ONLY "ate" (or user_ate). Do NOT invent bot_ate. If ONLY ${botName} eats, write ONLY bot_ate — leave "ate" empty.
  • If BOTH eat, use user_ate AND bot_ate explicitly, each with its own items.

CRITICAL — HOW TO WRITE FOOD (this drives calorie tracking):
  • Write each food in RUSSIAN, concretely, with an estimated calorie number after a colon. Format: название:ККАЛ — items separated by commas.
  • ESTIMATE calories from the ACTUAL portion in the scene. Small bite ≈ 80-150, normal plate ≈ 300-500, hearty feast ≈ 800-1200.
  • Distinguish specific foods: "говядина", "свинина", "курица", "рыба" — NOT a generic "meat".
  • Drinks: write название:ПРОЦЕНТ (percent of hydration restored). A normal cup: water≈25, tea≈15, juice≈18. If someone drinks A LOT (deeply, to their fill, a whole jug), RAISE the percent to 40-60. A tiny sip: 5-10. Match the amount shown in the scene.

Examples (Russian names + calorie estimates):
<!-- NN tp=0.5 | activity=normal -->
<!-- NN tp=8 | activity=resting | sleeping=true -->
<!-- NN tp=1 | activity=normal | ate=борщ:300,хлеб:80 | drank=чай:15 -->
<!-- NN tp=2 | activity=active | user_ate=жареная курица:400 | bot_ate=говядина тушёная:350 | drank=вода:25 -->
<!-- NN tp=1 | activity=normal | bot_drank=вино:5 | drank=вода:25 -->

This line is an HTML comment — invisible to the reader. NEVER skip it.`;

    return prompt;
}

function injectPrompt() {
    if (!isEnabled()) {
        setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.IN_CHAT, 2, true, extension_prompt_roles.SYSTEM);
        return;
    }
    const prompt = buildSystemPrompt();
    setExtensionPrompt(
        PROMPT_KEY,
        prompt,
        extension_prompt_types.IN_CHAT,
        2,
        true,
        extension_prompt_roles.SYSTEM
    );
}

// ═══════════════════════════════════════════════════════════════
// RENDER CARD BODY (by active tab)
// ═══════════════════════════════════════════════════════════════
function renderCardBody() {
    const body = document.getElementById('nn-body');
    if (!body || !state) return;

    if (isCompact()) {
        renderCompactBody(body);
        return;
    }

    switch (activeTab) {
        case 'overview':  renderOverview(body); break;
        case 'weight':    renderWeightTab(body); break;
        case 'products':  renderProductsTab(body); break;
        case 'settings':  renderSettingsTab(body); break;
        default:          renderOverview(body); break;
    }
}

// ═══════════════════════════════════════════════════════════════
// РЕДАКТОР ПАРАМЕТРОВ ПЕРСОНАЖА (шестерёнка в карточке)
// ═══════════════════════════════════════════════════════════════
let editingWho = null; // 'user' | 'bot' | null

function getEditTarget() {
    if (editingWho === 'user') return state.user;
    if (editingWho === 'bot') return getBotState();
    return null;
}

function openCharEditor(who) {
    editingWho = (editingWho === who) ? null : who; // повторный клик — закрыть
    renderCardBody();
}

// Возвращает HTML формы редактора для конкретного персонажа
function renderCharEditor(data, isUser) {
    if (!data) return '';

    const activityOptions = Object.entries(ACTIVITY_LEVELS).map(([key, v]) =>
        `<option value="${key}" ${data.activity === key ? 'selected' : ''}>${v.labelRu}</option>`
    ).join('');

    const buildOptions = Object.entries(BUILD_TYPES).map(([key, v]) =>
        `<option value="${key}" ${data.build === key ? 'selected' : ''}>${v.labelRu}</option>`
    ).join('');

    const genderOptions = [
        ['male', 'Мужчина'], ['female', 'Женщина'], ['unknown', 'Не указан'],
    ].map(([key, label]) =>
        `<option value="${key}" ${data.gender === key ? 'selected' : ''}>${label}</option>`
    ).join('');

    const who = isUser ? 'user' : 'bot';
    const autoGoal = calculateCalorieGoal({
        gender: data.gender, weight: data.weight, height: data.height,
        age: data.age, activity: data.activity, build: data.build,
        pregnant: data.pregnant, pregnancyWeek: data.pregnancyWeek,
    });

    const pregRowHtml = data.gender === 'male' ? '' : `<div class="nn-edit-preg-row">
        <label class="nn-edit-manual">
            <input type="checkbox" class="nn-edit-preg-chk" data-who="${who}" ${data.pregnant ? 'checked' : ''}>
            Беременность
        </label>
        <input type="number" class="nn-edit-preg-week" data-who="${who}" min="0" max="42" placeholder="неделя"
               value="${data.pregnancyWeek || ''}" ${data.pregnant ? '' : 'disabled'}>
    </div>`;

    return `<div class="nn-edit-panel" data-who="${who}">
        <div class="nn-edit-title">Параметры</div>
        <div class="nn-edit-grid">
            <label>Пол<select class="nn-edit-field" data-field="gender">${genderOptions}</select></label>
            <label>Возраст<input type="number" class="nn-edit-field" data-field="age" min="16" max="99" value="${data.age}"></label>
            <label>Рост, см<input type="number" class="nn-edit-field" data-field="height" min="120" max="230" value="${data.height}"></label>
            <label>Вес, кг<input type="number" class="nn-edit-field" data-field="weight" min="30" max="250" value="${data.weight}"></label>
            <label>Телосложение<select class="nn-edit-field" data-field="build">${buildOptions}</select></label>
            <label>Активность<select class="nn-edit-field" data-field="activity">${activityOptions}</select></label>
        </div>
        <div class="nn-edit-goal-row">
            <label class="nn-edit-manual">
                <input type="checkbox" class="nn-edit-manual-chk" data-who="${who}" ${data.manualGoal != null ? 'checked' : ''}>
                Задать норму вручную
            </label>
            <input type="number" class="nn-edit-goal-input" data-who="${who}" min="800" max="6000"
                   value="${data.manualGoal != null ? data.manualGoal : autoGoal}"
                   ${data.manualGoal == null ? 'disabled' : ''}>
            <span class="nn-edit-goal-hint">расчёт: ${autoGoal} ккал</span>
        </div>
        ${pregRowHtml}
        <div class="nn-edit-btns">
            <button class="nn-edit-recalc" data-who="${who}">↻ Пересчитать по карточке</button>
            <button class="nn-edit-done" data-who="${who}">Готово</button>
        </div>
    </div>`;
}


// Навешивает обработчики на форму редактора (вызывается после innerHTML)
function bindCharEditor() {
    const panel = document.querySelector('.nn-edit-panel');
    if (!panel) return;
    const who = panel.dataset.who;
    const data = who === 'user' ? state.user : getBotState();
    if (!data) return;

    // Поля (пол, возраст, рост, вес, телосложение, активность)
    panel.querySelectorAll('.nn-edit-field').forEach(el => {
        el.addEventListener('change', () => {
            const field = el.dataset.field;
            let val = el.value;
            if (['age', 'height', 'weight'].includes(field)) {
                val = parseInt(val);
                if (isNaN(val)) return;
            }
            data[field] = val;
            // Мужской пол — беременность автоматически снимается
            if (field === 'gender' && val === 'male') {
                data.pregnant = false;
                data.pregnancyWeek = 0;
            }
            // Если норма не ручная — пересчитываем автоматически
            if (data.manualGoal == null) recalcGoal(data);
            saveState();
            renderCardBody();
        });
    });

    // Чекбокс ручной нормы
    panel.querySelector('.nn-edit-manual-chk')?.addEventListener('change', (e) => {
        const input = panel.querySelector('.nn-edit-goal-input');
        if (e.target.checked) {
            data.manualGoal = parseInt(input.value) || calculateCalorieGoal({
                gender: data.gender, weight: data.weight, height: data.height,
                age: data.age, activity: data.activity, build: data.build,
            });
            input.disabled = false;
        } else {
            data.manualGoal = null;
            recalcGoal(data);
            input.disabled = true;
        }
        saveState();
        renderCardBody();
    });

    // Ввод ручной нормы
    panel.querySelector('.nn-edit-goal-input')?.addEventListener('change', (e) => {
        const val = parseInt(e.target.value);
        if (!isNaN(val) && val >= 800 && val <= 6000) {
            data.manualGoal = val;
            saveState();
            renderCardBody();
        }
    });

    // Беременность
    panel.querySelector('.nn-edit-preg-chk')?.addEventListener('change', (e) => {
        data.pregnant = e.target.checked;
        const weekInput = panel.querySelector('.nn-edit-preg-week');
        if (!e.target.checked) {
            data.pregnancyWeek = 0;
            weekInput.disabled = true;
        } else {
            weekInput.disabled = false;
        }
        if (data.manualGoal == null) recalcGoal(data);
        saveState();
        renderCardBody();
    });

    panel.querySelector('.nn-edit-preg-week')?.addEventListener('change', (e) => {
        const val = parseInt(e.target.value);
        if (!isNaN(val) && val >= 0 && val <= 42) {
            data.pregnancyWeek = val;
            if (val > 0) data.pregnant = true;
            if (data.manualGoal == null) recalcGoal(data);
            saveState();
            renderCardBody();
        }
    });

    // Пересчитать по карточке (заново анализирует описание)
    panel.querySelector('.nn-edit-recalc')?.addEventListener('click', () => {
        if (who === 'user') {
            state.user.analyzed = false;
            analyzeUser();
        } else {
            const bot = getCurrentBot();
            if (bot) {
                const cardText = `${bot.name} ${bot.description || ''} ${bot.personality || ''} ${bot.first_mes || ''}`;
                const params = buildCharacterParams(cardText);
                Object.assign(data, {
                    gender: params.gender, age: params.age, height: params.height,
                    weight: params.weight, build: params.build, activity: params.activity,
                });
                if (data.manualGoal == null) data.calorieGoal = params.calorieGoal;
            }
        }
        saveState();
        notify('Параметры пересчитаны по карточке', 'success', 3000);
        renderCardBody();
    });

    // Готово — закрыть
    panel.querySelector('.nn-edit-done')?.addEventListener('click', () => {
        editingWho = null;
        renderCardBody();
    });
}

// ─── OVERVIEW TAB ─────────────────────────────────────────────
function renderOverview(body) {
    const u = state.user;
    const b = getBotState();

    body.innerHTML = `<div class="nn-chars-row">
            ${renderCharCard(u, getUserAvatar(), getUserName(), true)}
            ${b ? renderCharCard(b, getBotAvatar(), getBotName(), false) : renderEmptyBotCard()}
        </div>
        <div class="nn-sections-row">
            ${renderConditionsSection()}
            ${renderBuffsSection()}
            ${renderDebuffsSection()}
        </div>
        <div class="nn-section nn-overview-help">
            <div class="nn-section-header">
                <span class="nn-section-icon">📊</span>
                <span class="nn-section-title">Как это работает</span>
            </div>
            <div class="nn-section-body">
                <p class="nn-help-text">Калории и вода расходуются автоматически по мере течения игрового времени. Еда восстанавливает калории и сытость, питьё — воду. Расширение само распознаёт приёмы пищи и напитки в повествовании и обновляет состояние персонажей.</p>
                <p class="nn-help-text">Долгое голодание или обезвоживание ведёт к дебаффам, болезням и физическому истощению. Вода ниже 30% — риск обезвоживания, ниже 15% — критическое состояние с тяжёлыми штрафами.</p>
            </div>
        </div>`;


    // Кнопки-шестерёнки
    body.querySelectorAll('.nn-char-gear').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openCharEditor(btn.dataset.who);
        });
    });

    // Значок беременности — показать/скрыть пояснение
    body.querySelectorAll('.nn-pregnancy-badge').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const panel = document.getElementById(`nn-preg-detail-${btn.dataset.who}`);
            if (panel) panel.classList.toggle('nn-hidden');
        });
    });

    // Обработчики формы редактора (если открыта)
    bindCharEditor();
}

function renderCharCard(data, avatarSrc, charName, isUser) {
    const goal = effectiveGoal(data);
    const calPct = Math.min(100, Math.round((data.calories / goal) * 100));
    const overfill = data.calories > goal;

    let barClass = '';
    if (overfill) barClass = 'nn-overfill';
    else if (calPct < 30) barClass = 'nn-danger';
    else if (calPct < 60) barClass = 'nn-warn';

    const statusInfo = getOverallStatus(data);
    const icon = isUser ? '♛' : '♜';
    const who = isUser ? 'user' : 'bot';

    const avatarHtml = avatarSrc
        ? `<img src="${avatarSrc}" alt="" onerror="this.style.display='none'">`
        : `<div class="nn-char-avatar-placeholder">👤</div>`;

    // Подзаголовок: пол · возраст · рост
    const genderTxt = data.gender === 'male' ? '♂' : data.gender === 'female' ? '♀' : '';
    const subtitle = `${genderTxt} ${data.age} лет · ${data.height} см`;

    let pregnancyHtml = '';
    let pregnancyDetailHtml = '';
    if (data.pregnant && data.gender !== 'male') {
        const stage = getPregnancyStage(data.pregnancyWeek);
        pregnancyHtml = `<button type="button" class="nn-pregnancy-badge" data-who="${who}">🤰 ${data.pregnancyWeek > 0 ? data.pregnancyWeek + ' нед.' : 'рано'}</button>`;

        const details = [];
        if (stage.desc) details.push(stage.desc);
        if (stage.calMult && stage.calMult > 1) details.push(`⚡ Норма калорий ×${stage.calMult} — организм тратит больше энергии на плод`);
        if (stage.waterMult && stage.waterMult > 1) details.push(`💧 Расход воды ×${stage.waterMult} — повышенная потребность в жидкости`);
        if (stage.nausea) details.push('🤢 Токсикоз: возможна тошнота, особенно после еды — сытость может снижаться сама по себе');
        if (stage.fatigue) details.push('😴 Повышенная усталость: энергия падает быстрее, нужен более частый отдых');

        pregnancyDetailHtml = `<div class="nn-preg-detail nn-hidden" id="nn-preg-detail-${who}">
            <div class="nn-preg-detail-title">${stage.label} · неделя ${data.pregnancyWeek}</div>
            ${details.map(d => `<div class="nn-preg-detail-line">${d}</div>`).join('')}
        </div>`;
    }

    // Форма редактора (если открыта для этого персонажа)
    const editorHtml = (editingWho === who) ? renderCharEditor(data, isUser) : '';

    return `<div class="nn-char-card">
        <button class="nn-char-gear" data-who="${who}" title="Редактировать параметры">⚙</button>

        <div class="nn-char-top">
            <div class="nn-char-avatar">${avatarHtml}</div>
            <div class="nn-char-info">
                <div class="nn-char-name">${charName} <span class="nn-char-name-icon">${icon}</span></div>
                <div class="nn-char-subtitle">${subtitle}</div>
            </div>
        </div>

        <div class="nn-cal-block">
            <div class="nn-cal-numbers">
                <span class="nn-cal-current">${data.calories}</span>
                <span class="nn-cal-sep">/</span>
                <span class="nn-cal-goal">${goal}</span>
                <span class="nn-cal-unit">ккал</span>
            </div>
            <div class="nn-cal-bar-row">
                <div class="nn-cal-bar">
                    <div class="nn-cal-bar-fill ${barClass}" style="width:${calPct}%"></div>
                </div>
                <span class="nn-cal-pct">${calPct}%</span>
            </div>
        </div>

        <div class="nn-char-bottom">
            <div class="nn-stats-grid">
                ${renderStatRow('🥄', 'Сытость', data.satiety, 'satiety')}
                ${renderStatRow('💧', 'Вода', data.water, 'water')}
                ${renderStatRow('⚡', 'Энергия', data.energy, 'energy')}
                ${renderStatRow('❤', 'Здоровье', data.health, 'health')}
            </div>
            <div class="nn-status-circle-wrap">
                <div class="nn-status-circle ${statusInfo.cls}">${statusInfo.icon}</div>
                <span class="nn-status-text">${statusInfo.text}</span>
            </div>
        </div>

        <div class="nn-weight-line">
            <span>⚖ Вес <b>${data.weight} кг</b></span>
            ${pregnancyHtml}
        </div>
        ${pregnancyDetailHtml}

        ${editorHtml}
    </div>`;
}

function renderEmptyBotCard() {
    return `<div class="nn-char-card"><span class="nn-empty">Персонаж не загружен</span></div>`;
}

function renderStatRow(icon, label, value, type) {
    const clamped = Math.max(0, Math.min(100, value || 0));
    return `<div class="nn-stat-row">
        <span class="nn-stat-icon">${icon}</span>
        <span class="nn-stat-label">${label}</span>
        <div class="nn-stat-bar"><div class="nn-stat-bar-fill nn-fill-${type}" style="width:${clamped}%"></div></div>
        <span class="nn-stat-val">${Math.round(value || 0)}%</span>
    </div>`;
}


function getOverallStatus(data) {
    if (data.diseases.some(d => d.severity === 'critical' || d.severity === 'severe')) {
        return { text: 'Критично', icon: '💔', cls: 'nn-status-danger' };
    }
    if (data.diseases.length > 0 || (data.health || 100) < 40 || (data.energy || 100) < 20) {
        return { text: 'Плохо', icon: '⚠', cls: 'nn-status-warn' };
    }
    if ((data.satiety || 100) < 30 || (data.water || 100) < 30) {
        return { text: 'Стресс', icon: '⚡', cls: 'nn-status-warn' };
    }
    if ((data.health || 100) > 70 && (data.energy || 100) > 60 && (data.satiety || 100) > 50) {
        return { text: 'Здоров', icon: '♥', cls: '' };
    }
    return { text: 'Стабильно', icon: '♥', cls: '' };
}

// Сколько часов осталось до конца выздоровления болезни
function diseaseRecoveryLeft(d) {
    if (!d.recovering) return null;
    const need = DISEASE_DB[d.id]?.recovery?.[d.severity] ?? 6;
    return Math.max(0.5, Math.round(need - (d.recoveryHours || 0)));
}

// ─── SECTIONS (bottom of Overview) ────────────────────────────
function renderConditionsSection() {
    const allDiseases = [
        ...state.user.diseases.map(d => ({ ...d, owner: getUserName(), ownerType: 'user' })),
        ...(getBotState()?.diseases || []).map(d => ({ ...d, owner: getBotName(), ownerType: 'bot' })),
    ];

    const items = allDiseases.length > 0
        ? allDiseases.map(d => {
            const sevCls = `nn-sev-${d.severity}`;
            const effectsHtml = (d.effects || []).map(e => `
                <div class="nn-condition-effect">
                    <span class="nn-condition-effect-name">⚡ ${e}</span>
                </div>`).join('');

            const severityLabel = {
                mild: 'Лёгкая', moderate: 'Средняя',
                severe: 'Тяжёлая', critical: 'Критическая',
            }[d.severity] || d.severity;

            return `
            <div class="nn-condition-item ${sevCls}">
                <div class="nn-condition-top">
                    <span class="nn-condition-name">⊘ ${d.name} <span class="nn-condition-owner nn-owner-${d.ownerType}">· ${d.owner}</span></span>
                    <span class="nn-severity-badge ${sevCls}">${severityLabel}</span>
                    <span class="nn-condition-time">${d.recovering ? `выздоровление ~${diseaseRecoveryLeft(d)}ч` : (d.since || '')}</span>
                </div>
                <div class="nn-condition-effects">${effectsHtml}</div>
            </div>`;
        }).join('')
        : '<span class="nn-empty">Нет заболеваний</span>';

    // Иммунитет отдельной строкой на каждого персонажа
    const immRow = (data, name, type) => {
        const imm = calculateImmunity(data);
        const cls = imm >= 60 ? 'nn-imm-good' : imm >= 35 ? 'nn-imm-mid' : 'nn-imm-low';
        return `<div class="nn-immunity-row">
            🛡 <span class="nn-condition-owner nn-owner-${type}">${name}</span>:
            <span class="nn-immunity-val ${cls}">${imm}%</span>
        </div>`;
    };

    const botData = getBotState();
    let immunityHtml = immRow(state.user, getUserName(), 'user');
    if (botData) immunityHtml += immRow(botData, getBotName(), 'bot');

    return `
    <div class="nn-section">
        <div class="nn-section-header">
            <span class="nn-section-icon">⚠</span>
            <span class="nn-section-title">Состояния</span>
        </div>
        <div class="nn-section-body nn-section-scroll">${items}</div>
        ${immunityHtml}
    </div>`;
}

function renderBuffsSection() {
    const allBuffs = [
        ...state.user.buffs.map(b => ({ ...b, owner: getUserName(), ownerType: 'user' })),
        ...(getBotState()?.buffs || []).map(b => ({ ...b, owner: getBotName(), ownerType: 'bot' })),
    ];

    const items = allBuffs.length > 0
        ? allBuffs.map(b => `
            <div class="nn-buff-item">
                <div class="nn-buff-left">
                    <span class="nn-buff-icon">${b.icon || '✦'}</span>
                    <span class="nn-buff-name">${b.name}${b.hoursLeft != null ? ` <i>(~${Math.max(0.5, Math.round(b.hoursLeft * 2) / 2)}ч)</i>` : ''} <span class="nn-condition-owner nn-owner-${b.ownerType}">· ${b.owner}</span></span>
                </div>
                <span class="nn-buff-val">${b.effect || ''}</span>
            </div>`).join('')
        : '<span class="nn-empty">Нет баффов</span>';

    return `
    <div class="nn-section">
        <div class="nn-section-header">
            <span class="nn-section-icon">✦</span>
            <span class="nn-section-title">Баффы</span>
        </div>
        <div class="nn-section-body nn-section-scroll">${items}</div>
    </div>`;
}

function renderDebuffsSection() {
    const allDebuffs = [
        ...state.user.debuffs.map(d => ({ ...d, owner: getUserName(), ownerType: 'user' })),
        ...(getBotState()?.debuffs || []).map(d => ({ ...d, owner: getBotName(), ownerType: 'bot' })),
    ];

    const items = allDebuffs.length > 0
        ? allDebuffs.map(d => `
            <div class="nn-debuff-item">
                <div class="nn-debuff-left">
                    <span class="nn-debuff-icon">${d.icon || '☠'}</span>
                    <span class="nn-debuff-name">${d.name}${d.fading ? ` <i>(проходит, ~${Math.max(0.5, Math.round((d.fadeLeft || 0) * 2) / 2)}ч)</i>` : ''} <span class="nn-condition-owner nn-owner-${d.ownerType}">· ${d.owner}</span></span>
                </div>
                <span class="nn-debuff-val">${d.effect || ''}</span>
            </div>`).join('')
        : '<span class="nn-empty">Нет дебаффов</span>';

    return `
    <div class="nn-section">
        <div class="nn-section-header">
            <span class="nn-section-icon">☠</span>
            <span class="nn-section-title">Дебаффы</span>
        </div>
        <div class="nn-section-body nn-section-scroll">${items}</div>
    </div>`;
}
//─── COMPACT MODE ─────────────────────────────────────────────
function renderCompactCharCard(data, avatarSrc, charName, isUser) {
    if (!data) return '';

    const goal = effectiveGoal(data);
    const calPct = Math.min(100, Math.round((data.calories / goal) * 100));
    const overfill = data.calories > goal;
    let barClass = '';
    if (overfill)barClass = 'nn-overfill';
    else if (calPct < 30) barClass = 'nn-danger';
    else if (calPct < 60) barClass = 'nn-warn';

    const statusInfo = getOverallStatus(data);
    const icon = isUser ? '♛' : '♜';
    const genderTxt = data.gender === 'male' ? '♂' : data.gender === 'female' ? '♀' : '';

    const avatarHtml = avatarSrc
        ? `<img src="${avatarSrc}" alt="" onerror="this.style.display='none'">`
        : `<div class="nn-char-avatar-placeholder">👤</div>`;

    function cmpStat(ico, label, value, type) {
        const c = Math.max(0, Math.min(100, value || 0));
        return `<div class="nn-cmp-stat-row">
            <span class="nn-cmp-stat-icon">${ico}</span>
            <span class="nn-cmp-stat-label">${label}</span>
            <div class="nn-cmp-stat-bar">
                <div class="nn-cmp-stat-fill nn-fill-${type}" style="width:${c}%"></div>
            </div>
            <span class="nn-cmp-stat-val">${Math.round(value || 0)}%</span>
        </div>`;
    }

    // Эффекты — компактные пилюли
    const buffPills = data.buffs.map(b =>
        `<span class="nn-cmp-pill nn-pill-buff" title="${b.name}">${b.icon || '✦'} ${b.name}</span>`
    ).join('');
    const debuffPills = data.debuffs.map(d =>
        `<span class="nn-cmp-pill nn-pill-debuff" title="${d.name}">${d.icon || '☠'} ${d.name}</span>`
    ).join('');
    const diseasePills = data.diseases.map(d =>
        `<span class="nn-cmp-pill nn-pill-disease" title="${d.name + ' · ' + d.severity}">🦠 ${d.name}</span>`
    ).join('');
    const hasFx = data.buffs.length || data.debuffs.length || data.diseases.length;

    return `<div class="nn-cmp-card">
        <!-- Верхняя строка: аватар + имя + калории + статус -->
        <div class="nn-cmp-top">
            <div class="nn-cmp-avatar">${avatarHtml}</div>
            <div class="nn-cmp-head">
                <div class="nn-cmp-name">${charName} <span class="nn-cmp-name-icon">${icon}</span></div>
                <div class="nn-cmp-subtitle">${genderTxt} ${data.age} лет · ${data.height} см · ⚖ ${data.weight} кг</div><div class="nn-cmp-cal-row">
                    <span class="nn-cmp-cal-cur">${data.calories}</span>
                    <span class="nn-cmp-cal-sep">/</span>
                    <span class="nn-cmp-cal-goal">${goal}</span>
                    <span class="nn-cmp-cal-unit">ккал</span>
                </div>
                <div class="nn-cmp-calbar-wrap">
                    <div class="nn-cmp-calbar">
                        <div class="nn-cmp-calbar-fill ${barClass}" style="width:${calPct}%"></div>
                    </div>
                    <span class="nn-cmp-cal-pct">${calPct}%</span>
                </div>
            </div>
            <div class="nn-cmp-status-col">
                <div class="nn-status-circle ${statusInfo.cls} nn-cmp-circle">${statusInfo.icon}</div>
                <span class="nn-cmp-status-txt">${statusInfo.text}</span>
            </div>
        </div>

        <!-- Статы (4 бара) -->
        <div class="nn-cmp-stats">
            ${cmpStat('🥄', 'Сытость', data.satiety, 'satiety')}
            ${cmpStat('💧', 'Вода',data.water,   'water')}
            ${cmpStat('⚡', 'Энергия', data.energy,  'energy')}
            ${cmpStat('❤',  'Здоровье',data.health,  'health')}
        </div>

        <!-- Баффы / дебаффы / болезни -->
        ${hasFx ? `<div class="nn-cmp-fx">${buffPills}${debuffPills}${diseasePills}</div>` : ''}
    </div>`;
}

function renderCompactBody(body) {
    const u = state.user;
    const b = getBotState();

    // На мобилке всегда горизонтальная раскладка (две карточки рядом)
    const isMobile = window.innerWidth <= 768;
    const layout = isMobile ? 'horizontal' : (localStorage.getItem(COMPACT_LAYOUT_LS_KEY) || 'vertical');

    const card = document.getElementById('nn-card');
    if (card) card.classList.toggle('nn-compact-h', layout === 'horizontal');

    body.innerHTML = `<div class="nn-compact-wrap nn-layout-${layout}">
        ${renderCompactCharCard(u, getUserAvatar(), getUserName(), true)}
        ${b ? renderCompactCharCard(b, getBotAvatar(), getBotName(), false) : ''}
        <div class="nn-cmp-footer">
            <span class="nn-cmp-day">📅 День ${state.dayCount || 1}</span>
            <button class="nn-cmp-expand" id="nn-cmp-expand-btn">Полный вид ↗</button>
        </div>
    </div>`;

    document.getElementById('nn-cmp-expand-btn')?.addEventListener('click', () => {
        localStorage.setItem(COMPACT_LS_KEY, 'false');
        if (card) { card.classList.remove('nn-compact'); card.classList.remove('nn-compact-h'); }
        const btn = document.getElementById('nn-btn-compact');
        if (btn) btn.classList.remove('nn-btn-active');
        renderCard();
    });
}



// ─── WEIGHT TAB ───────────────────────────────────────────────
function renderWeightTab(body) {
    const u = state.user;
    const b = getBotState();

    // Определяем тренд по последним 5 записям юзера
    function weightTrend(who) {
        const entries = state.weightHistory.filter(e => e.who === who).slice(-5);
        if (entries.length < 2) return 'stable';
        const diff = entries[entries.length - 1].weight - entries[0].weight;
        if (diff > 0.1)  return 'up';
        if (diff < -0.1) return 'down';
        return 'stable';
    }

    function trendIcon(t) {
        if (t === 'up')   return '<span class="nn-trend-up">▲</span>';
        if (t === 'down') return '<span class="nn-trend-down">▼</span>';
        return '<span class="nn-trend-stable">●</span>';
    }

    function changeLabel(change) {
        if (change > 0) return `<span class="nn-wh-gain">+${change.toFixed(2)} кг</span>`;
        if (change < 0) return `<span class="nn-wh-loss">${change.toFixed(2)} кг</span>`;
        return `<span class="nn-wh-neutral">без изм.</span>`;
    }

    function reasonClass(r) {
        if (r === 'Переедание' || r === 'Лёгкий профицит') return 'nn-reason-surplus';
        if (r === 'Сильный дефицит' || r === 'Умеренный дефицит') return 'nn-reason-deficit';
        return 'nn-reason-normal';
    }

    // Карточки текущего веса
    function weightCard(data, name, who, isUser) {
        if (!data) return '';
        const trend = weightTrend(who);
        const icon = isUser ? '♛' : '♜';
        const bmi = (data.weight / ((data.height / 100) ** 2)).toFixed(1);
        let bmiLabel = 'Норма';
        let bmiCls = 'nn-bmi-normal';
        if (bmi < 18.5) { bmiLabel = 'Дефицит'; bmiCls = 'nn-bmi-low'; }
        else if (bmi >= 25 && bmi < 30) { bmiLabel = 'Избыток'; bmiCls = 'nn-bmi-high'; }
        else if (bmi >= 30) { bmiLabel = 'Ожирение'; bmiCls = 'nn-bmi-obese'; }

        return `<div class="nn-weight-card">
            <div class="nn-weight-card-name">${name} <span class="nn-char-name-icon">${icon}</span></div>
            <div class="nn-weight-card-big">${data.weight} <span class="nn-weight-unit">кг</span> ${trendIcon(trend)}</div>
            <div class="nn-weight-card-sub">
                Рост: ${data.height} см  · 
                ИМТ: <span class="${bmiCls}">${bmi} — ${bmiLabel}</span>
            </div>
        </div>`;
    }

    // История
    const rows = [...state.weightHistory].reverse().map(e => {
        const d = new Date(e.timestamp);
        const dateStr = `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        const ownerCls = e.who === 'user' ? 'nn-owner-user' : 'nn-owner-bot';
        const calPct = Math.round((e.calories / e.calorieGoal) * 100);
        return `<tr>
            <td class="nn-wh-day">День ${e.day}</td>
            <td class="${ownerCls} nn-wh-name">${e.name}</td>
            <td class="nn-wh-weight">${e.weight} кг</td>
            <td>${changeLabel(e.change)}</td>
            <td><span class="nn-reason-pill ${reasonClass(e.reason)}">${e.reason}</span></td>
            <td class="nn-wh-cal">${e.calories} / ${e.calorieGoal} ккал (${calPct}%)</td>
            <td class="nn-wh-date">${dateStr}</td>
        </tr>`;
    }).join('') || `<tr><td colspan="7" class="nn-empty" style="text-align:center;padding:16px">История пуста — изменения веса появятся после смены игрового дня</td></tr>`;

    body.innerHTML = `
    <div class="nn-tab-content">
        <div class="nn-section">
            <div class="nn-section-header">
                <span class="nn-section-icon">📅</span>
                <span class="nn-section-title">Игровой день: <b style="color:var(--nn-accent)">${state.dayCount}</b></span>
            </div>
            <div class="nn-weight-cards-row">
                ${weightCard(u, getUserName(), 'user', true)}
                ${b ? weightCard(b, getBotName(), 'bot', false) : ''}
            </div>
        </div>

        <div class="nn-section">
            <div class="nn-section-header">
                <span class="nn-section-icon">📊</span>
                <span class="nn-section-title">История изменений веса</span>
                <span class="nn-section-count">${state.weightHistory.length} зап.</span>
            </div>
            <div class="nn-section-body">
                <p class="nn-help-text" style="margin-bottom:8px">
                    Вес пересчитывается автоматически при смене игрового дня (когда ИИ указывает, что прошло ≥16 часов).
                    Переедание (профицит >500 ккал/сутки) ведёт к набору, сильный дефицит (>800 ккал) — к потере.
                </p>
                <div class="nn-wh-table-wrap">
                    <table class="nn-wh-table">
                        <thead>
                            <tr>
                                <th>День</th>
                                <th>Персонаж</th>
                                <th>Вес</th>
                                <th>Изменение</th>
                                <th>Причина</th>
                                <th>Калории</th>
                                <th>Время</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
// TAB RENDERS — PLACEHOLDERS (will be expanded in Stage 2-4)
// ═══════════════════════════════════════════════════════════════

function renderStatusBlock(data, charName, isUser) {
    const immunity = calculateImmunity(data);
    const immCls = immunity >= 60 ? 'nn-imm-good' : immunity >= 35 ? 'nn-imm-mid' : 'nn-imm-low';
    const immLabel = immunity >= 60 ? 'Крепкий' : immunity >= 35 ? 'Ослаблен' : 'Слабый';

    // Беременность
    let pregHtml = '';
    if (data.pregnant && data.pregnancyWeek > 0) {
        const stage = getPregnancyStage(data.pregnancyWeek);
        pregHtml = `<div class="nn-status-preg">
            <span class="nn-status-preg-icon">🤰</span>
            <div>
                <b>${stage.label}</b> · неделя ${data.pregnancyWeek}
                <div class="nn-status-preg-note">${stage.nausea ? 'Токсикоз · ' : ''}${stage.fatigue ? 'Повышенная усталость · ' : ''}Повышенная норма калорий и воды</div>
            </div>
        </div>`;
    }

    // Болезни
    const sevLabels = { mild: 'Лёгкая', moderate: 'Средняя', severe: 'Тяжёлая', critical: 'Критическая' };
    const diseasesHtml = data.diseases.length > 0
        ? data.diseases.map(d => {
            const effectsHtml = (d.effects || []).map(e =>
                `<div class="nn-condition-effect"><span class="nn-condition-effect-name">⚡ ${e}</span></div>`).join('');
            return `<div class="nn-condition-item nn-sev-${d.severity}">
                <div class="nn-condition-top">
                    <span class="nn-condition-name">⊘ ${d.name}</span>
                    <span class="nn-severity-badge nn-sev-${d.severity}">${sevLabels[d.severity] || d.severity}</span>
                    <span class="nn-condition-time">${d.recovering ? `выздоровление ~${diseaseRecoveryLeft(d)}ч` : (d.since || '')}</span>
                </div>
                <div class="nn-condition-effects">${effectsHtml}</div>
            </div>`;
        }).join('')
        : '<span class="nn-empty">Нет заболеваний</span>';

    // Баффы (с таймером остатка)
    const buffsHtml = data.buffs.length > 0
        ? data.buffs.map(bf => `<div class="nn-buff-item">
            <div class="nn-buff-left"><span class="nn-buff-icon">${bf.icon || '✨'}</span><span class="nn-buff-name">${bf.name}${bf.hoursLeft != null ? ` <i>(~${Math.max(0.5, Math.round(bf.hoursLeft * 2) / 2)}ч)</i>` : ''}</span></div>
            <span class="nn-buff-val">${bf.effect || ''}</span>
        </div>`).join('')
        : '<span class="nn-empty">Нет баффов</span>';

    // Дебаффы
    const debuffsHtml = data.debuffs.length > 0
        ? data.debuffs.map(df => `<div class="nn-debuff-item">
            <div class="nn-debuff-left"><span class="nn-debuff-icon">${df.icon || '☠'}</span><span class="nn-debuff-name">${df.name}${df.fading ? ` <i>(проходит, ~${Math.max(0.5, Math.round((df.fadeLeft || 0) * 2) / 2)}ч)</i>` : ''}</span></div>
            <span class="nn-debuff-val">${df.effect || ''}</span>
        </div>`).join('')
        : '<span class="nn-empty">Нет дебаффов</span>';

    const icon = isUser ? '♛' : '♜';

    return `<div class="nn-status-char">
        <div class="nn-status-char-header">
            <span class="nn-status-char-name">${charName} <span class="nn-char-name-icon">${icon}</span></span>
        </div>

        <div class="nn-immunity-row">
            <span>🛡 Иммунитет:</span>
            <div class="nn-immunity-bar"><div class="nn-immunity-fill ${immCls}" style="width:${immunity}%"></div></div>
            <span class="nn-immunity-val ${immCls}">${immunity}% · ${immLabel}</span>
        </div>

        ${pregHtml}

        <div class="nn-section">
            <div class="nn-section-header"><span class="nn-section-icon">⚠</span><span class="nn-section-title">Болезни</span></div>
            <div class="nn-section-body">${diseasesHtml}</div>
        </div>

        <div class="nn-status-columns">
            <div class="nn-section">
                <div class="nn-section-header"><span class="nn-section-icon">✨</span><span class="nn-section-title">Баффы</span></div>
                <div class="nn-section-body">${buffsHtml}</div>
            </div>
            <div class="nn-section">
                <div class="nn-section-header"><span class="nn-section-icon">☠</span><span class="nn-section-title">Дебаффы</span></div>
                <div class="nn-section-body">${debuffsHtml}</div>
            </div>
        </div>
    </div>`;
}

// ─── PRODUCTS TAB ─────────────────────────────────────────────
let prodWho = 'user';    // кто ест
let prodCat = 'meat';    // открытая категория
let prodSearch = '';     // поиск
let prodSel = null;      // индекс выбранного продукта
let prodGrams = null;    // выбранная граммовка

function renderProductsTab(body) {
    const botData = getBotState();
    const search = prodSearch.trim().toLowerCase();

    const items = PRODUCT_DB
        .map((p, idx) => ({ p, idx }))
        .filter(({ p }) => search ? p.name.toLowerCase().includes(search) : p.cat === prodCat);

    const catCards = PRODUCT_CATEGORIES.map(c => `
        <button class="nn-prod-cat ${(c.id === prodCat && !search) ? 'nn-prod-cat-active' : ''}" data-cat="${c.id}">
            <span class="nn-prod-cat-ico">${c.icon}</span>
            <span class="nn-prod-cat-name">${c.name}</span>
        </button>`).join('');

    const rows = items.map(({ p, idx }) => {
        const unit = p.drink ? 'мл' : 'г';
        const selected = prodSel === idx;
        const grams = selected ? prodGrams : p.grams;
        const cal = Math.round(p.cal100 * grams / 100);
        const water = Math.round((p.water100 || 0) * grams / 100);

        const chips = (p.drink ? [100, 200, 250, 330, 500] : [50, 100, 150, 200, 300])
            .map(g => `<button class="nn-prod-chip ${g === grams ? 'nn-prod-chip-active' : ''}" data-g="${g}">${g}</button>`).join('');

        const panel = selected ? `
            <div class="nn-prod-panel">
                <div class="nn-prod-gram-row">
                    <button class="nn-prod-step" data-step="-25">−</button>
                    <input type="number" class="nn-prod-gram-input" min="10" max="2000" step="5" value="${grams}">
                    <span class="nn-prod-unit">${unit}</span>
                    <button class="nn-prod-step" data-step="25">+</button>
                </div>
                <div class="nn-prod-chips">${chips}</div>
                <button class="nn-prod-eat">${p.drink ? 'Выпить' : 'Съесть'} · ${cal} ккал${water > 0 ? ` · 💧+${water}%` : ''}</button>
            </div>` : '';

        return `<div class="nn-prod-row ${selected ? 'nn-prod-row-sel' : ''}" data-idx="${idx}">
            <div class="nn-prod-row-top">
                <span class="nn-prod-name">${p.name}</span>
                <span class="nn-prod-cal">${p.grams} ${unit} · ${Math.round(p.cal100 * p.grams / 100)} ккал</span>
            </div>
            ${panel}
        </div>`;
    }).join('') || '<span class="nn-empty">Ничего не найдено</span>';

    body.innerHTML = `
    <div class="nn-tab-content">
        <div class="nn-section">
            <div class="nn-section-header">
                <span class="nn-section-icon">🍽</span>
                <span class="nn-section-title">Продукты</span>
                <div class="nn-prod-who">
                    <button class="nn-prod-who-btn ${prodWho === 'user' ? 'nn-prod-who-active' : ''}" data-who="user">${getUserName()}</button>
                    <button class="nn-prod-who-btn ${prodWho === 'bot' ? 'nn-prod-who-active' : ''}" data-who="bot" ${botData ? '' : 'disabled'}>${getBotName()}</button>
                </div>
            </div>
            <div class="nn-section-body">
                <div class="nn-prod-cats">${catCards}</div>
                <input type="text" id="nn-prod-search" class="nn-prod-search" placeholder="Поиск по всем категориям…" value="${prodSearch}">
                <div class="nn-prod-list">${rows}</div>
            </div>
        </div>
    </div>`;

    body.querySelectorAll('.nn-prod-who-btn').forEach(btn => {
        btn.addEventListener('click', () => { prodWho = btn.dataset.who; renderCardBody(); });
    });
    body.querySelectorAll('.nn-prod-cat').forEach(btn => {
        btn.addEventListener('click', () => {
            prodCat = btn.dataset.cat; prodSearch = ''; prodSel = null;
            renderCardBody();
        });
    });
    document.getElementById('nn-prod-search')?.addEventListener('input', (e) => {
        prodSearch = e.target.value; prodSel = null;
        renderCardBody();
        const el = document.getElementById('nn-prod-search');
        if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    });

    body.querySelectorAll('.nn-prod-row').forEach(row => {
        const idx = parseInt(row.dataset.idx);
        const p = PRODUCT_DB[idx];

        // Клик по строке — открыть/закрыть панель граммовки
        row.querySelector('.nn-prod-row-top').addEventListener('click', () => {
            if (prodSel === idx) { prodSel = null; }
            else { prodSel = idx; prodGrams = p.grams; }
            renderCardBody();
        });

        const input = row.querySelector('.nn-prod-gram-input');
        input?.addEventListener('change', (e) => {
            const v = parseInt(e.target.value);
            if (!isNaN(v) && v >= 10 && v <= 2000) { prodGrams = v; renderCardBody(); }
        });
        row.querySelectorAll('.nn-prod-step').forEach(btn => {
            btn.addEventListener('click', () => {
                prodGrams = Math.max(10, Math.min(2000, prodGrams + parseInt(btn.dataset.step)));
                renderCardBody();
            });
        });
        row.querySelectorAll('.nn-prod-chip').forEach(btn => {
            btn.addEventListener('click', () => { prodGrams = parseInt(btn.dataset.g); renderCardBody(); });
        });
        row.querySelector('.nn-prod-eat')?.addEventListener('click', () => {
            consumeProduct(p, prodWho, prodGrams);
        });
    });
}

function consumeProduct(p, who, grams) {
    const data = who === 'bot' ? getBotState() : state.user;
    if (!data) { notify('Персонаж не загружен', 'warning'); return; }

    const cal = Math.round(p.cal100 * grams / 100);
    const water = Math.round((p.water100 || 0) * grams / 100);

    if (p.drink) {
        if (cal > 0) data.calories += cal;
        applyDrink(data, water);
    } else {
        applyMeal(data, cal, water);
    }

    evaluateConditions(data);
    addToHistory(who, [`${p.name} ${grams}${p.drink ? 'мл' : 'г'}`], cal);

    const whoName = who === 'bot' ? getBotName() : getUserName();
    const parts = [];
    if (cal > 0) parts.push(`+${cal} ккал`);
    if (water > 0) parts.push(`+${water}% воды`);
    notify(`${whoName}: ${p.name}, ${grams} ${p.drink ? 'мл' : 'г'}${parts.length ? ' (' + parts.join(', ') + ')' : ''}`, p.drink ? 'water' : 'food', 3500);

    prodSel = null;
    saveState();
    renderCardBody();
}


function formatTimestamp(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}.${mo} ${hh}:${mm}`;
}

// ═══════════════════════════════════════════════════════════════
// SETTINGS TAB (inside the card)
// ═══════════════════════════════════════════════════════════════
function renderSettingsTab(body) {
    body.innerHTML = `
        <div class="nn-tab-content">
            <div class="nn-section">
                <div class="nn-section-header">
                    <span class="nn-section-icon">🎨</span>
                    <span class="nn-section-title">Внешний вид</span>
                </div>
                <div class="nn-section-body">
                    <div class="nn-settings-row">
                        <label>Тема оформления</label>
                        <div class="nn-theme-picker">
                            <button class="nn-theme-choice nn-dot-violet" data-theme="violet" title="Чёрно-фиолетовая"></button>
                            <button class="nn-theme-choice nn-dot-rose" data-theme="rose" title="Бело-розовая"></button>
                            <button class="nn-theme-choice nn-dot-adaptive" data-theme="adaptive" title="Адаптивная"></button>
                        </div>
                    </div>
                    <div class="nn-settings-row">
                        <label for="nn-set-bg">Свой фон (файл в папке icons)</label>
                        <input type="text" id="nn-set-bg" placeholder="bg.jpg (по умолчанию)" value="${localStorage.getItem(BG_LS_KEY) || ''}">
                    </div>
                    <div class="nn-settings-row">
                        <label for="nn-set-overlay">Затемнение фона</label>
                        <input type="range" id="nn-set-overlay" min="0" max="100" step="5" value="${localStorage.getItem(BG_OVERLAY_LS_KEY) ?? '55'}">
                        <span id="nn-set-overlay-val">${localStorage.getItem(BG_OVERLAY_LS_KEY) ?? '55'}%</span>
                    </div>
                    <p class="nn-help-text">
                        По умолчанию используется картинка <b>bg.jpg</b> из папки <b>icons</b> расширения.
                        Хочешь свой фон — скопируй картинку в ту же папку <b>icons</b> и впиши сюда её имя целиком,
                        например <b>myfon.png</b>. Чтобы совсем убрать фон — впиши слово <b>none</b>.
                        Ползунком ниже регулируется затемнение, чтобы текст было лучше видно.
                    </p>
                </div>
            </div>

            <div class="nn-section">
                <div class="nn-section-header">
                    <span class="nn-section-icon">⚙</span>
                    <span class="nn-section-title">Основные</span>
                </div>
                <div class="nn-section-body">
                    <div class="nn-settings-row">
                        <label for="nn-set-enabled">Включить расширение</label>
                        <input type="checkbox" id="nn-set-enabled" ${isEnabled() ? 'checked' : ''}>
                    </div>
                    <p class="nn-help-text">
                        Параметры персонажей (пол, возраст, вес, норма калорий, беременность)
                        настраиваются во вкладке «Обзор» — кнопка ⚙ на карточке персонажа.
                    </p>
                </div>
            </div>

<div class="nn-section">
    <div class="nn-section-header">
        <span class="nn-section-icon">🧪</span>
        <span class="nn-section-title">Тест (отладка)</span>
    </div>
    <div class="nn-section-body">
        <p class="nn-help-text" style="margin-bottom:8px">Все тесты применяются к <b>${getUserName()}</b>.</p>

        <div class="nn-dbg-group-label">🦠 Гипогликемия</div>
        <div class="nn-settings-row nn-settings-btns">
            <button class="nn-set-btn" id="nn-dbg-hypo-mild">Лёгкая</button>
            <button class="nn-set-btn" id="nn-dbg-hypo-mod">Средняя</button>
            <button class="nn-set-btn" id="nn-dbg-hypo-sev">Тяжёлая</button>
            <button class="nn-set-btn nn-set-btn-danger" id="nn-dbg-hypo-crit">Критическая</button>
        </div>

        <div class="nn-dbg-group-label">🦠 Истощение (голод)</div>
        <div class="nn-settings-row nn-settings-btns">
            <button class="nn-set-btn" id="nn-dbg-starv-mild">Лёгкое</button>
            <button class="nn-set-btn" id="nn-dbg-starv-mod">Среднее</button>
            <button class="nn-set-btn" id="nn-dbg-starv-sev">Тяжёлое</button>
            <button class="nn-set-btn nn-set-btn-danger" id="nn-dbg-starv-crit">Критическое</button>
        </div>

        <div class="nn-dbg-group-label">🦠 Обезвоживание</div>
        <div class="nn-settings-row nn-settings-btns">
            <button class="nn-set-btn" id="nn-dbg-dehyd-mild">Лёгкое</button>
            <button class="nn-set-btn" id="nn-dbg-dehyd-mod">Среднее</button>
            <button class="nn-set-btn" id="nn-dbg-dehyd-sev">Тяжёлое</button>
            <button class="nn-set-btn nn-set-btn-danger" id="nn-dbg-dehyd-crit">Критическое</button>
        </div>

        <div class="nn-dbg-group-label">🦠 Недоедание</div>
        <div class="nn-settings-row nn-settings-btns">
            <button class="nn-set-btn" id="nn-dbg-maln-mild">Лёгкое</button>
            <button class="nn-set-btn" id="nn-dbg-maln-mod">Среднее</button>
            <button class="nn-set-btn" id="nn-dbg-maln-sev">Тяжёлое</button>
        </div>

        <div class="nn-dbg-group-label">☠ Дебаффы</div>
        <div class="nn-settings-row nn-settings-btns">
            <button class="nn-set-btn" id="nn-dbg-debuff-hunger">🍽 Голод</button>
            <button class="nn-set-btn" id="nn-dbg-debuff-dehy">💧 Жажда</button>
            <button class="nn-set-btn" id="nn-dbg-debuff-exh">😴 Истощение</button>
            <button class="nn-set-btn" id="nn-dbg-debuff-drow">💤 Сонливость</button>
            <button class="nn-set-btn" id="nn-dbg-debuff-over">🤢 Переедание</button>
        </div>

        <div class="nn-dbg-group-label">✦ Баффы</div>
        <div class="nn-settings-row nn-settings-btns">
            <button class="nn-set-btn" id="nn-dbg-buff-fed">🍲 Сытость</button>
            <button class="nn-set-btn" id="nn-dbg-buff-hyd">💧 Гидратация</button>
            <button class="nn-set-btn" id="nn-dbg-buff-energy">⚡ Бодрость</button>
        </div>

        <div class="nn-dbg-group-label" style="margin-top:10px">⚙ Сброс</div>
        <div class="nn-settings-row nn-settings-btns">
            <button id="nn-dbg-clear" class="nn-set-btn">🧹 Очистить состояния</button>
            <button id="nn-dbg-reset" class="nn-set-btn nn-set-btn-danger">↺ Сбросить всё</button>
        </div>
    </div>
</div>
        </div>
    `;

    // ─── Внешний вид ───
    body.querySelectorAll('.nn-theme-choice').forEach(btn => {
        btn.classList.toggle('nn-choice-active', btn.dataset.theme === getTheme());
        btn.addEventListener('click', () => {
            applyTheme(btn.dataset.theme);
            body.querySelectorAll('.nn-theme-choice').forEach(b =>
                b.classList.toggle('nn-choice-active', b.dataset.theme === getTheme()));
        });
    });

    document.getElementById('nn-set-bg')?.addEventListener('change', (e) => {
        const val = e.target.value.trim();
        if (val) localStorage.setItem(BG_LS_KEY, val);
        else localStorage.removeItem(BG_LS_KEY);
        applyCardBackground();
        const msg = !val ? 'Фон по умолчанию (bg.jpg)'
                  : val.toLowerCase() === 'none' ? 'Фон убран'
                  : 'Фон обновлён';
        notify(msg, 'info', 3000);
    });

    const overlaySlider = document.getElementById('nn-set-overlay');
    overlaySlider?.addEventListener('input', (e) => {
        document.getElementById('nn-set-overlay-val').textContent = e.target.value + '%';
    });
    overlaySlider?.addEventListener('change', (e) => {
        localStorage.setItem(BG_OVERLAY_LS_KEY, e.target.value);
        applyCardBackground();
    });

    // ─── Основные ───
    document.getElementById('nn-set-enabled')?.addEventListener('change', (e) => {
        setEnabled(e.target.checked);
    });

// ─── Отладочные кнопки ───

// Хелпер: принудительно внедрить болезнь нужной стадии
function dbgForceDisease(id, severity, statOverrides) {
    const u = state.user;
    u.diseases = u.diseases.filter(d => d.id !== id);
    Object.assign(u, statOverrides);
    const def = DISEASE_DB[id];
    if (def && def.stages[severity]) {
        u.diseases.push({
            id, name: def.nameRu, nameEn: def.nameEn,
            severity,
            effects: def.stages[severity].effects,
            effectsEn: def.stages[severity].effectsEn,
            modifiers: def.stages[severity].modifiers,
            symptoms: def.stages[severity].symptoms,
            elapsedHours: 0, recoveryHours: 0, recovering: false, since: '0ч',
        });
    }
    evaluateConditions(u);
    saveState();
    notify(`Тест: ${def?.nameRu || id} (${severity})`, 'disease', 3000);
}

// Хелпер: принудительно внедрить дебафф
function dbgForceDebuff(id, name, icon, effect, effects) {
    const u = state.user;
    if (!u.debuffs.find(d => d.id === id)) {
        u.debuffs.push({ id, name, icon, effect, effects, fading: false, fadeLeft: 0 });
    }
    evaluateConditions(u);
    saveState();
    notify(`Тест дебафф: ${name}`, 'debuff', 3000);
}

// Хелпер: принудительно внедрить бафф
function dbgForceBuff(id, name, icon, effect) {
    const u = state.user;
    if (!u.buffs.find(b => b.id === id)) {
        u.buffs.push({ id, name, icon, effect, hoursLeft: 5 });
    }
    evaluateConditions(u);
    saveState();
    notify(`Тест бафф: ${name}`, 'buff', 3000);
}

// ── Гипогликемия ──
document.getElementById('nn-dbg-hypo-mild')?.addEventListener('click', () => {
    dbgForceDisease('hypoglycemia', 'mild', { calories: 50, satiety: 15, hoursSinceLastMeal: 9 });
});
document.getElementById('nn-dbg-hypo-mod')?.addEventListener('click', () => {
    dbgForceDisease('hypoglycemia', 'moderate', { calories: 0, satiety: 8, hoursSinceLastMeal: 15 });
});
document.getElementById('nn-dbg-hypo-sev')?.addEventListener('click', () => {
    dbgForceDisease('hypoglycemia', 'severe', { calories: 0, satiety: 3, hoursSinceLastMeal: 23 });
});
document.getElementById('nn-dbg-hypo-crit')?.addEventListener('click', () => {
    dbgForceDisease('hypoglycemia', 'critical', { calories: 0, satiety: 0, hoursSinceLastMeal: 37 });
});

// ── Истощение (голод) ──
document.getElementById('nn-dbg-starv-mild')?.addEventListener('click', () => {
    dbgForceDisease('starvation', 'mild', { calories: 0, satiety: 5, hoursSinceLastMeal: 25 });
});
document.getElementById('nn-dbg-starv-mod')?.addEventListener('click', () => {
    dbgForceDisease('starvation', 'moderate', { calories: 0, satiety: 0, hoursSinceLastMeal: 49 });
});
document.getElementById('nn-dbg-starv-sev')?.addEventListener('click', () => {
    dbgForceDisease('starvation', 'severe', { calories: 0, satiety: 0, hoursSinceLastMeal: 73, health: 40 });
});
document.getElementById('nn-dbg-starv-crit')?.addEventListener('click', () => {
    dbgForceDisease('starvation', 'critical', { calories: 0, satiety: 0, hoursSinceLastMeal: 121, health: 15 });
});

// ── Обезвоживание ──
document.getElementById('nn-dbg-dehyd-mild')?.addEventListener('click', () => {
    dbgForceDisease('dehydration_disease', 'mild', { water: 24 });
});
document.getElementById('nn-dbg-dehyd-mod')?.addEventListener('click', () => {
    dbgForceDisease('dehydration_disease', 'moderate', { water: 14 });
});
document.getElementById('nn-dbg-dehyd-sev')?.addEventListener('click', () => {
    dbgForceDisease('dehydration_disease', 'severe', { water: 7 });
});
document.getElementById('nn-dbg-dehyd-crit')?.addEventListener('click', () => {
    dbgForceDisease('dehydration_disease', 'critical', { water: 2 });
});

// ── Недоедание ──
document.getElementById('nn-dbg-maln-mild')?.addEventListener('click', () => {
    dbgForceDisease('malnutrition', 'mild', { calories: 0, satiety: 10, hoursSinceLastMeal: 25 });
});
document.getElementById('nn-dbg-maln-mod')?.addEventListener('click', () => {
    dbgForceDisease('malnutrition', 'moderate', { calories: 0, satiety: 5, hoursSinceLastMeal: 49 });
});
document.getElementById('nn-dbg-maln-sev')?.addEventListener('click', () => {
    dbgForceDisease('malnutrition', 'severe', { calories: 0, satiety: 0, hoursSinceLastMeal: 73, health: 35 });
});

// ── Дебаффы ──
document.getElementById('nn-dbg-debuff-hunger')?.addEventListener('click', () => {
    dbgForceDebuff('hunger', 'Голод', '🍽', '-20% Энергии', ['Энергия -20%', 'Концентрация -15%']);
});
document.getElementById('nn-dbg-debuff-dehy')?.addEventListener('click', () => {
    dbgForceDebuff('dehydration', 'Жажда', '💧', '-15% Стамина', ['Стамина -15%', 'Концентрация -10%']);
});
document.getElementById('nn-dbg-debuff-exh')?.addEventListener('click', () => {
    dbgForceDebuff('exhaustion', 'Истощение', '😴', '-30% Действия', ['Физические действия -30%', 'Фокус -25%']);
});
document.getElementById('nn-dbg-debuff-drow')?.addEventListener('click', () => {
    dbgForceDebuff('drowsiness', 'Сонливость', '💤', '-10% Фокус', ['Фокус -10%', 'Реакция -10%']);
});
document.getElementById('nn-dbg-debuff-over')?.addEventListener('click', () => {
    const u = state.user;
    u.calories = Math.round(effectiveGoal(u) * 1.5);
    dbgForceDebuff('overeating', 'Переедание', '🤢', '-10% Энергии', ['Вялость', 'Энергия -10%']);
});

// ── Баффы ──
document.getElementById('nn-dbg-buff-fed')?.addEventListener('click', () => {
    state.user.satiety = 85;
    state.user.calories = Math.round(effectiveGoal(state.user) * 0.75);
    dbgForceBuff('well_fed', 'Сытость', '🍲', '+0.8% энергии/ч · −15% траты энергии');
});
document.getElementById('nn-dbg-buff-hyd')?.addEventListener('click', () => {
    state.user.water = 88;
    dbgForceBuff('hydrated', 'Гидратация', '💧', '+0.3% энергии/ч · −10% траты воды');
});
document.getElementById('nn-dbg-buff-energy')?.addEventListener('click', () => {
    state.user.energy = 92;
    dbgForceBuff('high_energy', 'Бодрость', '⚡', '+0.3% здоровья/ч · −12% траты энергии');
});

// ── Сброс ──
document.getElementById('nn-dbg-clear')?.addEventListener('click', () => {
    const u = state.user;
    u.diseases = []; u.buffs = []; u.debuffs = [];
    u.satiety = 100; u.water = 100; u.energy = 100;
    u.health = 100; u.calories = 0; u.hoursSinceLastMeal = 0;
    saveState();
    notify('Все состояния очищены', 'success', 2500);
});

document.getElementById('nn-dbg-reset')?.addEventListener('click', () => {
    if (!confirm('Сбросить ВЕСЬ прогресс питания в этом чате?')) return;
    chat_metadata[META_KEY] = defaultState();
    loadState();
    saveState();
});
}


// ═══════════════════════════════════════════════════════════════
// DRAG — перетаскивание за края и углы карточки (только десктоп)
// Слушатели движения вешаются на document — так надёжнее всего.
// ═══════════════════════════════════════════════════════════════
function makeDraggable(el, handle) {
    if (!el) return;

    const DRAG_EDGE = 28; // ширина рамки (px), за которую можно тащить
    let dragging = false;
    let startX, startY, origX, origY;

    // Точка рядом с краем карточки?
    function inEdge(e) {
        if (window.innerWidth <= 768) {
            // На мобилке тащим только за шапку и только в compact-режиме
            const card = document.getElementById('nn-card');
            if (card && card.classList.contains('nn-compact')) {
                return !!e.target.closest('.nn-header');
            }
            return false;
        }
        const r = el.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        return x <= DRAG_EDGE || x >= r.width - DRAG_EDGE
            || y <= DRAG_EDGE || y >= r.height - DRAG_EDGE;
    }

    // Интерактивный элемент под курсором — не тащим
    function isInteractive(e) {
        return !!e.target.closest('button, input, select, textarea, a, .nn-tab');
    }

    // Движение во время перетаскивания (на уровне документа)
    function onMove(e) {
        if (!dragging) return;
        let nx = origX + (e.clientX - startX);
        let ny = origY + (e.clientY - startY);
        nx = Math.max(0, Math.min(window.innerWidth - 120, nx));
        ny = Math.max(0, Math.min(window.innerHeight - 60, ny));
        el.style.left = nx + 'px';
        el.style.top = ny + 'px';
        e.preventDefault();
    }

    // Отпустили кнопку
    function onUp() {
        if (!dragging) return;
        dragging = false;
        el.style.cursor = '';
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        saveCardPos(el);
    }

    // Подсветка курсора при наведении на край
    el.addEventListener('pointermove', (e) => {
        if (dragging) return;
        el.style.cursor = (!isInteractive(e) && inEdge(e)) ? 'grab' : '';
    });

    // Начало перетаскивания
    el.addEventListener('pointerdown', (e) => {
        if (isInteractive(e)) return;
        if (!inEdge(e)) return;

        dragging = true;
        const r = el.getBoundingClientRect();
        el.style.transform = 'none';
        el.style.left = r.left + 'px';
        el.style.top = r.top + 'px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        origX = r.left;
        origY = r.top;
        startX = e.clientX;
        startY = e.clientY;
        el.style.cursor = 'grabbing';

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        e.preventDefault();
    });
}


function saveCardPos(el) {
    if (window.innerWidth <= 768) return;
    const rect = el.getBoundingClientRect();
    localStorage.setItem(POS_LS_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
}

function restoreCardPos(el) {
    // Мобилка + НЕ compact — CSS центрирует через flex, позицию не трогаем
    if (window.innerWidth <= 768 && !el.classList.contains('nn-compact')) {
        el.style.left = '';
        el.style.top = '';
        el.style.right = '';
        el.style.bottom = '';
        el.style.transform = '';
        return;
    }
    // Мобилка + compact — CSS уже поставил позицию (10dvh / 4vw),
    // восстанавливаем только если пользователь уже двигал карточку
    const saved = localStorage.getItem(POS_LS_KEY);
    if (!saved) {
        if (window.innerWidth <= 768) return; // CSS сам расставит
        // Десктоп, первый раз — по центру
        el.style.left = '50%';
        el.style.top = '50%';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        el.style.transform = 'translate(-50%, -50%)';
        return;
    }
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
                        <b>Калории и питание</b>
                        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                    </div>
                    <div class="inline-drawer-content" id="nn-settings-content">
                        <div class="nn-set-row">
                            <label for="nn-chk-enabled">Включить расширение:</label>
                            <input type="checkbox" id="nn-chk-enabled" ${isEnabled() ? 'checked' : ''}>
                        </div>
                        <p style="font-size:0.72rem;opacity:0.6;margin:8px 0 4px;">
                            Все настройки — внутри карточки питания (кнопка 🍎 → шестерёнка ⚙ на карточке персонажа).
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
// HISTORY — лог приёмов пищи
// ═══════════════════════════════════════════════════════════════
function addToHistory(who, items, calories) {
    if (!state.history) state.history = [];
    state.history.push({
        who,       // 'user' | 'bot' | 'both'
        items,     // ['bread', 'soup']
        calories,
        timestamp: Date.now(),
    });
    // Храним максимум 50 записей
    if (state.history.length > 50) {
        state.history = state.history.slice(-50);
    }
}

// ═══════════════════════════════════════════════════════════════
// СНИМКИ СОСТОЯНИЯ — для отката при удалении сообщений
// ═══════════════════════════════════════════════════════════════

// Глубокая копия (простой и надёжный способ для обычных данных)
function nnClone(obj) {
 return JSON.parse(JSON.stringify(obj));
}

// Сохраняем снимок текущих показателей. Привязываем к длине чата на
// этот момент — так снимок можно будет опознать даже после удаления.
function pushSnapshot() {
 if (!state) return;
 if (!Array.isArray(state.snapshots)) state.snapshots = [];
 state.snapshots.push({
 atLength: chat.length,
 user: nnClone(state.user),
 characters: nnClone(state.characters),
 lastGameTime: state.lastGameTime,
 lastProcessedMsgId: state.lastProcessedMsgId,
 });
 // храним максимум 40 снимков, чтобы не раздувать чат
 if (state.snapshots.length > 40) {
 state.snapshots = state.snapshots.slice(-40);
 }
}

// Откат к последнему живому снимку после удаления сообщения(ий)
function rollbackToChatLength() {
 if (!state || !Array.isArray(state.snapshots) || state.snapshots.length === 0) return;

 const len = chat.length;
 // выбрасываем снимки, сделанные для уже удалённых сообщений
 state.snapshots = state.snapshots.filter(s => s.atLength <= len);

 const snap = state.snapshots[state.snapshots.length - 1];
 if (!snap) {
 // ничего не осталось — сбрасываем метку, чтобы следующий ответ пересчитался
 state.lastProcessedMsgId = null;
 saveState();
 return;
 }

 state.user = nnClone(snap.user);
 state.characters = nnClone(snap.characters);
 state.lastGameTime = snap.lastGameTime;
 state.lastProcessedMsgId = snap.lastProcessedMsgId;

 saveState();
 notify('Показатели откачены к удалённому сообщению', 'info', 3000);
}

function onMessageDeleted() {
 if (!isEnabled() || !state) return;
 rollbackToChatLength();
}

// ═══════════════════════════════════════════════════════════════
// CORE PROCESSING — обработка ответа ИИ
// ═══════════════════════════════════════════════════════════════

function processAiResponse(text, messageId) {
    if (!state || !text) return;

    const msgIdNum = Number(messageId);

    if (state.lastProcessedMsgId === msgIdNum) {
        console.log('[NN] Swipe detected — skipping');
        return;
    }

    console.log('[NN] Processing AI response #' + msgIdNum);
    setSilent(true);

    // 1) Парсим тег
    const tag = parseNnTag(text);
    console.log('[NN] Tag:', tag ? JSON.stringify(tag) : 'NOT FOUND');

    // 2) Время
    // Приоритет: tp из нашего тега. Дата (Horae/RP_DATE) — только запасной
    // вариант, если тега нет. Дата ограничена 48 часами — защита от скачков
    // календаря (разные форматы дат дают гигантскую разницу и обнуляют всё).
    let hoursFromTag = tag?.tp ?? 0;
    let hoursFromDate = 0;

    const dateNow = parseGameTime(text);
    if (dateNow && state.lastGameTime != null) {
        const diffMinutes = dateNow.totalMinutes - state.lastGameTime;
        if (diffMinutes > 0) hoursFromDate = Math.min(diffMinutes / 60, 48);
    }

    // Определяем, сколько игровых часов прошло.
    // Приоритет: 1) тег tp от ИИ, 2) игровая дата (Horae/RP_DATE),
    // 3) запасное значение, если ИИ вообще ничего не сообщил —
    //    иначе потребности «замерзают» навсегда.
    let hours;
    if (tag && tag.tp != null) {
        hours = hoursFromTag;              // тег есть — верим только ему
    } else if (hoursFromDate > 0) {
        hours = hoursFromDate;             // тега нет — берём игровую дату
    } else {
        hours = 0.5;                       // ничего нет — считаем, что прошло полчаса
        console.log('[NN] Ни тега, ни даты — применяю запас 0.5ч, чтобы время шло');
    }
    console.log(`[NN] Time: tag=${hoursFromTag}h, date=${hoursFromDate.toFixed(1)}h, applied=${hours.toFixed(1)}h`);

    if (dateNow && (state.lastGameTime == null || dateNow.totalMinutes > state.lastGameTime)) {
        state.lastGameTime = dateNow.totalMinutes;
    }

    // 3) Активность и сон
    const activity = tag?.activity || 'normal';
    const sleeping = tag?.sleeping || false;

    // 4) Tick времени
    if (hours > 0) {
        const userResult = tickTime(state.user, hours, activity, sleeping, effectiveGoal(state.user));
        if (userResult.events.includes('starving')) {
            queueNotify(`${getUserName()} голодает — здоровье падает`, 'warning', 5000);
        }
        if (userResult.events.includes('dehydrated')) {
            queueNotify(`${getUserName()} обезвожена — здоровье падает`, 'warning', 5000);
        }
        if (userResult.events.includes('weight_loss')) {
            queueNotify(`${getUserName()} теряет вес от голода`, 'weight', 4000);
        }

        const botData = getBotState();
        if (botData) {
            const botResult = tickTime(botData, hours, activity, sleeping, effectiveGoal(botData));
            if (botResult.events.includes('starving')) {
                queueNotify(`${getBotName()} голодает — здоровье падает`, 'warning', 5000);
            }
            if (botResult.events.includes('dehydrated')) {
                queueNotify(`${getBotName()} обезвожен — здоровье падает`, 'warning', 5000);
            }
            if (botResult.events.includes('weight_loss')) {
                queueNotify(`${getBotName()} теряет вес от голода`, 'weight', 4000);
            }
        }


        // Смена дня — сброс калорий + расчёт веса
        if (hours >= 16) {
            state.dayCount = (state.dayCount || 1) + 1;

            const prevCal = resetDailyCalories(state.user);
            const weightResult = updateWeight(state.user, prevCal);
            const uGoal = effectiveGoal(state.user);

            // Записываем в историю веса
            const surplus = prevCal - uGoal;
            let reason = 'Норма';
            if (surplus > 500)        reason = 'Переедание';
            else if (surplus > 0)     reason = 'Лёгкий профицит';
            else if (surplus < -800)  reason = 'Сильный дефицит';
            else if (surplus < -200)  reason = 'Умеренный дефицит';

            state.weightHistory.push({
                day: state.dayCount,
                timestamp: Date.now(),
                who: 'user',
                name: getUserName(),
                weight: state.user.weight,
                change: weightResult.gained > 0 ? +weightResult.gained
                      : weightResult.lost > 0 ? -weightResult.lost : 0,
                reason,
                calories: prevCal,
                calorieGoal: uGoal,
            });

            if (weightResult.gained > 0.05) {
                queueNotify(`Вес +${weightResult.gained} кг (переедание)`, 'weight', 4000);
            }
            if (weightResult.lost > 0.05) {
                queueNotify(`Вес -${weightResult.lost} кг (дефицит)`, 'weight', 4000);
            }

            const botData = getBotState();
            if (botData) {
                const botPrev = resetDailyCalories(botData);
                const botWeight = updateWeight(botData, botPrev);
                const bGoal = effectiveGoal(botData);

                const bSurplus = botPrev - bGoal;
                let bReason = 'Норма';
                if (bSurplus > 500)       bReason = 'Переедание';
                else if (bSurplus > 0)    bReason = 'Лёгкий профицит';
                else if (bSurplus < -800) bReason = 'Сильный дефицит';
                else if (bSurplus < -200) bReason = 'Умеренный дефицит';

                state.weightHistory.push({
                    day: state.dayCount,
                    timestamp: Date.now(),
                    who: 'bot',
                    name: getBotName(),
                    weight: botData.weight,
                    change: botWeight.gained > 0 ? +botWeight.gained
                          : botWeight.lost > 0 ? -botWeight.lost : 0,
                    reason: bReason,
                    calories: botPrev,
                    calorieGoal: bGoal,
                });

                if (botWeight.gained > 0.05) {
                    queueNotify(`${getBotName()}: вес +${botWeight.gained} кг (переедание)`, 'weight', 4000);
                }
                if (botWeight.lost > 0.05) {
                    queueNotify(`${getBotName()}: вес -${botWeight.lost} кг (дефицит)`, 'weight', 4000);
                }
            }

            // Ограничиваем историю — 120 записей
            if (state.weightHistory.length > 120) {
                state.weightHistory = state.weightHistory.slice(-120);
            }
        }

    }

    // 5) Еда и питьё из тега
    // Логика атрибуции:
    //  • Если ИИ указал явные user_/bot_ поля — верим только им, общий ate/drank игнорируем.
    //  • Если явных нет — общий ate/drank идёт ТОЛЬКО юзеру (он POV).
    //  • Из еды/питья бота вычищаем позиции, дословно совпадающие с юзером (защита от дубля).
    if (tag) {
        const botData = getBotState();

        const hasExplicitAte = tag.userAte.length > 0 || tag.botAte.length > 0;
        const hasExplicitDrank = tag.userDrank.length > 0 || tag.botDrank.length > 0;

        // Итоговые списки
        const userFood = hasExplicitAte ? tag.userAte : tag.ate;
        const userDrink = hasExplicitDrank ? tag.userDrank : tag.drank;

        // Ключи еды/питья юзера — чтобы не начислить то же самое боту
        const userFoodKeys = new Set(userFood.map(f => f.item.toLowerCase().trim()));
        const userDrinkKeys = new Set(userDrink.map(d => d.item.toLowerCase().trim()));
        const botFood = tag.botAte.filter(f => !userFoodKeys.has(f.item.toLowerCase().trim()));
        const botDrink = tag.botDrank.filter(d => !userDrinkKeys.has(d.item.toLowerCase().trim()));

        // ── Еда юзера ──
        if (userFood.length > 0) {
            let totalCal = 0;
            for (const food of userFood) {
                applyMeal(state.user, food.calories, food.water);
                totalCal += food.calories;
            }
            queueNotify(`${getUserName()} ест: ${userFood.map(f => f.item).join(', ')} (+${totalCal} ккал)`, 'food', 3500);
            addToHistory('user', userFood.map(f => f.item), totalCal);
        }

        // ── Еда бота ──
        if (botFood.length > 0 && botData) {
            let totalCal = 0;
            for (const food of botFood) {
                applyMeal(botData, food.calories, food.water);
                totalCal += food.calories;
            }
            queueNotify(`${getBotName()} ест: ${botFood.map(f => f.item).join(', ')} (+${totalCal} ккал)`, 'food', 3000);
            addToHistory('bot', botFood.map(f => f.item), totalCal);
        }

        // ── Питьё юзера ──
        if (userDrink.length > 0) {
            for (const drink of userDrink) {
                applyDrink(state.user, drink.water);
            }
            queueNotify(`${getUserName()} пьёт: ${userDrink.map(d => d.item).join(', ')}`, 'water', 3000);
        }

        // ── Питьё бота ──
        if (botDrink.length > 0 && botData) {
            for (const drink of botDrink) {
                applyDrink(botData, drink.water);
            }
            queueNotify(`${getBotName()} пьёт: ${botDrink.map(d => d.item).join(', ')}`, 'water', 3000);
        }
    }

    // 6) Эвристика (если нет тега)
    if (!tag) {
        const detected = detectFromText(text);
        if (detected.meals.length > 0) {
            let totalCal = 0;
            for (const food of detected.meals) {
                applyMeal(state.user, food.calories, food.water);
                totalCal += food.calories;
            }
            queueNotify(`Обнаружена еда: ${detected.meals.map(f => f.item).join(', ')} (+${totalCal} ккал)`, 'food', 3500);
            addToHistory('user', detected.meals.map(f => f.item), totalCal);
        }
        if (detected.drinks.length > 0) {
            for (const drink of detected.drinks) {
                applyDrink(state.user, drink.water);
            }
            queueNotify(`Обнаружено питьё: ${detected.drinks.map(d => d.item).join(', ')}`, 'water', 3000);
        }
        if (detected.sleeping && hours > 0) {
            const sleepBonus = Math.min(hours * 12, 100 - state.user.energy);
            state.user.energy = Math.min(100, state.user.energy + sleepBonus);
        }
    }

    // 7) Условия (продвинутая система)
    const userCond = evaluateConditions(state.user, hours);

    for (const id of userCond.added) {
        const disease = state.user.diseases.find(d => d.id === id);
        const debuff = state.user.debuffs.find(d => d.id === id);
        const buff = state.user.buffs.find(b => b.id === id);

        if (disease) queueNotify(`⚠ ${disease.name} (${disease.severity})`, 'disease', 6000);
        else if (debuff) queueNotify(`Дебафф: ${debuff.name}`, 'debuff', 4000);
        else if (buff) queueNotify(`Бафф: ${buff.name}`, 'buff', 3500);
    }

    for (const id of userCond.progressed) {
        const disease = state.user.diseases.find(d => d.id === id);
        if (disease) {
            queueNotify(`⚠ ${disease.name} ухудшилась → ${disease.severity}`, 'disease', 6000);
        }
    }

    for (const id of userCond.removed) {
        queueNotify(`✧ Прошло: ${NN_ID_NAMES[id] || id}`, 'success', 4000);
    }
    for (const id of userCond.recovering) {
        queueNotify(`✧ ${NN_ID_NAMES[id] || id}: началось выздоровление`, 'success', 4500);
    }

    const botData2 = getBotState();
    if (botData2) {
        const botCond = evaluateConditions(botData2, hours);

        for (const id of botCond.added) {
            const disease = botData2.diseases.find(d => d.id === id);
            const debuff = botData2.debuffs.find(d => d.id === id);
            const buff = botData2.buffs.find(b => b.id === id);

            if (disease) queueNotify(`⚠ ${getBotName()}: ${disease.name} (${disease.severity})`, 'disease', 6000);
            else if (debuff) queueNotify(`${getBotName()} — дебафф: ${debuff.name}`, 'debuff', 4000);
            else if (buff) queueNotify(`${getBotName()} — бафф: ${buff.name}`, 'buff', 3500);
        }

        for (const id of botCond.progressed) {
            const disease = botData2.diseases.find(d => d.id === id);
            if (disease) {
                queueNotify(`⚠ ${getBotName()}: ${disease.name} ухудшилась → ${disease.severity}`, 'disease', 6000);
            }
        }

        for (const id of botCond.removed) {
            queueNotify(`✧ ${getBotName()}: прошло ${NN_ID_NAMES[id] || id}`, 'success', 4000);
        }
                for (const id of botCond.recovering) {
            queueNotify(`✧ ${getBotName()}: ${NN_ID_NAMES[id] || id} — выздоровление`, 'success', 4500);
        }

    }

 // 8) Сохраняем
 state.lastProcessedMsgId = msgIdNum;
 pushSnapshot(); // снимок показателей для отката при удалении сообщений

 setSilent(false);
 flushQueue();
 saveState();
}

// ═══════════════════════════════════════════════════════════════
// EVENT HANDLERS
// ═══════════════════════════════════════════════════════════════

function onGenerationStarted(type, params, dryRun) {
    if (!isEnabled() || dryRun) return;
    if (!state) loadState();
    injectPrompt();
}

function onMessageSent(messageId) {
    if (!isEnabled()) return;
    if (!state) loadState();
    injectPrompt();
}


function onMessageReceived(messageId) {
    if (!isEnabled()) return;
    if (!state) loadState();

    const msg = chat[messageId];
    if (!msg || msg.is_user) return;

    processAiResponse(msg.mes, messageId);
}

function onChatChanged() {
    loadState();
    injectPrompt();
    renderMiniBar();
    renderCard();
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
function init() {
    console.log('[Nutrition Framework] init v2 — Stage 2');
    buildToggleButton();
    buildMiniBar();
    buildCard();
    buildThemeSwitcher();
    injectSettingsPanel();
    loadState();
    injectPrompt();
    renderMiniBar();
    applyTheme(getTheme());
    buildHelpModal();

 eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted);
 eventSource.on(event_types.MESSAGE_SENT, onMessageSent);
 eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
 eventSource.on(event_types.MESSAGE_DELETED, onMessageDeleted);
 eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
}

jQuery(() => init());
export { init };
