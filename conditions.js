// nell-nutrition/conditions.js
// Продвинутая система болезней, беременности и физиологических состояний.

import { goalOf } from './nutrition-engine.js';
import { EFFECT_INFO, effectLevel, toggleEffect, grantEffect, hasEffect } from './effects.js';

// ═══════════════════════════════════════════════════════════════
// DISEASE DEFINITIONS — полное описание каждой болезни
// ═══════════════════════════════════════════════════════════════

export const DISEASE_DB = {
    hypoglycemia: {
        id: 'hypoglycemia',
        nameRu: 'Гипогликемия',
        nameEn: 'Hypoglycemia',
        category: 'physical',
        stages: {
            mild: {
                threshold: { hoursSinceLastMeal: 8, reserve: 100 },
                effects: ['Лёгкое головокружение', 'Раздражительность'],
                effectsEn: ['Mild dizziness', 'Irritability'],
                modifiers: { energy: -5, focus: -10 },
                symptoms: 'Slight tremor in hands, difficulty concentrating, craving sweets.',
            },
            moderate: {
                threshold: { hoursSinceLastMeal: 14, reserve: 0 },
                effects: ['Головокружение', 'Слабость', 'Тремор'],
                effectsEn: ['Dizziness', 'Weakness', 'Tremor'],
                modifiers: { energy: -15, focus: -25, physical: -15 },
                symptoms: 'Visible hand tremor, cold sweat, pale skin, trouble speaking clearly.',
            },
            severe: {
                threshold: { hoursSinceLastMeal: 22, reserve: 0 },
                effects: ['Сильное головокружение', 'Спутанность', 'Обморок'],
                effectsEn: ['Severe dizziness', 'Confusion', 'Fainting risk'],
                modifiers: { energy: -30, focus: -50, physical: -40 },
                symptoms: 'Stumbling, slurred speech, visual disturbances, risk of losing consciousness.',
            },
            critical: {
                threshold: { hoursSinceLastMeal: 36, reserve: 0 },
                effects: ['Потеря сознания', 'Судороги', 'Кома'],
                effectsEn: ['Loss of consciousness', 'Seizures', 'Coma risk'],
                modifiers: { energy: -60, focus: -80, physical: -70 },
                symptoms: 'Unable to stand, seizures possible, medical emergency, cannot act without help.',
            },
        },
        cure: { satiety: 40, reserve: 200 },
        recovery: { mild: 1, moderate: 3, severe: 8, critical: 24 },

    },

    starvation: {
        id: 'starvation',
        nameRu: 'Истощение',
        nameEn: 'Starvation',
        category: 'physical',
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
        cure: { satiety: 60, reserve: 500, hoursSinceLastMeal: 4 },
        recovery: { mild: 24, moderate: 72, severe: 168, critical: 336 },

    },

    dehydration_disease: {
        id: 'dehydration_disease',
        nameRu: 'Обезвоживание',
        nameEn: 'Dehydration',
        category: 'physical',
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
        category: 'physical',
        stages: {
            mild: {
                threshold: { deficitDays: 3 }, // 3 дня подряд дефицит
                effects: ['Усталость', 'Ломкость ногтей'],
                effectsEn: ['Fatigue', 'Brittle nails'],
                modifiers: { energy: -8, immune: -10 },
                symptoms: 'Always tired, nails breaking, hair dull, slightly slower healing.',
            },
            moderate: {
                threshold: { deficitDays: 7 },
                effects: ['Анемия', 'Иммунодефицит', 'Потеря мышц'],
                effectsEn: ['Anemia', 'Immune weakness', 'Muscle loss'],
                modifiers: { energy: -20, immune: -25, physical: -15 },
                symptoms: 'Pale, bruises easily, gets sick often, muscles wasting, always cold.',
            },
            severe: {
                threshold: { deficitDays: 14 },
                effects: ['Тяжёлая анемия', 'Когнитивный упадок', 'Выпадение волос'],
                effectsEn: ['Severe anemia', 'Cognitive decline', 'Hair loss'],
                modifiers: { energy: -35, immune: -40, physical: -30, focus: -25 },
                symptoms: 'Cannot think clearly, hair falling out in clumps, bones aching, infections constant.',
            },
        },
        cure: { deficitDays: 2, satiety: 60 },
        recovery: { mild: 48, moderate: 120, severe: 240 },
    },
    // ─── Новые физические ───
    refeeding: {
        id: 'refeeding', nameRu: 'Рефидинг-синдром', nameEn: 'Refeeding syndrome', category: 'physical',
        stages: {
            severe: {
                effects: ['Слабость', 'Отёки', 'Перебои сердца'],
                modifiers: { energy: -30, physical: -35 },
                symptoms: 'After eating too much too fast following long starvation: sudden weakness, swelling ankles, shortness of breath, irregular heartbeat. Needs small, careful meals and rest.',
                cues: ['ankles look swollen', 'short of breath climbing a few steps', 'a fluttering heartbeat', 'too weak to lift a full cup'],
            },
            critical: {
                effects: ['Аритмия', 'Судороги', 'Спутанность'],
                modifiers: { energy: -60, physical: -70 },
                symptoms: 'Dangerous refeeding reaction: arrhythmia, muscle cramps or seizures, confusion. A medical emergency.',
                cues: ['clutches at the chest', 'muscles cramp and lock', 'confused about where they are'],
            },
        },
        recovery: { severe: 48, critical: 96 },
    },
    electrolyte: {
        id: 'electrolyte', nameRu: 'Электролитный дисбаланс', nameEn: 'Electrolyte imbalance', category: 'physical',
        stages: {
            mild: { effects: ['Слабость', 'Судороги в мышцах'], modifiers: { energy: -8 },
                symptoms: 'Muscle twitches or cramps, unusual fatigue.', cues: ['a calf cramp', 'an eyelid twitch', 'unexpectedly tired'] },
            moderate: { effects: ['Сердцебиение', 'Головокружение'], modifiers: { energy: -20, physical: -15 },
                symptoms: 'Palpitations, dizziness, weakness; the body feels unreliable.', cues: ['heart skips a beat', 'grabs a wall when dizzy', 'hands shake'] },
            severe: { effects: ['Аритмия', 'Сильная слабость'], modifiers: { energy: -40, physical: -40 },
                symptoms: 'Irregular heartbeat, severe weakness, risk of collapse. Dangerous.', cues: ['pale and clammy', 'has to sit down mid-sentence', 'pulse visibly uneven'] },
        },
        recovery: { mild: 6, moderate: 24, severe: 48 },
    },
    alcohol_poisoning: {
        id: 'alcohol_poisoning', nameRu: 'Алкогольное отравление', nameEn: 'Alcohol poisoning', category: 'physical',
        stages: {
            severe: { effects: ['Рвота', 'Спутанность', 'Потеря координации'], modifiers: { energy: -40, physical: -60, focus: -60 },
                symptoms: 'Vomiting, confusion, cannot walk straight, drifting in and out. Should not be left alone.', cues: ['can\'t stand without help', 'mumbles incoherently', 'skin cold and damp'] },
            critical: { effects: ['Потеря сознания', 'Угнетение дыхания'], modifiers: { energy: -80, physical: -90, focus: -90 },
                symptoms: 'Unresponsive, slow or irregular breathing. Life-threatening without help.', cues: ['won\'t wake when shaken', 'breathing slow and shallow'] },
        },
        recovery: { severe: 12, critical: 24 },
    },

    // ─── Психика: последствия голода ───
    food_obsession: {
        id: 'food_obsession', nameRu: 'Пищевая одержимость', nameEn: 'Food preoccupation', category: 'mental',
        stages: {
            mild: { effects: ['Мысли о еде', 'Рассеянность'], modifiers: { focus: -10 },
                symptoms: 'Thoughts keep circling back to food; notices every smell, talks about meals.', cues: ['brings up food in an unrelated conversation', 'notices a bakery smell from far away', 'plans the next meal out loud'] },
            moderate: { effects: ['Навязчивые мысли о еде', 'Трудно сосредоточиться'], modifiers: { focus: -25 },
                symptoms: 'Food dominates thinking: daydreams about meals, fixates on others eating, hard to focus on anything else.', cues: ['watches someone eat with total focus', 'loses the thread when food is mentioned', 'counts crumbs on a plate'] },
            severe: { effects: ['Одержимость едой', 'Эмоциональные срывы'], modifiers: { focus: -45 },
                symptoms: 'Food is almost all the mind can hold; emotional outbursts, may take food without thinking.', cues: ['hands reach for food before thinking', 'tears up over a missed meal', 'hides a scrap in a pocket'] },
        },
        recovery: { mild: 12, moderate: 48, severe: 120 },
    },
    hunger_apathy: {
        id: 'hunger_apathy', nameRu: 'Голодная апатия', nameEn: 'Starvation apathy', category: 'mental',
        stages: {
            mild: { effects: ['Упадок настроения', 'Меньше интереса'], modifiers: { focus: -10 },
                symptoms: 'Flat mood, less interest in things that usually matter.', cues: ['shrugs at news that should excite', 'a smile that doesn\'t reach the eyes', 'lets a joke pass without reacting'] },
            moderate: { effects: ['Апатия', 'Замкнутость'], modifiers: { focus: -20, energy: -10 },
                symptoms: 'Apathy and withdrawal; everything feels like too much effort, irritable when pushed.', cues: ['answers in a monotone', 'stays sitting when everyone stands', 'doesn\'t bother to argue'] },
            severe: { effects: ['Подавленность', 'Безразличие к себе'], modifiers: { focus: -35, energy: -20 },
                symptoms: 'Deep low mood, indifference even to own safety; slow speech, long silences.', cues: ['long silence before answering', 'stares at nothing', 'doesn\'t flinch at danger'] },
        },
        recovery: { mild: 24, moderate: 72, severe: 168 },
    },
    food_insecurity: {
        id: 'food_insecurity', nameRu: 'Пищевая тревожность', nameEn: 'Food insecurity anxiety', category: 'mental',
        stages: {
            mild: { effects: ['Тревога, когда еды мало', 'Прячет запасы'], modifiers: { focus: -5 },
                symptoms: 'After real hunger: uneasy when food runs low, keeps a stash, eats quickly, hates wasting food.', cues: ['slips bread into a pocket for later', 'eats fast, guarding the plate', 'counts the remaining supplies', 'scrapes the plate clean'] },
            moderate: { effects: ['Сильная тревога о еде', 'Накопительство'], modifiers: { focus: -15 },
                symptoms: 'Lasting mark of starvation: panic when food is scarce, hoards, cannot leave food uneaten, distrustful about sharing.', cues: ['tenses when someone reaches for their food', 'keeps checking a hidden stash', 'eats past fullness because it might not come again'] },
        },
        recovery: { mild: 240, moderate: 480 },
    },
};

