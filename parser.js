// nell-nutrition/parser.js
// Разбор скрытого тега <!-- NN ... --> из ответа ИИ.
// Калории еды и напитков определяет сам ИИ — базы продуктов нет.

import { normalizeActivity } from './nutrition-engine.js';
import { drinkExtras } from './effects.js';

export function norm(s) {
    return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

function tokens(name) {
    return norm(name).split(/[^\p{L}]+/u).filter(t => t.length >= 2);
}

// ═══════════════════════════════════════════════════════════════
// РАЗБОР ПОЗИЦИИ: «борщ:450», «брага:500:350», «вода:300мл», «пирог (400 ккал)»
// ═══════════════════════════════════════════════════════════════
const AMOUNT_RE = /(\d+(?:[.,]\d+)?)\s*(ккал|kcal|калори\p{L}*|кал|cal|к|граммов|грамма|грамм|гр|г|g|gr|миллилитр\p{L}*|мл|ml|литр\p{L}*|л|l|%)?(?![\p{L}])/giu;

function unitKind(u) {
    const x = (u || '').toLowerCase();
    if (!x) return 'none';
    if (/^(ккал|kcal|калори|кал|cal|к)/.test(x)) return 'kcal';
    if (/^(г|g|гр|gr|грам)/.test(x)) return 'g';
    if (/^(мл|ml|миллилитр)/.test(x)) return 'ml';
    if (/^(л|l|литр)/.test(x)) return 'l';
    if (x === '%') return 'pct';
    return 'none';
}

function splitEntry(entry) {
    const raw = entry.trim();
    const amounts = { kcal: null, g: null, ml: null, pct: null, bares: [] };
    const firstNum = raw.search(/[:=(]\s*\d|\s\d+(?:[.,]\d+)?\s*(?:ккал|kcal|кал|cal|к|гр?|g|gr|мл|ml|л|l|%)?\s*\)?\s*(?:[:=(]|$)/iu);
    let name = firstNum > 0 ? raw.slice(0, firstNum) : raw;
    const rest = firstNum > 0 ? raw.slice(firstNum) : '';
    name = name.replace(/[:=(\s-]+$/, '').trim();

    let m;
    AMOUNT_RE.lastIndex = 0;
    while ((m = AMOUNT_RE.exec(rest)) !== null) {
        const v = parseFloat(m[1].replace(',', '.'));
        if (isNaN(v)) continue;
        const kind = unitKind(m[2]);
        if (kind === 'l') { if (amounts.ml == null) amounts.ml = v * 1000; }
        else if (kind === 'none') amounts.bares.push(v);
        else if (amounts[kind] == null) amounts[kind] = v;
    }
    return { name: name || raw, amounts };
}

function isEmptyValue(v) {
    const x = norm(v);
    return !x || /^(none|null|нет|ничего|-|—|n\/a|0)$/.test(x);
}

// Свежие овощи/фрукты (для цинги) и сомнительная еда (для отравлений) — по названию
const PRODUCE_RE = /(яблок|груш|банан|апельсин|мандарин|виноград|ягод|малин|черник|клубник|брусник|клюкв|вишн|слив|персик|абрикос|арбуз|дын|лимон|фрукт|овощ|салат|капуст|морков|огур|помидор|томат|свекл|свёкл|реп|редис|лук|чеснок|зелен|черемш|щавел|крапив|шиповник|борщ|щи|квашен|сок|морс|apple|pear|berr|fruit|vegetab|salad|orange|lemon|cabbage|carrot|onion|tomato|greens)/i;
const RISKY_RE = /(сыр(ой|ая|ое|ые|ую)|недожар|недовар|тухл|испорч|просроч|подгнил|плесен|вчерашн|лежал|улитк|лягуш|гриб|дичь|голуб|белк|кабан|падал|raw|spoiled|rotten|mould|mold|mushroom|undercooked|stale)/i;
// Сырая вода из природных источников
const RISKY_WATER_RE = /(руч|рек|речн|колод|пруд|озер|озёр|луж|болот|родник|ключ|талая|снег|сыр(ая|ой) вод|некипяч|stream|river|creek|pond|lake|puddle|well|swamp|raw water|unboiled)/i;
// Жидкие блюда немного поят
const SOUP_RE = /(суп|борщ|щи|уха|бульон|похл[её]б|окрошк|солянк|рассольн|кисел|soup|broth|stew|chowder)/i;

export function foodFlags(name) {
    const n = String(name || '');
    return { produce: PRODUCE_RE.test(n), risky: RISKY_RE.test(n) };
}

const DEFAULT_MEAL_KCAL = 400;   // если ИИ всё-таки не поставил число

function parseFoodEntry(entry) {
    const { name, amounts } = splitEntry(entry);
    // Калории — от ИИ: «ккал» или первое число без единиц
    let kcal = amounts.kcal ?? amounts.bares[0] ?? null;
    // «хлеб:2» — это количество, а не калории
    if (kcal != null && kcal > 0 && kcal < 15) kcal = null;
    const estimated = kcal == null;
    if (kcal == null) kcal = DEFAULT_MEAL_KCAL;
    return {
        item: name,
        ...foodFlags(name),
        calories: Math.max(0, Math.min(4000, Math.round(kcal))),
        water: SOUP_RE.test(name) ? 15 : 0,
        estimated,
    };
}

// Сколько поит напиток: вода и обычное питьё ≈ 10% на 100 мл, хмельное — мало, крепкое — ничего
function waterPer100(name) {
    const a = drinkExtras(name, 100).alcoholG;
    if (a >= 10) return 0;
    if (a > 1) return 2;
    return 10;
}

function parseDrinkEntry(entry) {
    const { name, amounts } = splitEntry(entry);
    // «брага:500:350» — объём, потом калории; «вода:300мл»
    let ml = amounts.ml ?? amounts.g ?? null;
    let kcal = amounts.kcal;
    const bares = [...amounts.bares];
    if (ml == null && bares.length) ml = bares.shift();
    if (kcal == null && bares.length) kcal = bares.shift();
    if (ml == null) ml = 250;
    const extras = drinkExtras(name, ml);
    const water = amounts.pct ?? waterPer100(name) * ml / 100;
    return {
        item: name,
        ml: Math.round(ml),
        produce: foodFlags(name).produce,
        risky: RISKY_WATER_RE.test(name),
        alcoholG: extras.alcoholG,
        caffeineMg: extras.caffeineMg,
        water: Math.max(0, Math.min(80, Math.round(water))),
        calories: Math.max(0, Math.min(2000, Math.round(kcal ?? 0))),
    };
}

/** Для ручного кормления из инфоблока — те же правила, что и для тега */
export const parseFoodItem = (entry) => parseFoodEntry(entry);
export const parseDrinkItem = (entry) => parseDrinkEntry(entry);

function parseList(raw, parser) {
    if (isEmptyValue(raw)) return [];
    return raw.split(/[,;]+(?![^(]*\))/)
        .map(s => s.trim())
        .filter(s => s && !isEmptyValue(s))
        .map(parser)
        .filter(x => x.item);
}

// ═══════════════════════════════════════════════════════════════
// ТЕГ <!-- NN tp=1 | activity=normal | user_ate=... | bot_drank=... -->
// ═══════════════════════════════════════════════════════════════
const TAG_RES = [
    /<!--\s*NN\b[\s:]*([\s\S]*?)-->/gi,
    /\[\s*NN\b[\s:]+([^\]\n]*)\]/gi,
];
const KNOWN_KEYS = ['tp', 'date', 'time', 'user_preg', 'bot_preg', 'user_full', 'bot_full', 'user_weight', 'bot_weight', 'activity', 'user_activity', 'bot_activity', 'sleeping',
    'user_feel', 'bot_feel', 'user_profile', 'bot_profile', 'user_state', 'bot_state', 'sleep', 'offscreen', 'ate', 'drank',
    'user_ate', 'bot_ate', 'user_drank', 'bot_drank', 'vomited', 'user_vomited', 'bot_vomited', 'user_care', 'bot_care'];

/**
 * Содержимое тега из текста. loose=true — для ответа фонового запроса:
 * модели заворачивают тег в ```, теряют «-->» или пишут голое «NN: …».
 */
export function findNnInner(text, { loose = false } = {}) {
    const strict = findTagInner(text);
    if (strict != null || !loose) return strict;
    const cleaned = String(text ?? '').replace(/```[a-z]*|```/gi, '');
    const open = cleaned.match(/<!--\s*NN\b[\s:]*([\s\S]*?)(?:-->|$)/i);
    if (open && open[1].trim()) return open[1];
    const bare = cleaned.match(/^\s*NN\b[\s:]+(.+)$/im);
    if (bare && bare[1].trim()) return bare[1];
    return null;
}

function findTagInner(text) {
    for (const re of TAG_RES) {
        re.lastIndex = 0;
        let m, last = null;
        while ((m = re.exec(text)) !== null) last = m[1];
        if (last != null) return last;
    }
    return null;
}

function splitFields(inner) {
    let parts = inner.split('|');
    if (parts.length === 1) {
        const keyRe = new RegExp(`\\s*[;,]?\\s+(?=(?:${KNOWN_KEYS.join('|')})\\s*[=:])`, 'i');
        parts = (' ' + inner).split(keyRe);
    }
    const out = {};
    for (const p of parts) {
        const m = p.match(/^\s*([a-z_]+)\s*[=:]\s*([\s\S]*?)\s*$/i);
        if (m) out[m[1].toLowerCase()] = m[2];
    }
    return out;
}

function parseHours(v) {
    const m = String(v || '').match(/([\d.,]+)\s*(m|min|мин|h|ч|d|д)?/i);
    if (!m) return null;
    let n = parseFloat(m[1].replace(',', '.'));
    if (isNaN(n) || n < 0) return null;
    const u = (m[2] || '').toLowerCase();
    if (u === 'm' || u === 'min' || u === 'мин') n /= 60;
    if (u === 'd' || u === 'д') n *= 24;
    return Math.min(n, 720);
}

/**
 * @returns {Object|null}
 */
export function parseNnTag(text) {
    if (!text) return null;
    const inner = findTagInner(text);
    if (inner == null) return null;
    return parseNnInner(inner);
}

/** Разбор уже извлечённого содержимого тега (из текста или из message.extra) */
export function parseNnInner(inner) {
    if (inner == null) return null;
    const f = splitFields(inner);

    const result = {
        inner: String(inner),
        tp: f.tp != null ? parseHours(f.tp) : null,
        activity: null,
        userActivity: null,
        botActivity: null,
        sleeping: false,
        offscreen: null,
        userVomited: false,
        botVomited: false,
        date: null,
        clock: null,            // время суток из ролплея, часы (14.5 = 14:30)
        userPreg: null, botPreg: null,   // неделя беременности (0 = не беременна)
        userFull: null, botFull: null,   // сытость 0–100 по оценке ИИ
        userWeight: null, botWeight: null, // { delta } или { abs } — вес изменился в истории
        userFeel: null, botFeel: null,
        userProfile: null, botProfile: null,
        userState: null, botState: null,
        ate: [], drank: [],
        userAte: [], botAte: [],
        userDrank: [], botDrank: [],
    };

    result.activity = normalizeActivity(f.activity);
    result.userActivity = normalizeActivity(f.user_activity);
    result.botActivity = normalizeActivity(f.bot_activity);

    const sl = norm(f.sleeping ?? f.sleep ?? '');
    if (/^(true|yes|1|да)$/.test(sl)) result.sleeping = true;

    const clean = (v, max = 120) => {
        const x = String(v || '').replace(/\s+/g, ' ').trim();
        return x && !isEmptyValue(x) ? x.slice(0, max) : null;
    };
    result.date = clean(f.date, 60);
    const tm = String(f.time || '').match(/(\d{1,2})[:.hч](\d{2})?/);
    if (tm) {
        const h = +tm[1], mi = +(tm[2] || 0);
        if (h <= 24 && mi < 60) result.clock = (h % 24) + mi / 60;
    }
    const preg = (v) => {
        const m = String(v ?? '').match(/\d+/);
        if (v == null || v === '' || !m) return null;
        return Math.min(42, +m[0]);
    };
    result.userPreg = preg(f.user_preg);
    result.botPreg = preg(f.bot_preg);
    const full = (v) => {
        const m = String(v ?? '').match(/\d+(?:[.,]\d+)?/);
        if (!m) return null;
        const n = parseFloat(m[0].replace(',', '.'));
        return n >= 0 && n <= 100 ? Math.round(n) : null;
    };
    result.userFull = full(f.user_full);
    result.botFull = full(f.bot_full);
    const weight = (v) => {
        const m = String(v ?? '').replace(/−/g, '-').match(/([+-])?\s*(\d+(?:[.,]\d+)?)/);
        if (!m) return null;
        const n = parseFloat(m[2].replace(',', '.'));
        if (m[1]) return Math.abs(n) <= 40 ? { delta: m[1] === '-' ? -n : n } : null;
        return n >= 30 && n <= 300 ? { abs: n } : null;
    };
    result.userWeight = weight(f.user_weight);
    result.botWeight = weight(f.bot_weight);
    result.userFeel = clean(f.user_feel);
    result.botFeel = clean(f.bot_feel);
    result.userProfile = parseProfile(f.user_profile);
    result.botProfile = parseProfile(f.bot_profile);
    result.userState = parseStateCalib(f.user_state);
    result.botState = parseStateCalib(f.bot_state);

    const yes = (v) => /^(true|yes|1|да)$/.test(norm(v || ''));
    result.userCare = yes(f.user_care);
    result.botCare = yes(f.bot_care);
    result.userVomited = yes(f.user_vomited) || yes(f.vomited);
    result.botVomited = yes(f.bot_vomited);

    const off = norm(f.offscreen || '');
    if (/^(fed|yes|true|сыт|ели|normal)/.test(off)) result.offscreen = 'fed';
    else if (/^(thirst|no.?water|dry|жажд|без.?вод)/.test(off)) result.offscreen = 'thirsty';
    else if (/^(hungry|no|false|голод|starv)/.test(off)) result.offscreen = 'hungry';

    if (f.ate) result.ate = parseList(f.ate, parseFoodEntry);
    if (f.user_ate) result.userAte = parseList(f.user_ate, parseFoodEntry);
    if (f.bot_ate) result.botAte = parseList(f.bot_ate, parseFoodEntry);
    if (f.drank) result.drank = parseList(f.drank, parseDrinkEntry);
    if (f.user_drank) result.userDrank = parseList(f.user_drank, parseDrinkEntry);
    if (f.bot_drank) result.botDrank = parseList(f.bot_drank, parseDrinkEntry);

    return result;
}

// ─── Калибровка: user_profile=f/24/165/57/slim/light/none ───
const BUILDS = ['slim', 'average', 'athletic', 'muscular', 'heavy'];
const LIFESTYLES = ['sedentary', 'light', 'moderate', 'active', 'very_active'];
function parseProfile(v) {
    if (!v || isEmptyValue(v)) return null;
    const p = String(v).split(/[\/;,]/).map(x => norm(x));
    const out = {};
    const g = p[0] || '';
    if (/^(m|male|м|муж)/.test(g)) out.gender = 'male';
    else if (/^(f|female|ж|жен)/.test(g)) out.gender = 'female';
    const age = parseInt(p[1]); if (age >= 14 && age <= 110) out.age = age;
    const h = parseInt(p[2]); if (h >= 110 && h <= 240) out.height = h;
    const w = parseFloat((p[3] || '').replace(',', '.')); if (w >= 30 && w <= 300) out.weight = w;
    const b = (p[4] || '').replace(/\s+/g, '_'); if (BUILDS.includes(b)) out.build = b;
    const l = (p[5] || '').replace(/[\s-]+/g, '_'); if (LIFESTYLES.includes(l)) out.activity = l;
    const pw = parseInt(p[7]);
    if (!isNaN(pw) && pw >= 0 && pw <= 42) out.pregnancyWeek = pw;
    const ed = p[6] || '';
    if (ed) {
        out.ed = {};
        for (const part of ed.split(/[+&]/)) {
            const m = part.trim().match(/^(anorexia|bulimia|binge)(?::(mild|moderate|severe))?/);
            if (m) out.ed[m[1]] = m[2] || 'moderate';
        }
    }
    return Object.keys(out).length ? out : null;
}

// user_state=сытость/вода/энергия (0–100)
function parseStateCalib(v) {
    if (!v || isEmptyValue(v)) return null;
    const n = String(v).split(/[\/;,]/).map(x => parseInt(x));
    const ok = (x) => !isNaN(x) && x >= 0 && x <= 100;
    if (!ok(n[0]) && !ok(n[1]) && !ok(n[2])) return null;
    return { satiety: ok(n[0]) ? n[0] : null, water: ok(n[1]) ? n[1] : null, energy: ok(n[2]) ? n[2] : null };
}
