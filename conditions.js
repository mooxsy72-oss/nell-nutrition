// nell-nutrition/conditions.js
// Продвинутая система болезней, беременности и физиологических состояний.

// ═══════════════════════════════════════════════════════════════
// DISEASE DEFINITIONS — полное описание каждой болезни
// ═══════════════════════════════════════════════════════════════

export const DISEASE_DB = {
    hypoglycemia: {
        id: 'hypoglycemia',
        nameRu: 'Гипогликемия',
        nameEn: 'Hypoglycemia',
        category: 'metabolic',
        stages: {
            mild: {
                threshold: { hoursSinceLastMeal: 8, calories: 100 },
                effects: ['Лёгкое головокружение', 'Раздражительность'],
                effectsEn: ['Mild dizziness', 'Irritability'],
                modifiers: { energy: -5, focus: -10 },
                symptoms: 'Slight tremor in hands, difficulty concentrating, craving sweets.',
            },
            moderate: {
                threshold: { hoursSinceLastMeal: 14, calories: 0 },
                effects: ['Головокружение', 'Слабость', 'Тремор'],
                effectsEn: ['Dizziness', 'Weakness', 'Tremor'],
                modifiers: { energy: -15, focus: -25, physical: -15 },
                symptoms: 'Visible hand tremor, cold sweat, pale skin, trouble speaking clearly.',
            },
            severe: {
                threshold: { hoursSinceLastMeal: 22, calories: 0 },
                effects: ['Сильное головокружение', 'Спутанность', 'Обморок'],
                effectsEn: ['Severe dizziness', 'Confusion', 'Fainting risk'],
                modifiers: { energy: -30, focus: -50, physical: -40 },
                symptoms: 'Stumbling, slurred speech, visual disturbances, risk of losing consciousness.',
            },
            critical: {
                threshold: { hoursSinceLastMeal: 36, calories: 0 },
                effects: ['Потеря сознания', 'Судороги', 'Кома'],
                effectsEn: ['Loss of consciousness', 'Seizures', 'Coma risk'],
                modifiers: { energy: -60, focus: -80, physical: -70 },
                symptoms: 'Unable to stand, seizures possible, medical emergency, cannot act without help.',
            },
        },
        cure: { satiety: 40, calories: 200 },
        recovery: { mild: 1, moderate: 3, severe: 8, critical: 24 },

    },

    starvation: {
        id: 'starvation',
        nameRu: 'Истощение',
        nameEn: 'Starvation',
        category: 'metabolic',
        stages: {
            mild: {
                threshold: { hoursSinceLastMeal: 24 },
                effects: ['Постоянный голод', 'Слабость', 'Потеря веса'],
                effectsEn: ['Constant hunger', 'Weakness', 'Weight loss'],
                modifiers: { energy: -10, physical: -10 },
                symptoms: 'Stomach constantly aching, thinking about food obsessively, mild weakness.',
            },
            moderate: {
                threshold: { hoursSinceLastMeal: 48 },
                effects: ['Мышечная атрофия', 'Апатия', 'Озноб'],
                effectsEn: ['Muscle atrophy', 'Apathy', 'Chills'],
                modifiers: { energy: -25, physical: -30, focus: -20 },
                symptoms: 'Muscles visibly weaker, indifferent to surroundings, constantly cold.',
            },
            severe: {
                threshold: { hoursSinceLastMeal: 72 },
                effects: ['Органная недостаточность', 'Бред', 'Невозможность двигаться'],
                effectsEn: ['Organ failure risk', 'Delirium', 'Unable to move'],
                modifiers: { energy: -50, physical: -60, focus: -50 },
                symptoms: 'Bedridden, hallucinations, organs shutting down, death approaching.',
            },
            critical: {
                threshold: { hoursSinceLastMeal: 120 },
                effects: ['Смерть неизбежна без помощи'],
                effectsEn: ['Death imminent without intervention'],
                modifiers: { energy: -80, physical: -90, focus: -70 },
                symptoms: 'Unconscious, barely breathing, will die without immediate medical care and nutrition.',
            },
        },
        cure: { satiety: 60, calories: 500, hoursSinceLastMeal: 4 },
        recovery: { mild: 24, moderate: 72, severe: 168, critical: 336 },

    },

    dehydration_disease: {
        id: 'dehydration_disease',
        nameRu: 'Обезвоживание',
        nameEn: 'Dehydration',
        category: 'metabolic',
        stages: {
            mild: {
                threshold: { water: 25 },
                effects: ['Сухость во рту', 'Головная боль'],
                effectsEn: ['Dry mouth', 'Headache'],
                modifiers: { focus: -10, energy: -5 },
                symptoms: 'Lips cracking, mild headache, dark urine, thirst.',
            },
            moderate: {
                threshold: { water: 15 },
                effects: ['Сильная головная боль', 'Слабость', 'Тахикардия'],
                effectsEn: ['Severe headache', 'Weakness', 'Rapid heartbeat'],
                modifiers: { focus: -20, energy: -20, physical: -15 },
                symptoms: 'Pounding headache, heart racing, dizziness when standing, skin losing elasticity.',
            },
            severe: {
                threshold: { water: 8 },
                effects: ['Спутанность сознания', 'Обморок', 'Почечный стресс'],
                effectsEn: ['Confusion', 'Fainting', 'Kidney stress'],
                modifiers: { focus: -40, energy: -40, physical: -35 },
                symptoms: 'Confused, stumbling, no sweat despite heat, kidneys aching, fainting spells.',
            },
            critical: {
                threshold: { water: 3 },
                effects: ['Отказ органов', 'Кома'],
                effectsEn: ['Organ failure', 'Coma'],
                modifiers: { focus: -70, energy: -70, physical: -60 },
                symptoms: 'Unconscious, organs failing, death without immediate IV fluids.',
            },
        },
        cure: { water: 40 },
        recovery: { mild: 2, moderate: 8, severe: 24, critical: 72 },
    },

    malnutrition: {
        id: 'malnutrition',
        nameRu: 'Недоедание',
        nameEn: 'Malnutrition',
        category: 'chronic',
        stages: {
            mild: {
                threshold: { avgCalorieDeficit: 3 }, // 3 дня подряд дефицит
                effects: ['Усталость', 'Ломкость ногтей'],
                effectsEn: ['Fatigue', 'Brittle nails'],
                modifiers: { energy: -8, immune: -10 },
                symptoms: 'Always tired, nails breaking, hair dull, slightly slower healing.',
            },
            moderate: {
                threshold: { avgCalorieDeficit: 7 },
                effects: ['Анемия', 'Иммунодефицит', 'Потеря мышц'],
                effectsEn: ['Anemia', 'Immune weakness', 'Muscle loss'],
                modifiers: { energy: -20, immune: -25, physical: -15 },
                symptoms: 'Pale, bruises easily, gets sick often, muscles wasting, always cold.',
            },
            severe: {
                threshold: { avgCalorieDeficit: 14 },
                effects: ['Тяжёлая анемия', 'Когнитивный упадок', 'Выпадение волос'],
                effectsEn: ['Severe anemia', 'Cognitive decline', 'Hair loss'],
                modifiers: { energy: -35, immune: -40, physical: -30, focus: -25 },
                symptoms: 'Cannot think clearly, hair falling out in clumps, bones aching, infections constant.',
            },
        },
        cure: { avgCalorieDeficit: 0, satiety: 70 },
        recovery: { mild: 48, moderate: 120, severe: 240 },
    },
};