// ═══════════════════════════════════════════════════════════════
// РАССТРОЙСТВА ПИЩЕВОГО ПОВЕДЕНИЯ — черта персонажа, задаётся вручную
// ═══════════════════════════════════════════════════════════════
export const ED_DB = {
    anorexia: {
        nameRu: 'Анорексия', nameEn: 'anorexia nervosa',
        prompt: 'intense fear around eating and weight gain, rigid rules and rituals around food, minimizing or hiding how little they eat, distorted self-perception, and ambivalence — part of them wants help',
        stages: {
            mild: 'mostly hidden; restraint and anxiety around meals, excuses not to eat',
            moderate: 'visible restriction and weight loss, cold hands, fatigue, conflict when pressed to eat',
            severe: 'the body is breaking down: dizziness, weakness, fainting risk; eating feels unbearable; they need real help',
        },
        cues: ['cuts food into small pieces and moves it around the plate', 'says they already ate', 'goes quiet when a meal is mentioned',
            'wraps a sleeve over thin wrists', 'an anxious glance at the portion size', 'fidgets instead of eating'],
    },
    bulimia: {
        nameRu: 'Булимия', nameEn: 'bulimia nervosa',
        prompt: 'cycles of feeling out of control with food, then intense shame and secrecy; mood swings tied to eating; hides evidence; a hidden physical toll',
        stages: {
            mild: 'well hidden; secrecy and guilt around food',
            moderate: 'regular episodes, noticeable disappearances after meals, fatigue, sore throat',
            severe: 'frequent episodes, weakness, palpitations, dental and throat damage; the illness runs their days',
        },
        cues: ['excuses themselves right after a meal', 'a forced brightness after eating', 'is careful no one sees them eat',
            'a hoarse voice', 'overly cheerful to deflect a question'],
    },
    binge: {
        nameRu: 'Компульсивное переедание', nameEn: 'binge eating disorder',
        prompt: 'episodes of eating well past fullness with a sense of lost control, often alone or in secret, triggered by stress or emotions rather than hunger, followed by shame',
        stages: {
            mild: 'occasional episodes under stress',
            moderate: 'frequent episodes, eating in secret, strong guilt',
            severe: 'eating to cope with almost every difficult feeling; intense shame and isolation',
        },
        cues: ['reaches for food when upset', 'eats quickly without tasting', 'hides wrappers',
            'says they are not hungry but keeps eating'],
    },
};
export const ED_SEV_LABEL = { mild: 'лёгкая', moderate: 'средняя', severe: 'тяжёлая' };

