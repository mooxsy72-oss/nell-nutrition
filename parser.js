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
        kcal: Math.round(p.cal100 * p.grams / 100),
        water: Math.round((p.water100 || 0) * p.grams / 100),
        cal100: p.cal100,
        water100: p.water100 || 0,
        grams: p.grams,
        drink: !!p.drink,
        alco: p.cat === 'alco',
    };
    mergeInto(EXACT, norm(p.name), entry);
    // Индексируем существительные из названия (не прилагательные)
    for (const t of tokens(p.name)) {
        if (!isAdjective(t)) mergeInto(STEMS, stemWord(t), entry);
    }
}
for (const [k, kcal] of Object.entries(MEAL_CALORIES)) {
    const data = { kcal, water: HYDRATING_ITEMS[k] ?? 0 };
    mergeInto(EXACT, norm(k), data);
    // Для словаря MEAL порционные ккал приоритетнее — кладём поверх
    const s = stemWord(k);
    const cur = STEMS.get(s);
    if (cur) { cur.kcal = kcal; if (HYDRATING_ITEMS[k] !== undefined) cur.water = HYDRATING_ITEMS[k]; }
    else STEMS.set(s, { ...data });
}
for (const [k, water] of Object.entries(HYDRATING_ITEMS)) {
    mergeInto(EXACT, norm(k), { water, drink: true });
    mergeInto(STEMS, stemWord(k), { water, drink: true });
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
            const hit = STEMS.get(stemWord(t)) || EXACT.get(t);
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
const KNOWN_KEYS = ['tp', 'activity', 'user_activity', 'bot_activity', 'sleeping', 'sleep', 'offscreen', 'ate', 'drank',
    'user_ate', 'bot_ate', 'user_drank', 'bot_drank', 'vomited', 'user_vomited', 'bot_vomited'];

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
    const f = splitFields(inner);

    const result = {
        tp: f.tp != null ? parseHours(f.tp) : null,
        activity: null,
        userActivity: null,
        botActivity: null,
        sleeping: false,
        offscreen: null,
        userVomited: false,
        botVomited: false,
        ate: [], drank: [],
        userAte: [], botAte: [],
        userDrank: [], botDrank: [],
    };

    result.activity = normalizeActivity(f.activity);
    result.userActivity = normalizeActivity(f.user_activity);
    result.botActivity = normalizeActivity(f.bot_activity);

    const sl = norm(f.sleeping ?? f.sleep ?? '');
    if (/^(true|yes|1|да)$/.test(sl)) result.sleeping = true;

    const yes = (v) => /^(true|yes|1|да)$/.test(norm(v || ''));
    result.userVomited = yes(f.user_vomited) || yes(f.vomited);
    result.botVomited = yes(f.bot_vomited);

    const off = norm(f.offscreen || '');
    if (/^(fed|yes|true|сыт|ели|normal)/.test(off)) result.offscreen = 'fed';
    else if (/^(hungry|no|false|голод|starv)/.test(off)) result.offscreen = 'hungry';

    if (f.ate) result.ate = parseList(f.ate, parseFoodEntry);
    if (f.user_ate) result.userAte = parseList(f.user_ate, parseFoodEntry);
    if (f.bot_ate) result.botAte = parseList(f.bot_ate, parseFoodEntry);
    if (f.drank) result.drank = parseList(f.drank, parseDrinkEntry);
    if (f.user_drank) result.userDrank = parseList(f.user_drank, parseDrinkEntry);
    if (f.bot_drank) result.botDrank = parseList(f.bot_drank, parseDrinkEntry);

    return result;
}

// ═══════════════════════════════════════════════════════════════
// ЭВРИСТИКА — если ИИ забыл тег
// ═══════════════════════════════════════════════════════════════
const L = '(?<![\\p{L}])';         // граница слова, работающая с кириллицей
const WORDS = '([\\p{L}]+(?:\\s+[\\p{L}]+)?)';

