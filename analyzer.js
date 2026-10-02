// nell-nutrition/analyzer.js
// Формулы: базовый обмен и суточная норма калорий.

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
// РАСЧЁТ ОБМЕНА И НОРМЫ КАЛОРИЙ
// Параметры персонажей определяет ИИ (калибровка через тег), здесь только формулы.
// ═══════════════════════════════════════════════════════════════
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