export function edList(c) {
    return Object.entries(c.ed || {}).filter(([k, v]) => v && ED_DB[k]).map(([k, v]) => ({ id: k, severity: v }));
}


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
export function applyPregnancyEffects(charData, hours = 0) {
    if (!charData.pregnant || !charData.pregnancyWeek) {
        return { nausea: false, extraFatigue: false, trimesterLabel: '' };
    }
    const stage = getPregnancyStage(charData.pregnancyWeek);
    const nausea = !!stage.nausea && charData.satiety > 20;
    const extraFatigue = !!stage.fatigue;

    // Эффекты пропорциональны прошедшему времени (без случайности —
    // иначе свайп одного и того же ответа давал бы разные цифры)
    if (nausea && hours > 0) charData.satiety = Math.max(0, charData.satiety - 1.2 * hours);
    if (extraFatigue && hours > 0) charData.energy = Math.max(0, charData.energy - 0.6 * hours);

    return { nausea, extraFatigue, trimesterLabel: stage.label };
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
    evaluateExtraDiseases(charData, hours, added, removed, progressed, recovering);

    evaluateEffects(charData, hours, added, removed);

    if (charData.pregnant) {
        applyPregnancyEffects(charData, hours);
    }

    return { added, removed, progressed, recovering };
}

function stageFields(def, stage) {
    const st = def.stages[stage];
    return {
        severity: stage,
        effects: st.effects, effectsEn: st.effectsEn,
        modifiers: st.modifiers, symptoms: st.symptoms,
    };
}

