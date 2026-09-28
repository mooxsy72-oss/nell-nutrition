// nell-nutrition/index.js — v3
// Инфоблок питания в конце каждого ответа бота + расчёт физиологии.

import {
    chat, chat_metadata, this_chid, characters,
    setExtensionPrompt, extension_prompt_types, extension_prompt_roles,
    saveChatDebounced, name1,
} from '../../../../script.js';
import { eventSource, event_types } from '../../../../scripts/events.js';
import { power_user } from '../../../../scripts/power-user.js';

import {
    tickTime, applyMeal, applyDrink, applyVomit, goalOf, reserveCap,
    SCENE_ACTIVITY, bmrOf, burnPerHour,
} from './nutrition-engine.js';
import { parseNnTag, detectFromText, detectActivity, parseGameTime } from './parser.js';
import {
    notify, queueNotify, flushQueue, setSilent, setToastsEnabled, clearQueue,
} from './notifications.js';
import {
    evaluateConditions, buildConditionPrompt, updateFocus,
    getPregnancyStage, calculateImmunity, DISEASE_DB,
    applyTurnEvents, checkRefeeding, edList, ED_DB, ED_SEV_LABEL, ED_GUIDANCE,
} from './conditions.js';
import { EFFECT_INFO, effectView, drinkExtras, grantEffect } from './effects.js';
import {
    ACTIVITY_LEVELS, BUILD_TYPES, calculateCalorieGoal,
    buildCharacterParams, analyzeInitialState,
} from './analyzer.js';
import { PRODUCT_DB, PRODUCT_CATEGORIES } from './products.js';

// ═══════════════════════════════════════════════════════════════
// НАСТРОЙКИ (localStorage — общие для всех чатов)
// ═══════════════════════════════════════════════════════════════
const META_KEY = 'nellNutritionState';
const PROMPT_KEY = 'nell_nutrition_state';
const LS = {
    enabled: 'nellNutrition_enabled',
    toasts: 'nellNutrition_toasts',
    scope: 'nellNutrition_scope',          // 'all' | 'last'
    expand: 'nellNutrition_expandLast',    // раскрывать блок последнего ответа
};
const lsGet = (k, d) => { const v = localStorage.getItem(k); return v === null ? d : v; };
const isEnabled = () => lsGet(LS.enabled, 'true') !== 'false';
const toastsOn = () => lsGet(LS.toasts, 'true') !== 'false';
const scopeAll = () => lsGet(LS.scope, 'all') === 'all';
const expandLast = () => lsGet(LS.expand, 'false') === 'true';

// Названия и иконки состояний берутся из баз болезней и эффектов
const nameOf = (id) => DISEASE_DB[id]?.nameRu || EFFECT_INFO[id]?.name || id;
const isMentalDisease = (id) => DISEASE_DB[id]?.category === 'mental';
const SEV_LABEL = { mild: 'лёгкая', moderate: 'средняя', severe: 'тяжёлая', critical: 'критическая' };
const ACT_LABEL = { low: 'низкая', medium: 'средняя', high: 'высокая',
    resting: 'низкая', normal: 'низкая', active: 'средняя', intense: 'высокая' };
const ACT_ICON = { low: 'fa-couch', medium: 'fa-person-walking', high: 'fa-person-running' };

// Поля профиля — их не откатываем при свайпе/удалении (это правки пользователя)
const PROFILE_FIELDS = ['gender', 'age', 'height', 'build', 'activity',
    'manualGoal', 'calorieGoal', 'pregnant', 'pregnancyWeek', 'ed'];

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const r0 = (n) => Math.round(n || 0);

// ═══════════════════════════════════════════════════════════════
// АВАТАРКИ
// personas.js подгружаем динамически: если в какой-то версии таверны
// его нет или он устроен иначе, расширение всё равно запустится.
// ═══════════════════════════════════════════════════════════════
let personasMod = null;
import('../../../personas.js').then(m => { personasMod = m; scheduleRenderAll(); }).catch(() => {});

function getUserAvatar() {
    const file = personasMod?.user_avatar;
    if (file) return { src: `/thumbnail?type=persona&file=${encodeURIComponent(file)}`, fallback: `/User Avatars/${encodeURIComponent(file)}` };
    const img = document.querySelector('#user_avatar_block .avatar-container.selected img, #user_avatar_block .avatar.selected img, #chat .mes[is_user="true"] .avatar img');
    return img?.src ? { src: img.src, fallback: '' } : null;
}

function getBotAvatar() {
    const bot = getCurrentBot();
    if (bot?.avatar && bot.avatar !== 'none') {
        return { src: `/thumbnail?type=avatar&file=${encodeURIComponent(bot.avatar)}`, fallback: `/characters/${encodeURIComponent(bot.avatar)}` };
    }
    const img = document.querySelector('#chat .mes:not([is_user="true"]) .avatar img');
    return img?.src ? { src: img.src, fallback: '' } : null;
}

function avatarHtml(who, cls) {
    const a = who === 'bot' ? getBotAvatar() : getUserAvatar();
    if (!a) return `<span class="nn-av ${cls} nn-av-empty"><i class="fa-solid fa-user"></i></span>`;
    return `<img class="nn-av ${cls}" src="${esc(a.src)}" data-fallback="${esc(a.fallback)}" alt="" loading="lazy" draggable="false">`;
}

// ═══════════════════════════════════════════════════════════════
// СОСТОЯНИЕ ЧАТА
// ═══════════════════════════════════════════════════════════════
let state = null;

function defaultCharState(name = '', charId = '') {
    return {
        charId, name,
        gender: 'unknown', age: 28, height: 170, weight: 65,
        build: 'average', activity: 'light',
        calorieGoal: 2000, manualGoal: null,

        calories: 0,        // съедено за игровой день
        burned: 0,          // сожжено за игровой день
        reserve: 1000,      // краткосрочный запас энергии
        recentIntake: 0,    // недавно съеденное (для переедания)
        water: 80, satiety: 75, energy: 75, health: 100,

        pregnant: false, pregnancyWeek: 0,
        ed: {},                 // РПП: { anorexia, bulimia, binge } → null | mild | moderate | severe
        diseases: [], buffs: [], debuffs: [],

        bac: 0, bacPeak: 0,     // алкоголь в крови, ‰
        caffeine: 0,            // кофеин, мг
        electrolyte: 0,         // «долг» электролитов после рвоты
        hoursAwake: 0, sleepStreak: 0,
        maxFastHours: 0, starvationTrauma: false,

        lastMealTime: null, hoursSinceLastMeal: 0, daysWithDeficit: 0,
        dayStartWeight: null,  // вес на начало игрового дня
        salience: {}, focus: [], focusCue: {},

        analyzed: false, initialAnalyzed: false,
    };
}

function defaultState() {
    return {
        user: defaultCharState('User', 'user'),
        characters: [],
        clockHours: null,       // игровые часы с 00:00 первого дня
        turn: 0,
        lastGameTime: null,
        history: [],
        weightHistory: [],
        snapshots: [],          // { beforeMsg, ... } — состояние ДО обработки ответа
        manualLog: [],          // ручное кормление, привязанное к ответу
        version: 3,
    };
}

function fillChar(c) {
    const def = defaultCharState();
    for (const k of Object.keys(def)) if (c[k] === undefined) c[k] = clone(def[k]);
    for (const k of ['diseases', 'buffs', 'debuffs']) if (!Array.isArray(c[k])) c[k] = [];
    c.diseases = c.diseases.filter(d => DISEASE_DB[d.id]);
}

function loadState() {
    try {
        if (!chat_metadata[META_KEY]) chat_metadata[META_KEY] = defaultState();
        state = chat_metadata[META_KEY];
        const def = defaultState();
        for (const k of Object.keys(def)) if (state[k] === undefined) state[k] = def[k];

        // Миграция с v2: калории раньше были «чистым балансом»
        if ((state.version || 2) < 3) {
            for (const c of [state.user, ...(state.characters || [])]) {
                if (!c) continue;
                const g = goalOf(c);
                c.reserve = Math.round(Math.min(g, Math.max(0, c.calories || 0)) || g * 0.5 * (c.satiety ?? 60) / 100);
                c.burned = 0; c.recentIntake = 0;
            }
            state.snapshots = [];
            if (state.clockHours == null) state.clockHours = ((state.dayCount || 1) - 1) * 24 + 12;
            state.version = 3;
        }

        state.snapshots = (state.snapshots || []).filter(s => s && s.beforeMsg !== undefined);
        for (const k of ['history', 'weightHistory', 'manualLog']) if (!Array.isArray(state[k])) state[k] = [];
        fillChar(state.user);
        state.user.name = getUserName();
        for (const c of state.characters) fillChar(c);

        if (!state.user.analyzed) analyzeUser();
        ensureBotState();
        analyzeInitialSceneOnce();
        // Вес на начало дня фиксируем уже после анализа карточек
        for (const c of [state.user, ...state.characters]) if (c.dayStartWeight == null) c.dayStartWeight = c.weight;
    } catch (err) {
        console.warn('[NN] loadState failed, resetting:', err);
        chat_metadata[META_KEY] = defaultState();
        state = chat_metadata[META_KEY];
        try { analyzeUser(); ensureBotState(); analyzeInitialSceneOnce(); } catch (e) { /* пусто */ }
    }
}

function saveState() {
    chat_metadata[META_KEY] = state;
    saveChatDebounced();
}

const effectiveGoal = (c) => goalOf(c);

function recalcGoal(c) {
    c.calorieGoal = calculateCalorieGoal({
        gender: c.gender, weight: c.weight, height: c.height, age: c.age,
        activity: c.activity, build: c.build, pregnant: c.pregnant, pregnancyWeek: c.pregnancyWeek,
    });
}

// ─── Персонажи ────────────────────────────────────────────────
const getUserName = () => name1 || 'User';
function getCurrentBot() {
    if (this_chid === undefined || !characters[this_chid]) return null;
    return characters[this_chid];
}
const getBotName = () => getCurrentBot()?.name || 'Bot';
function botCardText(bot) {
    return `${bot.name} ${bot.description || ''} ${bot.personality || ''} ${bot.first_mes || ''}`;
}

function analyzeUser() {
    let desc = '';
    try { desc = power_user?.persona_description || ''; } catch { /* пусто */ }
    const combined = `${getUserName()} ${desc}`;
    if (combined.trim().length > 3) {
        const p = buildCharacterParams(combined);
        Object.assign(state.user, {
            gender: p.gender, age: p.age, height: p.height, weight: p.weight,
            build: p.build, activity: p.activity,
        });
        if (!edList(state.user).length) state.user.ed = { ...p.ed };
        if (state.user.manualGoal == null) state.user.calorieGoal = p.calorieGoal;
    }
    state.user.analyzed = true;
}

function ensureBotState() {
    const bot = getCurrentBot();
    if (!bot) return null;
    const id = bot.avatar || bot.name;
    let c = state.characters.find(x => x.charId === id);
    if (!c) {
        c = defaultCharState(bot.name, id);
        const p = buildCharacterParams(botCardText(bot));
        Object.assign(c, {
            gender: p.gender, age: p.age, height: p.height, weight: p.weight,
            build: p.build, activity: p.activity, calorieGoal: p.calorieGoal, analyzed: true,
            ed: { ...p.ed },
        });
        state.characters.push(c);
    }
    fillChar(c);
    c.name = bot.name;
    return c;
}

