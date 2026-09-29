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
    tickTime, applyMeal, applyDrink, applyVomit, goalOf, changeWeight, bankFat, KCAL_PER_KG,
    burnPerHour,
} from './nutrition-engine.js';
import { parseNnTag, parseNnInner, findNnInner, MAX_HOURS } from './parser.js';
import {
    notify, queueNotify, flushQueue, setSilent, setToastsEnabled, clearQueue,
} from './notifications.js';
import {
    evaluateConditions, buildConditionPrompt, updateFocus,
    getPregnancyStage, calculateImmunity, DISEASE_DB,
    applyTurnEvents, checkRefeeding, edList, ED_DB, ED_SEV_LABEL, ED_GUIDANCE,
    applyHealDelta, resolveDiseaseId,
    pregnancyEvents, capHungerSeverity, setHungerCap, illnessEvents, setEra,
} from './conditions.js';
import { EFFECT_INFO, effectView, drinkExtras, grantEffect, resolveEffectId, hasEffect } from './effects.js';
import { ACTIVITY_LEVELS, BUILD_TYPES, calculateCalorieGoal } from './analyzer.js';

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
    'manualGoal', 'calorieGoal', 'ed'];

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

        hoursSinceLastMeal: 0, daysWithDeficit: 0,
        dayStartWeight: null,  // вес на начало игрового дня
        fatLedger: 0,          // кг жира от баланса калорий за день — списывается в полночь
        foodNote: null,        // { kind: 'ate' | 'why' | 'off', text } — что ел(а) или почему не ест
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
        for (const k of ['history', 'weightHistory']) if (!Array.isArray(state[k])) state[k] = [];
        delete state.manualLog;   // вкладки «Покормить» больше нет
        fillChar(state.user);
        state.user.name = getUserName();
        for (const c of state.characters) fillChar(c);

        ensureBotState();
        if (state.clockHours == null) state.clockHours = 12;
        // Вес на начало дня фиксируем уже после анализа карточек
        for (const c of [state.user, ...state.characters]) {
            if (c.dayStartWeight == null) c.dayStartWeight = c.weight;
            for (const d of c.diseases || []) {
                if (d.progress == null) {
                    const need = DISEASE_DB[d.id]?.recovery?.[d.severity] || 24;
                    d.progress = d.recovering ? Math.min(95, Math.round((d.recoveryHours || 0) / need * 100)) : 0;
                }
            }
            delete c.lastMealTime;
            // Старые чаты: текущий вес уже включает набранное за беременность
            if (c.pregnant && c.pregMassApplied == null) {
                c.pregGainFactor = pregGainFactor(c);
                c.pregMassApplied = pregMass(c.pregnancyWeek, c.pregGainFactor);
            }
            if (c.pregnant && !c.pregBase) c.pregBase = { week: c.pregnancyWeek || 1, clock: state.clockHours ?? 12 };
        }
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
function advanceTime(hours, activityOf, sleeping, fedOf, ctx, drinkOf = { user: true, bot: true }, declaredSkip = false, loggedMeal = { user: false, bot: false }) {
    const chars = activeChars();
    setHungerCap(!isHard());
    setEra(isHistorical() ? 'historical' : 'modern');
    if (state.clockHours == null) state.clockHours = 12;
    // Пропуск от 6 часов проживается по распорядку, шагами по часу
    // Явный скип или долгий отрезок проживается по распорядку, шагами по часу
    const routine = declaredSkip || hours >= 6;
    const opts = { healthFloor: isHard() ? null : 25 };
    let left = hours;
    // Если ИИ сам записал еду в конце отрезка, последний обед по распорядку и есть она —
    // его пропускаем, чтобы не посчитать дважды
    // На скипе еда в теге — это уже сцена после него: заменяет обед, только если тот был в последние 3 часа
    const endAt = state.clockHours + hours;
    const lastMealAt = routine ? lastRoutineMeal(state.clockHours, endAt) : null;
    const nearEnd = lastMealAt != null && endAt - lastMealAt <= 3;
    const skipLast = { user: loggedMeal.user && (!declaredSkip || nearEnd), bot: loggedMeal.bot && (!declaredSkip || nearEnd) };
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
                // За кадром едят ровно столько, сколько тратят: без голода вес на пропусках
                // не уходит (у беременной растёт только за счёт беременности)
                const dayTarget = burnPerHour(c, activityOf[ch.who]) * 16 + burnPerHour(c, 'low', true) * 8;
                for (const [mh, share] of MEALS) {
                    const crossed = h0 < mh ? h0 + step >= mh : h0 + step - 24 >= mh;
                    if (!crossed || asleep) continue;
                    const at = state.clockHours - h0 + (h0 < mh ? mh : mh + 24);
                    if (skipLast[ch.who] && lastMealAt != null && Math.abs(at - lastMealAt) < 1e-6) continue;
                    applyMeal(c, dayTarget * share, 8, g);
                    markMeal(c, dayTarget * share, at);
                    // Обычная трапеза за кадром наедает досыта — иначе к ночи все «голодные»
                    c.satiety = Math.max(c.satiety, 75);
                    // Обычный обед по распорядку — не обжорство
                    c.recentIntake = Math.min(c.recentIntake || 0, g * 0.4);
                    c.producedToday = true;   // обычное питание за кадром — с овощами; цинга только если в истории правда одно мясо
                }
                // Сытый организм добирает нехватку из жира, а не проваливается в гипогликемию
                const floor = g * (asleep ? 0.25 : 0.4);
                if ((c.reserve || 0) < floor) {
                    bankFat(c, -(floor - c.reserve) / KCAL_PER_KG);
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
        // Беременность идёт вместе со временем — вес прибавляется каждый день, и на скипах тоже
        for (const ch of chars) advancePregnancy(ch.data);
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

// Абсолютное время последнего обеда по распорядку на отрезке (from, to]
function lastRoutineMeal(from, to) {
    let last = null;
    for (let d = Math.floor(from / 24); d <= Math.floor(to / 24); d++) {
        for (const [mh] of MEALS) {
            const t = d * 24 + mh;
            if (t > from && t <= to && !isNight(mh)) last = t;
        }
    }
    return last;
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

// Прибавка веса за беременность (ребёнок, плацента, жидкость, запасы):
// ~1.5 кг за первый триместр, дальше ~0.42 кг в неделю — около 12–13 кг к сроку
// при нормальном весе; при худобе больше, при полноте меньше.
function pregMass(week, factor = 1) {
    const w = Math.max(0, Math.min(40, week || 0));
    const kg = w <= 13 ? 1.5 * w / 13 : 1.5 + 0.42 * (w - 13);
    return kg * factor;
}
function pregGainFactor(c) {
    const bmi = c.weight / ((c.height / 100) ** 2);
    return bmi < 18.5 ? 1.2 : bmi < 25 ? 1 : bmi < 30 ? 0.7 : 0.5;
}

// Неделя из тега: число недель, месяцы уже пересчитаны, триместр — к его началу
function pregWeekFrom(c, v) {
    if (v && typeof v === 'object' && v.trimester) {
        const start = { 1: 6, 2: 14, 3: 28 }[v.trimester];
        const cur = c.pregnant ? c.pregnancyWeek || 0 : 0;
        const curTri = cur >= 28 ? 3 : cur >= 14 ? 2 : cur > 0 ? 1 : 0;
        return v.trimester > curTri ? start : (cur || start);
    }
    return v;
}

// Точная неделя с дробной частью: от точки отсчёта идёт по игровым часам
function pregWeekExact(c, clock = state.clockHours) {
    if (!c.pregnant || !c.pregBase) return c.pregnancyWeek || 0;
    return Math.min(42, c.pregBase.week + Math.max(0, (clock - c.pregBase.clock) / 168));
}

/**
 * Беременность из тега. Неделя может только расти: ИИ часто повторяет ту неделю,
 * что видел в промпте, — раньше это сбрасывало отсчёт, и срок «застревал».
 * Назад срок правится карандашом в инфоблоке (setPregWeekManual).
 */
function applyPregnancy(c, week) {
    if (c.gender === 'male' || week == null) return;
    if (week === 0) {
        // Роды: уходит большая часть «беременного» веса
        if (c.pregnant) changeWeight(c, -(c.pregMassApplied || 0) * 0.65);
        c.pregnant = false; c.pregnancyWeek = 0; c.pregBase = null; c.pregMassApplied = 0;
    } else if (!c.pregnant) {
        // Вес на момент, когда стало известно, уже включает набранное к этой неделе
        c.pregGainFactor = pregGainFactor(c);
        c.pregMassApplied = pregMass(week, c.pregGainFactor);
        c.pregnant = true; c.pregnancyWeek = week; c.pregBase = { week, clock: state.clockHours };
    } else if (week > Math.floor(pregWeekExact(c))) {
        // История ушла вперёд сильнее наших часов — догоняем (и вес тоже)
        c.pregBase = { week, clock: state.clockHours };
        advancePregnancy(c);
    } else {
        return;   // та же или меньшая неделя — это повтор, отсчёт не трогаем
    }
    if (c.manualGoal == null) recalcGoal(c);
}

function advancePregnancy(c) {
    if (!c.pregnant || !c.pregBase) return;
    const exact = pregWeekExact(c);
    const mass = pregMass(exact, c.pregGainFactor || 1);
    changeWeight(c, mass - (c.pregMassApplied || 0));
    c.pregMassApplied = mass;
    const w = Math.max(1, Math.floor(exact));
    if (w !== c.pregnancyWeek) {
        c.pregnancyWeek = w;
        if (c.manualGoal == null) recalcGoal(c);
    }
}

/**
 * Ручная правка срока (карандаш в инфоблоке, калибровка): это уточнение, а не прошедшее
 * время — вес не меняем, только точку отсчёта. Правку переносим и в снимки, иначе свайп её откатит.
 */
function setPregWeekManual(c, week) {
    const apply = (x, clock) => {
        if (!x) return;
        if (!week) { x.pregnant = false; x.pregnancyWeek = 0; x.pregBase = null; x.pregMassApplied = 0; return; }
        if (!x.pregnant) x.pregGainFactor = pregGainFactor(x);
        x.pregnant = true;
        x.pregnancyWeek = week;
        x.pregBase = { week, clock };
        x.pregMassApplied = pregMass(week, x.pregGainFactor || 1);
        if (x.manualGoal == null) x.calorieGoal = calculateCalorieGoal(x);
    };
    apply(c, state.clockHours);
    for (const snap of state.snapshots) {
        const x = c === state.user ? snap.user : snap.characters.find(y => y.charId === c.charId);
        apply(x, snap.clockHours ?? state.clockHours);
    }
}

// Итог дня для веса: профицит откладывается всегда, а потеря — только если день
// закончился голодным. Недоигранный день (утро и сразу скип) вес не отнимает.
const HUNGER_DISEASE_IDS = ['hypoglycemia', 'starvation', 'malnutrition'];
function endedHungry(c) {
    return hasEffect(c, 'hunger') || c.satiety <= 15
        || c.diseases.some(d => HUNGER_DISEASE_IDS.includes(d.id) && !d.recovering);
}
function settleDayFat(c) {
    const kg = c.fatLedger || 0;
    c.fatLedger = 0;
    if (Math.abs(kg) < 0.02) return { applied: 0, skipped: 0 };   // шум
    if (kg > 0 || endedHungry(c)) { changeWeight(c, kg); return { applied: kg, skipped: 0 }; }
    return { applied: 0, skipped: kg };
}

function rolloverDay(ch, endedDay, ctx) {
    const c = ch.data;
    const g = effectiveGoal(c);
    const intake = r0(c.calories);
    const hungry = endedHungry(c);

    // Дефицитный день — только если лёг(ла) голодным; иначе это просто недоигранный день
    if (hungry) c.daysWithDeficit = (c.daysWithDeficit || 0) + 1;
    else c.daysWithDeficit = Math.max(0, (c.daysWithDeficit || 0) - 1);

    const fat = settleDayFat(c);

    // Итог дня: считаем по реальному балансу «съедено − сожжено»
    const balance = intake - r0(c.burned);
    let reason = 'Норма';
    if (fat.skipped < 0) reason = 'Неполный день';
    else if (balance > 500) reason = 'Переедание';
    else if (balance > 150) reason = 'Профицит';
    else if (hungry && balance < -800) reason = 'Сильный дефицит';
    else if (hungry && balance < -150) reason = 'Дефицит';
    if (c.pregnant && reason === 'Норма') reason = 'Беременность';

    const start = c.dayStartWeight ?? c.weight;
    const change = Math.round((c.weight - start) * 100) / 100;
    state.weightHistory.push({
        day: endedDay, who: ch.who, name: ch.name, weight: +c.weight.toFixed(2),
        change, reason, calories: intake, burned: r0(c.burned), calorieGoal: g, timestamp: Date.now(),
    });
    if (state.weightHistory.length > 120) state.weightHistory = state.weightHistory.slice(-120);
    if (Math.abs(change) >= 0.05) ctx.weight.push({ name: ch.name, change, weight: c.weight });

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
        applyMeal(c, sumCal(foods), water, g, { greedy: foods.some(f => f.manner === 'greedy') });
        markMeal(c, sumCal(foods));
        addToHistory(ch.who, foods.map(f => f.item), sumCal(foods));
    }
    for (const d of drinks) {
        const extras = d.alcoholG != null ? d : drinkExtras(d.item, d.ml || 250);
        applyDrink(c, d.water, d.calories || 0, g, { alcoholG: extras.alcoholG || 0, caffeineMg: extras.caffeineMg || 0 });
    }
    return kcal;
}

// Строка для инфоблока: что ИИ записал про еду и питьё или почему персонаж не ест.
// Угаданная по сытости еда в строку не попадает — это не то, что было в сцене.
function makeFoodNote(c, foods, drinks, why) {
    const g = c.gender === 'female' ? 1 : c.gender === 'male' ? 0 : 2;
    const verb = (forms) => forms[g];
    const item = (x) => x.item + (x.mannerLabel ? ` — ${x.mannerLabel}` : '');
    const named = foods.filter(f => !f.implied);
    const parts = [];
    if (named.length) parts.push(`${verb(['Съел', 'Съела', 'Съел(а)'])}: ${named.map(item).join('; ')}`);
    if (drinks.length) {
        const w = verb(['выпил', 'выпила', 'выпил(а)']);
        parts.push(`${parts.length ? w : w[0].toUpperCase() + w.slice(1)}: ${drinks.map(item).join('; ')}`);
    }
    if (parts.length) return { kind: 'ate', text: parts.join(' · '), clock: state.clockHours };
    if (why) return { kind: 'why', text: why[0].toUpperCase() + why.slice(1), clock: state.clockHours };
    return null;
}

// ─── Завтрак, обед, ужин: что уже было сегодня ───
const MEAL_SLOTS = [
    { id: 'breakfast', ru: 'завтрак', en: 'breakfast', from: 5, to: 11, dueFrom: 7 },
    { id: 'lunch', ru: 'обед', en: 'lunch', from: 11, to: 16, dueFrom: 12 },
    { id: 'dinner', ru: 'ужин', en: 'dinner', from: 16, to: 23, dueFrom: 18 },
];
const hourOf = (clock) => ((clock % 24) + 24) % 24;
function slotAt(clock) {
    const h = hourOf(clock);
    return MEAL_SLOTS.find(s => h >= s.from && h < s.to) || null;
}
function mealsOf(c, clock = state.clockHours) {
    const day = Math.floor((clock ?? 12) / 24);
    if (!c.meals || c.meals.day !== day) c.meals = { day, done: {} };
    return c.meals;
}
/** Настоящий приём пищи (от 150 ккал) закрывает завтрак, обед или ужин по времени */
function markMeal(c, kcal, clock = state.clockHours) {
    if (kcal < 150) return;
    const s = slotAt(clock);
    if (s) mealsOf(c, clock).done[s.id] = true;
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
    const ctx = newCtx();

    // ── Время: tp и time из тега; без тега — условные полчаса ──
    const bot = getBotState();
    // Явный скип (skip=2 months) важнее tp: это «прожили обычную жизнь» за этот срок.
    // Без тега время не угадываем: следующий ответ получит «догоняющую» приписку и покроет этот ход.
    let declaredSkip = tag?.skip != null && tag.skip > 0;
    let hours = tag ? (declaredSkip ? tag.skip : (tag.tp ?? (tag.clock != null ? null : 0))) : 0;
    state.missedTag = tag ? 0 : (state.missedTag || 0) + 1;
    hours = tag ? alignClock(tag.clock, hours) : hours;
    hours = Math.max(0, Math.min(MAX_HOURS, hours || 0));
    // Сутки и больше за один ответ — это скип, даже если ИИ написал tp, а не skip
    if (hours >= 24) declaredSkip = true;
    if (tag?.date) state.rpDate = tag.date;

    const sceneActivity = tag?.activity || 'low';
    const activityOf = {
        user: tag?.userActivity || sceneActivity,
        bot: tag?.botActivity || sceneActivity,
    };
    const activitySource = tag ? 'tag' : 'none';
    const sleeping = !!tag?.sleeping;

    // ── Еда — только из тега ──
    const source = tag ? 'tag' : 'none';
    let userFood = tag ? (tag.userAte.length ? tag.userAte : tag.ate) : [];
    const userDrink = tag ? (tag.userDrank.length ? tag.userDrank : tag.drank) : [];
    let botFood = tag && bot ? tag.botAte : [];
    const botDrink = tag && bot ? tag.botDrank : [];

    // За кадром едят по распорядку. Лёгкий режим: всегда, кроме offscreen=hungry.
    // Хард: только если ИИ отметил offscreen=fed.
    const off = tag?.offscreen;
    const offFed = isHard() ? off === 'fed' : off !== 'hungry' && off !== 'thirsty';
    // Распорядок идёт на любом длинном отрезке — даже если ИИ записал еду: раньше из-за этого
    // «утро → следующее утро с завтраком» теряло обед и ужин и считалось дефицитом.
    // Записанная еда заменяет только последний приём по распорядку (см. advanceTime).
    const fedOf = { user: offFed, bot: offFed };
    const loggedMeal = { user: userFood.length > 0, bot: botFood.length > 0 };
    // Вода за кадром есть всегда, кроме offscreen=thirsty
    const drinkOf = { user: off !== 'thirsty', bot: off !== 'thirsty' };

    const weightBefore = Object.fromEntries(activeChars().map(ch => [ch.who, ch.data.weight]));
    const burnedBefore = Object.fromEntries(activeChars().map(ch => [ch.who, ch.data.burned || 0]));
    const dayBefore = Math.floor((state.clockHours ?? 12) / 24);
    advanceTime(hours, activityOf, sleeping, fedOf, ctx, drinkOf, declaredSkip, loggedMeal);

    const chars = activeChars();
    const byWho = Object.fromEntries(chars.map(c => [c.who, c]));

    // Сытость по оценке ИИ (user_full / bot_full) — только если в этом ходу ели или пили:
    // ИИ часто повторяет цифру по инерции, и раньше из этого «додумывалась» еда.
    // Без записанной еды верим только резкому скачку (наелись, но блюдо не названо).
    const rawFull = { user: tag?.userFull ?? null, bot: bot ? tag?.botFull ?? null : null };
    const foodsFor = { user: userFood, bot: botFood };
    const drankFor = { user: userDrink, bot: botDrink };
    const fullOf = { user: null, bot: null };
    for (const ch of chars) {
        const full = rawFull[ch.who];
        if (full == null) continue;
        const c = ch.data;
        if (foodsFor[ch.who].length || drankFor[ch.who].length) { fullOf[ch.who] = full; continue; }
        if (full >= c.satiety + 20) {
            fullOf[ch.who] = full;
            const kcal = Math.round(Math.min(effectiveGoal(c) * 0.6, (full - c.satiety) / 130 * effectiveGoal(c)));
            foodsFor[ch.who] = [{ item: 'еда', calories: kcal, water: 0, implied: true }];
        }
    }
    userFood = foodsFor.user;
    botFood = foodsFor.bot;

    const mealKcal = { user: consume(byWho.user, userFood, userDrink, ctx), bot: 0 };
    if (byWho.bot) mealKcal.bot = consume(byWho.bot, botFood, botDrink, ctx);

    // ИИ видит сцену лучше формулы: «до отвала» — это до отвала
    for (const ch of chars) {
        const full = fullOf[ch.who];
        if (full != null) ch.data.satiety = Math.max(0, Math.min(100, full));
    }
    // Вес изменился в истории («поправилась знатно», «похудел на 3 кг»)
    const wOf = { user: tag?.userWeight, bot: bot ? tag?.botWeight : null };
    for (const ch of chars) {
        const w = wOf[ch.who];
        if (!w) continue;
        changeWeight(ch.data, w.delta != null ? w.delta : w.abs - ch.data.weight);
    }

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
        const drinks = ch.who === 'user' ? userDrink : botDrink;
        applyTurnEvents(ch.data, {
            sceneSleep: sleeping && hours < 12 ? hours : 0,
            mealKcal: mealKcal[ch.who],
            waterGain: drinks.reduce((a, d) => a + (d.water || 0), 0),
            vomited: vomited[ch.who],
        }, added);
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
    // Что ели или почему не едят — для инфоблока. Скип без записей: ели как обычно, за кадром.
    const whyOf = { user: tag?.userWhy || null, bot: bot ? tag?.botWhy || null : null };
    const drinksFor = { user: userDrink, bot: botDrink };
    for (const ch of chars) {
        let note = makeFoodNote(ch.data, foodsFor[ch.who], drinksFor[ch.who], whyOf[ch.who]);
        if (!note && fedOf[ch.who] && (declaredSkip || hours >= 6)) {
            note = { kind: 'off', text: ch.data.gender === 'female' ? 'Ела как обычно, за кадром' : ch.data.gender === 'male' ? 'Ел как обычно, за кадром' : 'Ели как обычно, за кадром' };
        }
        if (note) ch.data.foodNote = note;
    }
    if (state.calibrate?.pending || state.calibrate?.doneAt === N) {
        state.calibrate = { pending: false, doneAt: N };
    }
    if (tag?.userCare) state.user.careLeft = 12;
    if (bot && tag?.botCare) bot.careLeft = 12;
    if (tag?.userPreg != null) applyPregnancy(state.user, pregWeekFrom(state.user, tag.userPreg));
    if (bot && tag?.botPreg != null) applyPregnancy(bot, pregWeekFrom(bot, tag.botPreg));
    // Тег мог прийти с временем, но без недели — срок всё равно догоняет часы
    for (const ch of chars) advancePregnancy(ch.data);

    // Лечение по ролплею (user_heal=cold:+10) и эффекты, которые прошли в истории (user_clear=)
    const healOf = { user: tag?.userHeal || [], bot: bot ? tag?.botHeal || [] : [] };
    const clearOf = { user: tag?.userClear || [], bot: bot ? tag?.botClear || [] : [] };
    for (const ch of chars) {
        for (const h of healOf[ch.who]) {
            const id = resolveDiseaseId(ch.data, h.name);
            if (!id) continue;
            const r = applyHealDelta(ch.data, id, h.delta, hours);
            if (r === 'cured') { ctx[ch.who].removed.add(id); ctx[ch.who].added.delete(id); }
        }
        for (const raw of clearOf[ch.who]) {
            const id = resolveEffectId(raw);
            if (!id) continue;
            ch.data.buffs = ch.data.buffs.filter(e => e.id !== id);
            ch.data.debuffs = ch.data.debuffs.filter(e => e.id !== id);
            // Не даём эффекту тут же вернуться от тех же показателей
            ch.data.suppress = { ...(ch.data.suppress || {}), [id]: 6 };
            ctx[ch.who].added.delete(id);
        }
    }

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
    // Угаданную по сытости еду на отравление не проверяем — неизвестно, что это было
    const foodsOf = { user: userFood.filter(f => !f.implied), bot: botFood.filter(f => !f.implied) };
    const drinksOf = { user: userDrink, bot: botDrink };
    setEra(isHistorical() ? 'historical' : 'modern');
    for (const ch of chars) {
        const added = [];
        const r = illnessEvents(ch.data, {
            day: dayNumber(), turn: state.turn, foods: foodsOf[ch.who], drinks: drinksOf[ch.who],
            hard: isHard(), skip: declaredSkip || hours >= 12,
        }, added);
        added.forEach(id => ctx[ch.who].added.add(id));
        if (r.vomited) applyVomit(ch.data);
    }

    for (const ch of chars) mergeCond(ctx, ch.who, evaluateConditions(ch.data, 0));

    // ── Уведомления ──
    const uName = getUserName(), bName = getBotName();
    const foodLine = (name, list) => `${name}: ${list.map(f => f.item).join(', ')} (+${sumCal(list)} ккал)`;
    if (userFood.length) queueNotify(foodLine(uName, userFood), 'food', 3500);
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
                const v = effectView(e, ch.data.gender);
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
        updateFocus(ch.data, state.turn, new Set([...t.added, ...t.progressed]), { foodInScene, isUser: ch.who === 'user' });
    }
    // В тосте — и итоговый вес, чтобы было видно, с чем сверять инфоблок
    for (const w of ctx.weight) {
        queueNotify(`${w.name}: вес ${kgDelta(w.change)} кг за день → ${kg2(w.weight)} кг`, 'weight', 4000);
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
    // Калибровка — уточнение, а не прошедшее время: срок ставим как есть, вес не трогаем
    if (p.pregnancyWeek != null && c.gender !== 'male' && (p.pregnancyWeek > 0 || c.pregnant)) {
        if (p.pregnancyWeek !== c.pregnancyWeek) setPregWeekManual(c, p.pregnancyWeek);
    }
    if (c.gender === 'male') { c.pregnant = false; c.pregnancyWeek = 0; c.pregBase = null; }
    if (c.manualGoal == null) recalcGoal(c);
}

function applyStateCalib(c, st) {
    const g = effectiveGoal(c);
    // Чат начался посреди дня: прошедшие приёмы пищи считаем состоявшимися
    const h = hourOf(state.clockHours ?? 12);
    for (const s of MEAL_SLOTS) if (h >= s.to) mealsOf(c).done[s.id] = true;
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
        pregGain: +(c.pregMassApplied || 0).toFixed(2),
        fatLedger: +(c.fatLedger || 0).toFixed(3),
        foodNote: c.foodNote || null,
        now: state.clockHours,
        immunity: calculateImmunity(c),
        bac: +(c.bac || 0).toFixed(2),
        ed: edList(c),
        effects: [...c.debuffs, ...c.buffs].map(e => ({ id: e.id, ...effectView(e, c.gender), fading: !!e.fading, fadeLeft: e.fadeLeft })),
        diseases: c.diseases.map(d => ({
            id: d.id, name: d.name, severity: d.severity, recovering: !!d.recovering,
            category: DISEASE_DB[d.id]?.category || 'physical',
            since: d.since, effects: d.effects || [],
            progress: r0(d.progress || 0),
        })),
    };
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
    // Одна строка тела: пол, возраст, рост, вес — ИИ всегда знает, какие персонажи
    const g = c.gender === 'male' ? 'm' : c.gender === 'female' ? 'f' : '?';
    const body = `${g}, ${c.age}y, ${c.height}cm, ${(+c.weight).toFixed(1)}kg${c.pregnant && c.pregnancyWeek ? `, pregnant wk ${c.pregnancyWeek}` : ''}`;
    const meal = c.hoursSinceLastMeal >= 1 ? `last meal ${Math.round(c.hoursSinceLastMeal)}h ago` : 'just ate';
    const lines = [
        `${name}${isUser ? ' (player)' : ''}: ${body} · ${levelWord(c.satiety, 'satiety')}, ${levelWord(c.water, 'water')}, ${levelWord(c.energy, 'energy')}, ${levelWord(c.health, 'health')} · ${meal} · ${r0(c.calories)}/${effectiveGoal(c)} kcal today`,
    ];
    const cond = buildConditionPrompt(c, name, { isUser });
    if (cond) lines.push(cond);
    const effIds = [...c.debuffs, ...c.buffs].map(e => e.id);
    if (effIds.length) lines.push(`  Effect ids: ${effIds.join(', ')}`);
    const cap = getActionCapacity(c);
    if (cap) lines.push(`  Capacity: ${cap}`);
    const meals = mealPromptLine(c, name, isUser);
    if (meals) lines.push(meals);
    return lines.join('\n');
}

const pron = (c) => (c.gender === 'female' ? 'she' : c.gender === 'male' ? 'he' : 'they');

/**
 * Завтрак, обед, ужин: что уже было и не пора ли есть. Бот ест сам, без подсказок игрока,
 * если нет веской причины; за игрока решает игрок — бот может только заметить или предложить.
 */
function mealPromptLine(c, name, isUser) {
    const h = hourOf(state.clockHours ?? 12);
    if (h < 7 || isNight(h)) return null;
    const m = mealsOf(c);
    const status = MEAL_SLOTS.filter(s => h >= s.from)
        .map(s => `${s.en} ${m.done[s.id] ? '✓' : h >= s.to ? 'skipped' : 'not yet'}`).join(', ');
    const cur = MEAL_SLOTS.find(s => h >= s.dueFrom && h < s.to);
    let nudge = '';
    if (cur && !m.done[cur.id] && c.satiety < 85) {
        nudge = isUser
            ? ` It's ${cur.en} time — ${getBotName()} can notice, offer or bring food; whether ${name} eats is the player's call.`
            : ` It's ${cur.en} time: ${pron(c)} eats at a natural moment in this scene (a proper meal, or something on the go) unless there's a real reason — nausea, work, mood, no food; then that reason goes in bot_why.`;
    }
    return `  Meals today: ${status}.${nudge}`;
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

    const head = ['[Physiology — hidden background state; context for the story, not its topic]'];
    if (state.rpDate) head.push(`Date: ${state.rpDate}.`);
    const hh = hourOf(state.clockHours ?? 12);
    head.push(`Now ${String(Math.floor(hh)).padStart(2, '0')}:${String(Math.round((hh % 1) * 60) % 60).padStart(2, '0')}.`);
    if (isHistorical()) head.push('Pre-modern era: no modern medicine — herbs, rest and warmth are the cure; bad water and spoiled food are real dangers; sickness lasts longer.');

    // Правила — только нужные в этом ходу
    const botName = getBotName();
    const rules = [];
    if (anySurface) {
        rules.push('Everything under "Surface now" MUST show in this reply: one brief concrete detail each, woven into action — not the first or last line.');
    }
    rules.push(`Bodies drive behaviour. Every listed state — hunger, thirst, tiredness, active effects good or bad — quietly shapes how they act: pace, posture, patience, what they reach for. ${botName} looks after ${b ? (b.gender === 'female' ? 'her' : b.gender === 'male' ? 'his' : 'their') : 'their'} own body unprompted: thirsty → drinks, mealtime → eats, drained → sits or rests.`);
    rules.push('Show needs through action, not talk: a need or effect is said aloud at most once, then only acted on; never reuse an image or phrase from recent replies. Weakness limits what bodies can do.');
    rules.push(`${userName} is the player's character: no lines, thoughts, feelings or decisions for them — only their body and visible state (pallor, a growling stomach, trembling, heavy eyelids), or the world around them: ${botName} noticing, offering, the needed food or drink turning up.`);
    if ([u, b].some(c => c && c.diseases.some(d => DISEASE_DB[d.id]?.category === 'mental'))) {
        rules.push('Mental states show through behaviour and dialogue, never as a narrated diagnosis.');
    }
    if (anyEd) rules.push(ED_GUIDANCE);

    return `${head.join(' ')}
${blocks.join('\n')}
${rules.join(' ')}`;
}

// ─── 2. Правило тега (конец промпта) ───
// Вопросы по порядку: модель отвечает на каждый, прежде чем писать тег
function pregQuestion(c, name, prefix) {
    if (!c || c.gender === 'male') return null;
    if (c.pregnant && c.pregnancyWeek > 0) {
        const tri = getPregnancyStage(c.pregnancyWeek).trimester;
        return `${name} is pregnant, week ${c.pregnancyWeek} (trimester ${tri}) — it advances by itself; write ${prefix}_preg=WEEK only if the story states a later week, ${prefix}_preg=0 on birth or loss.`;
    }
    return `${name} is not pregnant — if the story reveals a pregnancy: ${prefix}_preg=WEEK (or 3m, T2).`;
}

function tagFieldRules(userName, botName) {
    const u = state.user, b = getBotState();
    const preg = [pregQuestion(u, userName, 'user'), pregQuestion(b, botName, 'bot')].filter(Boolean);
    let n = 0;
    const q = (text) => `${++n}. ${text}`;
    return [
        q(`TIME — Did the story jump ahead ("two months later", *skip a week*, OOC)? → skip=DURATION; off-screen meals and sleep are automatic. Otherwise tp = in-world hours since your last reply (a few lines 0.2, a night 8). time = clock now.`),
        q(`ACTIVITY — low (rest, talk) | medium (walk, chores) | high (run, fight, labour); different per person → user_/bot_activity.`),
        q(`EATING — Look only at ${userName}'s latest message and your reply. EVERY eating in them is logged as a new portion — even the same dish as before ("another slice", "keeps eating", "finishes the stew"). The same bite shown in both messages → once. No eating in these two messages → no food. Format FOOD (HOW):KCAL. HOW = a short phrase in the roleplay's language showing how much and how, e.g. "всю миску, жадно", "пару ложек через силу", "половину, не спеша" — never a bare "normally". KCAL realistic for that amount with fat, bread, sauce: bread slice 90, porridge with butter 350, pie slice 350, soup with bread 450, stew 700, feast plate 1000+. Ate but no dish named ("after dinner") → still log it: user_ate=ужин (всю тарелку):600. _full = fullness now 0–100, only for someone who ate or drank.`),
        q(`DRINKING — Same two messages, same rule: every drink is a new portion, even water, tea at the table or a sip. DRINK (HOW):ML:KCAL — sip 30, cup 250, mug 350, pint 500; HOW like "пару глотков", "полкружки залпом"; KCAL only if caloric. Drinks never go in _ate.`),
        q(`NOT EATING — Anyone who didn't eat this reply → _why = what keeps them from it right now, 3–8 words in the roleplay's language: "ещё не ела — разбирает счета", "сыт после обеда", "мутит с утра".`),
        preg.length ? q(`PREGNANCY — ${preg.join(' ')}`) : null,
        q(`ONLY IF TRUE: sleeping=true · _vomited=true · _care=true (being treated) · _heal=ID:+N for listed diseases (+5…+15 on treatment or recovery, −N on a setback) · _clear=EFFECT_ID when an effect clearly passed in the story · _weight=+2 / -3 / 62 when the story states it.`),
        isHard()
            ? `SURVIVAL: on a skip add offscreen=fed only if they had food, else hungry (thirsty = no water). Never invent meals.`
            : `On a skip they eat, drink and sleep normally unless the story says otherwise (offscreen=hungry / thirsty).`,
        `date = in-world date. feel = 3–8 words, body and mind.`,
    ].filter(Boolean).join('\n');
}

function calibrationRules(userName, botName) {
    return `Also add: user_profile=GENDER/AGE/HEIGHT_CM/WEIGHT_KG/BUILD/LIFESTYLE/ED/PREG_WEEK | bot_profile=… | user_state=SATIETY/WATER/ENERGY | bot_state=…
Use ${botName}'s character card, ${userName}'s persona description and the story so far; give your best estimate for anything not stated.
GENDER m or f · BUILD slim|average|athletic|muscular|heavy · LIFESTYLE sedentary|light|moderate|active|very_active · ED none, or anorexia|bulimia|binge with :mild|:moderate|:severe, only if clearly established · PREG_WEEK the pregnancy week, 0 if not pregnant · SATIETY, WATER, ENERGY 0–100, how they are right now.
Example shape: user_profile=f/24/165/57/slim/light/none/0 | bot_profile=m/30/185/82/muscular/active/none/0 | user_state=70/60/80 | bot_state=85/70/65`;
}

const TAG_TEMPLATE = '<!-- NN time=HH:MM | tp=HOURS | activity=LEVEL | user_ate=FOOD (HOW):KCAL | user_drank=DRINK (HOW):ML:KCAL | user_full=0-100 | user_why=REASON | bot_ate=FOOD (HOW):KCAL | bot_drank=DRINK (HOW):ML:KCAL | bot_full=0-100 | bot_why=REASON | date=DATE | user_feel=FEEL | bot_feel=FEEL -->';

function buildTagPrompt() {
    if (!state) return '';
    const userName = getUserName(), botName = getBotName();
    return `[Nutrition tag — required]
End every reply with one hidden comment on its own last line:
${TAG_TEMPLATE}
CAPITALS = fill from the scene, copy nothing. Values in the roleplay's language. Omit fields that don't apply. _x = user_x / bot_x.
Check each question silently, then write the tag — never answer them in the reply:
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
// ─── Очистка контекста: старые теги не отправляем ───
// Все данные уже сохранены (в сообщении и в данных чата), модели нужны лишь
// последние несколько тегов — как образец формата. Сам чат не трогаем.
const KEEP_TAGS_IN_PROMPT = 3;
const NN_COMMENT_RE = /\s*<!--\s*NN\b[\s\S]*?-->/gi;

function stripOldTagsFromMessages(list) {
    let kept = 0;
    for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        if (!m || typeof m.content !== 'string' || !/<!--\s*NN\b/i.test(m.content)) continue;
        if (kept < KEEP_TAGS_IN_PROMPT) { kept++; continue; }
        m.content = m.content.replace(NN_COMMENT_RE, '').replace(/\s+$/, '');
    }
}

// Текстовые API: промпт одной строкой
function onAfterCombinePrompts(data) {
    if (!isEnabled() || !data || typeof data.prompt !== 'string') return;
    const all = [...data.prompt.matchAll(NN_COMMENT_RE)];
    if (all.length <= KEEP_TAGS_IN_PROMPT) return;
    const cut = new Set(all.slice(0, all.length - KEEP_TAGS_IN_PROMPT).map(m => m.index));
    data.prompt = data.prompt.replace(NN_COMMENT_RE, (match, offset) => (cut.has(offset) ? '' : match));
}

function onPromptReady(eventData) {
    if (!isEnabled() || !state || !eventData) return;
    const list = eventData.chat;
    if (!Array.isArray(list)) return;
    stripOldTagsFromMessages(list);
    if (eventData.dryRun) return;
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
    who: 'user',
    pregEdit: { user: false, bot: false },  // открыт ли карандаш для срока беременности
};

const TABS = [
    { id: 'overview', icon: 'fa-chart-simple', label: 'Обзор' },
    { id: 'log', icon: 'fa-receipt', label: 'Журнал' },
    { id: 'weight', icon: 'fa-weight-scale', label: 'Вес', live: true },
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

    block.innerHTML = headHtml(snap, open) + (open ? bodyHtml(snap, live, tab) : '');
}

// ─── Хелперы ──────────────────────────────────────────────────
// Старые снимки хранили баффы/дебаффы отдельно — приводим к единому списку
function effectsOf(v) {
    if (v.effects) return v.effects;
    return [...(v.debuffs || []), ...(v.buffs || [])].map(e => ({ id: e.id, ...effectView(e, v.gender), fading: !!e.fading, fadeLeft: e.fadeLeft ?? e.hoursLeft }));
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
const kg = (w) => (Math.round((w || 0) * 10) / 10).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const kg2 = (w) => (Math.round((w || 0) * 100) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function kgDelta(d, digits = 2) {
    if (Math.abs(d) < 0.005) return '±0';
    return (d > 0 ? '+' : '−') + Math.abs(d).toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// ─── Аватар в кольце: дуги сытости и воды; энергия и здоровье — только когда на них что-то влияет ──
const RING_PARTS = [['satiety', 'Сытость'], ['water', 'Вода'], ['energy', 'Энергия'], ['health', 'Здоровье']];
const ENERGY_EFFECTS = ['exhaustion', 'drowsiness', 'sleep_deprived', 'hangover', 'caffeine_jitters'];
function showEnergy(v) {
    return v.energy < 60 || physicalOf(v).length > 0 || effectsOf(v).some(e => ENERGY_EFFECTS.includes(e.id));
}
function showHealth(v) {
    return v.health < 95 || physicalOf(v).length > 0;
}
function ringParts(v) {
    return RING_PARTS.filter(([k]) => (k === 'energy' ? showEnergy(v) : k === 'health' ? showHealth(v) : true));
}

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
    const parts = ringParts(v);
    const seg = 360 / parts.length;
    const gapDeg = 14;
    const L = (seg - gapDeg) / 360 * C;
    const c = size / 2;
    let arcs = '';
    parts.forEach(([k], i) => {
        const rot = -90 + i * seg + gapDeg / 2;
        const f = Math.max(0.001, L * pct(v[k]) / 100);
        const tr = `transform="rotate(${rot} ${c} ${c})"`;
        arcs += `<circle class="nn-ring-track" cx="${c}" cy="${c}" r="${r}" stroke-width="${sw}" stroke-dasharray="${L} ${C}" ${tr}/>`;
        arcs += `<circle class="nn-ring-fill nn-${lvl(v[k])}" cx="${c}" cy="${c}" r="${r}" stroke-width="${sw}" stroke-dasharray="${f} ${C}" ${tr}/>`;
    });
    const title = parts.map(([k, l]) => `${l} ${pct(v[k])}%`).join(' · ');
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
        case 'params': pane = paramsPane(); break;
        default: pane = overviewPane(snap, live);
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
    const time = d.since ? `уже ${d.since}` : '';
    const prog = d.progress || 0;
    const bar = `<div class="nn-heal" title="Прогресс лечения"><span class="nn-heal-label">${d.recovering || prog > 0 ? 'Лечение' : 'Без улучшений'}</span>
        <span class="nn-bar"><span style="width:${prog}%"></span></span><b>${prog}%</b></div>`;
    const mind = d.category === 'mental';
    return `<div class="nn-cond nn-sev-${d.severity}${mind ? ' nn-cond-mind' : ''}">
        <i class="fa-solid ${mind ? 'fa-brain' : 'fa-virus'}"></i>
        <div class="nn-cond-main">
            <div class="nn-cond-title">${esc(d.name)} <span class="nn-sev">${SEV_LABEL[d.severity] || ''}</span></div>
            <div class="nn-cond-sub">${esc((d.effects || []).join(', '))}${time ? `. ${esc(time)}` : ''}</div>
            ${bar}
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

const NOTE_ICON = { ate: 'fa-utensils', why: 'fa-comment-dots', off: 'fa-forward' };

function pregnancyNote(v, who, live) {
    if (!v.pregnant || v.gender === 'male') return '';
    const st = getPregnancyStage(v.pregnancyWeek);
    const gain = v.pregGain >= 0.05 ? ` · набрано ${kgDelta(v.pregGain, 1)} кг` : '';
    if (live && ui.pregEdit[who]) {
        return `<div class="nn-note nn-preg-edit"><i class="fa-solid fa-person-pregnant"></i>
            <label>Неделя <input class="text_pole nn-num" type="number" min="0" max="42" data-preg-week="${who}" value="${v.pregnancyWeek || 0}"></label>
            <button class="nn-icon-btn" data-act="preg-save" data-who="${who}" title="Сохранить"><i class="fa-solid fa-check"></i></button>
            <button class="nn-icon-btn" data-act="preg-edit" data-who="${who}" title="Отмена"><i class="fa-solid fa-xmark"></i></button>
            <span class="nn-mute nn-preg-hint">0 — не беременна. Дальше срок снова пойдёт сам.</span>
        </div>`;
    }
    const pencil = live ? `<button class="nn-icon-btn nn-preg-pencil" data-act="preg-edit" data-who="${who}" title="Поправить срок"><i class="fa-solid fa-pencil"></i></button>` : '';
    return `<div class="nn-note"><i class="fa-solid fa-person-pregnant"></i><span class="nn-note-text">${esc(st.label)}, неделя ${v.pregnancyWeek || '—'}${gain}</span>${pencil}</div>`;
}

function personCard(v, who, live = false) {
    const open = ui.cardOpen[who];
    const [stText, stIcon, stLvl] = statusOf(v);
    const g = v.gender === 'male' ? 'fa-mars' : v.gender === 'female' ? 'fa-venus' : 'fa-genderless';
    const kPct = v.goal ? Math.round(v.calories / v.goal * 100) : 0;
    const kLvl = kPct > 130 ? 'over' : kPct < 30 ? 'bad' : kPct < 60 ? 'warn' : 'good';
    // Заметка о еде из прошлых ходов — помечаем, что это было раньше, а не сейчас
    const fn = v.foodNote;
    const stale = fn?.kind === 'ate' && fn.clock != null && v.now != null && v.now - fn.clock >= 1;
    const note = fn?.text
        ? `<div class="nn-kcal-meta nn-food-note"><i class="fa-solid ${NOTE_ICON[fn.kind] || 'fa-utensils'}"></i><span>${stale ? 'Последнее — ' : ''}${esc(stale ? fn.text[0].toLowerCase() + fn.text.slice(1) : fn.text)}</span></div>`
        : '';
    const preg = pregnancyNote(v, who, live);
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
                ${note}
            </div>
            <div class="nn-rows">
                ${statRow('fa-utensils', 'Сытость', v.satiety)}
                ${statRow('fa-droplet', 'Вода', v.water)}
                ${showEnergy(v) ? statRow('fa-bolt', 'Энергия', v.energy) : ''}
                ${showHealth(v) ? statRow('fa-heart-pulse', 'Здоровье', v.health) : ''}
            </div>
            ${preg}
            ${stateSection(v, who)}
        </div>` : ''}
    </section>`;
}

function overviewPane(snap, live) {
    return `<div class="nn-cards">${personCard(snap.user, 'user', live)}${snap.bot ? personCard(snap.bot, 'bot', live) : ''}</div>`;
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
        const prev = entries[entries.length - 1];
        const ledger = c.fatLedger || 0;
        // Баланс дня ещё не в весе: он спишется в полночь (потеря — только если день закончится голодным)
        const pending = Math.abs(ledger) >= 0.02
            ? `<div class="nn-kcal-meta">Баланс дня: ${kgDelta(ledger)} кг — учтётся в полночь${ledger < 0 ? ', если ляжет спать голодным' : ''}</div>` : '';
        return `<section class="nn-card">
            <header class="nn-card-head nn-card-head-static">${avatarHtml(who, 'nn-av-lg')}<div class="nn-card-id"><div class="nn-card-name">${esc(who === 'user' ? getUserName() : c.name)}</div></div>
                <span class="nn-status"><i class="fa-solid ${trend[0]}"></i><span>${trend[1]}</span></span></header>
            <div class="nn-kcal-num"><b>${kg2(c.weight)}</b><span>кг, сегодня ${kgDelta(today)}${prev ? ` · прошлый день ${kgDelta(prev.change)}` : ''}</span></div>
            ${pending}
            <div class="nn-kcal-meta">ИМТ ${bmi.toFixed(1)} — <span class="nn-${bl}-text">${bmiLabel}</span></div>
        </section>`;
    };
    const rows = [...state.weightHistory].reverse().slice(0, 30).map(e => {
        const ch = Math.abs(e.change) < 0.005 ? '<span class="nn-mute">±0</span>'
            : `<span class="${e.change > 0 ? 'nn-warn-text' : 'nn-good-text'}">${kgDelta(e.change)}</span>`;
        return `<tr><td>${e.day}</td><td>${esc(e.name)}</td><td>${kg2(e.weight)}</td><td>${ch}</td><td>${e.calories}${e.burned != null ? ` / −${e.burned}` : ''}</td><td class="nn-mute">${esc(e.reason || '')}</td></tr>`;
    }).join('');
    return `<div class="nn-cards">${card(state.user, 'user')}${card(getBotState(), 'bot')}</div>
        ${rows ? `<div class="nn-table-wrap"><table class="nn-table">
            <thead><tr><th>День</th><th>Кто</th><th>Вес</th><th>За день</th><th>Ккал</th><th>Итог</th></tr></thead>
            <tbody>${rows}</tbody></table></div>` : ''}`;
}

// ─── Переключатель «кто» (для параметров) ──────────────────────
function whoSwitch() {
    const b = getBotState();
    return `<div class="nn-seg" role="group">
        <button class="${ui.who === 'user' ? 'nn-on' : ''}" data-act="who" data-who="user">${esc(getUserName())}</button>
        <button class="${ui.who === 'bot' ? 'nn-on' : ''}" data-act="who" data-who="bot" ${b ? '' : 'disabled'}>${esc(getBotName())}</button>
    </div>`;
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
        ${data.gender !== 'male' ? `<label>Беременность, неделя<input class="text_pole" type="number" data-field="pregnancyWeek" min="0" max="42" value="${data.pregnant ? data.pregnancyWeek : 0}" title="0 — не беременна"></label>` : ''}
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
    } else if (f === 'pregnancyWeek') {
        const v = parseInt(el.value);
        if (isNaN(v) || v < 0 || v > 42) return;
        setPregWeekManual(data, v);
    } else {
        let v = el.value;
        if (['age', 'height'].includes(f)) { v = parseInt(v); if (isNaN(v)) return; }
        if (f === 'weight') {
            v = parseFloat(v);
            if (isNaN(v)) return;
            shiftWeight(data, v - data.weight);
        }
        data[f] = v;
        if (f === 'gender' && v === 'male') setPregWeekManual(data, 0);
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

function savePregWeek(block, who) {
    const data = who === 'bot' ? getBotState() : state.user;
    const input = block.querySelector(`[data-preg-week="${who}"]`);
    const v = parseInt(input?.value);
    if (!data || isNaN(v) || v < 0 || v > 42) { notify('Неделя — число от 0 до 42', 'warning', 2500, true); return; }
    setPregWeekManual(data, v);
    ui.pregEdit[who] = false;
    saveState();
    injectPrompt();
    notify(v ? `Срок: ${v} неделя` : 'Беременность снята', 'success', 2500, true);
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
            case 'who': ui.who = t.dataset.who; break;
            case 'preg-edit': ui.pregEdit[t.dataset.who] = !ui.pregEdit[t.dataset.who]; break;
            case 'preg-save': savePregWeek(block, t.dataset.who); break;
            case 'card': ui.cardOpen[t.dataset.who] = !ui.cardOpen[t.dataset.who]; break;
            case 'state': ui.stateOpen[t.dataset.who] = !ui.stateOpen[t.dataset.who]; break;
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
        if (e.key === 'Enter' && e.target.matches('[data-preg-week]')) {
            e.preventDefault();
            savePregWeek(block, e.target.dataset.pregWeek);
            renderBlock(idOf());
            return;
        }
        if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.nn-head, .nn-card-head[data-act]')) {
            e.preventDefault();
            e.target.click();
        }
    });

    block.addEventListener('change', (e) => {
        const el = e.target;
        e.stopPropagation();
        if (el.dataset.field) {
            onParamChange(el);
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
    ['effect:craving', 'Эффект: тяга к еде (беременность)'],
    ['effect:morning_sickness', 'Эффект: утренняя тошнота'],
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
            elapsedHours: 0, progress: 0, recovering: false, since: '0ч',
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
        grantEffect(data, id, id === 'rested' ? 10 : id === 'hangover' ? 8 : 4, [], id === 'craving' ? 'квашеная капуста' : null);
        if (id === 'craving') { const e = data.debuffs.find(x => x.id === 'craving'); if (e) e.detailEn = 'sauerkraut'; }
    } else if (id === 'overfed') {
        data.recentIntake = g * 0.8; data.satiety = 100;
    } else {
        Object.assign(data, DEBUG_STATS[id] || {});
        if (id === 'perfect') data.reserve = g * 0.8;
    }
    evaluateConditions(data, 0);
    updateFocus(data, state.turn, new Set([...data.diseases.map(d => d.id), ...data.debuffs.map(d => d.id)]), { foodInScene: true, isUser: who === 'user' });
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
                <p class="nn-hint">В старых ответах блок показывает состояние на тот момент. В последнем доступны вкладки «Вес» и «Параметры». Еду и питьё расширение считает само по ролплею.</p>

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
                    hoursSinceLastMeal: 2, reserve: effectiveGoal(data) * 0.6, recentIntake: 0, daysWithDeficit: 0, fatLedger: 0,
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
    on(event_types.GENERATE_AFTER_COMBINE_PROMPTS, onAfterCombinePrompts);
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