function makeDisease(def, stage) {
    return {
        id: def.id, name: def.nameRu, nameEn: def.nameEn,
        ...stageFields(def, stage),
        elapsedHours: 0, recoveryHours: 0, recovering: false, since: '0ч',
    };
}

export function formatHours(h) {
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
            charData.diseases.push(makeDisease(diseaseDef, currentStage));
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
        if (t.reserve !== undefined && (charData.reserve ?? 0) > t.reserve) match = false;
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
    if (cure.reserve !== undefined && (charData.reserve ?? 0) < cure.reserve) cured = false;
    if (cure.water !== undefined && charData.water < cure.water) cured = false;
    if (cure.hoursSinceLastMeal !== undefined && (charData.hoursSinceLastMeal || 0) > cure.hoursSinceLastMeal) cured = false;

    return cured;
}

function evaluateMalnutrition(charData, hours, added, removed, progressed, recovering) {
    const def = DISEASE_DB.malnutrition;
    const existing = charData.diseases.find(d => d.id === 'malnutrition');
    const days = charData.daysWithDeficit || 0;

    let stage = null;
    if (days >= 14) stage = 'severe';
    else if (days >= 7) stage = 'moderate';
    else if (days >= 3) stage = 'mild';

    if (!existing) {
        if (stage) {
            charData.diseases.push(makeDisease(def, stage));
            added.push('malnutrition');
        }
        return;
    }

    existing.elapsedHours = (existing.elapsedHours || 0) + hours;
    existing.since = formatHours(existing.elapsedHours);

    const cureMet = days <= def.cure.deficitDays && charData.satiety >= def.cure.satiety;
    if (cureMet) {
        if (!existing.recovering) {
            existing.recovering = true;
            existing.recoveryHours = 0;
            recovering.push('malnutrition');
        } else {
            existing.recoveryHours = (existing.recoveryHours || 0) + hours;
        }
        if (existing.recoveryHours >= (def.recovery?.[existing.severity] ?? 48)) {
            charData.diseases = charData.diseases.filter(d => d.id !== 'malnutrition');
            removed.push('malnutrition');
        }
        return;
    }
    if (existing.recovering) { existing.recovering = false; existing.recoveryHours = 0; }

    if (stage && existing.severity !== stage) {
        const order = ['mild', 'moderate', 'severe', 'critical'];
        const worse = order.indexOf(stage) > order.indexOf(existing.severity);
        Object.assign(existing, stageFields(def, stage));
        if (worse) progressed.push('malnutrition');
    }
}

