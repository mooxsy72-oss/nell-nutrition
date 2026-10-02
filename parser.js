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

// «ничего», «ни крошки», «nothing», «не ел» — модель так пишет вместо того, чтобы опустить поле
const NOTHING_RE = /^(none|null|nil|нет|ничего|ни крошки|ни глотка|пусто|nothing|n\/a|-|—|0|не (ел|ела|ели|пил|пила|пили)\p{L}*|didn'?t (eat|drink)|not eating|no food|no drink)$/u;
function isEmptyValue(v) {
    const x = norm(v);
    return !x || NOTHING_RE.test(x);
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

// ─── Манера еды/питья в скобках: «пирог (жадно):450», «пиво (залпом):500» ───
// От неё зависит порция, если ИИ не дал чисел, и то, как быстро наступает переедание.
const MANNERS = [
    ['bites', /(пар[уа]\s*(кус|лож|глот|штук)|нескольк\p{L}*\s*(кус|лож|глот)|кусоч|немного|чуть|пригуб|попроб|глоток|few bites|a bite|bite or two|nibbl|a sip|sips?\b|spoonful|mouthful|tast)/iu, 0.25, 50],
    ['reluctant', /(нехотя|через силу|без аппетит|вяло|ковыря|неохот|reluct|unwilling|forc|pick(ed|ing) at|no appetite)/i, 0.55, 120],
    ['half', /(половин|пол(круж|миск|тарелк|стакан|чашк|порци|бутылк|кувшин)|half)/i, 0.5, 175],
    ['greedy', /(жадн|взахл[её]б|залпом|уплета|набросил|проглот|целиком|до дна|до последн|подчист|вылиза|wolf|devour|greed|gulp|ravenous|hungrily|scarf|in one go|every last|drain)/i, 1.4, 500],
    ['hearty', /(аппетит|охотно|с удовольств|целую|цел(ый|ое)|вс[юё] (миск|тарелк|кружк|порци)|полн(ую|ый|ое)|добавк|heart|appetite|eager|relish|gusto|second helping|a full|whole)/i, 1.15, 350],
    ['normal', /(обычн|спокойн|не спеша|неторопливо|normal|calm|steadily|slowly)/i, 1, 250],
];
export const MANNER_KEYS = MANNERS.map(m => m[0]);

function mannerOf(text) {
    const t = String(text || '');
    for (const [id, re, kcalMult, ml] of MANNERS) if (re.test(t)) return { id, kcalMult, ml };
    return null;
}

/** Выносит «(жадно)» из названия. Скобки с числами («(400 ккал)») не трогаем — это количество. */
function takeManner(name) {
    let manner = null, label = null;
    const out = String(name || '').replace(/\s*\(([^()]*)\)\s*/g, (m, inside) => {
        // Числа в скобках — это количество; любой другой текст — пометка «как ел(а)»
        if (/\d/.test(inside) || label || !/\p{L}/u.test(inside)) return m;
        manner = mannerOf(inside); label = inside.trim();
        return ' ';
    }).replace(/\s+/g, ' ').trim();
    return { name: out, manner, label };
}

// Посуда → миллилитры: «2 стакана воды», «кружка пива», «a pint of ale»
const CONTAINERS = [
    [/рюмк|стопк|shot/i, 50], [/глот|sip/i, 30], [/бокал|фужер|wine ?glass/i, 180], [/чашк|чашечк|cup/i, 200],
    [/стакан|glass/i, 250], [/кружк|mug|tankard/i, 350], [/банк|can\b/i, 330], [/пинт|pint/i, 500],
    [/бутыл|bottle/i, 500], [/кувшин|jug|pitcher/i, 1000], [/фляг|flask|waterskin|бурдюк/i, 500],
];
function containerMl(text) {
    const t = String(text || '');
    for (const [re, ml] of CONTAINERS) {
        const m = t.match(new RegExp(`(?:(\\d+(?:[.,]\\d+)?)\\s*)?(?:${re.source})`, 'i'));
        if (m) return (m[1] ? parseFloat(m[1].replace(',', '.')) : 1) * ml;
    }
    return null;
}

// Напиток, записанный в «съел»: переносим в питьё, иначе вода не засчитается
const DRINK_WORD_RE = /^(вод|чай|чая|чаю|кофе|капучино|латте|эспрессо|сок|морс|компот|квас|пив|эль(\s|$)|сидр|вин(?!егр)|медовух|брага|водк|виски|ром(\s|$)|джин|коньяк|самогон|глинтвейн|пунш|молок|кефир|ряженк|какао|лимонад|газировк|кол[аы](\s|$)|смузи|коктейл|отвар|настой|минералк|кипят|напит|water|tea|coffee|latte|espresso|juice|beer|ale\b|lager|stout|wine|mead|cider|vodka|whisk|rum\b|gin\b|brandy|milk|cocoa|lemonade|soda|cola|smoothie|cocktail|drink)/i;
const CONTAINER_WORD_RE = /^(\d+\s*)?(стакан|чашк|чашечк|кружк|бокал|рюмк|стопк|бутыл|банк|пинт|глот|фляг|cup|glass|mug|bottle|can|pint|shot|sip|flask)/i;
export function looksLikeDrink(name) {
    const n = norm(name);
    if (!n || SOUP_RE.test(n)) return false;
    return DRINK_WORD_RE.test(n) || (CONTAINER_WORD_RE.test(n) && !/(суп|каш|salad|салат)/i.test(n));
}
const isPlainWater = (name) => /(^|\s)(вод[аыуе]?|кипят\p{L}*|water)(\s|$)/iu.test(norm(name));

// Блюдо не названо: «ужин», «поели», «meal» — всё равно еда
const GENERIC_MEAL_RE = /^(еда|поел\p{L}*|перекус\p{L}*|завтрак|обед|ужин|полдник|трапез\p{L}*|meal|food|snack|breakfast|lunch|dinner|supper|ate)$/iu;

function parseFoodEntry(entry) {
    const { name: rawName, amounts } = splitEntry(entry);
    const { name, manner, label } = takeManner(rawName);
    if (isEmptyValue(name)) return { item: '' };   // «ничего:0»
    // Калории — от ИИ: «ккал» или первое число без единиц
    let kcal = amounts.kcal ?? amounts.bares[0] ?? null;
    // «хлеб:2» — это количество, а не калории
    if (kcal != null && kcal > 0 && kcal < 15) kcal = null;
    const estimated = kcal == null;
    // Без числа порцию задаёт манера: «пару кусочков» — мало, «жадно» — много
    if (kcal == null) kcal = DEFAULT_MEAL_KCAL * (manner?.kcalMult ?? 1);
    // «пару ложек», «облизнул», «попробовал» — это крохи, даже если ИИ поставил большое число
    if (manner?.id === 'bites' || /(облиз|слиз|lick)/i.test(rawName)) kcal = Math.min(kcal, 120);
    return {
        item: name || 'еда',
        manner: manner?.id || null,
        mannerLabel: label,
        generic: GENERIC_MEAL_RE.test(norm(name)),
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

/**
 * «брага:500:350», «вода:300мл», «2 стакана воды», «чай (жадно)».
 * fromFood — напиток пришёл в поле «съел»: там одиночное число — это калории (кроме воды).
 */
function parseDrinkEntry(entry, { fromFood = false } = {}) {
    const { name: rawName, amounts } = splitEntry(entry);
    const { name, manner, label } = takeManner(rawName);
    if (isEmptyValue(name)) return { item: '' };   // «ничего:0:0»
    let ml = amounts.ml ?? amounts.g ?? null;
    let kcal = amounts.kcal;
    const bares = [...amounts.bares];
    if (fromFood && bares.length === 1 && ml == null && !isPlainWater(name)) {
        if (kcal == null) kcal = bares.shift();
    }
    if (ml == null && bares.length) ml = bares.shift();
    if (kcal == null && bares.length) kcal = bares.shift();
    // «вода:2» — это два стакана, а не 2 мл
    if (ml != null && ml > 0 && ml <= 10 && amounts.ml == null) ml = ml * 250;
    if (ml == null) ml = containerMl(entry) ?? manner?.ml ?? 250;
    const extras = drinkExtras(name, ml);
    const water = amounts.pct ?? waterPer100(name) * ml / 100;
    return {
        item: name || 'питьё',
        manner: manner?.id || null,
        mannerLabel: label,
        ml: Math.round(ml),
        produce: foodFlags(name).produce,
        risky: RISKY_WATER_RE.test(name),
        alcoholG: extras.alcoholG,
        caffeineMg: extras.caffeineMg,
        water: Math.max(0, Math.min(80, Math.round(water))),
        calories: Math.max(0, Math.min(2000, Math.round(kcal ?? 0))),
    };
}

function splitList(raw) {
    if (isEmptyValue(raw)) return [];
    return raw.split(/[,;]+(?![^(]*\))/).map(s => s.trim()).filter(s => s && !isEmptyValue(s));
}

function parseList(raw, parser) {
    return splitList(raw).map(parser).filter(x => x.item);
}

/** Еда из тега; напитки, которые ИИ записал в «съел», уходят в питьё */
function parseFoodList(raw) {
    const foods = [], drinks = [];
    for (const s of splitList(raw)) {
        const nameOnly = takeManner(splitEntry(s).name).name;
        if (looksLikeDrink(nameOnly)) drinks.push(parseDrinkEntry(s, { fromFood: true }));
        else foods.push(parseFoodEntry(s));
    }
    return { foods: foods.filter(x => x.item), drinks: drinks.filter(x => x.item) };
}

// ═══════════════════════════════════════════════════════════════
// ТЕГ <!-- NN tp=1 | activity=normal | user_ate=... | bot_drank=... -->
// ═══════════════════════════════════════════════════════════════
const TAG_RES = [
    /<!--\s*NN\b[\s:]*([\s\S]*?)-->/gi,
    /\[\s*NN\b[\s:]+([^\]\n]*)\]/gi,
];
const KNOWN_KEYS = ['skip', 'user_heal', 'bot_heal', 'user_clear', 'bot_clear', 'tp', 'date', 'time', 'user_preg', 'bot_preg', 'user_full', 'bot_full', 'user_weight', 'bot_weight', 'activity', 'user_activity', 'bot_activity', 'sleeping',
    'user_feel', 'bot_feel', 'user_profile', 'bot_profile', 'user_state', 'bot_state', 'sleep', 'offscreen', 'ate', 'drank',
    'user_ate', 'bot_ate', 'user_drank', 'bot_drank', 'vomited', 'user_vomited', 'bot_vomited', 'user_care', 'bot_care', 'user_why', 'bot_why',
    'shown', 'user_likes', 'bot_likes', 'user_dislikes', 'bot_dislikes', 'user_habits', 'bot_habits'];

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

// Длительность: «1.5», «30 min», «8h», «3 дня», «2 недели», «2 months», «2 месяца», «1 год»
export const MAX_HOURS = 24 * 400;
function parseHours(v) {
    const str = String(v || '').toLowerCase();
    const m = str.match(/([\d.,]+)\s*([a-zа-яё]*)/i);
    if (!m) return null;
    let n = parseFloat(m[1].replace(',', '.'));
    if (isNaN(n) || n < 0) return null;
    const u = m[2] || '';
    if (/^(mo|mon|month|мес)/.test(u)) n *= 24 * 30.4;
    else if (/^(y|yr|year|год|лет)/.test(u)) n *= 24 * 365;
    else if (/^(w|wk|week|нед)/.test(u)) n *= 24 * 7;
    else if (/^(d|day|д|дн|сут)/.test(u)) n *= 24;
    else if (/^(m|min|мин)/.test(u)) n /= 60;
    return Math.min(n, MAX_HOURS);
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
        skip: f.skip != null && !isEmptyValue(f.skip) ? parseHours(f.skip) : null,
        userHeal: [], botHeal: [],       // [{ name, delta }] — лечение по ролплею
        userClear: [], botClear: [],     // id эффектов, которые прошли в ролплее
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
        userWhy: null, botWhy: null,     // почему не ест — коротко, для инфоблока
        shown: null,                     // id событий, которые модель показала в ответе (null — поля не было)
        userLikes: [], botLikes: [], userDislikes: [], botDislikes: [], userHabits: [], botHabits: [],
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
    // Беременность: «14», «wk 14», «4 months», «4 месяца», «T2», «2nd trimester», «второй триместр», «0»
    const preg = (v) => {
        if (v == null || v === '') return null;
        const x = String(v).toLowerCase();
        const tri = x.match(/(?:t|трим\p{L}*\s*)(\d)|(\d)\s*(?:st|nd|rd|th)?\s*(?:trim|трим)|(перв|втор|трет|first|second|third)\p{L}*\s*(?:trim|трим)/iu);
        if (tri) {
            const n = +(tri[1] || tri[2]) || ({ перв: 1, first: 1, втор: 2, second: 2, трет: 3, third: 3 }[tri[3]?.slice(0, 5)] || { перв: 1, втор: 2, трет: 3, first: 1, secon: 2, third: 3 }[tri[3]?.slice(0, 5)]);
            if (n >= 1 && n <= 3) return { trimester: n };
        }
        const m = x.match(/(\d+(?:[.,]\d+)?)\s*([a-zа-яё]*)/i);
        if (!m) return null;
        let n = parseFloat(m[1].replace(',', '.'));
        if (/^(mo|month|мес)/.test(m[2])) n = Math.round(n * 4.345);
        return Math.min(42, Math.round(n));
    };
    result.userPreg = preg(f.user_preg);
    result.botPreg = preg(f.bot_preg);
    const full = (v) => {
        const m = String(v ?? '').match(/\d+(?:[.,]\d+)?/);
        if (!m) return null;
        const n = parseFloat(m[0].replace(',', '.'));
        return n >= 0 && n <= 100 ? Math.round(n) : null;
    };
    // Лечение: «cold:+10, anemia:-5» / «простуда +10»
    const heal = (v) => {
        if (!v || isEmptyValue(v)) return [];
        return String(v).split(/[,;]+/).map(x => x.trim()).filter(Boolean).map(x => {
            const m = x.match(/^(.+?)[\s:=]*([+\-−]\s*\d+(?:[.,]\d+)?)\s*%?$/);
            if (!m) return null;
            return { name: m[1].trim(), delta: parseFloat(m[2].replace(/[−\s]/g, (c) => (c === '−' ? '-' : '')).replace(',', '.')) };
        }).filter(h => h && !isNaN(h.delta));
    };
    result.userHeal = heal(f.user_heal);
    result.botHeal = heal(f.bot_heal);
    const clear = (v) => (!v || isEmptyValue(v) ? [] : String(v).split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean));
    result.userClear = clear(f.user_clear);
    result.botClear = clear(f.bot_clear);

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
    result.userWhy = isEmptyValue(f.user_why) ? null : clean(f.user_why, 60);
    result.botWhy = isEmptyValue(f.bot_why) ? null : clean(f.bot_why, 60);
    if (f.shown != null) result.shown = isEmptyValue(f.shown) ? [] : String(f.shown).split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
    // Пищевой профиль: «квашеная капуста, мёд»; «-молоко» — разлюбил(а), убрать
    const prof = (v) => splitList(v || '').map(x => x.replace(/^["«]|["»]$/g, '').trim().slice(0, 50)).filter(x => x && !isEmptyValue(x)).slice(0, 8);
    result.userLikes = prof(f.user_likes); result.botLikes = prof(f.bot_likes);
    result.userDislikes = prof(f.user_dislikes); result.botDislikes = prof(f.bot_dislikes);
    result.userHabits = prof(f.user_habits); result.botHabits = prof(f.bot_habits);
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

    const drinkList = (v) => (v ? parseList(v, (e) => parseDrinkEntry(e)) : []);
    const eat = (v) => (v ? parseFoodList(v) : { foods: [], drinks: [] });
    const a = eat(f.ate), ua = eat(f.user_ate), ba = eat(f.bot_ate);
    result.ate = a.foods; result.userAte = ua.foods; result.botAte = ba.foods;
    result.drank = [...drinkList(f.drank), ...a.drinks];
    result.userDrank = [...drinkList(f.user_drank), ...ua.drinks];
    result.botDrank = [...drinkList(f.bot_drank), ...ba.drinks];

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
