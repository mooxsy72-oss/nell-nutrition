// nell-nutrition/parser.js
// Парсинг ответов ИИ: тег <!-- NN ... -->, поиск еды/питья/сна в тексте.

import { MEAL_CALORIES, HYDRATING_ITEMS, normalizeActivity } from './nutrition-engine.js';
import { PRODUCT_DB } from './products.js';
import { drinkExtras } from './effects.js';

// ═══════════════════════════════════════════════════════════════
// НОРМАЛИЗАЦИЯ И СТЕММИНГ
// ═══════════════════════════════════════════════════════════════
export function norm(s) {
    return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

const RU_ENDINGS = [
    'иями', 'ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими',
    'ах', 'ях', 'ов', 'ев', 'ом', 'ем', 'ой', 'ей', 'ую', 'юю',
    'ые', 'ий', 'ый', 'ая', 'яя', 'ое', 'ее',
    'а', 'я', 'ы', 'и', 'у', 'ю', 'е', 'о', 'ь', 'й',
];

export function stemWord(word) {
    const w = norm(word);
    if (/^[a-z]+$/.test(w)) {
        if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
        if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1);
        return w;
    }
    for (const e of RU_ENDINGS) {
        if (w.length - e.length >= 3 && w.endsWith(e)) return w.slice(0, w.length - e.length);
    }
    return w;
}

// Прилагательные ("жареная", "тушёный", "горячее") не несут смысла блюда —
// по ним не ищем, иначе "жареная курица" найдёт "свинину жареную".
const ADJ_RE = /(ый|ий|ой|ая|яя|ое|ее|ые|ие|ую|юю|ого|его|ыми|ими)$/;
function isAdjective(tok) { return tok.length > 3 && ADJ_RE.test(tok); }

function tokens(name) {
    return norm(name).split(/[^\p{L}]+/u).filter(t => t.length >= 2);
}

// ═══════════════════════════════════════════════════════════════
// ИНДЕКС ПРОДУКТОВ
// entry: { kcal (за порцию), water (% за порцию), cal100, water100, grams, drink }
// ═══════════════════════════════════════════════════════════════
const EXACT = new Map();
const STEMS = new Map();

function mergeInto(map, key, data) {
    const cur = map.get(key);
    if (!cur) { map.set(key, { ...data }); return; }
    for (const k of Object.keys(data)) {
        if (cur[k] === undefined && data[k] !== undefined) cur[k] = data[k];
    }
}

for (const p of PRODUCT_DB) {
    const entry = {
        name: norm(p.name),
        kcal: Math.round(p.cal100 * p.grams / 100),
        water: Math.round((p.water100 || 0) * p.grams / 100),
        cal100: p.cal100,
        water100: p.water100 || 0,
        grams: p.grams,
        drink: !!p.drink,
        alco: p.cat === 'alco',
    };
    mergeInto(EXACT, norm(p.name), entry);
    // Индексируем существительные из названия (не прилагательные), и только
    // до предлога: «Рыба на костре» — это рыба, а не костёр
    const head = norm(p.name).split(/\s(?:на|в|во|с|со|из|по|под|для|без|with|on|in|of)\s/)[0];
    for (const t of tokens(head)) {
        if (!isAdjective(t)) mergeInto(STEMS, stemWord(t), entry);
    }
}
for (const [k, kcal] of Object.entries(MEAL_CALORIES)) {
    const data = { name: norm(k), kcal, water: HYDRATING_ITEMS[k] ?? 0 };
    mergeInto(EXACT, norm(k), data);
    // Для словаря MEAL порционные ккал приоритетнее — кладём поверх
    const s = stemWord(k);
    const cur = STEMS.get(s);
    if (cur) { cur.kcal = kcal; if (HYDRATING_ITEMS[k] !== undefined) cur.water = HYDRATING_ITEMS[k]; }
    else STEMS.set(s, { ...data });
}
for (const [k, water] of Object.entries(HYDRATING_ITEMS)) {
    mergeInto(EXACT, norm(k), { name: norm(k), water, drink: true });
    mergeInto(STEMS, stemWord(k), { name: norm(k), water, drink: true });
}
// Словарные слова ("говядина", "вино") дополняем данными «на 100 г» из базы
for (const [key, val] of EXACT) {
    if (val.cal100 !== undefined) continue;
    const src = STEMS.get(stemWord(key.split(' ')[0]));
    if (src) {
        for (const f of ['cal100', 'water100', 'grams', 'alco']) {
            if (val[f] === undefined && src[f] !== undefined) val[f] = src[f];
        }
        if (src.drink) val.drink = true;
    }
}