// ═══════════════════════════════════════════════════════════════
// БОЛЕЗНИ СО СВОИМИ ПРАВИЛАМИ (стадия и выздоровление считаются здесь)
// ═══════════════════════════════════════════════════════════════
const STAGE_ORDER = ['mild', 'moderate', 'severe', 'critical'];

function customDisease(c, id, stage, cureMet, hours, added, removed, progressed, recovering) {
    const def = DISEASE_DB[id];
    const ex = c.diseases.find(d => d.id === id);
    if (!ex) {
        if (stage && !cureMet) {
            c.diseases.push(makeDisease(def, stage));
            added.push(id);
        }
        return;
    }
    ex.elapsedHours = (ex.elapsedHours || 0) + hours;
    ex.since = formatHours(ex.elapsedHours);

    if (cureMet || !stage) {
        if (!ex.recovering) { ex.recovering = true; ex.recoveryHours = 0; recovering.push(id); }
        else ex.recoveryHours = (ex.recoveryHours || 0) + hours;
        if (ex.recoveryHours >= (def.recovery?.[ex.severity] ?? 12)) {
            c.diseases = c.diseases.filter(d => d.id !== id);
            removed.push(id);
        }
        return;
    }
    if (ex.recovering) { ex.recovering = false; ex.recoveryHours = 0; }
    if (STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf(ex.severity)) {
        Object.assign(ex, stageFields(def, stage));
        progressed.push(id);
    }
}

function evaluateExtraDiseases(c, hours, added, removed, progressed, recovering) {
    const args = [hours, added, removed, progressed, recovering];
    const hslm = c.hoursSinceLastMeal || 0;
    const days = c.daysWithDeficit || 0;

    // Электролиты — после рвоты
    const el = c.electrolyte || 0;
    customDisease(c, 'electrolyte', el >= 80 ? 'severe' : el >= 50 ? 'moderate' : el >= 25 ? 'mild' : null, el < 15, ...args);

    // Алкогольное отравление
    const bac = c.bac || 0;
    customDisease(c, 'alcohol_poisoning', bac >= 4 ? 'critical' : bac >= 3 ? 'severe' : null, bac < 1.5, ...args);

    // Рефидинг — появляется только при еде (checkRefeeding), здесь лишь выздоровление
    const rf = c.diseases.find(d => d.id === 'refeeding');
    if (rf) customDisease(c, 'refeeding', rf.severity, true, ...args);

    // Пищевая одержимость
    customDisease(c, 'food_obsession',
        (hslm >= 96 || days >= 10) ? 'severe' : (hslm >= 48 || days >= 5) ? 'moderate' : (hslm >= 20 || days >= 2) ? 'mild' : null,
        hslm < 8 && days === 0, ...args);

    // Голодная апатия
    customDisease(c, 'hunger_apathy',
        (hslm >= 120 || days >= 14) ? 'severe' : (hslm >= 72 || days >= 8) ? 'moderate' : (hslm >= 36 || days >= 4) ? 'mild' : null,
        days <= 1 && hslm < 12 && c.satiety >= 50, ...args);

    // Пищевая тревожность — след пережитого голода, держится неделями
    if (hslm >= 60) c.starvationTrauma = true;
    if (c.starvationTrauma || c.diseases.some(d => d.id === 'food_insecurity')) {
        const stage = (c.maxFastHours || 0) >= 120 ? 'moderate' : 'mild';
        const had = c.diseases.some(d => d.id === 'food_insecurity');
        customDisease(c, 'food_insecurity', stage, had && hslm < 8 && days === 0, ...args);
        if (!c.diseases.some(d => d.id === 'food_insecurity')) { c.starvationTrauma = false; c.maxFastHours = 0; }
    }
}

