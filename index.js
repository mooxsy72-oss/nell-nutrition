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
    tickTime, applyMeal, applyDrink, applyVomit, goalOf, reserveCap, changeWeight, KCAL_PER_KG,
    SCENE_ACTIVITY, bmrOf, burnPerHour,
} from './nutrition-engine.js';
import { parseNnTag, parseNnInner, findNnInner, foodFlags } from './parser.js';
import {
    notify, queueNotify, flushQueue, setSilent, setToastsEnabled, clearQueue,
} from './notifications.js';
import {
    evaluateConditions, buildConditionPrompt, updateFocus,
    getPregnancyStage, calculateImmunity, DISEASE_DB,
    applyTurnEvents, checkRefeeding, edList, ED_DB, ED_SEV_LABEL, ED_GUIDANCE,
    pregnancyEvents, capHungerSeverity, setHungerCap, illnessEvents, setEra,
} from './conditions.js';
import { EFFECT_INFO, effectView, drinkExtras, grantEffect } from './effects.js';
import { ACTIVITY_LEVELS, BUILD_TYPES, calculateCalorieGoal } from './analyzer.js';
import { PRODUCT_DB, PRODUCT_CATEGORIES } from './products.js';

// ═══════════════════════════════════════════════════════════════
// НАСТРОЙКИ (localStorage — общие для всех чатов)
// ═══════════════════════════════════════════════════════════════
const META_KEY = 'nellNutritionState';
const PROMPT_KEY = 'nell_nutrition_state';      // состояние персонажей — поглубже в контексте
const PROMPT_KEY_TAG = 'nell_nutrition_tag';    // правило тега — в самом конце промпта
const LS = {
    enabled: 'nellNutrition_enabled',
    toasts: 'nellNutrition_toasts',
    scope: 'nellNutrition_scope',          // 'all' | 'last'
    expand: 'nellNutrition_expandLast',    // раскрывать блок последнего ответа
    mode: 'nellNutrition_mode',            // 'easy' — пропуски дней без голодной смерти, 'hard' — выживание
    era: 'nellNutrition_era',              // 'modern' | 'historical' — без современной медицины
};
const lsGet = (k, d) => { const v = localStorage.getItem(k); return v === null ? d : v; };
const isEnabled = () => lsGet(LS.enabled, 'true') !== 'false';
const toastsOn = () => lsGet(LS.toasts, 'true') !== 'false';
const scopeAll = () => lsGet(LS.scope, 'all') === 'all';
const expandLast = () => lsGet(LS.expand, 'false') === 'true';
const isHard = () => lsGet(LS.mode, 'easy') === 'hard';
const isHistorical = () => lsGet(LS.era, 'modern') === 'historical';

// Названия и иконки состояний берутся из баз болезней и эффектов
const nameOf = (id) => DISEASE_DB[id]?.nameRu || EFFECT_INFO[id]?.name || id;
const isMentalDisease = (id) => DISEASE_DB[id]?.category === 'mental';
const SEV_LABEL = { mild: 'лёгкая', moderate: 'средняя', severe: 'тяжёлая', critical: 'критическая' };
const ACT_LABEL = { low: 'низкая', medium: 'средняя', high: 'высокая',
    resting: 'низкая', normal: 'низкая', active: 'средняя', intense: 'высокая' };
const ACT_ICON = { low: 'fa-couch', medium: 'fa-person-walking', high: 'fa-person-running' };

