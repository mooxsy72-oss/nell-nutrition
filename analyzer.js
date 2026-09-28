// nell-nutrition/analyzer.js
// Анализ карточек персонажей и персоны юзера + расчёт нормы калорий.

// ═══════════════════════════════════════════════════════════════
// УРОВНИ АКТИВНОСТИ и ТЕЛОСЛОЖЕНИЕ
// ═══════════════════════════════════════════════════════════════
export const ACTIVITY_LEVELS = {
    sedentary:   { mult: 1.2,   labelRu: 'Сидячий образ жизни' },
    light:       { mult: 1.375, labelRu: 'Лёгкая активность' },
    moderate:    { mult: 1.55,  labelRu: 'Умеренная активность' },
    active:      { mult: 1.725, labelRu: 'Активный образ жизни' },
    very_active: { mult: 1.9,   labelRu: 'Очень активный' },
};

export const BUILD_TYPES = {
    slim:     { modifier: -0.04, labelRu: 'Худощавое' },
    average:  { modifier: 0.0,   labelRu: 'Обычное' },
    athletic: { modifier: 0.08,  labelRu: 'Спортивное' },
    muscular: { modifier: 0.15,  labelRu: 'Мускулистое' },
    heavy:    { modifier: 0.05,  labelRu: 'Крупное' },
};