/**
 * Резкое наедание после долгого голода. Вызывается ДО применения еды.
 * @returns {string|null} id, если синдром начался
 */
export function checkRefeeding(c, kcal, goal) {
    const starving = (c.hoursSinceLastMeal || 0) >= 72
        || c.diseases.some(d => d.id === 'starvation' && d.severity !== 'mild');
    if (!starving || kcal < goal * 0.4) return null;
    const stage = kcal >= goal * 0.9 ? 'critical' : 'severe';
    const ex = c.diseases.find(d => d.id === 'refeeding');
    if (ex) {
        if (STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf(ex.severity)) Object.assign(ex, stageFields(DISEASE_DB.refeeding, stage));
        ex.recoveryHours = 0;
        return null;
    }
    c.diseases.push({ ...makeDisease(DISEASE_DB.refeeding, stage), recovering: true });
    return 'refeeding';
}

// ═══════════════════════════════════════════════════════════════
// АКТИВНЫЕ ЭФФЕКТЫ
// ═══════════════════════════════════════════════════════════════
function evaluateEffects(c, hours, added, removed) {
    const g = goalOf(c);
    const T = (id, rule) => toggleEffect(c, id, rule, hours, added, removed);

    // Старые записи баффов/дебаффов → единый формат
    for (const e of [...c.buffs, ...c.debuffs]) {
        if (e.fading === undefined) { e.fading = false; e.fadeLeft = 0; }
    }
    c.buffs = c.buffs.filter(b => b.id !== 'balanced');

    // Голод и тело
    T('hunger', { on: c.satiety <= 20 && c.hoursSinceLastMeal >= 6, off: c.satiety > 35, linger: 0.5 });
    T('dehydration', { on: c.water <= 25, off: c.water > 35, linger: 1 });
    T('irritability', { on: c.satiety <= 30 && c.hoursSinceLastMeal >= 5 || c.diseases.some(d => d.id === 'hypoglycemia' && !d.recovering),
        off: c.satiety > 45, linger: 1 });
    T('overeating', { on: (c.recentIntake || 0) > g * 0.6, off: (c.recentIntake || 0) < g * 0.35, linger: 1.5 });
    const starving = c.diseases.some(d => d.id === 'starvation');
    T('slow_metabolism', { on: (c.daysWithDeficit || 0) >= 3 || starving, off: (c.daysWithDeficit || 0) === 0 && !starving, linger: 24 });

    // Сон и силы
    const caffeinated = (c.caffeine || 0) >= 60;
    T('exhaustion', { on: c.energy <= 15, off: c.energy > 30, linger: 4 });
    T('drowsiness', { on: c.energy <= 30 && c.energy > 15 && !caffeinated, off: c.energy > 40 || c.energy <= 15 || caffeinated, linger: 1 });
    T('sleep_deprived', { on: (c.hoursAwake || 0) >= 20, off: (c.hoursAwake || 0) < 4, linger: 0 });

    // Кофеин
    T('caffeine', { on: caffeinated, off: (c.caffeine || 0) < 40, linger: 0 });
    T('caffeine_jitters', { on: (c.caffeine || 0) >= 400, off: (c.caffeine || 0) < 250, linger: 0 });

    // Алкоголь: уровень опьянения меняется вместе с промилле
    const bac = c.bac || 0;
    T('intoxication', { on: bac >= 0.3, off: bac < 0.2, linger: 0 });
    const intox = c.debuffs.find(d => d.id === 'intoxication');
    if (intox) {
        const lv = EFFECT_INFO.intoxication.levels;
        let level = 0;
        for (let i = 0; i < lv.length; i++) if (bac >= lv[i].min) level = i;
        intox.level = level;
    }
    if (bac < 0.1 && (c.bacPeak || 0) >= 1.0) {
        grantEffect(c, 'hangover', 8, added);
        c.bacPeak = 0;
    } else if (bac < 0.1) {
        c.bacPeak = 0;
    }

    // Положительные
    T('well_fed', { on: c.satiety >= 75 && (c.reserve || 0) >= g * 0.45, off: c.satiety < 60, linger: 2 });
    T('hydrated', { on: c.water >= 80, off: c.water < 65, linger: 2 });
    T('high_energy', { on: c.energy >= 85, off: c.energy < 70, linger: 2 });

    // Эффекты с таймером (выспался, похмелье, стыд…) — просто тикают
    for (const id of ['rested', 'hangover', 'post_meal_anxiety', 'shame']) {
        T(id, { on: false, off: true, linger: 0 });
    }
}