// ═══════════════════════════════════════════════════════════════
// PREGNANCY SYSTEM
// ═══════════════════════════════════════════════════════════════

export const PREGNANCY_STAGES = {
    0:  { trimester: 0, label: 'Не беременна', labelEn: 'Not pregnant', desc: '' },
    1:  { trimester: 1, label: '1-й триместр (ранний)', labelEn: '1st Trimester (early)', calMult: 1.0, waterMult: 1.05, nausea: true,
          desc: 'Совсем ранний срок. Тело только начинает меняться, внешне пока незаметно, но уже возможен токсикоз и перепады настроения.' },
    5:  { trimester: 1, label: '1-й триместр', labelEn: '1st Trimester', calMult: 1.05, waterMult: 1.1, nausea: true,
          desc: 'Первый триместр. Утренняя тошнота и лёгкая усталость — обычное дело, аппетит может быть непредсказуемым.' },
    13: { trimester: 2, label: '2-й триместр', labelEn: '2nd Trimester', calMult: 1.2, waterMult: 1.15, nausea: false,
          desc: 'Второй триместр. Токсикоз обычно отступает, самочувствие улучшается, но потребности в еде и воде заметно растут.' },
    27: { trimester: 3, label: '3-й триместр', labelEn: '3rd Trimester', calMult: 1.3, waterMult: 1.2, nausea: false, fatigue: true,
          desc: 'Третий триместр. Живот уже заметен, тело устаёт быстрее, нужно больше отдыха, еды и воды.' },
    36: { trimester: 3, label: '3-й триместр (поздний)', labelEn: '3rd Trimester (late)', calMult: 1.35, waterMult: 1.25, nausea: false, fatigue: true,
          desc: 'Поздний срок. Тело готовится к родам, усталость на максимуме, любая нагрузка ощущается сильнее обычного.' },
};