function getBotState() {
    const bot = getCurrentBot();
    if (!bot || !state) return null;
    const id = bot.avatar || bot.name;
    return state.characters.find(c => c.charId === id) || null;
}

function activeChars() {
    const list = [{ who: 'user', data: state.user, name: getUserName() }];
    const b = getBotState();
    if (b) list.push({ who: 'bot', data: b, name: getBotName() });
    return list;
}

// Стартовое состояние по первой сцене
function analyzeInitialSceneOnce() {
    let first = null;
    for (const m of chat) { if (m && !m.is_user && m.mes) { first = m.mes; break; } }
    if (!first) first = getCurrentBot()?.first_mes || '';

    const est = analyzeInitialState(first);
    if (state.clockHours == null) state.clockHours = est.startHour;

    const hour = state.clockHours % 24;
    // сколько «дневной нормы» обычно уже съедено к этому часу
    const dayShare = Math.max(0, Math.min(0.9, (hour - 7) / 14));

    for (const c of [state.user, getBotState()]) {
        if (!c || c.initialAnalyzed) continue;
        const g = effectiveGoal(c);
        c.satiety = est.satiety;
        c.water = est.water;
        c.energy = est.energy;
        c.reserve = Math.round(g * (0.25 + 0.5 * est.satiety / 100));
        c.calories = Math.round(g * dayShare);
        c.hoursSinceLastMeal = est.satiety >= 90 ? 0 : est.satiety <= 35 ? 7 : 3;
        c.initialAnalyzed = true;
    }
}

// ═══════════════════════════════════════════════════════════════
// СНИМКИ — пересчёт при свайпе/правке, откат при удалении
// ═══════════════════════════════════════════════════════════════
function takeSnapshot(beforeMsg) {
    state.snapshots = state.snapshots.filter(s => s.beforeMsg < beforeMsg);
    state.snapshots.push({
        beforeMsg,
        user: clone(state.user),
        characters: clone(state.characters),
        clockHours: state.clockHours,
        turn: state.turn,
        lastGameTime: state.lastGameTime,
        weightHistory: clone(state.weightHistory),
        history: clone(state.history),
    });
    if (state.snapshots.length > 30) state.snapshots = state.snapshots.slice(-30);
}

function keepProfile(from, to) {
    if (!from || !to) return;
    for (const f of PROFILE_FIELDS) to[f] = from[f];
}

function restoreSnapshot(snap) {
    const curUser = state.user;
    const curChars = state.characters;
    state.user = clone(snap.user);
    state.characters = clone(snap.characters);
    keepProfile(curUser, state.user);
    for (const c of state.characters) keepProfile(curChars.find(x => x.charId === c.charId), c);
    for (const c of curChars) if (!state.characters.find(x => x.charId === c.charId)) state.characters.push(c);
    state.clockHours = snap.clockHours;
    state.turn = snap.turn;
    state.lastGameTime = snap.lastGameTime;
    state.weightHistory = clone(snap.weightHistory || []);
    state.history = clone(snap.history || []);
}

function onMessageDeleted() {
    if (!isEnabled() || !state) return;
    const len = chat.length;
    const affected = state.snapshots.filter(s => s.beforeMsg >= len).sort((a, b) => a.beforeMsg - b.beforeMsg);
    state.manualLog = state.manualLog.filter(e => e.afterMsg < len);
    if (affected.length) {
        restoreSnapshot(affected[0]);
        state.snapshots = state.snapshots.filter(s => s.beforeMsg < len);
        saveState();
        injectPrompt();
        notify('Показатели откачены к удалённому сообщению', 'info', 2500);
    }
    scheduleRenderAll();
}

// ═══════════════════════════════════════════════════════════════
// ВРЕМЯ: тик шагами ≤ 6ч, смена дня по накопленным игровым часам
// ═══════════════════════════════════════════════════════════════
function newCtx() {
    const mk = () => ({ added: new Set(), removed: new Set(), progressed: new Set(), recovering: new Set(), events: new Set() });
    return { user: mk(), bot: mk(), weight: [] };
}

function mergeCond(ctx, who, res) {
    const t = ctx[who];
    for (const id of res.added) { t.removed.delete(id); t.added.add(id); }
    for (const id of res.removed) { if (t.added.has(id)) t.added.delete(id); else t.removed.add(id); }
    for (const id of res.progressed) t.progressed.add(id);
    for (const id of res.recovering) t.recovering.add(id);
}

function advanceTime(hours, activityOf, sleeping, offscreenFed, ctx) {
    const chars = activeChars();
    if (state.clockHours == null) state.clockHours = 12;
    const feedOffscreen = offscreenFed && hours >= 12 && !sleeping;
    let left = hours;

    while (left > 1e-6) {
        const step = Math.min(6, left);
        left -= step;

        for (const ch of chars) {
            const g = effectiveGoal(ch.data);
            const burnedBefore = ch.data.burned || 0;
            const r = tickTime(ch.data, step, activityOf[ch.who], sleeping, g);
            r.events.forEach(e => ctx[ch.who].events.add(e));
            if (feedOffscreen) {
                // Большой пропуск времени: за кадром ели ровно столько, сколько потратили
                applyMeal(ch.data, (ch.data.burned || 0) - burnedBefore, 0, g);
                applyDrink(ch.data, step * 3.5 * SCENE_ACTIVITY[activityOf[ch.who]].strain, 0, g);
            }
        }

        const prevDay = Math.floor(state.clockHours / 24);
        state.clockHours += step;
        const newDay = Math.floor(state.clockHours / 24);
        for (let d = prevDay + 1; d <= newDay; d++) {
            for (const ch of chars) rolloverDay(ch, d, ctx);
        }

        for (const ch of chars) mergeCond(ctx, ch.who, evaluateConditions(ch.data, step));
    }
}

function rolloverDay(ch, endedDay, ctx) {
    const c = ch.data;
    const g = effectiveGoal(c);
    const intake = r0(c.calories);

    if (intake < g * 0.6) c.daysWithDeficit = (c.daysWithDeficit || 0) + 1;
    else if (intake >= g * 0.85) c.daysWithDeficit = Math.max(0, (c.daysWithDeficit || 0) - 1);

    // Итог дня: считаем по реальному балансу «съедено − сожжено»
    const balance = intake - r0(c.burned);
    let reason = 'Норма';
    if (balance > 500) reason = 'Переедание';
    else if (balance > 150) reason = 'Профицит';
    else if (balance < -800) reason = 'Сильный дефицит';
    else if (balance < -150) reason = 'Дефицит';

    const start = c.dayStartWeight ?? c.weight;
    const change = Math.round((c.weight - start) * 100) / 100;
    state.weightHistory.push({
        day: endedDay, who: ch.who, name: ch.name, weight: +c.weight.toFixed(2),
        change, reason, calories: intake, burned: r0(c.burned), calorieGoal: g, timestamp: Date.now(),
    });
    if (state.weightHistory.length > 120) state.weightHistory = state.weightHistory.slice(-120);
    if (Math.abs(change) >= 0.05) ctx.weight.push({ name: ch.name, change });

    c.calories = 0;
    c.burned = 0;
    c.dayStartWeight = c.weight;
    // Вес изменился — норма калорий тоже (если не задана вручную)
    if (c.manualGoal == null) recalcGoal(c);
}

const dayNumber = () => Math.floor((state.clockHours ?? 12) / 24) + 1;

function dayPart(clockHours) {
    const h = Math.floor(((clockHours ?? 12) % 24 + 24) % 24);
    if (h < 5) return ['ночь', 'night'];
    if (h < 11) return ['утро', 'morning'];
    if (h < 17) return ['день', 'daytime'];
    if (h < 22) return ['вечер', 'evening'];
    return ['ночь', 'night'];
}
function clockLabel(clockHours) {
    if (clockHours == null) return '';
    return `День ${Math.floor(clockHours / 24) + 1}, ${dayPart(clockHours)[0]}`;
}

// ═══════════════════════════════════════════════════════════════
// ОБРАБОТКА ОТВЕТА ИИ
// ═══════════════════════════════════════════════════════════════
const sumCal = (list) => list.reduce((a, x) => a + (x.calories || 0), 0);

function consume(ch, foods, drinks, ctx) {
    const c = ch.data, g = effectiveGoal(c);
    const kcal = sumCal(foods) + sumCal(drinks);
    // Резкое наедание после долгого голода — до применения еды
    const rf = checkRefeeding(c, kcal, g);
    if (rf && ctx) ctx[ch.who].added.add(rf);
    if (foods.length) {
        const water = Math.min(60, foods.reduce((a, f) => a + (f.water || 0), 0));
        applyMeal(c, sumCal(foods), water, g);
        addToHistory(ch.who, foods.map(f => f.item), sumCal(foods));
    }
    for (const d of drinks) {
        const extras = d.alcoholG != null ? d : drinkExtras(d.item, d.ml || 250);
        applyDrink(c, d.water, d.calories || 0, g, { alcoholG: extras.alcoholG || 0, caffeineMg: extras.caffeineMg || 0 });
    }
    return kcal;
}

function addToHistory(who, items, calories) {
    state.history.push({ who, items, calories: r0(calories), clock: state.clockHours, timestamp: Date.now() });
    if (state.history.length > 40) state.history = state.history.slice(-40);
}

function lastProcessedMsg() {
    return state.snapshots.reduce((m, s) => Math.max(m, s.beforeMsg), -1);
}