/**
 * Эффекты, которые зависят от события хода (сон, еда, рвота).
 * @param {{ slept?: number, mealKcal?: number, vomited?: boolean }} ev
 */
export function applyTurnEvents(c, ev, added = []) {
    const g = goalOf(c);
    if ((ev.slept || 0) >= 6) grantEffect(c, 'rested', 10, added);
    const ed = c.ed || {};
    if ((ev.mealKcal || 0) >= 150 && (ed.anorexia || ed.bulimia)) {
        grantEffect(c, 'post_meal_anxiety', ed.anorexia === 'severe' || ed.bulimia === 'severe' ? 4 : 2, added);
    }
    if ((ev.mealKcal || 0) >= g * 0.6 && (ed.bulimia || ed.binge)) grantEffect(c, 'shame', 4, added);
    if (ev.vomited && ed.bulimia) grantEffect(c, 'shame', 6, added);
}

// ═══════════════════════════════════════════════════════════════
// ЗАМЕТНОСТЬ СОСТОЯНИЙ — против однотипных ответов
// Каждое состояние «всплывает» в промпте раз в N ходов (тяжёлое — чаще),
// сразу при появлении/ухудшении, не больше двух за раз. РПП всплывает
// ещё и тогда, когда в сцене ели.
// ═══════════════════════════════════════════════════════════════
const SURFACE_EVERY_DISEASE = { mild: 5, moderate: 3, severe: 2, critical: 1 };
const SURFACE_EVERY_ED = { mild: 6, moderate: 4, severe: 3 };
const SEVERITY_RANK = { critical: 4, severe: 3, moderate: 2, mild: 1 };
const MAX_FOCUS = 2;

const DISEASE_CUES = {
    hypoglycemia: ['fine tremor in the fingers', 'cold sweat at the temples', 'a wave of dizziness', 'words come out a little slurred', 'sudden pallor'],
    dehydration_disease: ['pounding headache', 'dizzy when standing up', 'skin looks dry and papery', 'heart racing at rest'],
    starvation: ['clothes hang looser than before', 'constantly cold', 'muscles give out quickly', 'cheekbones sharper than before'],
    malnutrition: ['dull, tired-looking skin', 'a bruise that seems slow to fade', 'tires faster than expected', 'looks paler than usual'],
};

function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
}

function cuesFor(c, id) {
    if (id.startsWith('ed_')) return ED_DB[id.slice(3)]?.cues;
    const d = c.diseases.find(x => x.id === id);
    if (d) return DISEASE_DB[id]?.stages?.[d.severity]?.cues || DISEASE_CUES[id];
    return EFFECT_INFO[id]?.cues;
}

/**
 * @param {Set<string>} changed — появившиеся/ухудшившиеся id
 * @param {{ foodInScene?: boolean }} opts
 */
export function updateFocus(charData, turn, changed = new Set(), opts = {}) {
    charData.salience = charData.salience || {};
    const candidates = [];

    for (const d of charData.diseases) {
        const every = (SURFACE_EVERY_DISEASE[d.severity] || 3) + (d.recovering ? 2 : 0);
        const cat = DISEASE_DB[d.id]?.category;
        candidates.push({ id: d.id, every, rank: (cat === 'mental' ? 8 : 10) + (SEVERITY_RANK[d.severity] || 1) });
    }
    for (const e of edList(charData)) {
        candidates.push({ id: `ed_${e.id}`, every: SURFACE_EVERY_ED[e.severity] || 4, rank: 9 + (SEVERITY_RANK[e.severity] || 1),
            force: !!opts.foodInScene });
    }
    for (const d of charData.debuffs) {
        const info = EFFECT_INFO[d.id];
        if (!info?.every) continue;
        if (d.fading && !info.timed && !changed.has(d.id)) continue;   // проходящее — только фон
        const lv = effectLevel(d);
        candidates.push({ id: d.id, every: info.every, rank: lv?.kind === 'negative' ? 3 : 1 });
    }

    const due = candidates.filter(c => {
        const last = charData.salience[c.id];
        return c.force || changed.has(c.id) || last === undefined || turn - last >= c.every;
    }).sort((a, b) => ((changed.has(b.id) || b.force) - (changed.has(a.id) || a.force)) || (b.rank - a.rank));

    const focus = due.slice(0, MAX_FOCUS).map(c => c.id);
    charData.focusCue = {};
    for (const id of focus) {
        charData.salience[id] = turn;
        const pool = cuesFor(charData, id);
        if (pool?.length) charData.focusCue[id] = pool[(turn + hashStr(charData.name || '') + hashStr(id)) % pool.length];
    }
    const present = new Set(candidates.map(c => c.id));
    for (const id of Object.keys(charData.salience)) if (!present.has(id)) delete charData.salience[id];
    charData.focus = focus;
}