// Уменьшительные и неправильные формы → словарное слово
const ALIAS_PREFIX = [
    ['блинчик', 'блины'], ['блинк', 'блины'], ['пирожк', 'пирожок'], ['пирожоч', 'пирожок'], ['хлебуш', 'хлеб'], ['хлебц', 'хлебец'],
    ['супчик', 'суп'], ['супц', 'суп'], ['кашк', 'каша'], ['кашиц', 'каша'], ['молочк', 'молоко'], ['яичк', 'яйцо'], ['яиц', 'яйцо'],
    ['водичк', 'вода'], ['водиц', 'вода'], ['чаёк', 'чай'], ['чаек', 'чай'], ['чайк', 'чай'], ['чаю', 'чай'], ['чая', 'чай'], ['чаем', 'чай'],
    ['кофеёк', 'кофе'], ['кофеек', 'кофе'], ['кофейк', 'кофе'], ['винц', 'вино'], ['винишк', 'вино'], ['пивк', 'пиво'], ['пивас', 'пиво'],
    ['картошечк', 'картошка'], ['картофелин', 'картошка'], ['мясц', 'мясо'], ['мяса', 'мясо'], ['медок', 'мёд'], ['медк', 'мёд'], ['мёду', 'мёд'], ['меду', 'мёд'],
    ['щей', 'щи'], ['ягодк', 'ягоды'], ['яблочк', 'яблоко'], ['сырок', 'сыр'], ['сырк', 'сыр'], ['колбаск', 'колбаса'], ['сосисочк', 'сосиски'],
    ['бутербродик', 'бутерброд'], ['бутик', 'бутерброд'], ['оладуш', 'оладьи'], ['оладий', 'оладьи'], ['оладь', 'оладьи'], ['сухарик', 'сухари'],
    ['конфетк', 'конфета'], ['шоколадк', 'шоколад'], ['печеньк', 'печенье'], ['тортик', 'торт'], ['пирожн', 'торт'], ['булк', 'булочка'],
    ['котлетк', 'котлета'], ['курочк', 'курица'], ['рыбк', 'рыба'], ['похлёбк', 'похлёбка'], ['похлебк', 'похлёбка'], ['компотик', 'компот'],
];
function aliasOf(tok) {
    for (const [pre, target] of ALIAS_PREFIX) if (tok.startsWith(pre)) return target;
    return null;
}
function lookupToken(t) {
    const a = aliasOf(t);
    if (a) return EXACT.get(norm(a)) || STEMS.get(stemWord(a)) || null;
    return EXACT.get(t) || STEMS.get(stemWord(t)) || null;
}

/**
 * Ищет продукт по свободному названию от ИИ.
 * @returns {Object|null}
 */
export function lookupFood(name) {
    const n = norm(name);
    if (!n) return null;
    if (EXACT.has(n)) return EXACT.get(n);

    // По словам: сначала существительные, потом (если ничего) — все слова
    const toks = tokens(n);
    for (const pass of [toks.filter(t => !isAdjective(t)), toks]) {
        for (const t of pass) {
            const hit = lookupToken(t);
            if (hit) return hit;
        }
    }

    // Частичное совпадение — только длинные ключи, берём самый длинный
    let best = null, bestLen = 0;
    for (const [key, val] of EXACT) {
        if (key.length < 5) continue;
        if ((n.includes(key) || key.includes(n) && n.length >= 5) && key.length > bestLen) {
            best = val; bestLen = key.length;
        }
    }
    return best;
}

// Множитель порции по словам-маркерам (только когда ИИ не дал чисел)
function portionMultiplier(name) {
    const n = norm(name);
    if (/(глоток|глотк|чуть|немного|пригуб|капл|кусочек|ложк|bite|sip)/.test(n)) return 0.4;
    if (/(до отвала|вдоволь|залпом|много|фляг|кувшин|бутыл|литр|огромн|двойн|huge|double)/.test(n)) return 2.0;
    if (/(больш|полн|кружк|бокал|миск|large|big)/.test(n)) return 1.5;
    if (/(маленьк|стопк|рюмк|small)/.test(n)) return 0.6;
    return 1.0;
}

// ═══════════════════════════════════════════════════════════════
// РАЗБОР ОДНОЙ ПОЗИЦИИ: "борщ:320", "говядина 200г", "вода:250мл", "чай (15%)"
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
    const amounts = { kcal: null, g: null, ml: null, pct: null, bare: null };
    // Имя — всё до первого разделителя-числа ("борщ:320", "борщ (320 ккал)", "борщ 320")
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
        else if (kind === 'none') { if (amounts.bare == null) amounts.bare = v; }
        else if (amounts[kind] == null) amounts[kind] = v;
    }
    return { name: name || raw, amounts };
}

function isEmptyValue(v) {
    const x = norm(v);
    return !x || /^(none|null|нет|ничего|-|—|n\/a|0)$/.test(x);
}