/**
 * Получить данные о стадии беременности.
 * @param {number} week — неделя (0 = не беременна)
 * @returns {Object}
 */
export function getPregnancyStage(week) {
    if (!week || week <= 0) return PREGNANCY_STAGES[0];

    const keys = Object.keys(PREGNANCY_STAGES).map(Number).sort((a, b) => a - b);
    let result = PREGNANCY_STAGES[0];
    for (const k of keys) {
        if (week >= k) result = PREGNANCY_STAGES[k];
    }
    return result;
}

/**
 * Применить эффекты беременности к персонажу.
 * Вызывается каждый тик.
 * @param {Object} charData
 * @returns {{ nausea: boolean, extraFatigue: boolean, trimesterLabel: string }}
 */
export function applyPregnancyEffects(charData) {
    if (!charData.pregnant || !charData.pregnancyWeek) {
        return { nausea: false, extraFatigue: false, trimesterLabel: '' };
    }

    const stage = getPregnancyStage(charData.pregnancyWeek);
    const nausea = stage.nausea && charData.satiety > 20; // тошнота на сытый желудок
    const extraFatigue = stage.fatigue || false;

    // Тошнота снижает сытость
    if (nausea && Math.random() < 0.3) {
        charData.satiety = Math.max(0, charData.satiety - 5);
    }

    // Дополнительная усталость в 3-м триместре
    if (extraFatigue) {
        charData.energy = Math.max(0, charData.energy - 1);
    }

    return {
        nausea,
        extraFatigue,
        trimesterLabel: stage.label,
    };
}

// ═══════════════════════════════════════════════════════════════
// IMMUNITY SYSTEM — простая модель
// ═══════════════════════════════════════════════════════════════

/**
 * Рассчитать уровень иммунитета (0-100).
 * Зависит от питания, сна, болезней.
 * @param {Object} charData
 * @returns {number}
 */
export function calculateImmunity(charData) {
    let immunity = 80; // базовый

    // Хорошее питание
    if (charData.satiety >= 60 && charData.water >= 60) immunity += 10;

    // Высокая энергия (хороший сон)
    if (charData.energy >= 70) immunity += 5;

    // Штрафы
    if (charData.satiety < 30) immunity -= 15;
    if (charData.water < 30) immunity -= 10;
    if (charData.energy < 30) immunity -= 10;
    if (charData.hoursSinceLastMeal > 16) immunity -= 15;

    // Болезни снижают иммунитет
    immunity -= charData.diseases.length * 10;

    // Беременность немного снижает
    if (charData.pregnant) immunity -= 5;

    return Math.max(0, Math.min(100, immunity));
}

// ═══════════════════════════════════════════════════════════════
// ADVANCED CONDITION EVALUATION
// ═══════════════════════════════════════════════════════════════

