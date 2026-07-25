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
// РАСЧЁТ НОРМЫ КАЛОРИЙ (формула Миффлина-Сан Жеора)
// ═══════════════════════════════════════════════════════════════
/**
 * BMR (базовый обмен) → TDEE (суточная норма с учётом активности).
 * @param {Object} p — { gender, weight, height, age, activity, build, pregnant, pregnancyWeek }
 * @returns {number} — округлённая норма ккал
 */
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
    };

    // ─── ПОЛ ───
    const maleWords = /\b(he\b|his\b|him\b|man\b|male\b|boy\b|guy\b|мужчина|мужчин|он\b|его\b|ему\b|парень|мужской|father|отец|папа|brother|брат|king|король|lord|sir|мистер|husband|муж\b|son\b|сын)\b/gi;
    const femaleWords = /\b(she\b|her\b|hers\b|woman\b|female\b|girl\b|lady\b|женщина|женщин|она\b|её\b|ей\b|девушка|девуш|женский|mother|мать|мама|sister|сестра|queen|королева|miss\b|mrs\b|ms\b|мисс|wife|жена|daughter|дочь)\b/gi;

    const maleCount = (text.match(maleWords) || []).length;
    const femaleCount = (text.match(femaleWords) || []).length;

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
        const ftMatch = text.match(/(\d)\s*['′f](?:t|eet)?\s*(\d{1,2})?/i);
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
    if (/\b(muscular|buff|ripped|bodybuilder|jacked|мускулист|качок|бодибилдер|накачан)\b/i.test(text)) {
        result.build = 'muscular';
    } else if (/\b(athletic|fit\b|toned|lean\b|спортивн|подтянут|атлетич)\b/i.test(text)) {
        result.build = 'athletic';
    } else if (/\b(slim|slender|thin\b|petite|skinny|худ|стройн|тонк|хрупк)\b/i.test(text)) {
        result.build = 'slim';
    } else if (/\b(heavy|large|big\b|plump|chubby|stout|полн|крупн|толст|грузн|тучн)\b/i.test(text)) {
        result.build = 'heavy';
    }

    // ─── АКТИВНОСТЬ (по профессии/образу жизни) ───
    if (/\b(warrior|soldier|knight|fighter|athlete|mercenary|воин|солдат|рыцар|боец|спортсмен|наёмник|гладиатор|викинг)\b/i.test(text)) {
        result.activity = 'very_active';
    } else if (/\b(adventurer|hunter|worker|guard|farmer|blacksmith|dancer|авантюрист|охотник|рабоч|стражник|фермер|кузнец|танцор|курьер)\b/i.test(text)) {
        result.activity = 'active';
    } else if (/\b(traveler|merchant|servant|maid|путешественник|торговец|слуга|горничн|официант)\b/i.test(text)) {
        result.activity = 'moderate';
    } else if (/\b(scholar|mage|wizard|noble|scribe|librarian|student|учёный|маг|волшебник|дворянин|писарь|библиотекар|студент|программист|офис)\b/i.test(text)) {
        result.activity = 'sedentary';
    }

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

    return { gender, age, height, weight, build, activity, calorieGoal };
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

    // Базовые значения — «обычное» состояние, не идеальное
    let satiety = 70;
    let water = 75;
    let energy = 75;

    // ─── Признаки сытости ───
    if (/\b(just ate|finished eating|full\b|feast|banquet|after (?:dinner|lunch|breakfast)|наелся|наелась|поел|поела|сыт|после (?:ужина|обеда|завтрака)|пир|застолье)\b/i.test(t)) {
        satiety = 95;
    }
    // ─── Признаки голода ───
    else if (/\b(hungry|starving|empty stomach|haven'?t eaten|голоден|голодна|проголодал|пустой желудок|не ел|давно не ел|урчит)\b/i.test(t)) {
        satiety = 30;
    }

    // ─── Жажда ───
    if (/\b(thirsty|parched|dry mouth|dehydrated|жажда|хочет пить|пересохло|обезвожен)\b/i.test(t)) {
        water = 40;
    } else if (/\b(just drank|refreshed|напился|напилась|только что выпил)\b/i.test(t)) {
        water = 90;
    }

    // ─── Усталость / бодрость ───
    if (/\b(exhausted|tired|weary|sleepy|устал|устала|вымотан|сонн|измотан|без сил)\b/i.test(t)) {
        energy = 40;
    } else if (/\b(woke up|rested|fresh|energetic|проснул|отдохнул|бодр|выспал|полон сил)\b/i.test(t)) {
        energy = 95;
    }

    // Утро → чуть голоднее, но бодрее
    if (/\b(morning|dawn|утро|рассвет|утром)\b/i.test(t)) {
        satiety = Math.min(satiety, 55);
        energy = Math.max(energy, 85);
    }
    // Вечер/ночь → устал
    if (/\b(night|midnight|evening|ночь|полночь|вечер|поздно)\b/i.test(t)) {
        energy = Math.min(energy, 60);
    }

    return { satiety, water, energy };
}