// Свежие овощи/фрукты (для цинги) и сомнительная еда (для отравлений) — по названию из тега
const PRODUCE_RE = /(яблок|груш|банан|апельсин|мандарин|виноград|ягод|малин|черник|клубник|брусник|клюкв|вишн|слив|персик|абрикос|арбуз|дын|лимон|фрукт|овощ|салат|капуст|морков|огур|помидор|томат|свекл|свёкл|реп|редис|лук|чеснок|зелен|черемш|щавел|крапив|шиповник|борщ|щи|квашен|сок|морс|apple|pear|berr|fruit|vegetab|salad|orange|lemon|cabbage|carrot|onion|tomato|greens)/i;
const RISKY_RE = /(сыр(ой|ая|ое|ые|ую)|недожар|недовар|тухл|испорч|просроч|подгнил|плесен|вчерашн|лежал|улитк|лягуш|гриб|дичь|голуб|белк|кабан|падал|raw|spoiled|rotten|mould|mold|mushroom|undercooked|stale)/i;
// Сырая вода из природных источников
const RISKY_WATER_RE = /(руч|рек|речн|колод|пруд|озер|озёр|луж|болот|родник|ключ|талая|снег|сыр(ая|ой) вод|некипяч|stream|river|creek|pond|lake|puddle|well|swamp|raw water|unboiled)/i;

export function foodFlags(name) {
    const n = String(name || '');
    return { produce: PRODUCE_RE.test(n), risky: RISKY_RE.test(n) };
}

function parseFoodEntry(entry) {
    const { name, amounts } = splitEntry(entry);
    const hit = lookupFood(name);
    const mult = portionMultiplier(name);
    const cal100 = hit?.cal100 ?? 180;
    const water100 = hit?.water100 ?? (hit?.water ? hit.water / 2.5 : 0);

    let kcal = null, water = null;
    const kcalGiven = amounts.kcal ?? amounts.bare;

    if (kcalGiven != null && kcalGiven >= 15) {
        kcal = kcalGiven;                               // ИИ оценил порцию — доверяем
    } else if (amounts.g != null) {
        kcal = cal100 * amounts.g / 100;
        water = water100 * amounts.g / 100;
    } else if (amounts.ml != null) {                    // суп в мл
        kcal = cal100 * amounts.ml / 100;
        water = water100 * amounts.ml / 100;
    } else if (kcalGiven != null && kcalGiven > 0 && kcalGiven < 15) {
        // "яйцо 2" — это количество, а не калории
        const q = Math.min(6, kcalGiven);
        kcal = (hit?.kcal ?? 250) * q;
        water = (hit?.water ?? 0) * q;
    } else {
        kcal = (hit?.kcal ?? 250) * mult;
    }
    if (water == null) water = (hit?.water ?? 0) * (amounts.g || amounts.ml || kcalGiven >= 15 ? 1 : mult);

    return {
        item: name,
        ...foodFlags(name),
        calories: Math.max(0, Math.min(3000, Math.round(kcal))),
        water: Math.max(0, Math.min(60, Math.round(water))),
        estimated: kcalGiven == null && amounts.g == null && amounts.ml == null,
    };
}

function parseDrinkEntry(entry) {
    const { name, amounts } = splitEntry(entry);
    const hit = lookupFood(name);
    const water100 = hit?.water100 ?? (hit?.water ? hit.water / 2.5 : 8);
    const cal100 = hit?.cal100 ?? 0;

    let ml = amounts.ml ?? amounts.g ?? null;
    let water = null;

    if (ml == null && amounts.pct != null) {
        water = amounts.pct;
    } else if (ml == null && amounts.bare != null) {
        // Число без единиц: маленькое — старый формат (%), большое — мл
        if (amounts.bare <= 60) water = amounts.bare;
        else ml = amounts.bare;
    }
    if (ml == null && water == null) {
        ml = (hit?.grams ?? 250) * portionMultiplier(name);
    }
    if (water == null) water = water100 * ml / 100;
    if (ml == null) ml = water100 > 0 ? water / water100 * 100 : 250;

    const kcal = amounts.kcal ?? Math.round(cal100 * ml / 100);
    const extras = drinkExtras(name, ml);

    return {
        item: name,
        ml: Math.round(ml),
        produce: foodFlags(name).produce,
        risky: RISKY_WATER_RE.test(name),
        alcoholG: extras.alcoholG,
        caffeineMg: extras.caffeineMg,
        water: Math.max(0, Math.min(80, Math.round(water))),
        calories: Math.max(0, Math.min(1500, Math.round(kcal))),
        alco: !!hit?.alco,
    };
}

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
const KNOWN_KEYS = ['tp', 'date', 'time', 'user_preg', 'bot_preg', 'activity', 'user_activity', 'bot_activity', 'sleeping',
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
