// nell-nutrition/parser.js
// Парсинг ответов ИИ: тег <!-- NN ... -->, обнаружение еды/питья/сна.

import { MEAL_CALORIES, HYDRATING_ITEMS } from './nutrition-engine.js';
import { PRODUCT_DB } from './products.js';

// ─── Справочники из базы продуктов (название → ккал/вода за станд. порцию) ───
const PRODUCT_CAL = {};
const PRODUCT_WATER = {};
for (const p of PRODUCT_DB) {
    const key = p.name.toLowerCase();
    PRODUCT_CAL[key] = Math.round(p.cal100 * p.grams / 100);
    PRODUCT_WATER[key] = Math.round((p.water100 || 0) * p.grams / 100);
}
// ─── Нормализация русских окончаний ───
// Отрезаем регулярные падежные/родовые окончания, чтобы "зайца",
// "кашу", "борща" сводились к общему корню "зайц", "каш", "борщ".
const RU_ENDINGS = [
    'иями', 'ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими',
    'ах', 'ях', 'ов', 'ев', 'ом', 'ем', 'ой', 'ей', 'ую', 'юю',
    'ые', 'ий', 'ый', 'ая', 'яя', 'ое', 'ее',
    'а', 'я', 'ы', 'и', 'у', 'ю', 'е', 'о', 'ь', 'й',
];

function stemRu(word) {
    let w = (word || '').toLowerCase().trim();
    for (const e of RU_ENDINGS) {
        if (w.length - e.length >= 3 && w.endsWith(e)) {
            return w.slice(0, w.length - e.length);
        }
    }
    return w;
}

// Стем-индексы: корень → калории / вода. Первое совпадение выигрывает.
const STEM_CAL = {};
const STEM_WATER = {};
function addStem(map, dst) {
    for (const k in map) {
        const s = stemRu(k);
        if (dst[s] === undefined) dst[s] = map[k];
    }
}
addStem(MEAL_CALORIES, STEM_CAL);
addStem(PRODUCT_CAL, STEM_CAL);
addStem(HYDRATING_ITEMS, STEM_WATER);
addStem(PRODUCT_WATER, STEM_WATER);

// Частичное совпадение считаем надёжным только для слов от 4 букв —
// иначе "сухарь" ловит "уха", "рис" цепляет "ирис" и т.п.
// Из всех совпадений берём самое длинное (оно точнее).
function bestPartial(name, table) {
    const n = name.toLowerCase().trim();
    let best = null;
    for (const key in table) {
        if (key.length < 4) continue;
        const hit = n.includes(key) || (n.length >= 4 && key.includes(n));
        if (hit && (!best || key.length > best.length)) best = key;
    }
    return best;
}

function lookupCalories(name) {
    const n = name.toLowerCase().trim();
    if (MEAL_CALORIES[n] !== undefined) return MEAL_CALORIES[n];
    if (PRODUCT_CAL[n] !== undefined) return PRODUCT_CAL[n];
    const s = stemRu(n);
    if (STEM_CAL[s] !== undefined) return STEM_CAL[s];
    const key = bestPartial(n, PRODUCT_CAL);
    return key ? PRODUCT_CAL[key] : 250;
}

function lookupWater(name) {
    const n = name.toLowerCase().trim();
    if (HYDRATING_ITEMS[n] !== undefined) return HYDRATING_ITEMS[n];
    if (PRODUCT_WATER[n] !== undefined) return PRODUCT_WATER[n];
    const s = stemRu(n);
    if (STEM_WATER[s] !== undefined) return STEM_WATER[s];
    const key = bestPartial(n, PRODUCT_WATER);
    return key ? PRODUCT_WATER[key] : 0;
}

// ═══════════════════════════════════════════════════════════════
// TAG PARSING — <!-- NN tp=2 | activity=normal | ate=lunch | drank=water -->
// ═══════════════════════════════════════════════════════════════
const NN_TAG_RE = /<!--\s*NN\s+([^>]+?)\s*-->/i;

const VALID_ACTIVITIES = ['resting', 'normal', 'active', 'intense'];

/**
 * Парсит тег <!-- NN ... --> из ответа ИИ.
 * @param {string} text — полный текст сообщения
 * @returns {Object|null}
 */