function processAiResponse(messageId) {
    const msg = chat[messageId];
    if (!state || !msg || msg.is_user || msg.is_system || !msg.mes) return;
    const N = Number(messageId);

    // Повторная обработка того же ответа (свайп, регенерация, «продолжить», правка):
    // сначала возвращаемся к состоянию ДО него, потом считаем заново.
    const snap = state.snapshots.find(s => s.beforeMsg === N);
    if (snap) restoreSnapshot(snap);
    takeSnapshot(N);
    state.turn = (state.turn || 0) + 1;

    setSilent(true);
    clearQueue();
    const text = msg.mes;
    const tag = parseNnTag(text);
    const ctx = newCtx();

    // ── Время ──
    let hoursFromDate = 0;
    const dateNow = parseGameTime(text);
    if (dateNow && state.lastGameTime != null) {
        const diff = dateNow.totalMinutes - state.lastGameTime;
        if (diff > 0) hoursFromDate = Math.min(diff / 60, 48);
    }
    let hours;
    if (tag && tag.tp != null) hours = tag.tp;
    else if (hoursFromDate > 0) hours = hoursFromDate;
    else hours = 0.5;
    if (dateNow && (state.lastGameTime == null || dateNow.totalMinutes > state.lastGameTime)) {
        state.lastGameTime = dateNow.totalMinutes;
    }

    // Активность: отдельная для каждого из тега → общая из тега → по тексту
    const sceneActivity = tag?.activity || detectActivity(text);
    const activityOf = {
        user: tag?.userActivity || sceneActivity,
        bot: tag?.botActivity || sceneActivity,
    };
    const activitySource = (tag?.userActivity || tag?.botActivity || tag?.activity) ? 'tag' : 'text';
    let sleeping = !!tag?.sleeping;
    const offscreenFed = hours >= 24 ? tag?.offscreen !== 'hungry' : tag?.offscreen === 'fed';

    // ── Еда: из тега, а если его нет — оценка по тексту ──
    const bot = getBotState();
    let userFood = [], userDrink = [], botFood = [], botDrink = [];
    let source = 'tag';
    if (tag) {
        // Явное user_ate важнее общего ate; bot_ate на еду юзера не влияет
        userFood = tag.userAte.length ? tag.userAte : tag.ate;
        userDrink = tag.userDrank.length ? tag.userDrank : tag.drank;
        if (bot) { botFood = tag.botAte; botDrink = tag.botDrank; }
    } else {
        const det = detectFromText(text);
        userFood = det.meals; userDrink = det.drinks;
        if (det.sleeping && hours >= 3) sleeping = true;
        source = (det.meals.length || det.drinks.length) ? 'text' : 'none';
    }

    const weightBefore = Object.fromEntries(activeChars().map(ch => [ch.who, ch.data.weight]));
    const burnedBefore = Object.fromEntries(activeChars().map(ch => [ch.who, ch.data.burned || 0]));
    const dayBefore = Math.floor((state.clockHours ?? 12) / 24);
    advanceTime(hours, activityOf, sleeping, offscreenFed, ctx);

    const chars = activeChars();
    const byWho = Object.fromEntries(chars.map(c => [c.who, c]));
    const mealKcal = { user: consume(byWho.user, userFood, userDrink, ctx), bot: 0 };
    if (byWho.bot) mealKcal.bot = consume(byWho.bot, botFood, botDrink, ctx);

    // Рвота (болезнь, алкоголь, булимия)
    const vomited = { user: !!tag?.userVomited, bot: !!(bot && tag?.botVomited) };
    for (const ch of chars) {
        if (!vomited[ch.who]) continue;
        const lost = applyVomit(ch.data);
        queueNotify(`${ch.name}: рвота${lost ? `, потеряно ~${lost} ккал` : ''}`, 'warning', 4000);
    }
    // События хода → эффекты (выспался, тревога после еды, стыд)
    for (const ch of chars) {
        const added = [];
        applyTurnEvents(ch.data, { slept: sleeping ? hours : 0, mealKcal: mealKcal[ch.who], vomited: vomited[ch.who] }, added);
        added.forEach(id => ctx[ch.who].added.add(id));
    }
    const foodInScene = mealKcal.user > 0 || mealKcal.bot > 0;

    // Ручное кормление, сделанное после этого ответа, применяем заново
    for (const e of state.manualLog.filter(x => x.afterMsg === N)) applyManual(e);

    for (const ch of chars) mergeCond(ctx, ch.who, evaluateConditions(ch.data, 0));

    // ── Уведомления ──
    const uName = getUserName(), bName = getBotName();
    const foodLine = (name, list) => `${name}: ${list.map(f => f.item).join(', ')} (+${sumCal(list)} ккал)`;
    if (userFood.length) queueNotify(foodLine(uName, userFood) + (source === 'text' ? ' — оценка по тексту' : ''), 'food', 3500);
    if (botFood.length) queueNotify(foodLine(bName, botFood), 'food', 3500);
    if (userDrink.length) queueNotify(`${uName}: ${userDrink.map(d => d.item).join(', ')}`, 'water', 3000);
    if (botDrink.length) queueNotify(`${bName}: ${botDrink.map(d => d.item).join(', ')}`, 'water', 3000);

    for (const ch of chars) {
        const t = ctx[ch.who];
        const who = ch.name;
        if (t.events.has('starving')) queueNotify(`${who} голодает — здоровье падает`, 'warning', 5000);
        if (t.events.has('dehydrated')) queueNotify(`${who}: обезвоживание — здоровье падает`, 'warning', 5000);
        for (const id of t.added) {
            const d = ch.data.diseases.find(x => x.id === id);
            if (d) {
                queueNotify(`${who}: ${d.name} (${SEV_LABEL[d.severity]})`, isMentalDisease(id) ? 'mental' : 'disease', 6000);
                continue;
            }
            const e = [...ch.data.debuffs, ...ch.data.buffs].find(x => x.id === id);
            if (e) {
                const v = effectView(e);
                queueNotify(`${who}: ${v.name}`, v.kind === 'positive' ? 'buff' : 'debuff', 3500);
            }
        }
        for (const id of t.progressed) {
            const d = ch.data.diseases.find(x => x.id === id);
            if (d) queueNotify(`${who}: ${d.name} ухудшилась — ${SEV_LABEL[d.severity]}`, 'disease', 6000);
        }
        for (const id of t.recovering) queueNotify(`${who}: ${nameOf(id)} — началось выздоровление`, 'success', 4500);
        for (const id of t.removed) {
            // Мелкие эффекты при исчезновении не показываем — только болезни
            if (DISEASE_DB[id]) queueNotify(`${who}: прошло — ${nameOf(id)}`, 'success', 4000);
        }

        // Что «всплывёт» в следующем ответе
        updateFocus(ch.data, state.turn, new Set([...t.added, ...t.progressed]), { foodInScene });
    }
    for (const w of ctx.weight) {
        queueNotify(`${w.name}: вес ${w.change > 0 ? '+' : ''}${w.change.toFixed(2)} кг`, 'weight', 4000);
    }

    // ── Снимок для инфоблока этого сообщения ──
    msg.extra = msg.extra || {};
    msg.extra.nn = {
        v: 3,
        clock: state.clockHours,
        user: viewOf(state.user),
        bot: bot ? viewOf(bot) : null,
        turn: {
            hours, sleeping, source,
            activity: activityOf, activitySource,
            burned: Object.fromEntries(chars.map(ch => [ch.who,
                // если в ходе была полночь, «сожжено за день» обнулилось — считаем по часам
                Math.floor(state.clockHours / 24) === dayBefore
                    ? r0((ch.data.burned || 0) - burnedBefore[ch.who])
                    : r0(burnPerHour(ch.data, activityOf[ch.who], sleeping) * hours)])),
            offscreen: offscreenFed && hours >= 12,
            weightDelta: {
                user: +(state.user.weight - weightBefore.user).toFixed(3),
                bot: bot ? +(bot.weight - (weightBefore.bot ?? bot.weight)).toFixed(3) : 0,
            },
            userFood: slimItems(userFood), userDrink: slimItems(userDrink),
            botFood: slimItems(botFood), botDrink: slimItems(botDrink),
        },
    };

    setSilent(false);
    flushQueue();
    saveState();
    injectPrompt();
    scheduleRenderAll();
}

function slimItems(list) {
    return list.map(x => ({ item: x.item, calories: r0(x.calories), water: r0(x.water), ml: x.ml }));
}

function viewOf(c) {
    return {
        name: c === state.user ? getUserName() : c.name,
        calories: r0(c.calories), goal: effectiveGoal(c), burned: r0(c.burned),
        satiety: r0(c.satiety), water: r0(c.water), energy: r0(c.energy), health: r0(c.health),
        weight: c.weight, height: c.height, age: c.age, gender: c.gender,
        weightToday: +((c.weight - (c.dayStartWeight ?? c.weight))).toFixed(3),
        pregnant: !!c.pregnant, pregnancyWeek: c.pregnancyWeek || 0,
        hoursSinceLastMeal: c.hoursSinceLastMeal || 0,
        immunity: calculateImmunity(c),
        bac: +(c.bac || 0).toFixed(2),
        ed: edList(c),
        effects: [...c.debuffs, ...c.buffs].map(e => ({ id: e.id, ...effectView(e), fading: !!e.fading, fadeLeft: e.fadeLeft })),
        diseases: c.diseases.map(d => ({
            id: d.id, name: d.name, severity: d.severity, recovering: !!d.recovering,
            category: DISEASE_DB[d.id]?.category || 'physical',
            since: d.since, effects: d.effects || [],
            left: d.recovering ? Math.max(0.5, r0((DISEASE_DB[d.id]?.recovery?.[d.severity] ?? 6) - (d.recoveryHours || 0))) : null,
        })),
    };
}

// ═══════════════════════════════════════════════════════════════
// РУЧНОЕ КОРМЛЕНИЕ
// ═══════════════════════════════════════════════════════════════
function applyManual(e) {
    const data = e.who === 'bot' ? getBotState() : state.user;
    if (!data) return;
    const g = effectiveGoal(data);
    checkRefeeding(data, e.kcal, g);
    if (e.drink) applyDrink(data, e.water, e.kcal, g, drinkExtras(e.name, e.grams));
    else applyMeal(data, e.kcal, e.water, g);
    applyTurnEvents(data, { mealKcal: e.kcal });
}

function consumeProduct(p, who, grams) {
    const data = who === 'bot' ? getBotState() : state.user;
    if (!data) { notify('Персонаж не загружен', 'warning', 3000, true); return; }

    const kcal = Math.round(p.cal100 * grams / 100);
    const water = Math.round((p.water100 || 0) * grams / 100);
    const entry = { afterMsg: lastProcessedMsg(), who, name: p.name, grams, kcal, water, drink: !!p.drink };
    applyManual(entry);
    state.manualLog.push(entry);
    if (state.manualLog.length > 100) state.manualLog = state.manualLog.slice(-100);

    evaluateConditions(data, 0);
    addToHistory(who, [`${p.name} ${grams}${p.drink ? 'мл' : 'г'}`], kcal);

    const whoName = who === 'bot' ? getBotName() : getUserName();
    const parts = [];
    if (kcal > 0) parts.push(`+${kcal} ккал`);
    if (water > 0) parts.push(`+${water}% воды`);
    notify(`${whoName}: ${p.name}, ${grams} ${p.drink ? 'мл' : 'г'}${parts.length ? ' (' + parts.join(', ') + ')' : ''}`,
        p.drink ? 'water' : 'food', 3000, true);

    ui.prodSel = null;
    saveState();
    injectPrompt();
    renderLiveBlock();
}

// ═══════════════════════════════════════════════════════════════
// ПРОМПТ ДЛЯ ИИ
// ═══════════════════════════════════════════════════════════════
function levelWord(v, kind) {
    const T = {
        satiety: [[85, 'full'], [60, 'satisfied'], [35, 'peckish'], [15, 'hungry'], [-1, 'starving']],
        water: [[80, 'well hydrated'], [55, 'hydration fine'], [30, 'thirsty'], [15, 'very thirsty'], [-1, 'severely dehydrated']],
        energy: [[80, 'energetic'], [55, 'normal energy'], [30, 'tired'], [15, 'exhausted'], [-1, 'barely upright']],
        health: [[80, 'healthy'], [55, 'unwell'], [30, 'weak'], [-1, 'critical']],
    }[kind];
    for (const [th, w] of T) if (v > th) return w;
    return T[T.length - 1][1];
}

function getActionCapacity(c) {
    // Психика влияет на поведение, но не на физическую способность действовать
    const phys = c.diseases.filter(d => DISEASE_DB[d.id]?.category !== 'mental');
    const crit = phys.some(d => !d.recovering && d.severity === 'critical');
    const sev = phys.some(d => !d.recovering && d.severity === 'severe');
    if (crit || c.health <= 15) return 'INCAPACITATED — cannot run, fight or stand for long; needs help from others.';
    if (sev || c.energy <= 15 || c.health <= 35) return 'CRITICALLY WEAKENED — fleeing, fighting, climbing fail by default; at best a costly partial success.';
    if (phys.length || c.energy <= 35 || c.satiety <= 20 || c.water <= 20) return 'WEAKENED — physical actions take visible strain; prolonged effort likely fails partway.';
    return null;
}