// Поля профиля — их не откатываем при свайпе/удалении (это правки пользователя)
const PROFILE_FIELDS = ['gender', 'age', 'height', 'build', 'activity',
    'manualGoal', 'calorieGoal', 'pregnant', 'pregnancyWeek', 'pregBase', 'ed'];

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
        pregBase: null,         // { week, clock } — от этой точки неделя идёт сама
        ed: {},                 // РПП: { anorexia, bulimia, binge } → null | mild | moderate | severe
        diseases: [], buffs: [], debuffs: [],

        bac: 0, bacPeak: 0,     // алкоголь в крови, ‰
        caffeine: 0,            // кофеин, мг
        electrolyte: 0,         // «долг» электролитов после рвоты
        hoursAwake: 0, sleepStreak: 0,
        maxFastHours: 0, starvationTrauma: false,
        daysNoProduce: 0, producedToday: false,   // дни без овощей и фруктов (цинга)
        illRollDay: null,       // последний день, за который бросали шанс заболеть
        careLeft: 0,            // часы ухода (лекарь, травы, покой) — выздоровление быстрее

        lastMealTime: null, hoursSinceLastMeal: 0, daysWithDeficit: 0,
        dayStartWeight: null,  // вес на начало игрового дня
        salience: {}, focus: [], focusCue: {},
        feel: null,             // как себя чувствует — пишет ИИ в теге

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
        rpDate: null,           // дата/время из ролплея (тег date=)
        missedTag: 0,           // сколько ответов подряд пришло без тега (для «догоняющего» тега)
        calibrate: { pending: true, doneAt: null },   // уточнить профиль по карточкам в следующем ответе
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

        ensureBotState();
        if (state.clockHours == null) state.clockHours = 12;
        // Вес на начало дня фиксируем уже после анализа карточек
        for (const c of [state.user, ...state.characters]) if (c.dayStartWeight == null) c.dayStartWeight = c.weight;
    } catch (err) {
        console.warn('[NN] loadState failed, resetting:', err);
        chat_metadata[META_KEY] = defaultState();
        state = chat_metadata[META_KEY];
        try { ensureBotState(); state.clockHours = 12; } catch (e) { /* пусто */ }
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

function ensureBotState() {
    const bot = getCurrentBot();
    if (!bot) return null;
    const id = bot.avatar || bot.name;
    let c = state.characters.find(x => x.charId === id);
    if (!c) {
        // Параметры уточнит ИИ в первом ответе (калибровка через тег)
        c = defaultCharState(bot.name, id);
        state.characters.push(c);
        state.calibrate = { pending: true, doneAt: null };
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
        rpDate: state.rpDate,
        missedTag: state.missedTag || 0,
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
    state.rpDate = snap.rpDate ?? null;
    state.missedTag = snap.missedTag || 0;
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

// Распорядок дня на пропусках времени: ночью спят, в 8/13/19 едят
const MEALS = [[8, 0.3], [13, 0.35], [19, 0.35]];
const isNight = (h) => h >= 23 || h < 7;

/**
 * @param {number} hours
 * @param {{user:string, bot:string}} activityOf
 * @param {boolean} sleeping — тег сказал, что спали всё это время
 * @param {{user:boolean, bot:boolean}} fedOf — едят ли за кадром по распорядку
 * @param {{user:boolean, bot:boolean}} drinkOf — пьют ли за кадром
 */
function advanceTime(hours, activityOf, sleeping, fedOf, ctx, drinkOf = { user: true, bot: true }) {
    const chars = activeChars();
    setHungerCap(!isHard());
    setEra(isHistorical() ? 'historical' : 'modern');
    if (state.clockHours == null) state.clockHours = 12;
    // Пропуск от 6 часов проживается по распорядку, шагами по часу
    const routine = hours >= 6;
    const opts = { healthFloor: isHard() ? null : 25 };
    let left = hours;
    ctx.slept = { user: 0, bot: 0 };
    ctx.woke = { user: false, bot: false };
    ctx.endedAsleep = sleeping;

    while (left > 1e-6) {
        const step = routine ? Math.min(1, left) : Math.min(6, left);
        left -= step;
        const h0 = ((state.clockHours % 24) + 24) % 24;
        const asleep = sleeping || (routine && isNight((h0 + step / 2) % 24));

        for (const ch of chars) {
            const c = ch.data, g = effectiveGoal(c);
            const r = tickTime(c, step, activityOf[ch.who], asleep, g, opts);
            r.events.forEach(e => ctx[ch.who].events.add(e));
            if (asleep) ctx.slept[ch.who] += step;
            else if (ctx.slept[ch.who] > 0) ctx.woke[ch.who] = true;

            if (routine && fedOf[ch.who]) {
                // Аппетит подстраивается под нагрузку: в походе едят больше нормы,
                // но чуть меньше, чем тратят (≈90%) — вес потихоньку уходит.
                // Если тратят меньше нормы — едят норму, вес понемногу растёт.
                const burnDay = burnPerHour(c, activityOf[ch.who]) * 16 + burnPerHour(c, 'low', true) * 8;
                const dayTarget = Math.max(g, burnDay * 0.9);
                for (const [mh, share] of MEALS) {
                    const crossed = h0 < mh ? h0 + step >= mh : h0 + step - 24 >= mh;
                    if (!crossed || asleep) continue;
                    applyMeal(c, dayTarget * share, 8, g);
                    c.producedToday = true;   // обычное питание за кадром — с овощами; цинга только если в истории правда одно мясо
                }
                // Сытый организм добирает нехватку из жира, а не проваливается в гипогликемию
                const floor = g * (asleep ? 0.25 : 0.4);
                if ((c.reserve || 0) < floor) {
                    changeWeight(c, -(floor - c.reserve) / KCAL_PER_KG);
                    c.reserve = floor;
                }
            }
            if (routine && drinkOf[ch.who] && !asleep) {
                // Пьют по жажде: чем меньше воды, тем больше пьют — вода держится около 75–80%
                applyDrink(c, Math.max(0, 82 - c.water) * Math.min(1, 0.6 * step), 0, g);
            }
        }

        const prevDay = Math.floor(state.clockHours / 24);
        state.clockHours += step;
        const newDay = Math.floor(state.clockHours / 24);
        for (let d = prevDay + 1; d <= newDay; d++) {
            for (const ch of chars) rolloverDay(ch, d, ctx);
        }

        for (const ch of chars) {
            mergeCond(ctx, ch.who, evaluateConditions(ch.data, step));
            if (!isHard()) capHungerSeverity(ch.data);
        }
        ctx.endedAsleep = asleep;
    }
}

// Сверяем внутренние часы с временем из ролплея (тег time=)
function alignClock(tagClock, hours) {
    const before = state.clockHours ?? 12;
    if (tagClock == null) return hours;
    const predicted = before + (hours ?? 0);
    let cand = Math.floor(predicted / 24) * 24 + tagClock;
    if (cand - predicted > 12) cand -= 24;
    if (predicted - cand > 12) cand += 24;
    if (cand < before) {
        // Время из ролплея раньше наших часов — просто переставляем часы
        state.clockHours = cand;
        return 0;
    }
    return cand - before;
}

// Беременность: неделя из тега, дальше идёт сама со временем
function applyPregnancy(c, week) {
    if (c.gender === 'male') return;
    if (week === 0) { c.pregnant = false; c.pregnancyWeek = 0; c.pregBase = null; }
    else if (week > 0) { c.pregnant = true; c.pregnancyWeek = week; c.pregBase = { week, clock: state.clockHours }; }
    if (c.manualGoal == null) recalcGoal(c);
}
function advancePregnancy(c) {
    if (!c.pregnant || !c.pregBase) return;
    const w = Math.min(42, c.pregBase.week + Math.floor((state.clockHours - c.pregBase.clock) / 168));
    if (w !== c.pregnancyWeek) {
        c.pregnancyWeek = w;
        if (c.manualGoal == null) recalcGoal(c);
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

    c.daysNoProduce = c.producedToday ? 0 : (c.daysNoProduce || 0) + 1;
    c.producedToday = false;

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
    if ([...foods, ...drinks].some(f => f.produce)) c.producedToday = true;
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
    let text = msg.mes;
    // 1) обычный тег-комментарий; 2) сохранённый для этого же текста;
    // 3) тег «не по форме» (строкой, в ```-блоке, без -->) — читаем и вырезаем из видимого текста
    let tag = parseNnTag(text);
    if (!tag && msg.extra?.nn_tag?.inner && msg.extra.nn_tag.mesHash === hashText(text)) {
        tag = parseNnInner(msg.extra.nn_tag.inner);
    }
    if (!tag) {
        const inner = findNnInner(text, { loose: true });
        if (inner != null) tag = parseNnInner(inner);
    }
    if (tag) {
        // Видимые формы тега убираем из текста; правильный скрытый комментарий остаётся как образец формата
        const cleaned = stripLooseTag(text);
        if (cleaned !== text && cleaned.trim()) {
            msg.mes = cleaned;
            text = cleaned;
            if (Array.isArray(msg.swipes) && msg.swipe_id != null) msg.swipes[msg.swipe_id] = cleaned;
            try { stModule?.updateMessageBlock?.(N, msg); } catch (e) { /* пусто */ }
        }
    }
    if (tag) {
        msg.extra = msg.extra || {};
        msg.extra.nn_tag = { inner: tag.inner, mesHash: hashText(text) };
    }
    const tagRecovered = false;
    const ctx = newCtx();

    // ── Время: tp и time из тега; без тега — условные полчаса ──
    const bot = getBotState();
    // Без тега время не угадываем: следующий ответ получит «догоняющую» приписку и покроет этот ход
    let hours = tag ? (tag.tp ?? (tag.clock != null ? null : 0)) : 0;
    state.missedTag = tag ? 0 : (state.missedTag || 0) + 1;
    hours = tag ? alignClock(tag.clock, hours) : hours;
    hours = Math.max(0, Math.min(720, hours || 0));
    if (tag?.date) state.rpDate = tag.date;

    const sceneActivity = tag?.activity || 'low';
    const activityOf = {
        user: tag?.userActivity || sceneActivity,
        bot: tag?.botActivity || sceneActivity,
    };
    const activitySource = tag ? 'tag' : 'none';
    const sleeping = !!tag?.sleeping;

    // ── Еда — только из тега ──
    const source = tag ? (tagRecovered ? 'recovered' : 'tag') : 'none';
    const userFood = tag ? (tag.userAte.length ? tag.userAte : tag.ate) : [];
    const userDrink = tag ? (tag.userDrank.length ? tag.userDrank : tag.drank) : [];
    const botFood = tag && bot ? tag.botAte : [];
    const botDrink = tag && bot ? tag.botDrank : [];

    // За кадром едят по распорядку. Лёгкий режим: всегда, кроме offscreen=hungry.
    // Хард: только если ИИ отметил offscreen=fed. Кто ел в теге — тому распорядок не добавляем.
    const off = tag?.offscreen;
    const offFed = isHard() ? off === 'fed' : off !== 'hungry' && off !== 'thirsty';
    const fedOf = {
        user: offFed && !userFood.length,
        bot: offFed && !botFood.length,
    };
    // Вода за кадром есть всегда, кроме offscreen=thirsty
    const drinkOf = { user: off !== 'thirsty', bot: off !== 'thirsty' };

    const weightBefore = Object.fromEntries(activeChars().map(ch => [ch.who, ch.data.weight]));
    const burnedBefore = Object.fromEntries(activeChars().map(ch => [ch.who, ch.data.burned || 0]));
    const dayBefore = Math.floor((state.clockHours ?? 12) / 24);
    advanceTime(hours, activityOf, sleeping, fedOf, ctx, drinkOf);
    for (const ch of activeChars()) advancePregnancy(ch.data);

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
        applyTurnEvents(ch.data, { slept: ctx.slept[ch.who], mealKcal: mealKcal[ch.who], vomited: vomited[ch.who] }, added);
        added.forEach(id => ctx[ch.who].added.add(id));
    }
    const foodInScene = mealKcal.user > 0 || mealKcal.bot > 0;

    // Самочувствие и калибровка по карточкам — из тега
    if (tag) {
        if (tag.userFeel) state.user.feel = tag.userFeel;
        if (bot && tag.botFeel) bot.feel = tag.botFeel;
        if (tag.userProfile) applyProfile(state.user, tag.userProfile);
        if (bot && tag.botProfile) applyProfile(bot, tag.botProfile);
        if (tag.userState) applyStateCalib(state.user, tag.userState);
        if (bot && tag.botState) applyStateCalib(bot, tag.botState);
    }
    if (state.calibrate?.pending || state.calibrate?.doneAt === N) {
        state.calibrate = { pending: false, doneAt: N };
    }
    if (tag?.userCare) state.user.careLeft = 12;
    if (bot && tag?.botCare) bot.careLeft = 12;
    if (tag?.userPreg != null) applyPregnancy(state.user, tag.userPreg);
    if (bot && tag?.botPreg != null) applyPregnancy(bot, tag.botPreg);

    // События беременности — сами, по времени суток, сну и еде
    for (const ch of chars) {
        const added = [];
        const r = pregnancyEvents(ch.data, {
            woke: ctx.woke[ch.who], hour: ((state.clockHours % 24) + 24) % 24, day: dayNumber(), turn: state.turn,
            mealKcal: mealKcal[ch.who], activity: activityOf[ch.who], sleeping: ctx.endedAsleep,
        }, added);
        added.forEach(id => ctx[ch.who].added.add(id));
        if (r.vomited) {
            applyVomit(ch.data);
            queueNotify(`${ch.name}: еда не удержалась`, 'warning', 4000);
        }
    }

    // Болезни-события: простуда, гастрит, отравление — сами, по состоянию
    const foodsOf = { user: userFood, bot: botFood };
    const drinksOf = { user: userDrink, bot: botDrink };
    setEra(isHistorical() ? 'historical' : 'modern');
    for (const ch of chars) {
        const added = [];
        const r = illnessEvents(ch.data, {
            day: dayNumber(), turn: state.turn, foods: foodsOf[ch.who], drinks: drinksOf[ch.who],
            hard: isHard(), skip: hours >= 12,
        }, added);
        added.forEach(id => ctx[ch.who].added.add(id));
        if (r.vomited) applyVomit(ch.data);
    }

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
        date: state.rpDate,
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
            offscreen: hours >= 6 && (fedOf.user || fedOf.bot),
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

function applyProfile(c, p) {
    if (p.weight != null && Math.abs(p.weight - c.weight) > 0.05) {
        shiftWeight(c, p.weight - c.weight);
        c.weight = p.weight;
    }
    for (const f of ['gender', 'age', 'height', 'build', 'activity']) if (p[f] != null) c[f] = p[f];
    if (p.ed) c.ed = { ...p.ed };
    if (p.pregnancyWeek != null) applyPregnancy(c, p.pregnancyWeek);
    if (c.gender === 'male') { c.pregnant = false; c.pregnancyWeek = 0; c.pregBase = null; }
    if (c.manualGoal == null) recalcGoal(c);
}

function applyStateCalib(c, st) {
    const g = effectiveGoal(c);
    if (st.satiety != null) {
        c.satiety = st.satiety;
        c.reserve = Math.round(g * (0.25 + 0.5 * st.satiety / 100));
        c.hoursSinceLastMeal = st.satiety >= 85 ? 0.5 : st.satiety >= 60 ? 2.5 : st.satiety >= 35 ? 5 : st.satiety >= 15 ? 8 : 14;
    }
    if (st.water != null) c.water = st.water;
    if (st.energy != null) c.energy = st.energy;
}

function slimItems(list) {
    return list.map(x => ({ item: x.item, calories: r0(x.calories), water: r0(x.water), ml: x.ml }));
}

function viewOf(c) {
    return {
        name: c === state.user ? getUserName() : c.name,
        feel: c.feel || null,
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
    if (e.produce) data.producedToday = true;
    if (e.drink) applyDrink(data, e.water, e.kcal, g, drinkExtras(e.name, e.grams));
    else applyMeal(data, e.kcal, e.water, g);
    applyTurnEvents(data, { mealKcal: e.kcal });
}

function consumeProduct(p, who, grams) {
    const data = who === 'bot' ? getBotState() : state.user;
    if (!data) { notify('Персонаж не загружен', 'warning', 3000, true); return; }

    const kcal = Math.round(p.cal100 * grams / 100);
    const water = Math.round((p.water100 || 0) * grams / 100);
    const entry = { afterMsg: lastProcessedMsg(), who, name: p.name, grams, kcal, water, drink: !!p.drink,
        produce: p.cat === 'veg' || foodFlags(p.name).produce };
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

// ─── 1. Состояние персонажей (глубина 4): что сейчас с телами ───
function buildStatePrompt() {
    if (!state) return '';
    const u = state.user, b = getBotState();
    const userName = getUserName();
    const blocks = [charPromptBlock(u, userName, true)];
    if (b) blocks.push(charPromptBlock(b, getBotName(), false));
    const anySurface = (u.focus?.length || 0) + (b?.focus?.length || 0) > 0;
    const anyEd = edList(u).length || (b && edList(b).length);

    const head = ['[Physiology tracker — hidden background state of the characters. It is context for the story, not its topic.]'];
    if (state.rpDate) head.push(`Current in-world date/time: ${state.rpDate}.`);
    if (isHistorical()) head.push('Setting: a pre-modern era with no modern medicine — illness is treated with herbs, rest, warmth and folk remedies; infections, bad water and spoiled food are real dangers, and sickness takes longer to pass.');

    return `${head.join('\n')}

${blocks.join('\n\n')}

Rules for using this:
- ${anySurface ? 'Show a physical or mental state only where it is listed under "Surface in this reply".' : 'Nothing needs to surface in this reply.'} "Background only" items stay unspoken unless the scene itself turns to food, drink, rest or hard physical effort.
- A surfaced state gets ONE short concrete detail woven into action or dialogue — never a paragraph, never the opening or closing line of the reply.
- Never bring the same condition up in two replies in a row unless it just got worse. Never reuse an image, gesture or phrase you already used for it earlier in the chat; if nothing fresh fits, leave it out.
- ${userName} is the player's character. Never write ${userName}'s thoughts, feelings, decisions or words. But ${userName}'s BODY still reacts on its own: when a state of ${userName} surfaces, show it as an involuntary physical reaction the scene can see — a wave of nausea that stops them mid-step, pallor, trembling hands, legs giving way, a cough, a flinch of pain. The body reacts; the mind stays the player's.
- Weakness limits what bodies can actually do, even when it is not narrated.
- Mental conditions show through behaviour, choices and dialogue of the characters you voice — never as a narrated diagnosis.${anyEd ? `\n- ${ED_GUIDANCE}` : ''}`;
}

// ─── 2. Правило тега (глубина 0 — самый конец промпта, там модели слушаются лучше) ───
function tagFieldRules(userName, botName) {
    return [
        `- time (in-world 24h clock at the end of the reply) and tp (in-world hours since the previous reply: a few minutes 0.2, an hour 1, a night 8, two days 48) — ALWAYS.`,
        `- activity: low (sitting, talking, resting) | medium (walking, chores, cooking, handiwork) | high (running, fighting, heavy labour). If ${userName} and ${botName} did different things, write user_activity= and bot_activity= instead.`,
        `- Eating and drinking: check ${userName}'s last message AND the reply. Everything eaten or drunk in either goes in, once. "We ate / we both had" = both ate → user_ate AND bot_ate. Always a kcal number for the real portion: a bite 50, a snack 150–250, a plate 400–700, "stuffed" or a feast 800–1200 each. Drinks in ml: a sip 30, a cup 250, a mug 400. Not food that was only cooked, served, offered or talked about. Other NPCs are not tracked.`,
        `- date: the in-world date and part of day, short. user_feel / bot_feel: 3–8 words, how that character feels in body and mind right now.`,
        `- Only when true: sleeping=true (they slept) · user_vomited=true / bot_vomited=true · user_care=true / bot_care=true (a sick character was treated or cared for: ${isHistorical() ? 'a healer, herbs, a bathhouse, warmth, broth, rest' : 'a doctor, medicine, warmth, rest'}) · user_preg=WEEK / bot_preg=WEEK (a pregnancy is newly established or its week revealed; 0 if it ended).`,
        isHard()
            ? `- SURVIVAL MODE: for any time skip, add offscreen=fed only if they actually had food during it; otherwise offscreen=hungry, or offscreen=thirsty if they had neither food nor water. Never invent meals the story didn't provide.`
            : `- Time skips: off-screen sleep and regular meals are counted automatically — don't list them. Add offscreen=hungry only if the story makes clear they truly had nothing to eat (offscreen=thirsty if no water either).`,
        `- Omit empty fields. Write FOOD, DRINK, DATE and FEEL in the language the roleplay is written in.`,
    ].join('\n');
}

function calibrationRules(userName, botName) {
    return `Also add: user_profile=GENDER/AGE/HEIGHT_CM/WEIGHT_KG/BUILD/LIFESTYLE/ED/PREG_WEEK | bot_profile=… | user_state=SATIETY/WATER/ENERGY | bot_state=…
Use ${botName}'s character card, ${userName}'s persona description and the story so far; give your best estimate for anything not stated.
GENDER m or f · BUILD slim|average|athletic|muscular|heavy · LIFESTYLE sedentary|light|moderate|active|very_active · ED none, or anorexia|bulimia|binge with :mild|:moderate|:severe, only if clearly established · PREG_WEEK the pregnancy week, 0 if not pregnant · SATIETY, WATER, ENERGY 0–100, how they are right now.
Example shape: user_profile=f/24/165/57/slim/light/none/0 | bot_profile=m/30/185/82/muscular/active/none/0 | user_state=70/60/80 | bot_state=85/70/65`;
}

const TAG_TEMPLATE = '<!-- NN time=HH:MM | tp=HOURS | activity=LEVEL | user_ate=FOOD:KCAL, FOOD:KCAL | user_drank=DRINK:ML | bot_ate=FOOD:KCAL | bot_drank=DRINK:ML | date=DATE | user_feel=FEEL | bot_feel=FEEL -->';

function buildTagPrompt() {
    if (!state) return '';
    const userName = getUserName(), botName = getBotName();
    return `[Nutrition tag — REQUIRED in every reply]
End the reply with exactly one hidden HTML comment on its own last line, after all story text:
${TAG_TEMPLATE}
CAPITALS are placeholders — fill them from the current scene, copy nothing literally.
${tagFieldRules(userName, botName)}${catchUpLine()}${calibrateNow ? `\nONE-TIME CALIBRATION (this reply only). ${calibrationRules(userName, botName)}` : ''}
Never skip, mention or explain the comment.`;
}

// Прошлый ответ пришёл без тега — этот тег должен покрыть и его
function catchUpLine() {
    const n = state?.missedTag || 0;
    if (!n) return '';
    return `\n- CATCH-UP: your previous ${n > 1 ? `${n} replies` : 'reply'} had no tag. This tag must cover everything since the last tagged reply: tp = in-world hours since then, and all eating and drinking in those replies and in ${getUserName()}'s messages in between.`;
}

// Модуль таверны целиком — для main_api и updateMessageBlock (динамически, чтобы не падать на старых версиях)
let stModule = null;
import('../../../../script.js').then(m => { stModule = m; }).catch(() => {});
const isChatCompletion = () => stModule?.main_api === 'openai';

// Калибровка по карточкам: включается на первый ответ в новом чате и по кнопке,
// держится на время свайпов этого же ответа, потом промпт возвращается к обычному
let calibrateNow = false;

function injectPrompt() {
    const on = isEnabled() && state;
    setExtensionPrompt(PROMPT_KEY, on ? buildStatePrompt() : '', extension_prompt_types.IN_CHAT, 4, true, extension_prompt_roles.SYSTEM);
    // Для chat completion правило тега ставится в самый конец готового промпта (onPromptReady),
    // для остальных API — обычным инджектом на глубине 0
    setExtensionPrompt(PROMPT_KEY_TAG, on && !isChatCompletion() ? buildTagPrompt() : '', extension_prompt_types.IN_CHAT, 0, true, extension_prompt_roles.SYSTEM);
}

/**
 * Chat completion: правило тега — последним системным сообщением, уже после
 * всех инструкций пресета (пост-история, джейлбрейк). Если в конце стоит
 * префилл ассистента — ставим перед ним.
 */
function onPromptReady(eventData) {
    if (!isEnabled() || !state || !eventData || eventData.dryRun) return;
    const list = eventData.chat;
    if (!Array.isArray(list)) return;
    const text = buildTagPrompt();
    if (!text) return;
    let at = list.length;
    while (at > 0 && list[at - 1]?.role === 'assistant') at--;
    list.splice(at, 0, { role: 'system', content: text });
}

// Вырезает тег, написанный не комментарием: ```-блок, незакрытый <!-- NN, голая строка «NN: …»
function stripLooseTag(text) {
    let t = String(text || '');
    t = t.replace(/```[a-z]*\s*(?:<!--\s*)?NN\b[\s\S]*?```/gi, '');
    t = t.replace(/<!--\s*NN\b(?![\s\S]*-->)[\s\S]*$/i, '');
    t = t.replace(/^\s*\[?\s*NN\b[\s:]+[^\n]*$/gim, '');
    return t.replace(/\s+$/, '');
}

function hashText(t) {
    let h = 0;
    const s = String(t || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
}

// ═══════════════════════════════════════════════════════════════
// ИНФОБЛОК В СООБЩЕНИИ
// ═══════════════════════════════════════════════════════════════
const ui = {
    open: new Map(),                       // mesId → раскрыт ли блок
    tab: new Map(),                        // mesId → активная вкладка
    cardOpen: { user: true, bot: true },   // карточки персонажей в «Обзоре»
    stateOpen: { user: false, bot: false },// раздел «Самочувствие»
    catalogOpen: false,
    who: 'user',
    prodCat: null, prodSearch: '', prodSel: null, prodGrams: null,
};

const TABS = [
    { id: 'overview', icon: 'fa-chart-simple', label: 'Обзор' },
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
        date: state.rpDate,
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

    const searchFocused = document.activeElement?.classList?.contains('nn-search');
    block.innerHTML = headHtml(snap, open) + (open ? bodyHtml(snap, live, tab) : '');
    if (searchFocused && open && tab === 'feed') {
        const s = block.querySelector('.nn-search');
        if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    }
}

// ─── Хелперы ──────────────────────────────────────────────────
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

// ─── Аватар в кольце: четыре дуги — сытость, вода, энергия, здоровье ──
const RING_PARTS = [['satiety', 'Сытость'], ['water', 'Вода'], ['energy', 'Энергия'], ['health', 'Здоровье']];

function alertOf(v) {
    if (physicalOf(v).length) return 'bad';
    if (mentalOf(v).length || v.ed?.length) return 'mind';
    if (effectsOf(v).some(e => e.kind === 'negative' && !e.fading)) return 'warn';
    return null;
}

function ringAvatar(v, who, size) {
    const sw = size >= 50 ? 4 : 3.5;
    const r = size / 2 - sw / 2;
    const C = 2 * Math.PI * r;
    const gapDeg = 14;
    const L = (90 - gapDeg) / 360 * C;
    const c = size / 2;
    let arcs = '';
    RING_PARTS.forEach(([k], i) => {
        const rot = -90 + i * 90 + gapDeg / 2;
        const f = Math.max(0.001, L * pct(v[k]) / 100);
        const tr = `transform="rotate(${rot} ${c} ${c})"`;
        arcs += `<circle class="nn-ring-track" cx="${c}" cy="${c}" r="${r}" stroke-width="${sw}" stroke-dasharray="${L} ${C}" ${tr}/>`;
        arcs += `<circle class="nn-ring-fill nn-${lvl(v[k])}" cx="${c}" cy="${c}" r="${r}" stroke-width="${sw}" stroke-dasharray="${f} ${C}" ${tr}/>`;
    });
    const title = RING_PARTS.map(([k, l]) => `${l} ${pct(v[k])}%`).join(' · ');
    const alert = alertOf(v);
    const inset = sw * 2 + 1;
    return `<span class="nn-ringav" style="width:${size}px;height:${size}px" title="${title}">
        <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">${arcs}</svg>
        <span class="nn-ringav-img" style="inset:${inset}px">${avatarHtml(who, 'nn-av-fill')}</span>
        ${alert ? `<span class="nn-alert nn-alert-${alert}"></span>` : ''}
    </span>`;
}

function personChip(v, who) {
    return `<span class="nn-chip">
        ${ringAvatar(v, who, 44)}
        <span class="nn-chip-text">
            <span class="nn-chip-name">${esc(v.name)}</span>
            <span class="nn-chip-kcal"><i class="fa-solid fa-fire-flame-curved"></i>${v.calories}<small>/${v.goal}</small></span>
        </span>
    </span>`;
}

function turnKcal(turn) {
    if (!turn) return 0;
    return [...turn.userFood, ...turn.botFood, ...turn.userDrink, ...turn.botDrink]
        .reduce((a, x) => a + (x.calories || 0), 0);
}

function headHtml(snap, open) {
    // Раскрытый блок: отдельной шапки нет — кнопка «свернуть» стоит в строке вкладок
    if (open) return '';
    return `<div class="nn-head" role="button" tabindex="0" data-act="toggle" aria-expanded="false">
        <span class="nn-people">${personChip(snap.user, 'user')}${snap.bot ? personChip(snap.bot, 'bot') : ''}</span>
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
        case 'log': pane = ''; break;             // пока пусто — придумаем позже
        case 'weight': pane = weightPane(); break;
        case 'feed': pane = feedPane(); break;
        case 'params': pane = paramsPane(); break;
        default: pane = overviewPane(snap);
    }
    return `<div class="nn-body">
        <div class="nn-tabs" role="tablist">${tabs}
            <button class="nn-tab nn-collapse" data-act="toggle" aria-label="Свернуть" title="Свернуть"><i class="fa-solid fa-chevron-up"></i></button>
        </div>
        <div class="nn-pane${pane ? '' : ' nn-pane-empty'}">${pane}</div>
    </div>`;
}

// ─── Обзор ────────────────────────────────────────────────────
function statusOf(v) {
    const phys = physicalOf(v);
    if (phys.some(d => d.severity === 'critical' || d.severity === 'severe')) return ['Критично', 'fa-heart-crack', 'bad'];
    if (phys.length || v.health < 40 || v.energy < 20) return ['Плохо', 'fa-face-dizzy', 'bad'];
    if (v.satiety < 30 || v.water < 30 || effectsOf(v).some(e => e.kind === 'negative' && !e.fading)) return ['Напряжение', 'fa-triangle-exclamation', 'warn'];
    return ['Норма', 'fa-heart', 'good'];
}

function statRow(icon, label, v, extra = '') {
    return `<div class="nn-row nn-${lvl(v)}">
        <i class="fa-solid ${icon}"></i><span class="nn-row-label">${label}</span>
        <span class="nn-bar"><span style="width:${pct(v)}%"></span></span>
        <b class="nn-row-val">${extra || `${pct(v)}%`}</b>
    </div>`;
}

function diseaseItem(d) {
    const time = d.recovering ? `выздоровление, ещё ~${d.left} ч` : (d.since ? `уже ${d.since}` : '');
    const mind = d.category === 'mental';
    return `<div class="nn-cond nn-sev-${d.severity}${mind ? ' nn-cond-mind' : ''}">
        <i class="fa-solid ${mind ? 'fa-brain' : 'fa-virus'}"></i>
        <div class="nn-cond-main">
            <div class="nn-cond-title">${esc(d.name)} <span class="nn-sev">${SEV_LABEL[d.severity] || ''}</span></div>
            <div class="nn-cond-sub">${esc((d.effects || []).join(', '))}${time ? `. ${esc(time)}` : ''}</div>
        </div>
    </div>`;
}

function edItem(e) {
    return `<div class="nn-cond nn-cond-mind nn-sev-${e.severity}">
        <i class="fa-solid fa-brain"></i>
        <div class="nn-cond-main"><div class="nn-cond-title">${esc(ED_DB[e.id].nameRu)} <span class="nn-sev">${ED_SEV_LABEL[e.severity]}</span></div></div>
    </div>`;
}

function effectItem(e) {
    const left = e.fading ? Math.max(0.5, Math.round((e.fadeLeft || 0) * 2) / 2) : null;
    const tail = left != null ? `. ${e.timed ? 'Ещё' : 'Проходит,'} ~${left} ч` : '';
    return `<div class="nn-cond nn-eff-${e.kind}${e.fading && !e.timed ? ' nn-fading' : ''}">
        <i class="fa-solid ${e.icon}"></i>
        <div class="nn-cond-main">
            <div class="nn-cond-title">${esc(e.name)}</div>
            <div class="nn-cond-sub">${esc(e.text || '')}${tail}</div>
        </div>
    </div>`;
}

// «Самочувствие»: как себя чувствует (пишет ИИ) + болезни и эффекты.
// Если нечего показать — раздела нет совсем.
function stateSection(v, who) {
    const phys = physicalOf(v);
    const mind = [...(v.ed || []).map(edItem), ...mentalOf(v).map(diseaseItem)];
    const eff = effectsOf(v).slice().sort((a, b) => ({ negative: 0, neutral: 1, positive: 2 }[a.kind] - { negative: 0, neutral: 1, positive: 2 }[b.kind]));
    if (!v.feel && !phys.length && !mind.length && !eff.length) return '';

    const open = ui.stateOpen[who];
    const badges = [];
    if (phys.length) badges.push(`<span class="nn-fx nn-bad"><i class="fa-solid fa-virus"></i>${phys.length}</span>`);
    if (mind.length) badges.push(`<span class="nn-fx nn-mind"><i class="fa-solid fa-brain"></i>${mind.length}</span>`);
    const neg = eff.filter(e => e.kind !== 'positive').length, pos = eff.length - neg;
    if (neg) badges.push(`<span class="nn-fx nn-warn"><i class="fa-solid fa-arrow-trend-down"></i>${neg}</span>`);
    if (pos) badges.push(`<span class="nn-fx nn-good"><i class="fa-solid fa-arrow-trend-up"></i>${pos}</span>`);

    let body = '';
    if (open) {
        const group = (icon, title, html) => html ? `<h5 class="nn-sub-h"><i class="fa-solid ${icon}"></i>${title}</h5><div class="nn-conds">${html}</div>` : '';
        const bac = v.bac >= 0.1 ? `<div class="nn-row nn-${v.bac >= 1.8 ? 'bad' : v.bac >= 0.9 ? 'warn' : 'good'}">
            <i class="fa-solid fa-wine-glass"></i><span class="nn-row-label">Алкоголь</span>
            <span class="nn-bar"><span style="width:${Math.min(100, v.bac / 3 * 100)}%"></span></span>
            <b class="nn-row-val">${v.bac.toFixed(1)}‰</b>
        </div>` : '';
        const imm = v.immunity < 80 ? statRow('fa-shield-halved', 'Иммунитет', v.immunity) : '';
        body = `<div class="nn-state-body">
            ${v.feel ? `<p class="nn-feel">${esc(v.feel)}</p>` : ''}
            ${bac}${imm}
            ${group('fa-virus', 'Болезни', phys.map(diseaseItem).join(''))}
            ${group('fa-brain', 'Психика', mind.join(''))}
            ${group('fa-wand-magic-sparkles', 'Активные эффекты', eff.map(effectItem).join(''))}
        </div>`;
    }
    return `<div class="nn-state${open ? ' nn-on' : ''}">
        <button class="nn-state-toggle" data-act="state" data-who="${who}" aria-expanded="${open}">
            <i class="fa-solid fa-heart-pulse"></i><span class="nn-state-title">Самочувствие</span>
            <span class="nn-state-badges">${badges.join('')}</span>
            <i class="fa-solid fa-chevron-down nn-chev"></i>
        </button>${body}
    </div>`;
}

function personCard(v, who) {
    const open = ui.cardOpen[who];
    const [stText, stIcon, stLvl] = statusOf(v);
    const g = v.gender === 'male' ? 'fa-mars' : v.gender === 'female' ? 'fa-venus' : 'fa-genderless';
    const kPct = v.goal ? Math.round(v.calories / v.goal * 100) : 0;
    const kLvl = kPct > 130 ? 'over' : kPct < 30 ? 'bad' : kPct < 60 ? 'warn' : 'good';
    const ate = v.gender === 'female' ? 'ела' : v.gender === 'male' ? 'ел' : 'ел(а)';
    const last = v.hoursSinceLastMeal >= 1 ? `последний приём ${fmtH(v.hoursSinceLastMeal)} назад` : `${ate} недавно`;

    let preg = '';
    if (v.pregnant && v.gender !== 'male') {
        const st = getPregnancyStage(v.pregnancyWeek);
        preg = `<div class="nn-note"><i class="fa-solid fa-person-pregnant"></i><span>${esc(st.label)}, неделя ${v.pregnancyWeek || '—'}</span></div>`;
    }
    return `<section class="nn-card${open ? '' : ' nn-card-closed'}">
        <header class="nn-card-head" role="button" tabindex="0" data-act="card" data-who="${who}" aria-expanded="${open}">
            ${ringAvatar(v, who, 52)}
            <div class="nn-card-id">
                <div class="nn-card-name">${esc(v.name)}</div>
                <div class="nn-card-sub"><i class="fa-solid ${g}"></i>${v.age} ${plural(v.age, ['год', 'года', 'лет'])}, ${v.height} см, ${kg(v.weight)} кг</div>
            </div>
            <span class="nn-status nn-${stLvl}"><i class="fa-solid ${stIcon}"></i><span>${stText}</span></span>
            <i class="fa-solid fa-chevron-down nn-chev"></i>
        </header>
        ${open ? `<div class="nn-card-body">
            <div class="nn-kcal nn-${kLvl}">
                <div class="nn-kcal-num"><b>${v.calories}</b><span>из ${v.goal} ккал</span></div>
                <span class="nn-bar nn-bar-thick"><span style="width:${Math.min(100, kPct)}%"></span></span>
                <div class="nn-kcal-meta">${last}</div>
            </div>
            <div class="nn-rows">
                ${statRow('fa-utensils', 'Сытость', v.satiety)}
                ${statRow('fa-droplet', 'Вода', v.water)}
                ${statRow('fa-bolt', 'Энергия', v.energy)}
                ${statRow('fa-heart-pulse', 'Здоровье', v.health)}
            </div>
            ${preg}
            ${stateSection(v, who)}
        </div>` : ''}
    </section>`;
}

function overviewPane(snap) {
    return `<div class="nn-cards">${personCard(snap.user, 'user')}${snap.bot ? personCard(snap.bot, 'bot') : ''}</div>`;
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
        return `<section class="nn-card">
            <header class="nn-card-head nn-card-head-static">${avatarHtml(who, 'nn-av-lg')}<div class="nn-card-id"><div class="nn-card-name">${esc(who === 'user' ? getUserName() : c.name)}</div></div>
                <span class="nn-status"><i class="fa-solid ${trend[0]}"></i><span>${trend[1]}</span></span></header>
            <div class="nn-kcal-num"><b>${kg(c.weight)}</b><span>кг, сегодня ${kgDelta(today)}</span></div>
            <div class="nn-kcal-meta">ИМТ ${bmi.toFixed(1)} — <span class="nn-${bl}-text">${bmiLabel}</span></div>
        </section>`;
    };
    const rows = [...state.weightHistory].reverse().slice(0, 30).map(e => {
        const ch = Math.abs(e.change) < 0.005 ? '<span class="nn-mute">±0</span>'
            : `<span class="${e.change > 0 ? 'nn-warn-text' : 'nn-good-text'}">${kgDelta(e.change)}</span>`;
        return `<tr><td>${e.day}</td><td>${esc(e.name)}</td><td>${kg(e.weight)}</td><td>${ch}</td><td>${e.calories}${e.burned != null ? ` / −${e.burned}` : ''}</td></tr>`;
    }).join('');
    return `<div class="nn-cards">${card(state.user, 'user')}${card(getBotState(), 'bot')}</div>
        ${rows ? `<div class="nn-table-wrap"><table class="nn-table">
            <thead><tr><th>День</th><th>Кто</th><th>Вес</th><th>За день</th><th>Ккал</th></tr></thead>
            <tbody>${rows}</tbody></table></div>` : ''}`;
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
    if (!q && !ui.prodCat) return '';
    const items = PRODUCT_DB.map((p, idx) => ({ p, idx }))
        .filter(({ p }) => q ? p.name.toLowerCase().includes(q) : p.cat === ui.prodCat);
    if (!items.length) return '<div class="nn-empty">Ничего не нашлось</div>';

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
        <button class="nn-cat${c.id === ui.prodCat ? ' nn-on' : ''}" data-act="cat" data-cat="${c.id}">
            <i class="fa-solid ${c.icon}"></i><span>${c.name}</span>
        </button>`).join('');
    const list = prodListHtml();
    return `<div class="nn-feed-top">${whoSwitch()}
            <label class="nn-search-wrap"><i class="fa-solid fa-magnifying-glass"></i>
            <input type="text" class="nn-search text_pole" placeholder="Найти продукт" value="${esc(ui.prodSearch)}"></label>
        </div>
        <button class="nn-catalog-bar${ui.catalogOpen ? ' nn-on' : ''}" data-act="catalog" aria-expanded="${ui.catalogOpen}">
            <i class="fa-solid fa-book-open"></i><span>Каталог продуктов</span><i class="fa-solid fa-chevron-down nn-chev"></i>
        </button>
        ${ui.catalogOpen ? `<div class="nn-cats">${cats}</div>` : ''}
        <div class="nn-prod-list${list ? '' : ' nn-hidden'}">${list}</div>`;
}

// ─── Параметры ────────────────────────────────────────────────
function paramsPane() {
    const data = ui.who === 'bot' ? getBotState() : state.user;
    if (!data) return `${whoSwitch()}`;
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
        <label>Вес, кг<input class="text_pole" type="number" data-field="weight" min="30" max="250" step="0.1" value="${+(+data.weight).toFixed(1)}"></label>
        <label>Телосложение<select class="text_pole" data-field="build">${opt(Object.entries(BUILD_TYPES).map(([k, v]) => [k, v.labelRu]), data.build)}</select></label>
        <label>Образ жизни<select class="text_pole" data-field="activity">${opt(Object.entries(ACTIVITY_LEVELS).map(([k, v]) => [k, v.labelRu]), data.activity)}</select></label>
    </div>
    <div class="nn-form-line">
        <label class="checkbox_label"><input type="checkbox" data-field="manualToggle" ${manual ? 'checked' : ''}>Своя норма калорий</label>
        <input class="text_pole nn-num" type="number" data-field="manualGoal" min="800" max="6000" value="${manual ? data.manualGoal : auto}" ${manual ? '' : 'disabled'}>
    </div>
    <div class="nn-form-line">
        <button class="nn-btn" data-act="reanalyze"><i class="fa-solid fa-arrows-rotate"></i>Пересчитать по карточкам и ролплею</button>
    </div>`;
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
    // ИИ уточнит профиль и состояние по карточкам и ролплею в следующем ответе (через инджект)
    state.calibrate = { pending: true, doneAt: null };
    saveState();
    injectPrompt();
    notify('Уточню по карточкам и ролплею в следующем ответе', 'success', 3000, true);
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
            case 'cat': ui.prodCat = ui.prodCat === t.dataset.cat ? null : t.dataset.cat; ui.prodSearch = ''; ui.prodSel = null; break;
            case 'catalog': ui.catalogOpen = !ui.catalogOpen; if (!ui.catalogOpen) { ui.prodCat = null; ui.prodSel = null; } break;
            case 'card': ui.cardOpen[t.dataset.who] = !ui.cardOpen[t.dataset.who]; break;
            case 'state': ui.stateOpen[t.dataset.who] = !ui.stateOpen[t.dataset.who]; break;
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
        if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.nn-head, .nn-card-head[data-act]')) {
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
        if (list) {
            list.innerHTML = prodListHtml();
            list.classList.toggle('nn-hidden', !list.innerHTML.trim());
        }
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
    ['disease:cold:moderate', 'Болезнь: простуда'],
    ['disease:food_poisoning:moderate', 'Болезнь: пищевое отравление'],
    ['disease:dysentery:moderate', 'Болезнь: дизентерия'],
    ['disease:gastritis:mild', 'Болезнь: гастрит'],
    ['disease:anemia:mild', 'Болезнь: анемия'],
    ['disease:scurvy:mild', 'Болезнь: цинга'],
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
        if (id === 'anemia') data.daysWithDeficit = Math.max(data.daysWithDeficit || 0, 10);
        if (id === 'scurvy') data.daysNoProduce = Math.max(data.daysNoProduce || 0, 30);
        if (id === 'gastritis') data.daysWithDeficit = Math.max(data.daysWithDeficit || 0, 3);
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
                <label class="nn-settings-row">Учёт калорий
                    <select id="nn-set-mode" class="text_pole">
                        <option value="easy" ${isHard() ? '' : 'selected'}>Лёгкий — можно пропускать дни</option>
                        <option value="hard" ${isHard() ? 'selected' : ''}>Хардкор — выживание</option>
                    </select>
                </label>
                <label class="nn-settings-row">Эпоха
                    <select id="nn-set-era" class="text_pole">
                        <option value="modern" ${isHistorical() ? '' : 'selected'}>Современность</option>
                        <option value="historical" ${isHistorical() ? 'selected' : ''}>Историческая — без современной медицины</option>
                    </select>
                </label>
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
        document.getElementById('nn-set-mode')?.addEventListener('change', e => {
            localStorage.setItem(LS.mode, e.target.value);
            setHungerCap(!isHard());
            injectPrompt();
        });
        document.getElementById('nn-set-era')?.addEventListener('change', e => {
            localStorage.setItem(LS.era, e.target.value);
            setEra(e.target.value);
            injectPrompt();
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
    const regen = ['swipe', 'regenerate', 'continue'].includes(type);
    calibrateNow = !!state.calibrate?.pending || (regen && state.calibrate?.doneAt === lastBotIndex());
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

function onMessageSwiped(id) {
    if (!isEnabled() || !state) return;
    setTimeout(() => {
        if (generating) return;
        const m = chat[id];
        if (!m || m.is_user) return;
        if (isGreeting(id)) { scheduleRenderAll(); return; }
        const sw = m.swipes?.[m.swipe_id];
        // Переключились на уже готовый вариант — пересчитываем по его тексту
        if (sw && sw.trim() && m.mes === sw) onMessageReceived(Number(id));
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
    setHungerCap(!isHard());
    setEra(isHistorical() ? 'historical' : 'modern');
    injectSettingsPanel();
    loadState();
    injectPrompt();

    on(event_types.GENERATION_STARTED, onGenerationStarted);
    on(event_types.GENERATION_ENDED, onGenerationEnded);
    on(event_types.GENERATION_STOPPED, onGenerationEnded);
    on(event_types.MESSAGE_RECEIVED, onMessageReceived);
    on(event_types.CHAT_COMPLETION_PROMPT_READY, onPromptReady);
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