export function parseNnTag(text) {
    if (!text) return null;
    const m = text.match(NN_TAG_RE);
    if (!m) return null;

    const inner = m[1];
    const result = {
        tp: null,
        activity: null,
        sleeping: false,
        ate: [], drank: [],
        userAte: [], botAte: [],
        userDrank: [], botDrank: [],
    };

    // tp (time passed)
    const tpMatch = inner.match(/tp\s*[=:]\s*([\d.,]+)/i);
    if (tpMatch) {
        const num = parseFloat(tpMatch[1].replace(',', '.'));
        if (!isNaN(num) && num >= 0) result.tp = Math.min(num, 720);
    }

    // activity
    const actMatch = inner.match(/activity\s*[=:]\s*([a-z]+)/i);
    if (actMatch && VALID_ACTIVITIES.includes(actMatch[1].toLowerCase())) {
        result.activity = actMatch[1].toLowerCase();
    }

    // sleeping
    if (/sleep(?:ing)?\s*[=:]\s*(?:true|yes|1)/i.test(inner)) {
        result.sleeping = true;
    }

    // Захватываем всё до следующего "|" — теперь принимает любой язык,
    // цифры, скобки и двоеточия ("говядина:400", "хлеб (80)").
    const ateMatch = inner.match(/(?:^|[|;])\s*ate\s*[=:]\s*([^|]+)/i);
    if (ateMatch) result.ate = parseItemList(ateMatch[1]);

    const userAteMatch = inner.match(/user_ate\s*[=:]\s*([^|]+)/i);
    if (userAteMatch) result.userAte = parseItemList(userAteMatch[1]);

    const botAteMatch = inner.match(/bot_ate\s*[=:]\s*([^|]+)/i);
    if (botAteMatch) result.botAte = parseItemList(botAteMatch[1]);

    const drankMatch = inner.match(/(?:^|[|;])\s*drank\s*[=:]\s*([^|]+)/i);
    if (drankMatch) result.drank = parseDrinkList(drankMatch[1]);

    const userDrankMatch = inner.match(/user_drank\s*[=:]\s*([^|]+)/i);
    if (userDrankMatch) result.userDrank = parseDrinkList(userDrankMatch[1]);

    const botDrankMatch = inner.match(/bot_drank\s*[=:]\s*([^|]+)/i);
    if (botDrankMatch) result.botDrank = parseDrinkList(botDrankMatch[1]);

    return result;
}