// ═══════════════════════════════════════════════════════════════
// PROMPT GENERATION
// ═══════════════════════════════════════════════════════════════
function effectPrompt(e) {
    const lv = effectLevel(e);
    return lv?.prompt || EFFECT_INFO[e.id]?.prompt || e.id;
}

function edPrompt(e) {
    const def = ED_DB[e.id];
    return `${def.nameEn} (${e.severity}): ${def.prompt}; at this stage ${def.stages[e.severity]}`;
}

/**
 * Блок состояния одного персонажа для системного промпта.
 */
export function buildConditionPrompt(charData, charName, opts = {}) {
    const focus = new Set(charData.focus || []);
    const surface = [];
    const background = [];
    const cue = (id) => charData.focusCue?.[id] ? ` Possible detail this time: ${charData.focusCue[id]}.` : '';

    for (const d of charData.diseases) {
        const def = DISEASE_DB[d.id];
        const stage = def?.stages?.[d.severity];
        const kind = def?.category === 'mental' ? 'mental' : 'physical';
        const label = `${d.nameEn || d.name} (${kind}, ${d.severity}${d.recovering ? ', recovering — improving slowly, not instantly' : ''})`;
        if (focus.has(d.id)) surface.push(`${label}: ${stage?.symptoms || ''}${cue(d.id)}`);
        else background.push(label);
    }
    for (const e of edList(charData)) {
        const id = `ed_${e.id}`;
        if (focus.has(id)) surface.push(`${edPrompt(e)}.${cue(id)}`);
        else background.push(`${ED_DB[e.id].nameEn} (${e.severity}) — shapes their reactions whenever food, meals, bodies or weight come up`);
    }
    for (const d of charData.debuffs) {
        if (focus.has(d.id)) surface.push(`${effectPrompt(d)}.${cue(d.id)}`);
        else background.push(d.fading && !EFFECT_INFO[d.id]?.timed ? `${effectPrompt(d)} (passing)` : effectPrompt(d));
    }
    for (const b of charData.buffs) background.push(effectPrompt(b));

    if (charData.pregnant && charData.pregnancyWeek > 0) {
        const stage = getPregnancyStage(charData.pregnancyWeek);
        let p = `pregnant, ${stage.labelEn}, week ${charData.pregnancyWeek}`;
        if (stage.nausea) p += ', morning sickness possible';
        if (stage.fatigue) p += ', tires faster';
        background.push(p);
    }
    const immunity = calculateImmunity(charData);
    if (immunity < 40) background.push(`weakened immunity (${immunity}%)`);

    const out = [];
    if (surface.length) {
        out.push(`  Surface in this reply (one brief, concrete detail each, woven into action or dialogue — the suggested detail is optional, pick your own if it fits better):`);
        for (const l of surface) out.push(`    • ${l}`);
    }
    if (background.length) {
        out.push(`  Background only (shapes what they can do and how they react; do not describe it this reply): ${background.join('; ')}.`);
    }
    return out.join('\n');
}

/** Общие правила для РПП — добавляются в промпт, если оно есть хоть у кого-то */
export const ED_GUIDANCE = `Eating disorders here are illnesses, not personality quirks or aesthetics. Portray them with realism and care: the fear, secrecy, shame and ambivalence, and the real cost to the body and to relationships. Never glamorize thinness or restriction, never frame weight loss as an achievement, and never include methods, tricks, numbers or targets in the narration — keep any purging off-page or to a brief mention. Other characters can notice and care; recovery and support are possible.`;