/**
 * Продвинутая проверка болезней с прогрессией по стадиям.
 * Заменяет простую updateConditions из nutrition-engine.js
 * @param {Object} charData
 * @returns {{ added: string[], removed: string[], progressed: string[] }}
 */
export function evaluateConditions(charData, hours = 0) {
    const added = [];
    const removed = [];
    const progressed = [];
    const recovering = [];

    evaluateDisease(charData, DISEASE_DB.hypoglycemia, hours, added, removed, progressed, recovering);
    evaluateDisease(charData, DISEASE_DB.dehydration_disease, hours, added, removed, progressed, recovering);
    evaluateDisease(charData, DISEASE_DB.starvation, hours, added, removed, progressed, recovering);
    evaluateMalnutrition(charData, hours, added, removed, progressed, recovering);

    evaluateSimpleDebuffs(charData, hours, added, removed);
    evaluateBuffs(charData, hours, added, removed);

    if (charData.pregnant) {
        applyPregnancyEffects(charData);
    }

    return { added, removed, progressed, recovering };
}

function formatHours(h) {
    if (h >= 24) {
        const d = Math.floor(h / 24);
        const rest = Math.round(h % 24);
        return rest > 0 ? `${d}д ${rest}ч` : `${d}д`;
    }
    return `${Math.round(h)}ч`;
}

function evaluateDisease(charData, diseaseDef, hours, added, removed, progressed, recovering) {
    const existing = charData.diseases.find(d => d.id === diseaseDef.id);
    const currentStage = determineStage(charData, diseaseDef);

    // ── Болезни ещё нет ──
    if (!existing) {
        if (currentStage) {
            charData.diseases.push({
                id: diseaseDef.id,
                name: diseaseDef.nameRu,
                nameEn: diseaseDef.nameEn,
                severity: currentStage,
                effects: diseaseDef.stages[currentStage].effects,
                effectsEn: diseaseDef.stages[currentStage].effectsEn,
                modifiers: diseaseDef.stages[currentStage].modifiers,
                symptoms: diseaseDef.stages[currentStage].symptoms,
                elapsedHours: 0,
                recoveryHours: 0,
                recovering: false,
                since: '0ч',
            });
            added.push(diseaseDef.id);
        }
        return;
    }

    // ── Болезнь есть — время идёт ──
    existing.elapsedHours = (existing.elapsedHours || 0) + hours;
    existing.since = formatHours(existing.elapsedHours);

    const cureConditionsMet = isCured(charData, diseaseDef.cure) || !currentStage;

    if (cureConditionsMet) {
        // Условия лечения выполнены, но выздоровление требует времени
        if (!existing.recovering) {
            existing.recovering = true;
            existing.recoveryHours = 0;
            recovering.push(diseaseDef.id);
        } else {
            existing.recoveryHours = (existing.recoveryHours || 0) + hours;
        }

        const needHours = diseaseDef.recovery?.[existing.severity] ?? 6;
        if (existing.recoveryHours >= needHours) {
            charData.diseases = charData.diseases.filter(d => d.id !== diseaseDef.id);
            removed.push(diseaseDef.id);
        }
        return;
    }

    // ── Условия лечения НЕ выполнены — выздоровление обрывается ──
    if (existing.recovering) {
        existing.recovering = false;
        existing.recoveryHours = 0;
    }

    // Прогрессия / регрессия стадии
    if (existing.severity !== currentStage) {
        const stages = ['mild', 'moderate', 'severe', 'critical'];
        const oldIdx = stages.indexOf(existing.severity);
        const newIdx = stages.indexOf(currentStage);

        existing.severity = currentStage;
        existing.effects = diseaseDef.stages[currentStage].effects;
        existing.effectsEn = diseaseDef.stages[currentStage].effectsEn;
        existing.modifiers = diseaseDef.stages[currentStage].modifiers;
        existing.symptoms = diseaseDef.stages[currentStage].symptoms;

        if (newIdx > oldIdx) progressed.push(diseaseDef.id);
    }
}