function charPromptBlock(c, name, isUser) {
    const lastMeal = c.hoursSinceLastMeal >= 1 ? `last meal ~${Math.round(c.hoursSinceLastMeal)}h ago` : 'ate recently';
    const lines = [
        `${name}${isUser ? ' (player character)' : ''}: ${levelWord(c.satiety, 'satiety')}, ${levelWord(c.water, 'water')}, ${levelWord(c.energy, 'energy')}, ${levelWord(c.health, 'health')}; ${lastMeal}; eaten today ≈${r0(c.calories)} of ~${effectiveGoal(c)} kcal.`,
    ];
    const cond = buildConditionPrompt(c, name, { isUser });
    if (cond) lines.push(cond);
    const cap = getActionCapacity(c);
    if (cap) lines.push(`  Physical capacity: ${cap}`);
    return lines.join('\n');
}

function buildSystemPrompt() {
    if (!state) return '';
    const u = state.user, b = getBotState();
    const userName = getUserName(), botName = getBotName();

    const anySurface = (u.focus?.length || 0) + (b?.focus?.length || 0) > 0;
    const blocks = [charPromptBlock(u, userName, true)];
    if (b) blocks.push(charPromptBlock(b, botName, false));
    const anyEd = edList(u).length || (b && edList(b).length);
    const timeLine = state.clockHours != null
        ? `In-world time estimate: day ${dayNumber()}, ${dayPart(state.clockHours)[1]}.\n`
        : '';

    return `[Nutrition tracker — hidden physiological state. It is background context for the story, not its topic.]
${timeLine}
${blocks.join('\n\n')}

How to use this:
- ${anySurface ? 'Mention a physical state only where it is listed under "Surface in this reply".' : 'Nothing needs to surface in this reply.'} Anything under "Background only" stays unspoken unless the scene itself turns to food, drink, rest or hard physical effort.
- When something surfaces, one short concrete detail inside the action or dialogue is enough — never a paragraph, never the opening or closing line.
- Don't reuse a symptom, image or wording you already used in recent replies. Vary it or leave it out.
- For ${userName}: show only outward signs; never decide their feelings, thoughts or actions.
- Weakness still limits what bodies can actually do, even when it is not narrated.
- Mental conditions show through behaviour, choices and dialogue — not through narrated diagnoses.${anyEd ? `\n- ${ED_GUIDANCE}` : ''}

REQUIRED hidden tag — end every reply with exactly one line:
<!-- NN tp=HOURS | activity=low|medium|high | user_ate=... | user_drank=... | bot_ate=... | bot_drank=... -->
- tp: in-world hours since the previous reply (a few minutes = 0.2, an hour = 1, a night = 8).
- activity — what the bodies mostly did during that time: low = sitting, talking, resting, light tasks; medium = walking, chores, cooking, handiwork, riding; high = running, fighting, heavy labour, climbing, a long march with a load. If ${userName} and ${botName} did different things, use user_activity=… and bot_activity=… instead.
- sleeping=true only if the characters slept during this reply.
- user_vomited=true / bot_vomited=true only if that character actually threw up in this reply.
- Food: only what was actually eaten in this reply or described as eaten in ${userName}'s last message. Not food that was served, cooked, offered or talked about. If a meal continues from an earlier reply, list only the newly eaten part.
- Write food as название:ККАЛ for the real portion — a bite ≈ 50, a snack ≈ 150–250, a plate ≈ 400–700, a feast ≈ 1000+. One entry per dish, comma-separated.
- Write drinks as название:МЛ — a sip ≈ 30мл, a cup ≈ 200–250мл, a big mug ≈ 400мл.
- user_… is ${userName}, bot_… is ${botName}. Leave out empty fields. Other NPCs are not tracked.
- For time skips of a day or more, off-screen meals are assumed; add offscreen=hungry only if they truly had nothing to eat.
Examples:
<!-- NN tp=0.2 | activity=low -->
<!-- NN tp=1 | activity=low | user_ate=борщ:320, ржаной хлеб:90 | user_drank=чай:200мл | bot_ate=борщ:320 -->
<!-- NN tp=0.5 | user_activity=low | bot_activity=high -->
<!-- NN tp=8 | activity=low | sleeping=true -->`;
}

function injectPrompt() {
    const prompt = (isEnabled() && state) ? buildSystemPrompt() : '';
    setExtensionPrompt(PROMPT_KEY, prompt, extension_prompt_types.IN_CHAT, 2, true, extension_prompt_roles.SYSTEM);
}

// ═══════════════════════════════════════════════════════════════
// ИНФОБЛОК В СООБЩЕНИИ
// ═══════════════════════════════════════════════════════════════
const ui = {
    open: new Map(),     // mesId → раскрыт ли блок
    tab: new Map(),      // mesId → активная вкладка
    who: 'user',         // чей профиль/кормление в живом блоке
    prodCat: 'meat', prodSearch: '', prodSel: null, prodGrams: null,
};

const TABS = [
    { id: 'overview', icon: 'fa-chart-simple', label: 'Обзор' },
    { id: 'states', icon: 'fa-notes-medical', label: 'Состояния' },
    { id: 'log', icon: 'fa-receipt', label: 'Журнал' },
    { id: 'weight', icon: 'fa-weight-scale', label: 'Вес', live: true },
    { id: 'feed', icon: 'fa-utensils', label: 'Покормить', live: true },
    { id: 'params', icon: 'fa-sliders', label: 'Параметры', live: true },
];

function lastBotIndex() {
    for (let i = chat.length - 1; i >= 0; i--) {
        const m = chat[i];
        if (m && !m.is_user && !m.is_system) return i;
    }
    return -1;
}
const getMesEl = (id) => document.querySelector(`#chat .mes[mesid="${id}"]`);

function liveSnap() {
    const b = getBotState();
    const lb = lastBotIndex();
    return {
        clock: state.clockHours,
        user: viewOf(state.user),
        bot: b ? viewOf(b) : null,
        turn: lb >= 0 ? chat[lb]?.extra?.nn?.turn ?? null : null,
    };
}

let renderTimer = null;
function scheduleRenderAll() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderAllBlocks, 60);
}
function renderAllBlocks() {
    if (!isEnabled()) { document.querySelectorAll('.nn-ib').forEach(b => b.remove()); return; }
    if (!state && chat.length) loadState();
    document.querySelectorAll('#chat .mes[mesid]').forEach(el => renderBlock(Number(el.getAttribute('mesid'))));
}
function renderLiveBlock() { renderBlock(lastBotIndex()); }

function renderBlock(id) {
    const el = getMesEl(id);
    if (!el) return;
    const msg = chat[id];
    const live = id === lastBotIndex();
    let block = el.querySelector('.nn-ib');
    const snap = state && msg && !msg.is_user && !msg.is_system ? (live ? liveSnap() : msg.extra?.nn) : null;
    const show = isEnabled() && snap && snap.user && (scopeAll() || live);

    if (!show) { block?.remove(); return; }
    if (!block) {
        const anchor = el.querySelector('.mes_text');
        if (!anchor) return;
        block = document.createElement('div');
        block.className = 'nn-ib';
        anchor.insertAdjacentElement('afterend', block);
        bindBlock(block);
    }
    block.dataset.mesid = String(id);
    const open = ui.open.has(id) ? ui.open.get(id) : (live && expandLast());
    block.classList.toggle('nn-open', open);
    block.classList.toggle('nn-live', live);

    let tab = ui.tab.get(id) || 'overview';
    if (!live && TABS.find(t => t.id === tab)?.live) tab = 'overview';

    // Сохраняем фокус поиска при перерисовке
    const searchFocused = document.activeElement?.classList?.contains('nn-search');
    block.innerHTML = headHtml(snap, open) + (open ? bodyHtml(snap, live, tab) : '');
    if (searchFocused && open && tab === 'feed') {
        const s = block.querySelector('.nn-search');
        if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    }
}

// ─── Хелперы разметки ─────────────────────────────────────────
// Старые снимки хранили баффы/дебаффы отдельно — приводим к единому списку
function effectsOf(v) {
    if (v.effects) return v.effects;
    return [...(v.debuffs || []), ...(v.buffs || [])].map(e => ({ id: e.id, ...effectView(e), fading: !!e.fading, fadeLeft: e.fadeLeft ?? e.hoursLeft }));
}
const physicalOf = (v) => v.diseases.filter(d => (d.category || 'physical') === 'physical');
const mentalOf = (v) => v.diseases.filter(d => d.category === 'mental');
const lvl = (v) => (v > 60 ? 'good' : v > 30 ? 'warn' : 'bad');
const pct = (v) => Math.max(0, Math.min(100, r0(v)));

function plural(n, forms) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
}
function fmtH(h) {
    if (h == null) return '';
    if (h < 1) return `${Math.max(1, Math.round(h * 60))} мин`;
    if (h >= 24) {
        const d = Math.floor(h / 24), rest = Math.round(h % 24);
        return rest ? `${d} д ${rest} ч` : `${d} д`;
    }
    return `${+h.toFixed(1)} ч`;
}