const EAT_PATTERNS = [
    new RegExp(`\\b(?:eats?|ate|eating|devours?|devoured|finish(?:es|ed)?|bites? into|chews?)\\s+(?:a |an |some |the |his |her |their )?${WORDS}`, 'giu'),
    new RegExp(`${L}(?:ест|съедает|съела?|поела?|доедает|доела?|кушает|жу[её]т|уплетает|перекусывает|откусывает|заглатывает|пожирает)\\s+${WORDS}`, 'giu'),
];
const DRINK_PATTERNS = [
    new RegExp(`\\b(?:drinks?|drank|sips?|sipped|gulps?|gulped|downs?|downed)\\s+(?:a |an |some |the |his |her |their )?(?:cup of |glass of |mug of |bottle of )?${WORDS}`, 'giu'),
    new RegExp(`${L}(?:пь[её]т|выпивает|выпила?|отпивает|отпила?|глотает|глотнула?|допивает|допила?|прихл[её]бывает)\\s+${WORDS}`, 'giu'),
];
const SLEEP_PATTERNS = [
    /\b(?:falls?\s+asleep|fell\s+asleep|went\s+to\s+sleep|slept|dozes?\s+off|dozed\s+off)\b/i,
    new RegExp(`${L}(?:засыпает|уснула?|заснула?|проспала?|легла?\\s+спать)(?![\\p{L}])`, 'iu'),
];

function firstFoodWord(phrase) {
    const toks = tokens(phrase);
    // "жареную курицу" → ищем по существительному, но показываем фразу целиком
    for (const t of toks) {
        const hit = STEMS.get(stemWord(t)) || EXACT.get(t);
        if (hit) return { word: toks.slice(0, toks.indexOf(t) + 1).join(' '), hit };
    }
    return null;
}

function negatedBefore(text, idx) {
    const before = text.slice(Math.max(0, idx - 12), idx).toLowerCase();
    return /(не|not|n't|never|никогда не)\s*$/.test(before.trim() + ' ') || /\b(не|not)\s+$/.test(before);
}

/**
 * @returns {{ meals: Array, drinks: Array, sleeping: boolean }}
 */
export function detectFromText(text) {
    if (!text) return { meals: [], drinks: [], sleeping: false };
    const meals = [], drinks = [];

    for (const re of EAT_PATTERNS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
            if (negatedBefore(text, m.index)) continue;
            const f = firstFoodWord(m[1]);
            if (f && !f.hit.drink && f.hit.kcal) {
                meals.push({ item: f.word, calories: f.hit.kcal, water: f.hit.water || 0, estimated: true });
            }
        }
    }
    for (const re of DRINK_PATTERNS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
            if (negatedBefore(text, m.index)) continue;
            const f = firstFoodWord(m[1]);
            const hit = f?.hit;
            if (hit && (hit.drink || hit.water)) {
                const ml = hit.grams ?? 250;
                drinks.push({
                    item: f.word, ml, ...drinkExtras(f.word, ml),
                    water: Math.round(hit.water100 != null ? hit.water100 * ml / 100 : hit.water),
                    calories: Math.round((hit.cal100 || 0) * ml / 100),
                });
            }
        }
    }
    const sleeping = SLEEP_PATTERNS.some(re => re.test(text));

    return { meals: dedup(meals), drinks: dedup(drinks), sleeping };
}

function dedup(arr) {
    const seen = new Set();
    return arr.filter(x => (seen.has(x.item) ? false : (seen.add(x.item), true)));
}