function determineStage(charData, diseaseDef) {
    const stages = ['critical', 'severe', 'moderate', 'mild'];

    for (const stage of stages) {
        const stageData = diseaseDef.stages[stage];
        if (!stageData) continue;

        const t = stageData.threshold;
        let match = true;

        if (t.hoursSinceLastMeal !== undefined && (charData.hoursSinceLastMeal || 0) < t.hoursSinceLastMeal) match = false;
        if (t.calories !== undefined && charData.calories > t.calories) match = false;
        if (t.water !== undefined && charData.water > t.water) match = false;
        if (t.satiety !== undefined && charData.satiety > t.satiety) match = false;

        if (match) return stage;
    }

    return null;
}

function isCured(charData, cure) {
    if (!cure) return false;
    let cured = true;

    if (cure.satiety !== undefined && charData.satiety < cure.satiety) cured = false;
    if (cure.calories !== undefined && charData.calories < cure.calories) cured = false;
    if (cure.water !== undefined && charData.water < cure.water) cured = false;
    if (cure.hoursSinceLastMeal !== undefined && (charData.hoursSinceLastMeal || 0) > cure.hoursSinceLastMeal) cured = false;

    return cured;
}

function evaluateMalnutrition(charData, hours, added, removed, progressed, recovering) {
    const def = DISEASE_DB.malnutrition;
    const existing = charData.diseases.find(d => d.id === 'malnutrition');

    const deficit = charData.calorieGoal - charData.calories;
    const isDeficit = deficit > charData.calorieGoal * 0.4 && (charData.hoursSinceLastMeal || 0) >= 24;

    let stage = 'mild';
    if (charData.hoursSinceLastMeal >= 72) stage = 'severe';
    else if (charData.hoursSinceLastMeal >= 48) stage = 'moderate';

    if (!existing) {
        if (isDeficit) {
            charData.diseases.push({
                id: 'malnutrition',
                name: def.nameRu,
                nameEn: def.nameEn,
                severity: stage,
                effects: def.stages[stage].effects,
                effectsEn: def.stages[stage].effectsEn,
                modifiers: def.stages[stage].modifiers,
                symptoms: def.stages[stage].symptoms,
                elapsedHours: 0,
                recoveryHours: 0,
                recovering: false,
                since: '0ч',
            });
            added.push('malnutrition');
        }
        return;
    }

    existing.elapsedHours = (existing.elapsedHours || 0) + hours;
    existing.since = formatHours(existing.elapsedHours);

    const cureMet = !isDeficit && charData.satiety > 60;

    if (cureMet) {
        if (!existing.recovering) {
            existing.recovering = true;
            existing.recoveryHours = 0;
            recovering.push('malnutrition');
        } else {
            existing.recoveryHours = (existing.recoveryHours || 0) + hours;
        }
        const needHours = def.recovery?.[existing.severity] ?? 48;
        if (existing.recoveryHours >= needHours) {
            charData.diseases = charData.diseases.filter(d => d.id !== 'malnutrition');
            removed.push('malnutrition');
        }
        return;
    }

    if (existing.recovering) {
        existing.recovering = false;
        existing.recoveryHours = 0;
    }

    if (existing.severity !== stage) {
        const stages = ['mild', 'moderate', 'severe', 'critical'];
        const wasWorse = stages.indexOf(stage) > stages.indexOf(existing.severity);
        existing.severity = stage;
        existing.effects = def.stages[stage].effects;
        existing.effectsEn = def.stages[stage].effectsEn;
        existing.modifiers = def.stages[stage].modifiers;
        existing.symptoms = def.stages[stage].symptoms;
        if (wasWorse) progressed.push('malnutrition');
    }
}