// ═══════════════════════════════════════════════════════════════
// ПОИСК СЛОВ С УЧЁТОМ КИРИЛЛИЦЫ
// \b в JS понимает только латиницу, поэтому для русских слов он никогда
// не срабатывал. Здесь граница — «не буква» с обеих сторон.
// Слово с * на конце — это основа: после неё могут идти любые буквы.
// ═══════════════════════════════════════════════════════════════
function wordRe(list, flags = 'giu') {
    const alts = list.map(w => {
        const stem = w.endsWith('*');
        const body = (stem ? w.slice(0, -1) : w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
        return stem ? body + '\\p{L}*' : body;
    });
    return new RegExp(`(?<![\\p{L}])(?:${alts.join('|')})(?![\\p{L}])`, flags);
}
function count(text, re) { return (text.match(re) || []).length; }
function has(text, list) { return wordRe(list, 'iu').test(text); }

// ═══════════════════════════════════════════════════════════════
// РАСЧЁТ НОРМЫ КАЛОРИЙ (формула Миффлина-Сан Жеора)
// ═══════════════════════════════════════════════════════════════
/**
 * BMR (базовый обмен) → TDEE (суточная норма с учётом активности).
 * @param {Object} p — { gender, weight, height, age, activity, build, pregnant, pregnancyWeek }
 * @returns {number} — округлённая норма ккал
 */
/**
 * Базовый обмен (ккал/сутки) — сколько тело тратит в полном покое.
 * Зависит от пола, веса, роста, возраста; мышцы добавляют расход.
 */
export function calculateBMR(p) {
    const gender = p.gender || 'unknown';
    const weight = p.weight || 65;
    const height = p.height || (gender === 'male' ? 178 : 165);
    const age = p.age || 28;
    const base = 10 * weight + 6.25 * height - 5 * age;
    let bmr = gender === 'male' ? base + 5 : gender === 'female' ? base - 161 : base - 78;
    bmr *= 1 + (BUILD_TYPES[p.build]?.modifier ?? 0);
    return Math.max(800, bmr);
}

export function calculateCalorieGoal(p) {
    const gender = p.gender || 'unknown';
    const weight = p.weight || 65;      // кг
    const height = p.height || (gender === 'male' ? 178 : 165); // см
    const age = p.age || 28;

    // Базовый обмен (BMR)
    let bmr;
    if (gender === 'male') {
        bmr = 10 * weight + 6.25 * height - 5 * age + 5;
    } else if (gender === 'female') {
        bmr = 10 * weight + 6.25 * height - 5 * age - 161;
    } else {
        // Неизвестный пол — усредняем
        bmr = 10 * weight + 6.25 * height - 5 * age - 78;
    }

    // Множитель активности
    const actMult = ACTIVITY_LEVELS[p.activity]?.mult ?? 1.375;
    let tdee = bmr * actMult;

    // Поправка на телосложение (больше мышц → выше расход)
    const buildMod = BUILD_TYPES[p.build]?.modifier ?? 0;
    tdee *= (1 + buildMod);

    // Беременность добавляет калории (2-3 триместр)
    if (p.pregnant && p.pregnancyWeek > 0) {
        if (p.pregnancyWeek >= 27) tdee += 450;
        else if (p.pregnancyWeek >= 13) tdee += 340;
        else tdee += 100;
    }

    // Округляем до 50
    return Math.max(1000, Math.round(tdee / 50) * 50);
}

// ═══════════════════════════════════════════════════════════════
// АНАЛИЗ ТЕКСТА КАРТОЧКИ
// ═══════════════════════════════════════════════════════════════
/**
 * Извлекает пол, возраст, рост, вес, телосложение и активность
 * из текстового описания персонажа.
 * @param {string} rawText — description + personality + first_mes
 * @returns {Object}
 */
export function analyzeCharacterText(rawText) {
    const text = (rawText || '').toLowerCase();
    const result = {
        gender: 'unknown',
        age: null,
        height: null,
        weight: null,
        build: 'average',
        activity: 'light',
        ed: {},
    };

    // ─── ПОЛ ───
    const maleWords = wordRe(['he', 'his', 'him', 'himself', 'man', 'male', 'boy', 'guy', 'father', 'brother',
        'king', 'lord', 'sir', 'husband', 'son', 'мужчина*', 'он', 'его', 'ему', 'им', 'парень*', 'парн*',
        'мужск*', 'отец', 'отца', 'папа*', 'брат*', 'король*', 'короля', 'мистер*', 'муж', 'мужа', 'сын*',
        'юноша*', 'господин*', 'сам']);
    const femaleWords = wordRe(['she', 'her', 'hers', 'herself', 'woman', 'female', 'girl', 'lady', 'mother',
        'sister', 'queen', 'miss', 'mrs', 'ms', 'wife', 'daughter', 'женщин*', 'она', 'её', 'ее', 'ей', 'ею',
        'девушк*', 'девочк*', 'женск*', 'мать', 'матери', 'мама*', 'сестр*', 'королев*', 'мисс', 'жена', 'жены',
        'дочь', 'дочери', 'госпожа*', 'сама']);

    const maleCount = count(text, maleWords);
    const femaleCount = count(text, femaleWords);

    if (maleCount > femaleCount * 1.2) result.gender = 'male';
    else if (femaleCount > maleCount * 1.2) result.gender = 'female';

    // ─── ВОЗРАСТ ───
    // "26-year-old", "age: 26", "26 лет", "aged 26", "26 years old"
    const ageMatch = text.match(/(\d{2})[\s-]*(?:year|years|лет|года|годов|yo\b)/i)
                  || text.match(/age[:\s]+(\d{2})/i)
                  || text.match(/возраст[:\s]+(\d{2})/i);
    if (ageMatch) {
        const a = parseInt(ageMatch[1]);
        if (a >= 16 && a <= 99) result.age = a;
    }

    // ─── РОСТ ───
    // "180 cm", "рост 175", "5'11" (футы/дюймы)
    const cmMatch = text.match(/(\d{3})\s*(?:cm|см|сантиметр)/i)
                 || text.match(/(?:height|рост)[:\s]+(\d{3})/i);
    if (cmMatch) {
        const h = parseInt(cmMatch[1]);
        if (h >= 120 && h <= 230) result.height = h;
    } else {
        // Футы и дюймы: 5'11" или 5 ft 11
        const ftMatch = text.match(/(?<!\d)(\d)\s*(?:'|′|ft\.?|feet|foot)\s*(?:(\d{1,2})\s*(?:"|″|in(?:ch(?:es)?)?)?)?(?![\d])/i);
        if (ftMatch) {
            const ft = parseInt(ftMatch[1]);
            const inch = parseInt(ftMatch[2] || '0');
            if (ft >= 4 && ft <= 7) {
                result.height = Math.round((ft * 30.48) + (inch * 2.54));
            }
        }
    }

    // ─── ВЕС ───
    const weightMatch = text.match(/(\d{2,3})\s*(?:kg|кг|kilo|килограмм)/i)
                     || text.match(/(?:weight|вес)[:\s]+(\d{2,3})/i);
    if (weightMatch) {
        const w = parseInt(weightMatch[1]);
        if (w >= 35 && w <= 250) result.weight = w;
    }

    // ─── ТЕЛОСЛОЖЕНИЕ ───
    if (has(text, ['muscular', 'buff', 'ripped', 'bodybuilder', 'jacked', 'мускулист*', 'качок', 'качк*', 'бодибилдер*', 'накачан*'])) {
        result.build = 'muscular';
    } else if (has(text, ['athletic', 'fit', 'toned', 'lean', 'спортивн*', 'подтянут*', 'атлетич*'])) {
        result.build = 'athletic';
    } else if (has(text, ['slim', 'slender', 'thin', 'petite', 'skinny', 'худ*', 'стройн*', 'хрупк*', 'миниатюрн*'])) {
        result.build = 'slim';
    } else if (has(text, ['heavy', 'large', 'plump', 'chubby', 'stout', 'fat', 'полн*', 'крупн*', 'толст*', 'грузн*', 'тучн*', 'пухл*'])) {
        result.build = 'heavy';
    }

    // ─── АКТИВНОСТЬ (по профессии/образу жизни) ───
    if (has(text, ['warrior*', 'soldier*', 'knight*', 'fighter*', 'athlete*', 'mercenar*', 'воин*', 'солдат*', 'рыцар*', 'боец', 'бойц*', 'спортсмен*', 'наёмни*', 'наемни*', 'гладиатор*', 'викинг*'])) {
        result.activity = 'very_active';
    } else if (has(text, ['adventurer*', 'hunter*', 'worker*', 'guard*', 'farmer*', 'blacksmith*', 'dancer*', 'авантюрист*', 'охотни*', 'рабоч*', 'стражни*', 'фермер*', 'кузнец*', 'танцор*', 'танцовщиц*', 'курьер*'])) {
        result.activity = 'active';
    } else if (has(text, ['traveler*', 'traveller*', 'merchant*', 'servant*', 'maid*', 'путешественни*', 'торговц*', 'торговец', 'слуг*', 'горничн*', 'официант*'])) {
        result.activity = 'moderate';
    } else if (has(text, ['scholar*', 'mage*', 'wizard*', 'noble*', 'scribe*', 'librarian*', 'student*', 'учён*', 'учен*', 'маг', 'мага', 'волшебни*', 'дворянин*', 'писар*', 'библиотекар*', 'студент*', 'программист*', 'офис*'])) {
        result.activity = 'sedentary';
    }

    // ─── РПП — только если прямо названо в карточке ───
    if (has(text, ['анорекси*', 'anorexi*'])) result.ed.anorexia = 'moderate';
    if (has(text, ['булими*', 'bulimi*'])) result.ed.bulimia = 'moderate';
    if (has(text, ['компульсивн* переедани*', 'психогенн* переедани*', 'binge eating', 'binge-eating', 'binge eater'])) result.ed.binge = 'moderate';

    return result;
}

// ═══════════════════════════════════════════════════════════════
// ПОЛНЫЙ АНАЛИЗ → готовые параметры персонажа
// ═══════════════════════════════════════════════════════════════
/**
 * Собирает всё вместе: анализ текста + дефолты по полу + расчёт нормы.
 * @param {string} rawText
 * @returns {Object} — { gender, age, height, weight, build, activity, calorieGoal }
 */
export function buildCharacterParams(rawText) {
    const a = analyzeCharacterText(rawText);

    const gender = a.gender;
    const age = a.age ?? 28;

    // Рост по умолчанию зависит от пола
    const height = a.height ?? (gender === 'male' ? 178 : gender === 'female' ? 165 : 170);

    // Вес по умолчанию — от роста (упрощённо, ИМТ ~22)
    let weight = a.weight;
    if (!weight) {
        const hM = height / 100;
        weight = Math.round(22 * hM * hM);
        if (gender === 'male') weight += 4;
        else if (gender === 'female') weight -= 3;
    }

    const build = a.build;
    const activity = a.activity;

    const calorieGoal = calculateCalorieGoal({
        gender, weight, height, age, activity, build,
        pregnant: false, pregnancyWeek: 0,
    });

    return { gender, age, height, weight, build, activity, calorieGoal, ed: a.ed };
}

// ═══════════════════════════════════════════════════════════════
// АНАЛИЗ НАЧАЛЬНОЙ СЫТОСТИ (по первому сообщению / сцене)
// ═══════════════════════════════════════════════════════════════
/**
 * Оценивает стартовую сытость персонажа по контексту сцены.
 * @param {string} text — текст первого сообщения
 * @returns {{ satiety: number, water: number, energy: number }}
 */
export function analyzeInitialState(text) {
    const t = (text || '').toLowerCase();

    let satiety = 70;
    let water = 75;
    let energy = 75;
    let startHour = 12;

    if (has(t, ['just ate', 'finished eating', 'full', 'feast', 'banquet', 'after dinner', 'after lunch', 'after breakfast',
        'наелся', 'наелась', 'поел', 'поела', 'сыт', 'сыта', 'после ужина', 'после обеда', 'после завтрака', 'пир*', 'застоль*'])) {
        satiety = 95;
    } else if (has(t, ['hungry', 'starving', 'empty stomach', "haven't eaten", 'havent eaten', 'голоден', 'голодна', 'голодн*',
        'проголодал*', 'пустой желудок', 'не ел', 'не ела', 'урчит', 'урчал*'])) {
        satiety = 30;
    }

    if (has(t, ['thirsty', 'parched', 'dry mouth', 'dehydrated', 'жажд*', 'хочет пить', 'хочется пить', 'пересохл*', 'обезвожен*'])) {
        water = 40;
    } else if (has(t, ['just drank', 'refreshed', 'напился', 'напилась', 'только что выпил*'])) {
        water = 90;
    }

    if (has(t, ['exhausted', 'tired', 'weary', 'sleepy', 'устал*', 'вымотан*', 'сонн*', 'измотан*', 'без сил'])) {
        energy = 40;
    } else if (has(t, ['woke up', 'rested', 'energetic', 'проснул*', 'отдохнувш*', 'бодр*', 'выспал*', 'полон сил', 'полна сил'])) {
        energy = 95;
    }

    // Время суток → стартовый час (для смены игрового дня) и поправки
    if (has(t, ['dawn', 'sunrise', 'рассвет*', 'на заре'])) startHour = 6;
    else if (has(t, ['morning', 'breakfast', 'утро', 'утром', 'утра', 'завтрак*'])) startHour = 8;
    else if (has(t, ['noon', 'midday', 'lunch', 'полдень', 'полдня', 'обед*'])) startHour = 13;
    else if (has(t, ['afternoon', 'после полудня', 'днём', 'днем'])) startHour = 15;
    else if (has(t, ['evening', 'sunset', 'dusk', 'dinner', 'вечер*', 'закат*', 'сумерк*', 'ужин*'])) startHour = 19;
    else if (has(t, ['midnight', 'полночь', 'полуночи'])) startHour = 0;
    else if (has(t, ['night', 'ночь', 'ночью', 'ночи', 'поздно'])) startHour = 23;

    if (startHour >= 5 && startHour <= 9) {
        satiety = Math.min(satiety, 55);
        energy = Math.max(energy, 85);
    }
    if (startHour >= 21 || startHour <= 2) {
        energy = Math.min(energy, 60);
    }

    return { satiety, water, energy, startHour };
}