function parseItemList(raw) {
    return raw.split(/[,;]+/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(entry => {
            const m = entry.match(/^(.+?)[\s:(]+(\d+)\)?$/);
            let name, cal;
            if (m) {
                name = m[1].trim();
                cal = parseInt(m[2]);
            } else {
                name = entry;
                cal = NaN;
            }
            const mult = portionMultiplier(name);
            // Если ИИ указал число калорий — доверяем ему как есть (он уже
            // оценил порцию). Множитель применяем только к запасной оценке
            // из словаря, чтобы "большая тарелка каши" без числа не была скудной.
            let calories, water;
            if (!isNaN(cal) && cal > 0) {
                calories = cal;
                water = lookupWater(name);
            } else {
                calories = Math.round(lookupCalories(name) * mult);
                water = Math.round(lookupWater(name) * mult);
            }
            return { item: name, calories, water: Math.max(0, Math.min(100, water)) };
        });
}

// Разбирает "чай:15, вода" — число = % воды, если задано ИИ.
// Множитель порции по словам-маркерам в названии.
// "стакан воды" ≈ 1×, "большая кружка" ≈ 1.5×, "залпом до отвала" ≈ 2×, "глоток" ≈ 0.4×.
function portionMultiplier(name) {
    const n = name.toLowerCase();
    if (/(глоток|чуть|немного|пригуб|капл)/.test(n)) return 0.4;
    if (/(до отвала|вдоволь|залпом|напил|много|фляг|кувшин|бутыл|литр)/.test(n)) return 2.0;
    if (/(больш|полн|кружк|бокал)/.test(n)) return 1.5;
    if (/(маленьк|стопк|рюмк)/.test(n)) return 0.6;
    return 1.0;
}

function parseDrinkList(raw) {
    return raw.split(/[,;]+/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(entry => {
            const m = entry.match(/^(.+?)[\s:(]+(\d+)\)?$/);
            let name, water;
            if (m) {
                name = m[1].trim();
                water = parseInt(m[2]);
            } else {
                name = entry;
                water = NaN;
            }
            let w = (!isNaN(water) && water > 0) ? water : (lookupWater(name) || 15);
            w = Math.round(w * portionMultiplier(name));
            return { item: name, water: Math.max(1, Math.min(100, w)) };
        });
}

// ═══════════════════════════════════════════════════════════════
// HEURISTIC DETECTION — ищем еду/питьё в обычном тексте
// (на случай если ИИ забудет тег)
// ═══════════════════════════════════════════════════════════════

const EAT_PATTERNS = [
    // English
    /(?:eats?|ate|eating|devours?|consumes?|has|had)\s+(?:a\s+|some\s+|the\s+)?(\w+)/gi,
    /(?:grabs?|takes?|picks?\s+up)\s+(?:a\s+|some\s+|the\s+)?(\w+)\s+(?:and\s+)?(?:eats?|bites?)/gi,
    // Russian
    /(?:ест|съедает|ел[аи]?|кушает|перекусывает|обедает|ужинает|завтракает|пожирает)\s+([а-яё]+)/gi,
    /(?:берёт|хватает)\s+([а-яё]+)\s+и\s+(?:ест|съедает)/gi,
];

const DRINK_PATTERNS = [
    /(?:drinks?|drank|drinking|sips?|gulps?)\s+(?:a\s+|some\s+|the\s+|her\s+|his\s+)?(\w+)/gi,
    /(?:пьёт|выпивает|пил[аи]?|отпивает|глотает)\s+([а-яё]+)/gi,
];

const SLEEP_PATTERNS = [
    /(?:falls?\s+asleep|went\s+to\s+sleep|sleeping|slept|naps?|dozes?\s+off)/i,
    /(?:засыпает|уснул[аи]?|спит|заснул[аи]?|дремлет|легл[аи]?\s+спать)/i,
];

/**
 * Пытается обнаружить еду/питьё/сон в тексте без тега.
 * @param {string} text
 * @returns {Object} — { meals: [{item, calories, water}], drinks: [{item, water}], sleeping: boolean }
 */
export function detectFromText(text) {
    if (!text) return { meals: [], drinks: [], sleeping: false };

    const meals = [];
    const drinks = [];
    let sleeping = false;

    // Еда
    for (const pattern of EAT_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const item = match[1].toLowerCase();
            const s = stemRu(item);
            const cal = MEAL_CALORIES[item] ?? STEM_CAL[s];
            if (cal !== undefined) {
                const water = HYDRATING_ITEMS[item] ?? STEM_WATER[s] ?? 0;
                meals.push({ item, calories: cal, water });
            }
        }
    }

    // Питьё
    for (const pattern of DRINK_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const item = match[1].toLowerCase();
            const s = stemRu(item);
            const water = HYDRATING_ITEMS[item] ?? STEM_WATER[s];
            if (water !== undefined) {
                drinks.push({ item, water });
            }
        }
    }

    // Сон
    for (const pattern of SLEEP_PATTERNS) {
        if (pattern.test(text)) {
            sleeping = true;
            break;
        }
    }

    // Дедупликация
    const uniqueMeals = dedup(meals, 'item');
    const uniqueDrinks = dedup(drinks, 'item');

    return { meals: uniqueMeals, drinks: uniqueDrinks, sleeping };
}

function dedup(arr, key) {
    const seen = new Set();
    return arr.filter(item => {
        if (seen.has(item[key])) return false;
        seen.add(item[key]);
        return true;
    });
}

// ═══════════════════════════════════════════════════════════════
// TIME PARSING (Horae compatible + RP_DATE)
// ═══════════════════════════════════════════════════════════════
const HORAE_TIME_RE = /time:\s*(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s+(\d{1,2}):(\d{2})/i;
const HORAE_DATE_RE = /(?:date|time):\s*(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{1,2})/i;
const RP_DATE_RE = /\[RP_DATE:\s*(\d{1,2})\.(\d{1,2})\.(\d{1,4})\]/i;

function calendarMinutes(y, mo, d, h = 0, min = 0) {
    return Date.UTC(y, mo - 1, d, h, min) / 60000;
}

/**
 * Извлекает игровое время из текста (Horae или RP_DATE).
 * @returns {{ totalMinutes: number }|null}
 */
export function parseGameTime(text) {
    if (!text) return null;

    const mFull = text.match(HORAE_TIME_RE);
    if (mFull) {
        return { totalMinutes: calendarMinutes(+mFull[1], +mFull[2], +mFull[3], +mFull[4], +mFull[5]) };
    }

    const mDate = text.match(HORAE_DATE_RE);
    if (mDate) {
        return { totalMinutes: calendarMinutes(+mDate[1], +mDate[2], +mDate[3]) };
    }

    const mRp = text.match(RP_DATE_RE);
    if (mRp) {
        return { totalMinutes: calendarMinutes(+mRp[3], +mRp[2], +mRp[1]) };
    }

    return null;
}