function evaluateSimpleDebuffs(charData, hours, added, removed) {
    // Голод — отпускает быстро после еды (0.5ч)
    toggleDebuff(charData, hours, 0.5, 'hunger', 'Голод', '🍽', '-20% Энергии',
        ['Энергия -20%', 'Концентрация -15%'],
        charData.satiety <= 20 && charData.hoursSinceLastMeal >= 6,
        charData.satiety > 35,
        added, removed);

    // Жажда — головная боль и сухость держатся ~1ч после питья
    toggleDebuff(charData, hours, 1, 'dehydration', 'Жажда', '💧', '-15% Стамина',
        ['Стамина -15%', 'Концентрация -10%'],
        charData.water <= 25,
        charData.water > 35,
        added, removed);

    // Истощение — тело приходит в себя долго (4ч)
    toggleDebuff(charData, hours, 4, 'exhaustion', 'Истощение', '😴', '-30% Действия',
        ['Физические действия -30%', 'Фокус -25%'],
        charData.energy <= 15,
        charData.energy > 30,
        added, removed);

    // Сонливость — рассеивается за 1ч
    toggleDebuff(charData, hours, 1, 'drowsiness', 'Сонливость', '💤', '-10% Фокус',
        ['Фокус -10%', 'Реакция -10%'],
        charData.energy <= 30 && charData.energy > 15,
        charData.energy > 40 || charData.energy <= 15,
        added, removed);

    // Переедание — тяжесть в животе ~2ч
    toggleDebuff(charData, hours, 2, 'overeating', 'Переедание', '🤢', '-10% Энергии',
        ['Вялость', 'Энергия -10%'],
        charData.calories > charData.calorieGoal * 1.4,
        charData.calories <= charData.calorieGoal * 1.2,
        added, removed);
}


function toggleDebuff(charData, hours, lingerHours, id, name, icon, effect, effects, conditionOn, conditionOff, added, removed) {
    const exists = charData.debuffs.find(d => d.id === id);

    // Причина активна — дебаф в полной силе (обрываем затухание, если было)
    if (conditionOn) {
        if (!exists) {
            charData.debuffs.push({ id, name, icon, effect, effects, fading: false, fadeLeft: 0 });
            added.push(id);
        } else if (exists.fading) {
            exists.fading = false;
            exists.fadeLeft = 0;
        }
        return;
    }

    if (!exists) return;

    // Причина устранена — начинаем/продолжаем затухание
    if (conditionOff && !exists.fading) {
        exists.fading = true;
        exists.fadeLeft = lingerHours;
        return;
    }

    if (exists.fading) {
        exists.fadeLeft -= hours;
        if (exists.fadeLeft <= 0) {
            charData.debuffs = charData.debuffs.filter(d => d.id !== id);
            removed.push(id);
        }
    }
}

function evaluateBuffs(charData, hours, added, removed) {
    // Чистим устаревший бафф «Баланс» из старых сохранений
    if (charData.buffs.some(b => b.id === 'balanced')) {
        charData.buffs = charData.buffs.filter(b => b.id !== 'balanced');
        removed.push('balanced');
    }

    // Сытость — держится, пока показатели высокие, потом ещё до 5ч
    toggleBuff(charData, hours, 5, 'well_fed', 'Сытость', '🍲', '+0.8% энергии/ч · +0.5% здоровья/ч · −15% траты энергии',
        charData.satiety >= 75 && charData.calories >= charData.calorieGoal * 0.6,
        charData.satiety < 60,
        added, removed);

    // Гидратация — до 4ч
    toggleBuff(charData, hours, 4, 'hydrated', 'Гидратация', '💧', '+0.3% энергии/ч · +0.5% здоровья/ч · −10% траты воды',
        charData.water >= 80,
        charData.water < 65,
        added, removed);

    // Бодрость — до 6ч
    toggleBuff(charData, hours, 6, 'high_energy', 'Бодрость', '⚡', '+0.3% здоровья/ч · −12% траты энергии',
        charData.energy >= 85,
        charData.energy < 70,
        added, removed);
}