const kg = (w) => (Math.round((w || 0) * 10) / 10).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function kgDelta(d, digits = 2) {
    if (Math.abs(d) < 0.005) return '±0';
    return (d > 0 ? '+' : '−') + Math.abs(d).toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function meter(icon, v, label) {
    return `<span class="nn-m nn-${lvl(v)}" title="${label}: ${pct(v)}%">
        <i class="fa-solid ${icon}"></i><span class="nn-m-track"><span style="width:${pct(v)}%"></span></span>
    </span>`;
}

function fxBadges(v) {
    let h = '';
    const phys = physicalOf(v).length;
    const mind = mentalOf(v).length + (v.ed?.length || 0);
    const eff = effectsOf(v);
    const neg = eff.filter(e => e.kind !== 'positive').length;
    const pos = eff.filter(e => e.kind === 'positive').length;
    if (phys) h += `<span class="nn-fx nn-bad" title="Физические болезни"><i class="fa-solid fa-virus"></i>${phys}</span>`;
    if (mind) h += `<span class="nn-fx nn-mind" title="Психика"><i class="fa-solid fa-brain"></i>${mind}</span>`;
    if (neg) h += `<span class="nn-fx nn-warn" title="Отрицательные эффекты"><i class="fa-solid fa-arrow-trend-down"></i>${neg}</span>`;
    if (pos) h += `<span class="nn-fx nn-good" title="Положительные эффекты"><i class="fa-solid fa-arrow-trend-up"></i>${pos}</span>`;
    return h;
}

function personChip(v, who) {
    return `<span class="nn-chip">
        ${avatarHtml(who, 'nn-av-sm')}
        <span class="nn-chip-name">${esc(v.name)}</span>
        <span class="nn-chip-kcal" title="Съедено за игровой день"><i class="fa-solid fa-fire-flame-curved"></i>${v.calories}<small>/${v.goal}</small></span>
        <span class="nn-chip-meters">
            ${meter('fa-utensils', v.satiety, 'Сытость')}
            ${meter('fa-droplet', v.water, 'Вода')}
            ${meter('fa-bolt', v.energy, 'Энергия')}
            ${meter('fa-heart-pulse', v.health, 'Здоровье')}
        </span>
        ${fxBadges(v)}
    </span>`;
}

function turnKcal(turn) {
    if (!turn) return 0;
    return [...turn.userFood, ...turn.botFood, ...turn.userDrink, ...turn.botDrink]
        .reduce((a, x) => a + (x.calories || 0), 0);
}

function headHtml(snap, open) {
    const t = snap.turn;
    const delta = [];
    if (t) {
        delta.push(`<span title="Прошло игрового времени"><i class="fa-regular fa-clock"></i>${fmtH(t.hours)}</span>`);
        if (t.sleeping) delta.push(`<span title="Сон"><i class="fa-solid fa-moon"></i></span>`);
        else if (t.activity && typeof t.activity === 'object') {
            const top = ['high', 'medium', 'low'].find(l => Object.values(t.activity).includes(l)) || 'low';
            delta.push(`<span title="Активность: ${ACT_LABEL[top]}"><i class="fa-solid ${ACT_ICON[top]}"></i></span>`);
        }
        const kc = turnKcal(t);
        if (kc > 0) delta.push(`<span title="Съедено и выпито в этом ответе"><i class="fa-solid fa-plus"></i>${kc}</span>`);
        if (t.source !== 'tag') delta.push(`<span class="nn-warn" title="ИИ не оставил тег — значения оценены"><i class="fa-solid fa-triangle-exclamation"></i></span>`);
    } else {
        delta.push(`<span title="Стартовые значения по первой сцене — обновятся после следующего ответа"><i class="fa-solid fa-flag"></i>старт</span>`);
    }
    return `<div class="nn-head" role="button" tabindex="0" data-act="toggle" aria-expanded="${open}">
        <span class="nn-people">${personChip(snap.user, 'user')}${snap.bot ? personChip(snap.bot, 'bot') : ''}</span>
        <span class="nn-delta">${delta.join('')}</span>
        <i class="fa-solid fa-chevron-down nn-chev"></i>
    </div>`;
}

function bodyHtml(snap, live, tab) {
    const tabs = TABS.filter(t => live || !t.live).map(t => `
        <button class="nn-tab${t.id === tab ? ' nn-on' : ''}" data-act="tab" data-tab="${t.id}" role="tab" aria-selected="${t.id === tab}">
            <i class="fa-solid ${t.icon}"></i><span>${t.label}</span>
        </button>`).join('');

    let pane = '';
    switch (tab) {
        case 'states': pane = statesPane(snap); break;
        case 'log': pane = logPane(snap, live); break;
        case 'weight': pane = weightPane(); break;
        case 'feed': pane = feedPane(); break;
        case 'params': pane = paramsPane(); break;
        default: pane = overviewPane(snap);
    }
    const foot = [clockLabel(snap.clock)];
    if (!live) foot.push('состояние на момент этого ответа');
    return `<div class="nn-body">
        <div class="nn-tabs" role="tablist">${tabs}</div>
        <div class="nn-pane">${pane}</div>
        <div class="nn-foot">${foot.filter(Boolean).map(esc).join('. ')}</div>
    </div>`;
}

// ─── Обзор ────────────────────────────────────────────────────
function statusOf(v) {
    const phys = physicalOf(v);
    if (phys.some(d => d.severity === 'critical' || d.severity === 'severe')) return ['Критично', 'fa-heart-crack', 'bad'];
    if (phys.length || v.health < 40 || v.energy < 20) return ['Плохо', 'fa-face-dizzy', 'bad'];
    if (v.satiety < 30 || v.water < 30 || effectsOf(v).some(e => e.kind === 'negative' && !e.fading)) return ['Напряжение', 'fa-triangle-exclamation', 'warn'];
    if (v.health > 70 && v.energy > 60 && v.satiety > 50) return ['Здоров', 'fa-heart', 'good'];
    return ['Стабильно', 'fa-heart', 'good'];
}

function statRow(icon, label, v) {
    return `<div class="nn-row nn-${lvl(v)}">
        <i class="fa-solid ${icon}"></i><span class="nn-row-label">${label}</span>
        <span class="nn-bar"><span style="width:${pct(v)}%"></span></span>
        <b class="nn-row-val">${pct(v)}%</b>
    </div>`;
}

function personCard(v, who) {
    const [stText, stIcon, stLvl] = statusOf(v);
    const g = v.gender === 'male' ? 'fa-mars' : v.gender === 'female' ? 'fa-venus' : 'fa-genderless';
    const kPct = v.goal ? Math.round(v.calories / v.goal * 100) : 0;
    const kLvl = kPct > 130 ? 'over' : kPct < 30 ? 'bad' : kPct < 60 ? 'warn' : 'good';
    const last = v.hoursSinceLastMeal >= 1 ? `последний приём ${fmtH(v.hoursSinceLastMeal)} назад` : 'ел(а) недавно';

    let preg = '';
    if (v.pregnant && v.gender !== 'male') {
        const st = getPregnancyStage(v.pregnancyWeek);
        preg = `<div class="nn-note"><i class="fa-solid fa-person-pregnant"></i><span>${esc(st.label)}, неделя ${v.pregnancyWeek || '—'}. ${esc(st.desc || '')}</span></div>`;
    }
    if (v.ed?.length) {
        preg += `<div class="nn-note nn-note-mind"><i class="fa-solid fa-brain"></i><span>${v.ed.map(e => `${ED_DB[e.id].nameRu} (${ED_SEV_LABEL[e.severity]})`).join(', ')}</span></div>`;
    }
    return `<section class="nn-card">
        <header class="nn-card-head">
            ${avatarHtml(who, 'nn-av-lg')}
            <div class="nn-card-id">
                <div class="nn-card-name">${esc(v.name)}</div>
                <div class="nn-card-sub"><i class="fa-solid ${g}"></i>${v.age} ${plural(v.age, ['год', 'года', 'лет'])}, ${v.height} см, ${kg(v.weight)} кг${v.weightToday != null && Math.abs(v.weightToday) >= 0.005 ? ` <span class="nn-mute">(${kgDelta(v.weightToday)} за день)</span>` : ''}</div>
            </div>
            <span class="nn-status nn-${stLvl}"><i class="fa-solid ${stIcon}"></i>${stText}</span>
        </header>
        <div class="nn-kcal nn-${kLvl}">
            <div class="nn-kcal-num"><b>${v.calories}</b><span>из ${v.goal} ккал за день</span></div>
            <span class="nn-bar nn-bar-thick"><span style="width:${Math.min(100, kPct)}%"></span></span>
            <div class="nn-kcal-meta">сожжено ${v.burned} ккал, ${last}</div>
        </div>
        <div class="nn-rows">
            ${statRow('fa-utensils', 'Сытость', v.satiety)}
            ${statRow('fa-droplet', 'Вода', v.water)}
            ${statRow('fa-bolt', 'Энергия', v.energy)}
            ${statRow('fa-heart-pulse', 'Здоровье', v.health)}
        </div>
        ${preg}
    </section>`;
}

function overviewPane(snap) {
    return `<div class="nn-cards">${personCard(snap.user, 'user')}${snap.bot ? personCard(snap.bot, 'bot') : ''}</div>`;
}

// ─── Состояния ────────────────────────────────────────────────
function diseaseItem(d) {
    const time = d.recovering ? `выздоровление, ещё ~${d.left} ч` : (d.since ? `уже ${d.since}` : '');
    const icon = d.category === 'mental' ? 'fa-brain' : 'fa-virus';
    return `<div class="nn-cond nn-sev-${d.severity}${d.category === 'mental' ? ' nn-cond-mind' : ''}">
        <i class="fa-solid ${icon}"></i>
        <div class="nn-cond-main">
            <div class="nn-cond-title">${esc(d.name)} <span class="nn-sev">${SEV_LABEL[d.severity] || ''}</span></div>
            <div class="nn-cond-sub">${esc((d.effects || []).join(', '))}${time ? `. ${esc(time)}` : ''}</div>
        </div>
    </div>`;
}

function edItem(e) {
    const def = ED_DB[e.id];
    return `<div class="nn-cond nn-cond-mind nn-sev-${e.severity}">
        <i class="fa-solid fa-brain"></i>
        <div class="nn-cond-main">
            <div class="nn-cond-title">${esc(def.nameRu)} <span class="nn-sev">${ED_SEV_LABEL[e.severity]}</span></div>
            <div class="nn-cond-sub">Расстройство пищевого поведения — черта персонажа. Меняется во вкладке «Параметры».</div>
        </div>
    </div>`;
}

function effectItem(e) {
    const left = e.fading ? Math.max(0.5, Math.round((e.fadeLeft || 0) * 2) / 2) : null;
    const tail = left != null ? (e.timed ? `. Ещё ~${left} ч` : `. Проходит, ~${left} ч`) : '';
    return `<div class="nn-cond nn-eff-${e.kind}${e.fading && !e.timed ? ' nn-fading' : ''}">
        <i class="fa-solid ${e.icon}"></i>
        <div class="nn-cond-main">
            <div class="nn-cond-title">${esc(e.name)}${e.mental ? ' <span class="nn-sev">психика</span>' : ''}</div>
            <div class="nn-cond-sub">${esc(e.text || '')}${tail}</div>
        </div>
    </div>`;
}

function statesFor(v, who) {
    const phys = physicalOf(v).map(diseaseItem).join('');
    const mind = [...(v.ed || []).map(edItem), ...mentalOf(v).map(diseaseItem)].join('');
    const eff = effectsOf(v).slice().sort((a, b) => ({ negative: 0, neutral: 1, positive: 2 }[a.kind] - { negative: 0, neutral: 1, positive: 2 }[b.kind]));
    const imm = v.immunity;
    const bac = v.bac >= 0.1 ? `<div class="nn-row nn-${v.bac >= 1.8 ? 'bad' : v.bac >= 0.9 ? 'warn' : 'good'}">
            <i class="fa-solid fa-wine-glass"></i><span class="nn-row-label">Алкоголь</span>
            <span class="nn-bar"><span style="width:${Math.min(100, v.bac / 3 * 100)}%"></span></span><b class="nn-row-val">${v.bac.toFixed(1)}‰</b>
        </div>` : '';
    return `<section class="nn-card">
        <header class="nn-card-head">${avatarHtml(who, 'nn-av-lg')}<div class="nn-card-id"><div class="nn-card-name">${esc(v.name)}</div></div></header>
        <div class="nn-row nn-${lvl(imm)}">
            <i class="fa-solid fa-shield-halved"></i><span class="nn-row-label">Иммунитет</span>
            <span class="nn-bar"><span style="width:${pct(imm)}%"></span></span><b class="nn-row-val">${pct(imm)}%</b>
        </div>
        ${bac}
        <h5 class="nn-sub-h"><i class="fa-solid fa-virus"></i>Физические болезни</h5>
        <div class="nn-conds">${phys || '<div class="nn-empty">Нет.</div>'}</div>
        <h5 class="nn-sub-h"><i class="fa-solid fa-brain"></i>Психика</h5>
        <div class="nn-conds">${mind || '<div class="nn-empty">Нет.</div>'}</div>
        <h5 class="nn-sub-h"><i class="fa-solid fa-wand-magic-sparkles"></i>Активные эффекты</h5>
        <div class="nn-conds">${eff.map(effectItem).join('') || '<div class="nn-empty">Нет.</div>'}</div>
    </section>`;
}

function statesPane(snap) {
    return `<div class="nn-cards">${statesFor(snap.user, 'user')}${snap.bot ? statesFor(snap.bot, 'bot') : ''}</div>`;
}

// ─── Журнал ───────────────────────────────────────────────────
function itemsList(name, foods, drinks) {
    if (!foods.length && !drinks.length) return '';
    const f = foods.map(x => `<li><i class="fa-solid fa-utensils"></i><span>${esc(x.item)}</span><b>${x.calories} ккал</b></li>`);
    const d = drinks.map(x => `<li><i class="fa-solid fa-glass-water"></i><span>${esc(x.item)}${x.ml ? `, ${x.ml} мл` : ''}</span><b>${x.calories ? `${x.calories} ккал, ` : ''}+${x.water}% воды</b></li>`);
    return `<div class="nn-log-who">${esc(name)}</div><ul class="nn-log-list">${f.join('')}${d.join('')}</ul>`;
}

function logPane(snap, live) {
    const t = snap.turn;
    let turnHtml;
    if (!t) {
        turnHtml = live
            ? '<div class="nn-empty">Пока это стартовые значения — они определены по первой сцене и карточкам. Первый расчёт будет после следующего ответа бота.</div>'
            : '<div class="nn-empty">Для этого сообщения расчёта не было — это приветствие или ответ из старой версии.</div>';
    } else {
        const meta = [`<span><i class="fa-regular fa-clock"></i>прошло ${fmtH(t.hours)}</span>`];
        if (t.sleeping) meta.push('<span><i class="fa-solid fa-moon"></i>сон</span>');
        // активность и расход по каждому персонажу (в старых снимках активность одна строкой)
        const actOf = (who) => (typeof t.activity === 'string' ? t.activity : t.activity?.[who]) || 'low';
        const people = [['user', snap.user], ...(snap.bot ? [['bot', snap.bot]] : [])];
        for (const [who, v] of people) {
            const a = actOf(who);
            const lvl2 = ACT_LABEL[a] ? a : 'low';
            const burned = t.burned?.[who];
            meta.push(`<span title="${t.activitySource === 'text' ? 'Активность определена по тексту' : 'Активность из тега ИИ'}"><i class="fa-solid ${t.sleeping ? 'fa-bed' : (ACT_ICON[lvl2] || ACT_ICON.low)}"></i>${esc(v.name)}: ${t.sleeping ? 'сон' : ACT_LABEL[a] || a}${burned != null ? `, −${burned} ккал` : ''}</span>`);
        }
        const notes = [];
        if (t.offscreen) notes.push('Пропуск времени: обычные приёмы пищи за кадром учтены автоматически.');
        if (t.source === 'text') notes.push('ИИ не оставил тег — еда найдена в тексте и оценена по базе продуктов.');
        if (t.source === 'none') notes.push('ИИ не оставил тег — время посчитано условно (30 минут).');
        const lists = itemsList(snap.user.name, t.userFood, t.userDrink)
            + (snap.bot ? itemsList(snap.bot.name, t.botFood, t.botDrink) : '');
        const wd = t.weightDelta;
        if (wd) {
            const parts = [`${esc(snap.user.name)} ${kgDelta(wd.user, 3)} кг`];
            if (snap.bot) parts.push(`${esc(snap.bot.name)} ${kgDelta(wd.bot, 3)} кг`);
            meta.push(`<span title="Изменение веса за этот ход"><i class="fa-solid fa-weight-scale"></i>${parts.join(', ')}</span>`);
        }
        turnHtml = `<div class="nn-log-meta">${meta.join('')}</div>
            ${notes.map(n => `<div class="nn-note nn-warn"><i class="fa-solid fa-circle-info"></i><span>${n}</span></div>`).join('')}
            ${lists || '<div class="nn-empty">В этом ответе никто не ел и не пил.</div>'}`;
    }

    let hist = '';
    if (live && state.history.length) {
        const rows = [...state.history].reverse().slice(0, 10).map(h => {
            const name = h.who === 'bot' ? getBotName() : getUserName();
            return `<li><span class="nn-log-when">${esc(clockLabel(h.clock) || '')}</span><span>${esc(name)}: ${esc(h.items.join(', '))}</span><b>${h.calories} ккал</b></li>`;
        }).join('');
        hist = `<h4 class="nn-h">Недавние приёмы пищи</h4><ul class="nn-log-list nn-log-hist">${rows}</ul>`;
    }
    return `<h4 class="nn-h">В этом ответе</h4>${turnHtml}${hist}`;
}

// ─── Вес ──────────────────────────────────────────────────────
function weightPane() {
    const card = (c, who) => {
        if (!c) return '';
        const entries = state.weightHistory.filter(e => e.who === who).slice(-5);
        let trend = ['fa-equals', 'стабильно'];
        if (entries.length >= 2) {
            const diff = entries[entries.length - 1].weight - entries[0].weight;
            if (diff > 0.1) trend = ['fa-arrow-trend-up', 'растёт'];
            else if (diff < -0.1) trend = ['fa-arrow-trend-down', 'снижается'];
        }
        const bmi = c.weight / ((c.height / 100) ** 2);
        let bmiLabel = 'норма', bl = 'good';
        if (bmi < 18.5) { bmiLabel = 'дефицит'; bl = 'warn'; }
        else if (bmi >= 30) { bmiLabel = 'ожирение'; bl = 'bad'; }
        else if (bmi >= 25) { bmiLabel = 'избыток'; bl = 'warn'; }
        const today = c.weight - (c.dayStartWeight ?? c.weight);
        const buf = Math.round((c.reserve || 0) / reserveCap(effectiveGoal(c)) * 100);
        return `<section class="nn-card">
            <header class="nn-card-head">${avatarHtml(who, 'nn-av-lg')}<div class="nn-card-id"><div class="nn-card-name">${esc(c.name)}</div></div>
                <span class="nn-status"><i class="fa-solid ${trend[0]}"></i>${trend[1]}</span></header>
            <div class="nn-kcal-num"><b>${kg(c.weight)}</b><span>кг, сегодня ${kgDelta(today)} кг</span></div>
            <div class="nn-kcal-meta">ИМТ ${bmi.toFixed(1)} — <span class="nn-${bl}-text">${bmiLabel}</span>. Рост ${c.height} см.</div>
            <div class="nn-row nn-${buf > 85 ? 'warn' : buf < 10 ? 'bad' : 'good'}" title="Когда запас полон — лишнее идёт в вес; когда пуст — вес уходит">
                <i class="fa-solid fa-battery-half"></i><span class="nn-row-label">Запас</span>
                <span class="nn-bar"><span style="width:${Math.min(100, buf)}%"></span></span><b class="nn-row-val">${buf}%</b>
            </div>
        </section>`;
    };
    const rows = [...state.weightHistory].reverse().slice(0, 30).map(e => {
        const ch = Math.abs(e.change) < 0.005 ? '<span class="nn-mute">±0</span>'
            : `<span class="${e.change > 0 ? 'nn-warn-text' : 'nn-good-text'}">${kgDelta(e.change)}</span>`;
        return `<tr><td>${e.day}</td><td>${esc(e.name)}</td><td>${kg(e.weight)} кг</td><td>${ch}</td><td>${esc(e.reason)}</td><td>${e.calories}${e.burned != null ? ` / −${e.burned}` : `/${e.calorieGoal}`}</td></tr>`;
    }).join('');
    return `<div class="nn-cards">${card(state.user, 'user')}${card(getBotState(), 'bot')}</div>
        <h4 class="nn-h">История по дням</h4>
        ${rows ? `<div class="nn-table-wrap"><table class="nn-table">
            <thead><tr><th>День</th><th>Кто</th><th>Вес</th><th>За день</th><th>Итог</th><th>Съедено / сожжено</th></tr></thead>
            <tbody>${rows}</tbody></table></div>`
        : '<div class="nn-empty">Записи появятся после первой игровой полуночи. Сейчас идёт день ' + dayNumber() + '.</div>'}
        <p class="nn-hint">Вес меняется в каждом ответе. Сначала еда и расход двигают запас энергии; когда он полон, лишнее откладывается в вес (7700 ккал ≈ 1 кг), когда пуст — вес уходит. При полном голоде теряются ещё вода и мышцы.</p>`;
}

// ─── Покормить ────────────────────────────────────────────────
function whoSwitch() {
    const b = getBotState();
    return `<div class="nn-seg" role="group">
        <button class="${ui.who === 'user' ? 'nn-on' : ''}" data-act="who" data-who="user">${esc(getUserName())}</button>
        <button class="${ui.who === 'bot' ? 'nn-on' : ''}" data-act="who" data-who="bot" ${b ? '' : 'disabled'}>${esc(getBotName())}</button>
    </div>`;
}

function prodListHtml() {
    const q = ui.prodSearch.trim().toLowerCase();
    const items = PRODUCT_DB.map((p, idx) => ({ p, idx }))
        .filter(({ p }) => q ? p.name.toLowerCase().includes(q) : p.cat === ui.prodCat);
    if (!items.length) return '<div class="nn-empty">Ничего не нашлось. Попробуйте другое слово.</div>';

    return items.map(({ p, idx }) => {
        const unit = p.drink ? 'мл' : 'г';
        const sel = ui.prodSel === idx;
        const grams = sel ? ui.prodGrams : p.grams;
        const kcal = Math.round(p.cal100 * grams / 100);
        const water = Math.round((p.water100 || 0) * grams / 100);
        const chips = (p.drink ? [100, 200, 250, 330, 500] : [50, 100, 150, 200, 300])
            .map(g => `<button class="nn-pchip${g === grams ? ' nn-on' : ''}" data-act="grams" data-g="${g}">${g}</button>`).join('');
        return `<div class="nn-prod${sel ? ' nn-on' : ''}">
            <button class="nn-prod-row" data-act="prod" data-idx="${idx}">
                <span>${esc(p.name)}</span><span class="nn-mute">${p.grams} ${unit}, ${Math.round(p.cal100 * p.grams / 100)} ккал</span>
            </button>
            ${sel ? `<div class="nn-prod-panel">
                <div class="nn-grams">
                    <button data-act="step" data-step="-25" aria-label="Меньше"><i class="fa-solid fa-minus"></i></button>
                    <input type="number" class="nn-grams-input" min="10" max="2000" step="5" value="${grams}" aria-label="Количество">
                    <span>${unit}</span>
                    <button data-act="step" data-step="25" aria-label="Больше"><i class="fa-solid fa-plus"></i></button>
                    <span class="nn-pchips">${chips}</span>
                </div>
                <button class="nn-btn nn-btn-main" data-act="eat" data-idx="${idx}">
                    <i class="fa-solid ${p.drink ? 'fa-glass-water' : 'fa-utensils'}"></i>
                    ${p.drink ? 'Выпить' : 'Съесть'}: ${kcal} ккал${water > 0 ? `, +${water}% воды` : ''}
                </button>
            </div>` : ''}
        </div>`;
    }).join('');
}

function feedPane() {
    const cats = PRODUCT_CATEGORIES.map(c => `
        <button class="nn-cat${c.id === ui.prodCat && !ui.prodSearch ? ' nn-on' : ''}" data-act="cat" data-cat="${c.id}">
            <i class="fa-solid ${c.icon}"></i><span>${c.name}</span>
        </button>`).join('');
    return `<div class="nn-feed-top">${whoSwitch()}
            <label class="nn-search-wrap"><i class="fa-solid fa-magnifying-glass"></i>
            <input type="text" class="nn-search text_pole" placeholder="Поиск по всем продуктам" value="${esc(ui.prodSearch)}"></label>
        </div>
        <div class="nn-cats">${cats}</div>
        <div class="nn-prod-list">${prodListHtml()}</div>
        <p class="nn-hint">Необязательно: ИИ сам считает еду из сцены. Здесь можно докормить вручную — это запомнится и не пропадёт при свайпе.</p>`;
}

// ─── Параметры ────────────────────────────────────────────────
function paramsPane() {
    const data = ui.who === 'bot' ? getBotState() : state.user;
    if (!data) return `${whoSwitch()}<div class="nn-empty">Персонаж не загружен.</div>`;
    const opt = (entries, cur) => entries.map(([k, l]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${l}</option>`).join('');
    const auto = calculateCalorieGoal({
        gender: data.gender, weight: data.weight, height: data.height, age: data.age,
        activity: data.activity, build: data.build, pregnant: data.pregnant, pregnancyWeek: data.pregnancyWeek,
    });
    const manual = data.manualGoal != null;

    return `${whoSwitch()}
    <div class="nn-form">
        <label>Пол<select class="text_pole" data-field="gender">${opt([['male', 'Мужской'], ['female', 'Женский'], ['unknown', 'Не указан']], data.gender)}</select></label>
        <label>Возраст<input class="text_pole" type="number" data-field="age" min="16" max="99" value="${data.age}"></label>
        <label>Рост, см<input class="text_pole" type="number" data-field="height" min="120" max="230" value="${data.height}"></label>
        <label>Вес, кг<input class="text_pole" type="number" data-field="weight" min="30" max="250" step="0.1" value="${data.weight}"></label>
        <label>Телосложение<select class="text_pole" data-field="build">${opt(Object.entries(BUILD_TYPES).map(([k, v]) => [k, v.labelRu]), data.build)}</select></label>
        <label>Образ жизни (для нормы)<select class="text_pole" data-field="activity">${opt(Object.entries(ACTIVITY_LEVELS).map(([k, v]) => [k, v.labelRu]), data.activity)}</select></label>
    </div>
    <div class="nn-form-line">
        <label class="checkbox_label"><input type="checkbox" data-field="manualToggle" ${manual ? 'checked' : ''}>Своя норма калорий</label>
        <input class="text_pole nn-num" type="number" data-field="manualGoal" min="800" max="6000" value="${manual ? data.manualGoal : auto}" ${manual ? '' : 'disabled'}>
        <span class="nn-mute">по формуле: ${auto} ккал</span>
    </div>
    ${data.gender === 'male' ? '' : `<div class="nn-form-line">
        <label class="checkbox_label"><input type="checkbox" data-field="pregnant" ${data.pregnant ? 'checked' : ''}>Беременность</label>
        <input class="text_pole nn-num" type="number" data-field="pregnancyWeek" min="0" max="42" placeholder="неделя" value="${data.pregnancyWeek || ''}" ${data.pregnant ? '' : 'disabled'}>
    </div>`}
    <h4 class="nn-h">Расстройства пищевого поведения</h4>
    <div class="nn-form">
        ${Object.entries(ED_DB).map(([id, def]) => `<label>${def.nameRu}<select class="text_pole" data-field="ed_${id}">
            ${opt([['', 'Нет'], ['mild', 'Лёгкая'], ['moderate', 'Средняя'], ['severe', 'Тяжёлая']], data.ed?.[id] || '')}
        </select></label>`).join('')}
    </div>
    <p class="nn-hint">Черта персонажа: влияет на то, как ИИ отыгрывает его отношения с едой и телом, и добавляет эффекты после еды. Само по себе от голода не появляется.</p>
    <div class="nn-form-line">
        <button class="nn-btn" data-act="reanalyze"><i class="fa-solid fa-arrows-rotate"></i>Заново определить по карточке</button>
    </div>
    <div class="nn-rates">
        <div><span class="nn-mute">Базовый обмен</span><b>${r0(bmrOf(data))} ккал/сут</b></div>
        <div><i class="fa-solid fa-bed"></i><span class="nn-mute">Сон</span><b>${r0(burnPerHour(data, 'low', true))} ккал/ч</b></div>
        <div><i class="fa-solid ${ACT_ICON.low}"></i><span class="nn-mute">Низкая</span><b>${r0(burnPerHour(data, 'low'))} ккал/ч</b></div>
        <div><i class="fa-solid ${ACT_ICON.medium}"></i><span class="nn-mute">Средняя</span><b>${r0(burnPerHour(data, 'medium'))} ккал/ч</b></div>
        <div><i class="fa-solid ${ACT_ICON.high}"></i><span class="nn-mute">Высокая</span><b>${r0(burnPerHour(data, 'high'))} ккал/ч</b></div>
    </div>
    <p class="nn-hint">Реальный расход считается по активности в каждой сцене: базовый обмен (пол, вес, рост, возраст, телосложение) × уровень активности. Образ жизни влияет только на рекомендуемую норму — сколько персонаж в среднем должен есть.</p>`;
}

function onParamChange(el) {
    const data = ui.who === 'bot' ? getBotState() : state.user;
    if (!data) return;
    const f = el.dataset.field;
    if (f.startsWith('ed_')) {
        data.ed = { ...(data.ed || {}), [f.slice(3)]: el.value || null };
    } else if (f === 'manualToggle') {
        data.manualGoal = el.checked ? (calculateCalorieGoal(data) || 2000) : null;
        if (!el.checked) recalcGoal(data);
    } else if (f === 'manualGoal') {
        const v = parseInt(el.value);
        if (isNaN(v) || v < 800 || v > 6000) return;
        data.manualGoal = v;
    } else if (f === 'pregnant') {
        data.pregnant = el.checked;
        if (!el.checked) data.pregnancyWeek = 0;
        if (data.manualGoal == null) recalcGoal(data);
    } else if (f === 'pregnancyWeek') {
        const v = parseInt(el.value);
        if (isNaN(v) || v < 0 || v > 42) return;
        data.pregnancyWeek = v;
        if (v > 0) data.pregnant = true;
        if (data.manualGoal == null) recalcGoal(data);
    } else {
        let v = el.value;
        if (['age', 'height'].includes(f)) { v = parseInt(v); if (isNaN(v)) return; }
        if (f === 'weight') {
            v = parseFloat(v);
            if (isNaN(v)) return;
            shiftWeight(data, v - data.weight);
        }
        data[f] = v;
        if (f === 'gender' && v === 'male') { data.pregnant = false; data.pregnancyWeek = 0; }
        if (data.manualGoal == null) recalcGoal(data);
    }
    saveState();
    injectPrompt();
    renderLiveBlock();
}

// Ручная правка веса — это правка профиля: переносим её и в снимки,
// иначе свайп вернул бы старый вес
function shiftWeight(data, delta) {
    if (!delta) return;
    data.dayStartWeight = (data.dayStartWeight ?? data.weight) + delta;
    for (const snap of state.snapshots) {
        const c = data === state.user ? snap.user : snap.characters.find(x => x.charId === data.charId);
        if (c) { c.weight = +(c.weight + delta).toFixed(3); if (c.dayStartWeight != null) c.dayStartWeight += delta; }
    }
}

function reanalyze() {
    if (ui.who === 'user') {
        const before = state.user.weight;
        state.user.analyzed = false;
        analyzeUser();
        const after = state.user.weight;
        state.user.weight = before;
        shiftWeight(state.user, after - before);
        state.user.weight = after;
    } else {
        const bot = getCurrentBot(), data = getBotState();
        if (bot && data) {
            const p = buildCharacterParams(botCardText(bot));
            shiftWeight(data, p.weight - data.weight);
            Object.assign(data, { gender: p.gender, age: p.age, height: p.height, weight: p.weight, build: p.build, activity: p.activity, ed: { ...p.ed } });
            if (data.manualGoal == null) data.calorieGoal = p.calorieGoal;
        }
    }
    saveState();
    injectPrompt();
    notify('Параметры определены заново по карточке', 'success', 2500, true);
    renderLiveBlock();
}

// ─── События внутри блока ─────────────────────────────────────
function bindBlock(block) {
    const idOf = () => Number(block.dataset.mesid);

    block.addEventListener('click', (e) => {
        const t = e.target.closest('[data-act]');
        if (!t || !block.contains(t)) return;
        e.stopPropagation();
        const id = idOf();
        switch (t.dataset.act) {
            case 'toggle': ui.open.set(id, !block.classList.contains('nn-open')); break;
            case 'tab': ui.tab.set(id, t.dataset.tab); break;
            case 'who': ui.who = t.dataset.who; ui.prodSel = null; break;
            case 'cat': ui.prodCat = t.dataset.cat; ui.prodSearch = ''; ui.prodSel = null; break;
            case 'prod': {
                const idx = Number(t.dataset.idx);
                if (ui.prodSel === idx) ui.prodSel = null;
                else { ui.prodSel = idx; ui.prodGrams = PRODUCT_DB[idx].grams; }
                break;
            }
            case 'step': ui.prodGrams = Math.max(10, Math.min(2000, (ui.prodGrams || 100) + Number(t.dataset.step))); break;
            case 'grams': ui.prodGrams = Number(t.dataset.g); break;
            case 'eat': consumeProduct(PRODUCT_DB[Number(t.dataset.idx)], ui.who, ui.prodGrams); return;
            case 'reanalyze': reanalyze(); return;
            default: return;
        }
        renderBlock(id);
    });

    // Аватарка не загрузилась: пробуем оригинал, потом значок
    block.addEventListener('error', (e) => {
        const img = e.target;
        if (!(img instanceof HTMLImageElement) || !img.classList.contains('nn-av')) return;
        const fb = img.dataset.fallback;
        if (fb) { img.dataset.fallback = ''; img.src = fb; return; }
        const span = document.createElement('span');
        span.className = img.className + ' nn-av-empty';
        span.innerHTML = '<i class="fa-solid fa-user"></i>';
        img.replaceWith(span);
    }, true);

    block.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.nn-head')) {
            e.preventDefault();
            e.target.click();
        }
    });

    block.addEventListener('change', (e) => {
        const el = e.target;
        e.stopPropagation();
        if (el.matches('.nn-grams-input')) {
            const v = parseInt(el.value);
            if (!isNaN(v) && v >= 10 && v <= 2000) { ui.prodGrams = v; renderBlock(idOf()); }
        } else if (el.dataset.field) {
            onParamChange(el);
        }
    });

    block.addEventListener('input', (e) => {
        if (!e.target.matches('.nn-search')) return;
        e.stopPropagation();
        ui.prodSearch = e.target.value;
        ui.prodSel = null;
        const list = block.querySelector('.nn-prod-list');
        if (list) list.innerHTML = prodListHtml();
        block.querySelectorAll('.nn-cat').forEach(c => c.classList.toggle('nn-on', !ui.prodSearch && c.dataset.cat === ui.prodCat));
    });
}

// ═══════════════════════════════════════════════════════════════
// ПАНЕЛЬ В МЕНЮ РАСШИРЕНИЙ
// ═══════════════════════════════════════════════════════════════
function setEnabled(val) {
    localStorage.setItem(LS.enabled, val ? 'true' : 'false');
    injectPrompt();
    renderAllBlocks();
}

const DEBUG_OPTIONS = [
    ['disease:hypoglycemia:mild', 'Болезнь: гипогликемия, лёгкая'],
    ['disease:hypoglycemia:critical', 'Болезнь: гипогликемия, критическая'],
    ['disease:starvation:moderate', 'Болезнь: истощение, среднее'],
    ['disease:dehydration_disease:moderate', 'Болезнь: обезвоживание, среднее'],
    ['disease:malnutrition:mild', 'Болезнь: недоедание, лёгкое'],
    ['disease:refeeding:severe', 'Болезнь: рефидинг-синдром'],
    ['disease:electrolyte:moderate', 'Болезнь: электролитный дисбаланс'],
    ['disease:alcohol_poisoning:severe', 'Болезнь: алкогольное отравление'],
    ['disease:food_obsession:moderate', 'Психика: пищевая одержимость'],
    ['disease:hunger_apathy:mild', 'Психика: голодная апатия'],
    ['disease:food_insecurity:mild', 'Психика: пищевая тревожность'],
    ['stat:hunger', 'Состояние: голодный'],
    ['stat:thirst', 'Состояние: жажда'],
    ['stat:tired', 'Состояние: устал'],
    ['stat:drunk', 'Состояние: пьян (1.2‰)'],
    ['stat:coffee', 'Состояние: много кофеина'],
    ['stat:awake', 'Состояние: 22 часа без сна'],
    ['stat:perfect', 'Состояние: сыт, напоен, бодр'],
    ['effect:hangover', 'Эффект: похмелье'],
    ['effect:rested', 'Эффект: выспался'],
    ['effect:shame', 'Эффект: стыд и вина'],
];
const DEBUG_STATS = {
    hunger: { satiety: 12, hoursSinceLastMeal: 8 },
    thirst: { water: 20 },
    tired: { energy: 25 },
    drunk: { bac: 1.2, bacPeak: 1.2 },
    coffee: { caffeine: 450 },
    awake: { hoursAwake: 22 },
    perfect: { satiety: 90, water: 90, energy: 92, health: 100 },
};

function debugApply(code, who) {
    const data = who === 'bot' ? getBotState() : state.user;
    if (!data) { notify('Персонаж не загружен', 'warning', 2500, true); return; }
    const g = effectiveGoal(data);
    const [kind, id, sev] = code.split(':');
    if (kind === 'disease') {
        const def = DISEASE_DB[id];
        data.diseases = data.diseases.filter(d => d.id !== id);
        const st = def.stages[sev];
        data.diseases.push({
            id, name: def.nameRu, nameEn: def.nameEn, severity: sev,
            effects: st.effects, effectsEn: st.effectsEn, modifiers: st.modifiers, symptoms: st.symptoms,
            elapsedHours: 0, recoveryHours: 0, recovering: false, since: '0ч',
        });
        if (id === 'hypoglycemia' || id === 'starvation') Object.assign(data, { reserve: 0, satiety: 5, hoursSinceLastMeal: (st.threshold?.hoursSinceLastMeal || 12) + 1 });
        if (id === 'dehydration_disease') data.water = st.threshold?.water ?? 10;
        if (id === 'malnutrition') data.daysWithDeficit = 3;
        if (id === 'electrolyte') data.electrolyte = 55;
        if (id === 'alcohol_poisoning') data.bac = 3.2;
        if (id === 'food_obsession') data.daysWithDeficit = Math.max(data.daysWithDeficit || 0, 5);
        if (id === 'hunger_apathy') data.daysWithDeficit = Math.max(data.daysWithDeficit || 0, 4);
        if (id === 'food_insecurity') { data.starvationTrauma = true; data.hoursSinceLastMeal = 10; }
        if (id === 'refeeding') data.diseases.find(d => d.id === 'refeeding').recovering = true;
    } else if (kind === 'effect') {
        grantEffect(data, id, id === 'rested' ? 10 : id === 'hangover' ? 8 : 4);
    } else if (id === 'overfed') {
        data.recentIntake = g * 0.8; data.satiety = 100;
    } else {
        Object.assign(data, DEBUG_STATS[id] || {});
        if (id === 'perfect') data.reserve = g * 0.8;
    }
    evaluateConditions(data, 0);
    updateFocus(data, state.turn, new Set([...data.diseases.map(d => d.id), ...data.debuffs.map(d => d.id)]), { foodInScene: true });
    saveState();
    injectPrompt();
    renderLiveBlock();
    notify('Тестовое состояние применено', 'info', 2000, true);
}

function injectSettingsPanel() {
    let attempts = 0;
    const iv = setInterval(() => {
        attempts++;
        const container = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
        if (!container) { if (attempts >= 40) clearInterval(iv); return; }
        clearInterval(iv);
        if (document.getElementById('nn-settings-drawer')) return;

        container.insertAdjacentHTML('beforeend', `
        <div class="inline-drawer" id="nn-settings-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b><i class="fa-solid fa-apple-whole"></i> Калории и питание</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content nn-settings">
                <label class="checkbox_label"><input type="checkbox" id="nn-set-enabled" ${isEnabled() ? 'checked' : ''}>Включить расширение</label>
                <label class="checkbox_label"><input type="checkbox" id="nn-set-toasts" ${toastsOn() ? 'checked' : ''}>Всплывающие уведомления</label>
                <label class="checkbox_label"><input type="checkbox" id="nn-set-expand" ${expandLast() ? 'checked' : ''}>Раскрывать инфоблок последнего ответа</label>
                <label class="nn-settings-row">Инфоблок показывать
                    <select id="nn-set-scope" class="text_pole">
                        <option value="all" ${scopeAll() ? 'selected' : ''}>под каждым ответом бота</option>
                        <option value="last" ${scopeAll() ? '' : 'selected'}>только под последним</option>
                    </select>
                </label>
                <p class="nn-hint">В старых ответах блок показывает состояние на тот момент. В последнем доступны вкладки «Вес», «Покормить» и «Параметры».</p>

                <hr class="sysHR">
                <b>Проверка</b>
                <div class="nn-settings-row">
                    <select id="nn-dbg-who" class="text_pole"><option value="user">Юзер</option><option value="bot">Бот</option></select>
                    <select id="nn-dbg-code" class="text_pole">${DEBUG_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
                    <div id="nn-dbg-apply" class="menu_button">Применить</div>
                </div>
                <div class="nn-settings-row">
                    <div id="nn-dbg-clear" class="menu_button">Очистить состояния</div>
                    <div id="nn-dbg-reset" class="menu_button redWarningBG">Сбросить чат</div>
                </div>
            </div>
        </div>`);

        document.getElementById('nn-set-enabled')?.addEventListener('change', e => setEnabled(e.target.checked));
        document.getElementById('nn-set-toasts')?.addEventListener('change', e => {
            localStorage.setItem(LS.toasts, e.target.checked ? 'true' : 'false');
            setToastsEnabled(e.target.checked);
        });
        document.getElementById('nn-set-expand')?.addEventListener('change', e => {
            localStorage.setItem(LS.expand, e.target.checked ? 'true' : 'false');
            renderLiveBlock();
        });
        document.getElementById('nn-set-scope')?.addEventListener('change', e => {
            localStorage.setItem(LS.scope, e.target.value);
            renderAllBlocks();
        });
        document.getElementById('nn-dbg-apply')?.addEventListener('click', () => {
            if (!state) loadState();
            debugApply(document.getElementById('nn-dbg-code').value, document.getElementById('nn-dbg-who').value);
        });
        document.getElementById('nn-dbg-clear')?.addEventListener('click', () => {
            if (!state) return;
            for (const { data } of activeChars()) {
                Object.assign(data, {
                    diseases: [], buffs: [], debuffs: [], satiety: 80, water: 85, energy: 85, health: 100,
                    hoursSinceLastMeal: 2, reserve: effectiveGoal(data) * 0.6, recentIntake: 0, daysWithDeficit: 0,
                    salience: {}, focus: [],
                });
            }
            saveState(); injectPrompt(); renderLiveBlock();
            notify('Состояния очищены', 'success', 2000, true);
        });
        document.getElementById('nn-dbg-reset')?.addEventListener('click', () => {
            if (!confirm('Сбросить весь прогресс питания в этом чате?')) return;
            chat_metadata[META_KEY] = defaultState();
            loadState(); saveState(); injectPrompt(); renderAllBlocks();
        });
    }, 250);
}

// ═══════════════════════════════════════════════════════════════
// СОБЫТИЯ ТАВЕРНЫ
// ═══════════════════════════════════════════════════════════════
let generating = false;

function onGenerationStarted(type, params, dryRun) {
    if (dryRun) return;
    generating = true;
    if (!isEnabled()) return;
    if (!state) loadState();
    injectPrompt();
}
function onGenerationEnded() { generating = false; }

function onMessageReceived(id) {
    if (!isEnabled()) return;
    if (!state) loadState();
    processAiResponse(Number(id));
}

function isGreeting(id) {
    for (let i = 0; i < id; i++) if (chat[i]?.is_user) return false;
    return true;
}

// Альтернативное приветствие — это не ход, а другая стартовая сцена
function reanalyzeStart() {
    if (state.snapshots.length) return;
    state.clockHours = null;
    for (const { data } of activeChars()) data.initialAnalyzed = false;
    analyzeInitialSceneOnce();
    saveState();
    injectPrompt();
    scheduleRenderAll();
}

function onMessageSwiped(id) {
    if (!isEnabled() || !state) return;
    setTimeout(() => {
        if (generating) return;
        const m = chat[id];
        if (!m || m.is_user) return;
        if (isGreeting(id)) { reanalyzeStart(); return; }
        const sw = m.swipes?.[m.swipe_id];
        // Переключились на уже готовый вариант — пересчитываем по его тексту
        if (sw && sw.trim() && m.mes === sw) processAiResponse(Number(id));
        else scheduleRenderAll();
    }, 150);
}

function onMessageEdited(id) {
    if (!isEnabled() || !state) return;
    const m = chat[id];
    // Пересчитываем только последний учтённый ответ — иначе поплывут все следующие
    if (m && !m.is_user && Number(id) === lastProcessedMsg()) processAiResponse(Number(id));
    else scheduleRenderAll();
}

function onChatChanged() {
    ui.open.clear();
    ui.tab.clear();
    loadState();
    injectPrompt();
    for (const ms of [150, 600, 1500]) setTimeout(renderAllBlocks, ms);
}

// Таверна дорисовывает сообщения позже событий смены чата и не присылает
// «сообщение отрисовано» при загрузке — поэтому следим за самим #chat.
let chatObserver = null;
function observeChat() {
    const target = document.getElementById('chat');
    if (!target) { setTimeout(observeChat, 500); return; }
    if (chatObserver) return;
    chatObserver = new MutationObserver((muts) => {
        for (const m of muts) {
            for (const n of m.addedNodes) {
                if (n.nodeType === 1 && (n.classList?.contains('mes') || n.querySelector?.('.mes'))) {
                    scheduleRenderAll();
                    return;
                }
            }
        }
    });
    chatObserver.observe(target, { childList: true });
}

function on(evt, fn) {
    if (evt) eventSource.on(evt, fn);
}

function init() {
    console.log('[Nutrition Framework] init v3 — инфоблок');
    setToastsEnabled(toastsOn());
    injectSettingsPanel();
    loadState();
    injectPrompt();

    on(event_types.GENERATION_STARTED, onGenerationStarted);
    on(event_types.GENERATION_ENDED, onGenerationEnded);
    on(event_types.GENERATION_STOPPED, onGenerationEnded);
    on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    on(event_types.CHARACTER_MESSAGE_RENDERED, scheduleRenderAll);
    on(event_types.USER_MESSAGE_RENDERED, scheduleRenderAll);
    on(event_types.MESSAGE_SWIPED, onMessageSwiped);
    on(event_types.MESSAGE_EDITED, onMessageEdited);
    on(event_types.MESSAGE_UPDATED, scheduleRenderAll);
    on(event_types.MESSAGE_DELETED, onMessageDeleted);
    on(event_types.MORE_MESSAGES_LOADED, scheduleRenderAll);
    on(event_types.CHAT_CHANGED, onChatChanged);

    observeChat();
    for (const ms of [300, 1000]) setTimeout(renderAllBlocks, ms);
}

jQuery(() => init());
export { init };