// ═══════════════════════════════════════════════════════════════
// АКТИВНОСТЬ ПО ТЕКСТУ — если ИИ не указал её в теге
// Берём самый высокий уровень, найденный в сцене.
// ═══════════════════════════════════════════════════════════════
const ACT_WORDS = {
    high: [
        'бе[гж]\\p{L}*', 'побежал\\p{L}*', 'убега\\p{L}*', 'мчит\\p{L}*', 'несёт\\p{L}*ся', 'несет\\p{L}*ся',
        'дерут\\p{L}*', 'дер[её]т\\p{L}*', 'дрался', 'дралась', 'сражает\\p{L}*', 'сражал\\p{L}*', 'бой', 'боя', 'битв\\p{L}*', 'схватк\\p{L}*', 'драк\\p{L}*',
        'уклоня\\p{L}*', 'фехтова\\p{L}*', 'рубит', 'рубил\\p{L}*', 'карабка\\p{L}*', 'взбира\\p{L}*', 'плыв[её]т', 'плыл\\p{L}*',
        'тащит', 'тащил\\p{L}*', 'волочит', 'копает', 'копал\\p{L}*', 'колет дрова', 'погон\\p{L}*', 'спасается', 'тренир\\p{L}*',
        'run', 'runs', 'ran', 'running', 'sprint\\p{L}*', 'fight\\p{L}*', 'fought', 'battle\\p{L}*', 'combat', 'climb\\p{L}*',
        'swim\\p{L}*', 'swam', 'dodg\\p{L}*', 'chase\\p{L}*', 'drag\\p{L}*', 'haul\\p{L}*', 'dig\\p{L}*', 'train\\p{L}*',
    ],
    medium: [
        'ид[её]т', 'идут', 'ид[её]м', 'идя', 'шла', 'шёл', 'шел', 'шли', 'шагает', 'шага\\p{L}*', 'брела', 'брёл', 'брел', 'брели', 'бред[её]т', 'бредут',
        'пош[её]л', 'пошла', 'пошли', 'добира\\p{L}*', 'спускал\\p{L}*', 'спуска\\p{L}*ся', 'поднял\\p{L}*ся', 'собира\\p{L}*', 'собрал\\p{L}*',
        'несла', 'несли', 'дорог\\p{L}* заняла', 'шагал\\p{L}*', 'гуля\\p{L}*', 'прогулк\\p{L}*', 'бродит', 'бродил\\p{L}*', 'поднима\\p{L}* по',
        'убира\\p{L}*', 'готовит', 'готовил\\p{L}*', 'стряпа\\p{L}*', 'моет', 'мыл\\p{L}*', 'стирает', 'работает', 'работал\\p{L}*',
        'несёт', 'несет', 'нёс', 'нес', 'таскает', 'танцу\\p{L}*', 'скачет верхом', 'едет верхом', 'рыбач\\p{L}*', 'собирает', 'охоти\\p{L}*',
        'walk\\p{L}*', 'stroll\\p{L}*', 'hike\\p{L}*', 'hiking', 'clean\\p{L}*', 'cook\\p{L}*', 'carr\\p{L}*', 'danc\\p{L}*', 'work\\p{L}*', 'ride\\p{L}*', 'riding',
    ],
};
const ACT_RES = Object.fromEntries(Object.entries(ACT_WORDS).map(([k, list]) =>
    [k, new RegExp(`(?<![\\p{L}])(?:${list.join('|')})(?![\\p{L}])`, 'iu')]));

/** @returns {'low'|'medium'|'high'} */
export function detectActivity(text) {
    const t = String(text || '').replace(/<!--[\s\S]*?-->/g, '');
    if (ACT_RES.high.test(t)) return 'high';
    if (ACT_RES.medium.test(t)) return 'medium';
    return 'low';
}

// ═══════════════════════════════════════════════════════════════
// ИГРОВОЕ ВРЕМЯ (Horae + RP_DATE)
// ═══════════════════════════════════════════════════════════════
const HORAE_TIME_RE = /time:\s*(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s+(\d{1,2}):(\d{2})/i;
const HORAE_DATE_RE = /(?:date|time):\s*(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{1,2})/i;
const RP_DATE_RE = /\[RP_DATE:\s*(\d{1,2})\.(\d{1,2})\.(\d{1,4})\]/i;

function calendarMinutes(y, mo, d, h = 0, min = 0) {
    return Date.UTC(y, mo - 1, d, h, min) / 60000;
}

export function parseGameTime(text) {
    if (!text) return null;
    const mFull = text.match(HORAE_TIME_RE);
    if (mFull) return { totalMinutes: calendarMinutes(+mFull[1], +mFull[2], +mFull[3], +mFull[4], +mFull[5]), hasClock: true, hour: +mFull[4] + (+mFull[5]) / 60 };
    const mDate = text.match(HORAE_DATE_RE);
    if (mDate) return { totalMinutes: calendarMinutes(+mDate[1], +mDate[2], +mDate[3]), hasClock: false };
    const mRp = text.match(RP_DATE_RE);
    if (mRp) return { totalMinutes: calendarMinutes(+mRp[3], +mRp[2], +mRp[1]), hasClock: false };
    return null;
}