function toggleBuff(charData, hours, maxHours, id, name, icon, effect, conditionOn, conditionOff, added, removed) {
    const exists = charData.buffs.find(b => b.id === id);

    // Условие выполняется — бафф активен, таймер полный
    if (conditionOn) {
        if (!exists) {
            charData.buffs.push({ id, name, icon, effect, hoursLeft: maxHours });
            added.push(id);
        } else {
            exists.hoursLeft = maxHours;
        }
        return;
    }

    if (!exists) return;

    // Условие больше не выполняется — таймер тикает вниз
    exists.hoursLeft = (exists.hoursLeft ?? maxHours) - hours;
    if (conditionOff || exists.hoursLeft <= 0) {
        charData.buffs = charData.buffs.filter(b => b.id !== id);
        removed.push(id);
    }
}

// ═══════════════════════════════════════════════════════════════
// PROMPT GENERATION — описание симптомов для ИИ
// ═══════════════════════════════════════════════════════════════

/**
 * Генерирует блок текста для системного промпта, описывающий
 * симптомы и ограничения персонажа.
 * @param {Object} charData
 * @param {string} charName
 * @returns {string}
 */
export function buildConditionPrompt(charData, charName) {
    const lines = [];

    // Болезни с симптомами (+ фаза выздоровления)
    for (const disease of charData.diseases) {
        const def = DISEASE_DB[disease.id];
        const duration = disease.since ? `, ongoing ${disease.since}` : '';
        if (def && def.stages[disease.severity]) {
            const stage = def.stages[disease.severity];
            if (disease.recovering) {
                lines.push(`  ⚠ ${disease.nameEn} (${disease.severity}${duration}) — RECOVERING: the body is healing but symptoms persist in weakened form. Show gradual improvement, NOT instant health. ${stage.symptoms}`);
            } else {
                lines.push(`  ⚠ ${disease.nameEn} (${disease.severity}${duration}): ${stage.symptoms}`);
            }
        } else {
            lines.push(`  ⚠ ${disease.name} (${disease.severity}${duration})`);
        }
    }

    // Дебаффы — живые описания для нарратива
    const DEBUFF_PROMPTS = {
        hunger: 'Hunger — stomach growls audibly, irritable, distracted by thoughts of food; tires noticeably faster.',
        dehydration: 'Thirst — dry cracked lips, dull headache, sluggish movements; keeps craving water.',
        exhaustion: 'Exhaustion — heavy limbs, slow reactions, slurred focus; demanding physical actions fail easily.',
        drowsiness: 'Drowsiness — heavy eyelids, yawning, attention drifts mid-conversation.',
        overeating: 'Overeating — sluggish, heavy stomach, mild nausea, wants to sit or lie down.',
    };
    for (const debuff of charData.debuffs) {
        const base = DEBUFF_PROMPTS[debuff.id] || debuff.name;
        lines.push(debuff.fading
            ? `  ☠ ${base} (FADING — the worst has passed, show only mild residual traces easing away)`
            : `  ☠ ${base}`);
    }

    // Баффы — живые описания
    const BUFF_PROMPTS = {
        well_fed: 'Well fed — steady strength, warm contentment, high endurance; body performs at its best.',
        hydrated: 'Hydrated — clear head, fresh complexion, good stamina.',
        high_energy: 'Energetic — quick and alert, movements light and confident.',
    };
    for (const buff of charData.buffs) {
        lines.push(`  ✦ ${BUFF_PROMPTS[buff.id] || buff.name}`);
    }


    // Беременность
    if (charData.pregnant && charData.pregnancyWeek > 0) {
        const stage = getPregnancyStage(charData.pregnancyWeek);
        lines.push(`  🤰 Pregnant: ${stage.labelEn} (week ${charData.pregnancyWeek})`);
        if (stage.nausea) lines.push(`     Morning sickness active — may feel nauseous, especially after eating.`);
        if (stage.fatigue) lines.push(`     Extra fatigue — tires faster, needs more rest and food.`);
    }

    // Иммунитет
    const immunity = calculateImmunity(charData);
    if (immunity < 40) {
        lines.push(`  🛡 Immune system WEAKENED (${immunity}%) — vulnerable to infections, slow healing.`);
    }

    if (lines.length === 0) return '';

    return `\n${charName} — active conditions (MANDATORY: at least one symptom from EACH line below must visibly appear in this reply's narration):\n${lines.join('\n')}`;
}

