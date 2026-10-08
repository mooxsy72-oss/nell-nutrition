// nell-nutrition/conditions.js
// Продвинутая система болезней, беременности и физиологических состояний.

import { goalOf, setSatiety } from './nutrition-engine.js';
import { EFFECT_INFO, effectLevel, toggleEffect, grantEffect, hasEffect, seededChance, effectAllowed } from './effects.js';

// ═══════════════════════════════════════════════════════════════
// DISEASE DEFINITIONS — полное описание каждой болезни
// ═══════════════════════════════════════════════════════════════

export const DISEASE_DB = {
    // Только хардкор: у здорового человека голод почти не роняет сахар — в лёгком режиме вместо неё «Слабость от голода»
    hypoglycemia: {
        id: 'hypoglycemia',
        nameRu: 'Гипогликемия',
        nameEn: 'Hypoglycemia',
        category: 'physical',
        stages: {
            mild: {
                threshold: { hoursSinceLastMeal: 30, reserve: 0 },
                effects: ['Лёгкое головокружение', 'Раздражительность'],
                effectsEn: ['Mild dizziness', 'Irritability'],
                modifiers: { energy: -5, focus: -10 },
                symptoms: 'Slight tremor in hands, difficulty concentrating, craving sweets.',
            },
            moderate: {
                threshold: { hoursSinceLastMeal: 42, reserve: 0 },
                effects: ['Головокружение', 'Слабость', 'Тремор'],
                effectsEn: ['Dizziness', 'Weakness', 'Tremor'],
                modifiers: { energy: -15, focus: -25, physical: -15 },
                symptoms: 'Visible hand tremor, cold sweat, pale skin, trouble speaking clearly.',
            },
            severe: {
                threshold: { hoursSinceLastMeal: 60, reserve: 0 },
                effects: ['Сильное головокружение', 'Спутанность', 'Обморок'],
                effectsEn: ['Severe dizziness', 'Confusion', 'Fainting risk'],
                modifiers: { energy: -30, focus: -50, physical: -40 },
                symptoms: 'Stumbling, slurred speech, visual disturbances, risk of losing consciousness.',
            },
            critical: {
                threshold: { hoursSinceLastMeal: 84, reserve: 0 },
                effects: ['Потеря сознания', 'Судороги', 'Кома'],
                effectsEn: ['Loss of consciousness', 'Seizures', 'Coma risk'],
                modifiers: { energy: -60, focus: -80, physical: -70 },
                symptoms: 'Unable to stand, seizures possible, medical emergency, cannot act without help.',
            },
        },
        cure: { satiety: 40, reserve: 200 },
        recovery: { mild: 0.5, moderate: 1, severe: 3, critical: 12 },   // поели — сахар выравнивается быстро

    },

    starvation: {
        id: 'starvation',
        nameRu: 'Истощение',
        nameEn: 'Starvation',
        category: 'physical',
        stages: {
            mild: {
                threshold: { hoursSinceLastMeal: 48 },
                effects: ['Постоянный голод', 'Слабость', 'Потеря веса'],
                effectsEn: ['Constant hunger', 'Weakness', 'Weight loss'],
                modifiers: { energy: -10, physical: -10 },
                symptoms: 'Stomach constantly aching, thinking about food obsessively, mild weakness.',
            },
            moderate: {
                threshold: { hoursSinceLastMeal: 72 },
                effects: ['Мышечная атрофия', 'Апатия', 'Озноб'],
                effectsEn: ['Muscle atrophy', 'Apathy', 'Chills'],
                modifiers: { energy: -25, physical: -30, focus: -20 },
                symptoms: 'Muscles visibly weaker, indifferent to surroundings, constantly cold.',
            },
            severe: {
                threshold: { hoursSinceLastMeal: 120 },
                effects: ['Органная недостаточность', 'Бред', 'Невозможность двигаться'],
                effectsEn: ['Organ failure risk', 'Delirium', 'Unable to move'],
                modifiers: { energy: -50, physical: -60, focus: -50 },
                symptoms: 'Bedridden, hallucinations, organs shutting down, death approaching.',
            },
            critical: {
                threshold: { hoursSinceLastMeal: 168 },
                effects: ['Смерть неизбежна без помощи'],
                effectsEn: ['Death imminent without intervention'],
                modifiers: { energy: -80, physical: -90, focus: -70 },
                symptoms: 'Unconscious, barely breathing, will die without immediate medical care and nutrition.',
            },
        },
        cure: { satiety: 60, reserve: 500, hoursSinceLastMeal: 4 },
        recovery: { mild: 6, moderate: 24, severe: 72, critical: 168 },

    },

    dehydration_disease: {
        id: 'dehydration_disease',
        nameRu: 'Обезвоживание',
        nameEn: 'Dehydration',
        category: 'physical',
        stages: {
            // Обезвоживание — не «захотелось пить», а долгое время почти без воды:
            // уровень воды низкий И держится так несколько часов (dryHours — часы при воде ≤ 20)
            mild: {
                threshold: { water: 15, dryHours: 4 },
                effects: ['Сухость во рту', 'Головная боль'],
                effectsEn: ['Dry mouth', 'Headache'],
                modifiers: { focus: -10, energy: -5 },
                symptoms: 'Lips cracking, mild headache, dark urine, thirst.',
            },
            moderate: {
                threshold: { water: 8, dryHours: 12 },
                effects: ['Сильная головная боль', 'Слабость', 'Тахикардия'],
                effectsEn: ['Severe headache', 'Weakness', 'Rapid heartbeat'],
                modifiers: { focus: -20, energy: -20, physical: -15 },
                symptoms: 'Pounding headache, heart racing, dizziness when standing, skin losing elasticity.',
            },
            severe: {
                threshold: { water: 3, dryHours: 24 },
                effects: ['Спутанность сознания', 'Обморок', 'Почечный стресс'],
                effectsEn: ['Confusion', 'Fainting', 'Kidney stress'],
                modifiers: { focus: -40, energy: -40, physical: -35 },
                symptoms: 'Confused, stumbling, no sweat despite heat, kidneys aching, fainting spells.',
            },
            critical: {
                threshold: { water: 0, dryHours: 48 },
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

    // ─── Болезни-события: случаются сами, шанс зависит от состояния ───
    cold: {
        id: 'cold', nameRu: 'Простуда', nameEn: 'Cold / flu', category: 'physical', event: true,
        stages: {
            mild: { effects: ['Насморк', 'Першение в горле'], modifiers: { energy: -5 },
                symptoms: 'Runny nose, scratchy throat, sneezing; a little slower and grumpier than usual.',
                cues: ['sniffles', 'a muffled sneeze', 'clears a scratchy throat', 'wraps both hands around a hot cup'] },
            moderate: { effects: ['Кашель', 'Температура', 'Ломота'], modifiers: { energy: -15, physical: -15 },
                symptoms: 'Fever, cough, aching body; wants warmth and rest; appetite poor.',
                cues: ['a rattling cough', 'flushed cheeks, glassy eyes', 'shivers despite the warmth', 'burrows under a blanket'] },
            severe: { effects: ['Сильный жар', 'Озноб', 'Бред'], modifiers: { energy: -35, physical: -40 },
                symptoms: 'High fever and chills, barely able to get up, drifting in feverish dozes; needs someone to look after them.',
                cues: ['forehead burning to the touch', 'teeth chattering', 'mumbles something in a feverish doze'] },
        },
        course: { mild: 48, moderate: 72, severe: 96 },
        recovery: { mild: 24, moderate: 48, severe: 96 },
    },
    food_poisoning: {
        id: 'food_poisoning', nameRu: 'Пищевое отравление', nameEn: 'Food poisoning', category: 'physical', event: true,
        stages: {
            mild: { effects: ['Тошнота', 'Спазмы в животе'], modifiers: { energy: -10 },
                symptoms: 'Queasy stomach and cramps after something they ate; no appetite.',
                cues: ['a hand on the stomach', 'grimaces at a cramp', 'pushes food away', 'sips water carefully'] },
            moderate: { effects: ['Рвота', 'Диарея', 'Слабость'], modifiers: { energy: -25, physical: -25 },
                symptoms: 'Vomiting and diarrhoea, weak and pale, losing fluids fast; needs water and rest.',
                cues: ['bolts outside suddenly', 'pale and sweaty', 'curled up, knees to chest'] },
            severe: { effects: ['Сильная рвота', 'Обезвоживание', 'Жар'], modifiers: { energy: -45, physical: -50 },
                symptoms: 'Violent vomiting, fever, can\'t keep water down; dangerously dehydrated without help.',
                cues: ['can\'t keep even water down', 'shaking with fever', 'too weak to sit up'] },
        },
        course: { mild: 8, moderate: 18, severe: 36 },
        recovery: { mild: 6, moderate: 18, severe: 36 },
    },
    dysentery: {
        id: 'dysentery', nameRu: 'Дизентерия', nameEn: 'Dysentery', category: 'physical', event: true,
        stages: {
            mild: { effects: ['Боли в животе', 'Частый понос'], modifiers: { energy: -15 },
                symptoms: 'Cramping belly and frequent loose stools after drinking bad water; losing fluids.',
                cues: ['doubles over at a cramp', 'excuses themselves again', 'drinks thirstily but stays pale'] },
            moderate: { effects: ['Кровавый понос', 'Жар', 'Обезвоживание'], modifiers: { energy: -30, physical: -30 },
                symptoms: 'The bloody flux: fever, painful cramps, fast dehydration; too weak to travel.',
                cues: ['hollow-eyed and feverish', 'lips cracked from thirst', 'can barely stand'] },
            severe: { effects: ['Сильное обезвоживание', 'Бред', 'Упадок сил'], modifiers: { energy: -50, physical: -60 },
                symptoms: 'Severe flux and fever, delirious, wasting fast; without constant water and care it can kill.',
                cues: ['skin loose and dry', 'mumbles in delirium', 'can\'t lift a cup alone'] },
        },
        course: { mild: 72, moderate: 120, severe: 168 },
        recovery: { mild: 24, moderate: 72, severe: 120 },
    },
    gastritis: {
        id: 'gastritis', nameRu: 'Гастрит', nameEn: 'Gastritis', category: 'physical', event: true,
        stages: {
            mild: { effects: ['Боль в желудке после еды', 'Изжога'], modifiers: { energy: -5 },
                symptoms: 'Burning stomach pain after eating or on an empty stomach; picky about food.',
                cues: ['winces after a few bites', 'presses a hand under the ribs', 'avoids anything spicy'] },
            moderate: { effects: ['Сильные боли', 'Тошнота', 'Нет аппетита'], modifiers: { energy: -15 },
                symptoms: 'Gnawing stomach pain, nausea, eating becomes a chore.',
                cues: ['hunched over from stomach pain', 'eats a few spoonfuls and stops', 'bitter taste, grimacing'] },
        },
        recovery: { mild: 72, moderate: 168 },
    },
    anemia: {
        id: 'anemia', nameRu: 'Анемия', nameEn: 'Anemia', category: 'physical', event: true,
        stages: {
            mild: { effects: ['Бледность', 'Быстрая утомляемость'], modifiers: { energy: -10 },
                symptoms: 'Pale, tires quickly, cold hands.',
                cues: ['pale lips', 'out of breath on the stairs', 'cold fingers'] },
            moderate: { effects: ['Головокружение', 'Одышка', 'Слабость'], modifiers: { energy: -20, physical: -15 },
                symptoms: 'Dizzy when standing up, short of breath, weak and cold.',
                cues: ['steadies herself on the wall when standing', 'dark circles under the eyes', 'breathes hard after a short walk'] },
            severe: { effects: ['Обмороки', 'Сильная слабость'], modifiers: { energy: -35, physical: -35 },
                symptoms: 'Near-fainting spells, racing heart, very weak; needs rest and proper food.',
                cues: ['vision greys out for a moment', 'heart pounding at rest', 'has to sit down mid-task'] },
        },
        recovery: { mild: 168, moderate: 336, severe: 504 },
    },
    scurvy: {
        id: 'scurvy', nameRu: 'Цинга', nameEn: 'Scurvy', category: 'physical', event: true,
        stages: {
            mild: { effects: ['Слабость', 'Кровоточат дёсны'], modifiers: { energy: -10 },
                symptoms: 'Weeks without fresh produce: tired, gums bleed when eating.',
                cues: ['a trace of blood on the bread', 'rubs aching gums', 'unusually tired'] },
            moderate: { effects: ['Синяки', 'Боль в суставах'], modifiers: { energy: -20, physical: -20 },
                symptoms: 'Bruises appear from nothing, joints ache, old scrapes won\'t heal.',
                cues: ['a bruise no one remembers getting', 'stiff aching knees', 'a cut that stays open'] },
            severe: { effects: ['Шатаются зубы', 'Раны не заживают'], modifiers: { energy: -35, physical: -40 },
                symptoms: 'Loose teeth, swollen gums, wounds reopening; the body is falling apart without fresh food.',
                cues: ['a loose tooth', 'swollen, dark gums', 'an old scar splitting open'] },
        },
        recovery: { mild: 72, moderate: 168, severe: 336 },
    },

    // ─── Психика: последствия голода ───
    food_obsession: {
        id: 'food_obsession', nameRu: 'Мысли о еде', nameEn: 'Food on the mind', category: 'mental',
        stages: {
            mild: { effects: ['Чаще думает о еде', 'Рассеянность'], modifiers: { focus: -10 },
                symptoms: 'Long without proper food: thoughts drift to the next meal more often than usual.', cues: ['loses the thread for a moment', 'notices a smell of cooking'] },
            moderate: { effects: ['Трудно думать о другом', 'Рассеянность'], modifiers: { focus: -25 },
                symptoms: 'Days of not eating enough: hard to focus, thoughts keep returning to food.', cues: ['loses the thread when food is mentioned', 'distracted, asks to repeat'] },
            severe: { effects: ['Почти все мысли — о еде', 'Эмоциональные срывы'], modifiers: { focus: -45 },
                symptoms: 'Food is almost all the mind can hold; emotional outbursts, may take food without thinking.', cues: ['hands reach for food before thinking', 'tears up over a missed meal', 'hides a scrap in a pocket'] },
        },
        recovery: { mild: 3, moderate: 24, severe: 72 },
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
        recovery: { mild: 12, moderate: 48, severe: 120 },
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
    const nausea = !!stage.nausea;
    const extraFatigue = !!stage.fatigue;

    // Тошнота теперь событие (утром, после сна), здесь только усталость 3-го триместра
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

    // Недосып, недоедание, алкоголь — минус; выспался и сыт — плюс
    if (hasEffect(charData, 'sleep_deprived')) immunity -= 10;
    if ((charData.daysWithDeficit || 0) >= 3) immunity -= 10;
    if ((charData.bac || 0) >= 0.9) immunity -= 5;
    if (hasEffect(charData, 'rested')) immunity += 5;
    if (hasEffect(charData, 'well_fed')) immunity += 5;

    // Физические болезни снижают иммунитет
    immunity -= charData.diseases.filter(d => DISEASE_DB[d.id]?.category !== 'mental').length * 10;

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
    if ((charData.careLeft || 0) > 0) charData.careLeft = Math.max(0, charData.careLeft - hours);
    // Средний иммунитет за последние сутки — по нему бросаем шанс заболеть
    if (hours > 0) {
        const now = calculateImmunity(charData);
        const k = Math.min(1, hours / 24);
        charData.immAvg = charData.immAvg == null ? now : charData.immAvg + (now - charData.immAvg) * k;
    }
    const added = [];
    const removed = [];
    const progressed = [];
    const recovering = [];

    if (!hungerCap) evaluateDisease(charData, DISEASE_DB.hypoglycemia, hours, added, removed, progressed, recovering);
    else if (charData.diseases.some(d => d.id === 'hypoglycemia')) {   // лёгкий режим: её нет (переключили режим)
        charData.diseases = charData.diseases.filter(d => d.id !== 'hypoglycemia');
        removed.push('hypoglycemia');
    }
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

// ═══════════════════════════════════════════════════════════════
// ПРОГРЕСС ЛЕЧЕНИЯ 0–100%
// Растёт сам, пока причина болезни ушла (поели, попили, прошёл курс),
// и от того, что ИИ видит в ролплее (уход, лекарства, покой — user_heal).
// Откатывается, если причина вернулась или стало хуже. 100% — здоров.
// ═══════════════════════════════════════════════════════════════
function healTick(c, ex, needHours, hours, cureMet, recovering) {
    const rate = 100 / Math.max(1, needHours);
    const before = ex.progress || 0;
    if (cureMet) {
        if (!ex.recovering) { ex.recovering = true; if (hours > 0) recovering.push(ex.id); }
        ex.progress = Math.min(100, before + rate * recoverStep(c, hours));
    } else if (!DISEASE_DB[ex.id]?.event) {
        // Причина вернулась (снова голод, жажда) — выздоровление откатывается
        ex.recovering = false;
        ex.progress = Math.max(0, before - rate * hours * 0.5);
    } else {
        // Болезнь-событие идёт своим курсом; набранное лечением не теряется
        ex.recovering = before > 0;
    }
    return ex.progress >= 100;
}

/** Лечение по ролплею: delta в процентах, шаг ограничен, чтобы не выздоравливать за один ответ */
export function applyHealDelta(c, id, delta, hours = 0) {
    const d = c.diseases.find(x => x.id === id);
    if (!d || !delta) return null;
    const maxUp = Math.max(15, Math.min(60, hours * 2));
    const step = Math.max(-30, Math.min(maxUp, delta));
    d.progress = Math.max(0, Math.min(100, (d.progress || 0) + step));
    if (step > 0) d.recovering = true;
    if (d.progress >= 100) {
        c.diseases = c.diseases.filter(x => x.id !== id);
        return 'cured';
    }
    return step > 0 ? 'better' : 'worse';
}

/** Найти болезнь по тому, как её назвал ИИ: id, английское или русское название */
export function resolveDiseaseId(c, name) {
    const n = String(name || '').toLowerCase().replace(/ё/g, 'е').trim().replace(/\s+/g, '_');
    if (!n) return null;
    for (const d of c.diseases) {
        const def = DISEASE_DB[d.id] || {};
        const names = [d.id, def.nameEn, def.nameRu, d.name].filter(Boolean)
            .map(x => String(x).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, '_'));
        if (names.some(x => x === n || x.startsWith(n) || n.startsWith(x.split('_')[0]))) return d.id;
    }
    return null;
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
        elapsedHours: 0, progress: 0, recovering: false, since: '0ч',
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

    const needHours = diseaseDef.recovery?.[existing.severity] ?? 6;
    if (healTick(charData, existing, needHours, hours, cureConditionsMet, recovering)) {
        charData.diseases = charData.diseases.filter(d => d.id !== diseaseDef.id);
        removed.push(diseaseDef.id);
        return;
    }
    if (cureConditionsMet) return;

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

        if (newIdx > oldIdx) { progressed.push(diseaseDef.id); existing.progress = Math.max(0, (existing.progress || 0) - 20); }
    }
}

// Эпоха: 'modern' | 'historical' (без современной медицины — инфекции чаще, болеют дольше)
let era = 'modern';
export function setEra(v) { era = v === 'historical' ? 'historical' : 'modern'; }
const isHistorical = () => era === 'historical';

// Скорость выздоровления: без медицины медленнее, уход (лекарь, травы, покой) — быстрее
function recoverStep(c, hours) {
    const care = (c.careLeft || 0) > 0 ? 1.6 : 1;
    const eraMult = isHistorical() ? 1 / 1.5 : 1;
    return hours * care * eraMult;
}
const courseMult = () => (isHistorical() ? 1.3 : 1);

// Лёгкий режим: болезни от голода и жажды не доходят до тяжёлых стадий
let hungerCap = false;
export function setHungerCap(v) { hungerCap = !!v; }
const HUNGER_IDS = ['hypoglycemia', 'starvation', 'dehydration_disease', 'malnutrition',
    'cold', 'food_poisoning', 'dysentery', 'gastritis', 'anemia', 'scurvy'];
function capStage(id, stage) {
    if (!hungerCap || !HUNGER_IDS.includes(id)) return stage;
    return stage === 'severe' || stage === 'critical' ? 'moderate' : stage;
}

function determineStage(charData, diseaseDef) {
    return capStage(diseaseDef.id, determineStageRaw(charData, diseaseDef));
}

function determineStageRaw(charData, diseaseDef) {
    const stages = ['critical', 'severe', 'moderate', 'mild'];

    for (const stage of stages) {
        const stageData = diseaseDef.stages[stage];
        if (!stageData) continue;

        const t = stageData.threshold;
        let match = true;

        if (t.hoursSinceLastMeal !== undefined && (charData.hoursSinceLastMeal || 0) < t.hoursSinceLastMeal) match = false;
        if (t.reserve !== undefined && (charData.reserve ?? 0) > t.reserve) match = false;
        if (t.water !== undefined && charData.water > t.water) match = false;
        if (t.dryHours !== undefined && (charData.dryHours || 0) < t.dryHours) match = false;
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
    stage = capStage('malnutrition', stage);

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
    if (healTick(charData, existing, def.recovery?.[existing.severity] ?? 48, hours, cureMet, recovering)) {
        charData.diseases = charData.diseases.filter(d => d.id !== 'malnutrition');
        removed.push('malnutrition');
        return;
    }
    if (cureMet) return;

    if (stage && existing.severity !== stage) {
        const order = ['mild', 'moderate', 'severe', 'critical'];
        const worse = order.indexOf(stage) > order.indexOf(existing.severity);
        Object.assign(existing, stageFields(def, stage));
        if (worse) { progressed.push('malnutrition'); existing.progress = Math.max(0, (existing.progress || 0) - 20); }
    }
}

// ═══════════════════════════════════════════════════════════════
// БОЛЕЗНИ СО СВОИМИ ПРАВИЛАМИ (стадия и выздоровление считаются здесь)
// ═══════════════════════════════════════════════════════════════
const STAGE_ORDER = ['mild', 'moderate', 'severe', 'critical'];

function customDisease(c, id, stage, cureMet, hours, added, removed, progressed, recovering) {
    const def = DISEASE_DB[id];
    stage = capStage(id, stage);
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

    const ok = cureMet || !stage;
    if (healTick(c, ex, def.recovery?.[ex.severity] ?? 12, hours, ok, recovering)) {
        c.diseases = c.diseases.filter(d => d.id !== id);
        removed.push(id);
        return;
    }
    if (ok) return;
    if (STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf(ex.severity)) {
        Object.assign(ex, stageFields(def, stage));
        progressed.push(id);
        ex.progress = Math.max(0, (ex.progress || 0) - 20);
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

    // Простуда и отравление идут своим курсом, потом выздоровление
    for (const id of ['cold', 'food_poisoning', 'dysentery']) {
        const ex = c.diseases.find(d => d.id === id);
        if (!ex) continue;
        let stage = ex.severity;
        // Слабый иммунитет — простуда через сутки может перейти в тяжёлую форму
        const worsenAt = isHistorical() ? 50 : 40;
        if ((id === 'cold' || id === 'dysentery') && !ex.worsened && (ex.elapsedHours || 0) >= 24 && calculateImmunity(c) < worsenAt && !ex.recovering) {
            stage = STAGE_ORDER[Math.min(2, STAGE_ORDER.indexOf(stage) + 1)];
            ex.worsened = true;
        }
        const course = (DISEASE_DB[id].course[ex.severity] ?? 24) * courseMult() / ((c.careLeft || 0) > 0 ? 1.3 : 1);
        customDisease(c, id, stage, (ex.elapsedHours || 0) >= course, ...args);
    }

    // Гастрит — держится, пока питание нерегулярное
    const gx = c.diseases.find(d => d.id === 'gastritis');
    if (gx) customDisease(c, 'gastritis', days >= 5 ? 'moderate' : gx.severity, days === 0 && hslm < 8, ...args);

    // Анемия — от долгого недоедания; у беременных — быстрее
    const pregAnemia = c.pregnant && (c.pregnancyWeek || 0) >= 20 && days >= 3;
    customDisease(c, 'anemia',
        days >= 21 ? 'severe' : days >= 14 ? 'moderate' : (days >= 10 || pregAnemia) ? 'mild' : null,
        days === 0 && c.satiety >= 60, ...args);

    // Цинга — недели без свежих овощей и фруктов
    const np = c.daysNoProduce || 0;
    customDisease(c, 'scurvy', np >= 60 ? 'severe' : np >= 45 ? 'moderate' : np >= 30 ? 'mild' : null, np === 0, ...args);

    // Пищевая одержимость
    // Острое (часы) и хроническое (дни) разведены: сутки без еды — это сильный голод, а не болезнь.
    // Мысли о еде — от двух суток без еды или нескольких дней недоедания; после нормальной еды
    // проходят за часы, если недоедание не тянется днями
    customDisease(c, 'food_obsession',
        (hslm >= 120 || days >= 10) ? 'severe' : (hslm >= 72 || days >= 6) ? 'moderate' : (hslm >= 40 || days >= 3) ? 'mild' : null,
        hslm < 6 && c.satiety >= 50 && days < 3, ...args);

    // Голодная апатия
    // Апатия — от долгого голода (трое суток без еды или неделя недоедания), не от пропущенного дня
    customDisease(c, 'hunger_apathy',
        (hslm >= 168 || days >= 14) ? 'severe' : (hslm >= 120 || days >= 8) ? 'moderate' : (hslm >= 72 || days >= 5) ? 'mild' : null,
        days < 5 && hslm < 12 && c.satiety >= 50, ...args);

    // Пищевая тревожность — след пережитого голода, держится неделями
    if (hslm >= 72) c.starvationTrauma = true;
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
        ex.progress = 0;
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
    // Эффект, который по ролплею прошёл (user_clear), какое-то время не возвращается
    c.suppress = c.suppress || {};
    for (const k of Object.keys(c.suppress)) {
        c.suppress[k] -= hours;
        if (c.suppress[k] <= 0) delete c.suppress[k];
    }
    const T = (id, rule) => toggleEffect(c, id, c.suppress[id] ? { ...rule, on: false, off: true } : rule, hours, added, removed);

    // Старые записи баффов/дебаффов → единый формат
    for (const e of [...c.buffs, ...c.debuffs]) {
        if (e.fading === undefined) { e.fading = false; e.fadeLeft = 0; }
    }
    c.buffs = c.buffs.filter(b => b.id !== 'balanced');

    // Эффекты от показателей снимаются сразу, как только показатель восстановился
    // (небольшой зазор между «включить» и «выключить» — чтобы не мигали)
    T('hunger', { on: c.satiety <= 20 && c.hoursSinceLastMeal >= 8, off: c.satiety > 26 });   // ~14 ч без еды: пропущен приём, а не просто утро
    T('dehydration', { on: c.water <= 30, off: c.water > 38 });   // просто хочется пить; болезнь — позже и не сразу
    T('irritability', { on: c.satiety <= 20 && c.hoursSinceLastMeal >= 5 || c.diseases.some(d => d.id === 'hypoglycemia' && !d.recovering),
        off: c.satiety > 30 && !c.diseases.some(d => d.id === 'hypoglycemia' && !d.recovering) });
    T('overeating', { on: (c.recentIntake || 0) > g * 0.6, off: (c.recentIntake || 0) < g * 0.45 });
    // Замедленный обмен — приспособление тела к нескольким дням недоедания (или к настоящему голоданию,
    // от трёх суток), а не к одному пропущенному дню; проходит через сутки нормального питания
    const starving = c.diseases.some(d => d.id === 'starvation' && d.severity !== 'mild' && !d.recovering);
    T('slow_metabolism', { on: (c.daysWithDeficit || 0) >= 4 || starving, off: (c.daysWithDeficit || 0) <= 1 && !starving, linger: 24 });
    // Острая слабость от голода: дрожь, лёгкое головокружение. Проходит, как только поели.
    // В хардкоре при гипогликемии не нужна — та сильнее
    const hypo = c.diseases.some(d => d.id === 'hypoglycemia' && !d.recovering);
    T('hunger_weak', { on: (c.hoursSinceLastMeal || 0) >= 16 && c.satiety <= 12 && !hypo, off: c.satiety > 30 || hypo, linger: 0 });

    // Сон и силы
    const caffeinated = (c.caffeine || 0) >= 60;
    T('exhaustion', { on: c.energy <= 15, off: c.energy > 20 });
    T('drowsiness', { on: c.energy <= 30 && c.energy > 15 && !caffeinated, off: c.energy > 35 || c.energy <= 15 || caffeinated });
    T('sleep_deprived', { on: (c.hoursAwake || 0) >= 20, off: (c.hoursAwake || 0) < 4 });

    // Кофеин
    T('caffeine', { on: caffeinated, off: (c.caffeine || 0) < 50 });
    T('caffeine_jitters', { on: (c.caffeine || 0) >= 400, off: (c.caffeine || 0) < 350 });

    // Алкоголь: уровень опьянения меняется вместе с промилле
    const bac = c.bac || 0;
    T('intoxication', { on: bac >= 0.3, off: bac < 0.25 });
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

    // Положительные эффекты — не по показателям, а события (см. applyTurnEvents):
    // хорошо поели, напились вдоволь, выспались. «Бодрость» убрана — это дубль кольца энергии.
    c.buffs = c.buffs.filter(b => b.id !== 'high_energy');
    // Сытость уходит сразу, как только снова проголодался
    if (c.satiety < 50) c.buffs = c.buffs.filter(b => b.id !== 'well_fed');
    // «Напился вдоволь» и «выспался» тоже не держатся, когда показатель уже ушёл
    if (c.water < 60) c.buffs = c.buffs.filter(b => b.id !== 'hydrated');
    if (c.energy < 45 || hasEffect(c, 'sleep_deprived') || hasEffect(c, 'exhaustion')) c.buffs = c.buffs.filter(b => b.id !== 'rested');

    // Беременность: со второго триместра голод просыпается раньше — но эффект только когда правда голодна
    const pw = c.pregnant ? (c.pregnancyWeek || 0) : 0;
    T('pregnancy_appetite', { on: pw >= 14 && c.satiety <= 35 && !hasEffect(c, 'hunger'), off: pw < 14 || c.satiety > 50 || hasEffect(c, 'hunger'), linger: 0 });
    // «Малыш толкается» удалён — к питанию не относится; чистим старые сохранения
    c.buffs = c.buffs.filter(b => b.id !== 'baby_kicks');
    c.debuffs = c.debuffs.filter(b => b.id !== 'baby_kicks');

    // Эффекты с таймером (выспался, похмелье, стыд…) — просто тикают
    for (const id of ['rested', 'well_fed', 'hydrated', 'hangover', 'post_meal_anxiety', 'shame',
        'morning_sickness', 'craving', 'heartburn',
        'favorite_food', 'disliked_food', 'aversion', 'sugar_crash', 'warmed']) {
        T(id, { on: false, off: true, linger: 0 });
    }
}

// ═══════════════════════════════════════════════════════════════
// СОБЫТИЯ БЕРЕМЕННОСТИ — срабатывают сами, без участия пользователя
// Случайность привязана к дню и ходу, поэтому свайп даёт тот же результат.
// ═══════════════════════════════════════════════════════════════
// ru — для инфоблока, en — для промпта (весь инджект на английском)
const CRAVINGS = [
    ['солёные огурцы', 'pickles'], ['что-то сладкое', 'something sweet'], ['что-то кислое', 'something sour'],
    ['мясо', 'meat'], ['свежие фрукты', 'fresh fruit'], ['квашеная капуста', 'sauerkraut'], ['холодное молоко', 'cold milk'],
    ['сыр', 'cheese'], ['мёд', 'honey'], ['что-то острое', 'something spicy'], ['жареная картошка', 'fried potatoes'], ['ягоды', 'berries'],
];

const AVERSIONS = [
    ['запах жареного', 'the smell of frying'], ['мясо', 'meat'], ['рыба', 'fish'], ['кофе', 'coffee'],
    ['яйца', 'eggs'], ['лук и чеснок', 'onion and garlic'], ['жирное', 'anything fatty'],
];
// Выбор из списка: хэш плохо различает строки с отличием в одной цифре, поэтому перемешиваем ещё раз
const mixChance = (seed) => seededChance(`${seededChance(seed)}|${seed}`);
const pickIndex = (seed, n) => Math.floor(mixChance(seed) * n) % n;
const findEffectIn = (c, id) => [...c.buffs, ...c.debuffs].find(x => x.id === id);

// ═══════════════════════════════════════════════════════════════
// ПИЩЕВОЙ ПРОФИЛЬ: любимое, нелюбимое, тяга — у всех, не только у беременных
// ═══════════════════════════════════════════════════════════════
const foodNorm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
// Основы слов от 3 букв (мёд, суп): «квашеную капусту» совпадёт с «квашеная капуста»
const stems = (s) => foodNorm(s).split(' ').filter(w => w.length >= 3).map(w => w.slice(0, Math.max(3, w.length - 2)));

/** Что из списка совпадает с названием съеденного (или null) */
export function matchFood(item, list = []) {
    const it = stems(item);
    if (!it.length) return null;
    for (const x of list) {
        const xs = stems(x);
        if (xs.length && xs.every(s => it.some(w => w.startsWith(s) || s.startsWith(w)))) return x;
    }
    return null;
}

const SWEET_RE = /(сладк|мед|мёд|торт|пирожн|конфет|сахар|варень|пряник|шоколад|леденц|халв|зефир|пастил|мармелад|пирог с (ягод|вишн|яблок|черник)|sweet|cake|candy|honey|pastry|cookie|chocolate|jam|biscuit|donut|dessert)/i;
const HOT_RE = /(суп|щи|борщ|уха|бульон|похл[её]б|каш|рагу|жарк|чай|кофе|сбитень|взвар|глинтвейн|какао|горяч|тёпл|тепл|soup|stew|broth|porridge|tea|coffee|cocoa|mulled|hot|warm)/i;

/**
 * События от еды: любимое, нелюбимое, тяга утолена, отвращение, сладкое, горячее.
 * @param {{ foods: Array, drinks: Array, cold?: boolean, hour: number }} ev
 */
export function foodEvents(c, ev, added = []) {
    const likes = c.food?.likes || [], dislikes = c.food?.dislikes || [];
    const items = [...(ev.foods || []).filter(f => !f.implied), ...(ev.drinks || [])];
    if (!items.length) return;
    const crave = findEffectIn(c, 'craving'), avers = findEffectIn(c, 'aversion');
    let fav = null, bad = null;
    for (const f of items) {
        // Тяга утолена — радость сильнее обычного любимого
        if (crave && matchFood(f.item, [crave.detail || ''])) {
            c.debuffs = c.debuffs.filter(e => e.id !== 'craving');
            c.buffs = c.buffs.filter(e => e.id !== 'craving');
            fav = crave.detail;
        }
        fav = fav || matchFood(f.item, likes);
        bad = bad || matchFood(f.item, dislikes);
        // Съела то, от чего воротит, — мутит
        if (avers && matchFood(f.item, [avers.detail || ''])) grantEffect(c, 'morning_sickness', 2, added);
    }
    if (fav) {
        grantEffect(c, 'favorite_food', 3, added, fav);
        setSatiety(c, Math.min(100, c.satiety + 3), goalOf(c));
    }
    if (bad) {
        grantEffect(c, 'disliked_food', 2, added, bad);
        setSatiety(c, Math.max(0, c.satiety - 3), goalOf(c));   // насытило хуже: ели мало и через силу
    }
    const sweetKcal = (ev.foods || []).filter(f => SWEET_RE.test(f.item)).reduce((a, f) => a + (f.calories || 0), 0);
    if (sweetKcal >= 300 && effectAllowed('sugar_crash') && !findEffectIn(c, 'sugar_crash')) {
        grantEffect(c, 'sugar_crash', 2, added);
        c.energy = Math.max(0, c.energy - 8);
    }
    // Горячее согревает — в старину, холодным утром или вечером; не чаще раза в 6 ч
    if (ev.cold && items.some(f => HOT_RE.test(f.item)) && !findEffectIn(c, 'warmed')
        && (c.warmedAt == null || ev.clock - c.warmedAt >= 6)) {
        c.warmedAt = ev.clock;
        grantEffect(c, 'warmed', 2, added);
    }
}

/**
 * Тяга к любимому у любого персонажа (у беременных — своя, в pregnancyEvents).
 * Раз в день, днём, чаще на голодный желудок. Детерминирована — свайп даёт то же.
 */
export function cravingEvents(c, ev, added = []) {
    const likes = c.food?.likes || [];
    if (c.pregnant || !likes.length || ev.sleeping || ev.hour < 11 || ev.hour >= 22 || c.cravingDay === ev.day) return;
    c.cravingDay = ev.day;
    const key = `${c.charId || c.name}|${ev.day}`;
    if (mixChance(`crave2|${ev.day * 7919}|${c.charId || c.name}`) >= (c.satiety <= 50 ? 0.45 : 0.25)) return;
    const like = likes[pickIndex(`like2|${ev.day * 7919}|${c.charId || c.name}`, likes.length)];
    grantEffect(c, 'craving', 4, added, like);
    const e = findEffectIn(c, 'craving');
    if (e) e.detailEn = like;
}

/**
 * @param {{ woke?: boolean, hour?: number, day?: number, turn?: number, mealKcal?: number, activity?: string, sleeping?: boolean }} ev
 * @returns {{ vomited: boolean }}
 */
export function pregnancyEvents(c, ev, added = []) {
    const out = { vomited: false };
    if (!c.pregnant || !(c.pregnancyWeek > 0)) return out;
    const w = c.pregnancyWeek;
    const g = goalOf(c);
    const key = `${c.charId || c.name}|${ev.day}`;
    const morning = ev.hour >= 5 && ev.hour < 11;

    // Утренняя тошнота: 5–15 неделя, после пробуждения или утром, раз в день, ~2 утра из 3
    if (w >= 5 && w <= 15 && ((ev.woke && ev.hour < 13) || morning) && c.sicknessDay !== ev.day) {
        c.sicknessDay = ev.day;
        const chance = w >= 7 && w <= 12 ? 0.7 : 0.45;
        if (seededChance(`${key}|sick`) < chance) grantEffect(c, 'morning_sickness', 3, added);
    }
    // Во время тошноты плотная еда может не удержаться
    if (hasEffect(c, 'morning_sickness') && (ev.mealKcal || 0) >= g * 0.15
        && seededChance(`${key}|${ev.turn}|vomit`) < 0.3) {
        out.vomited = true;
    }
    // Тяга к конкретной еде: 8–34 неделя, раз в день, в ~40% дней
    if (w >= 8 && w <= 34 && !ev.sleeping && c.cravingDay !== ev.day && ev.hour >= 10) {
        c.cravingDay = ev.day;
        if (seededChance(`${key}|crave`) < 0.4) {
            // Половина тяг — к любимому из пищевого профиля, остальное — классика беременности
            const likes = c.food?.likes || [];
            const [ru, en] = likes.length && seededChance(`${key}|fromlikes`) < 0.5
                ? (x => [x, x])(likes[pickIndex(`${key}|like`, likes.length)])
                : CRAVINGS[Math.floor(seededChance(`${key}|what`) * CRAVINGS.length)];
            grantEffect(c, 'craving', 4, added, ru);
            const e = [...c.buffs, ...c.debuffs].find(x => x.id === 'craving');
            if (e) e.detailEn = en;
        }
    }
    // Отвращение к еде: 6–16 неделя, раз в день, в ~30% дней — нелюбимое или классика
    if (w >= 6 && w <= 16 && !ev.sleeping && c.aversionDay !== ev.day && ev.hour >= 7) {
        c.aversionDay = ev.day;
        if (seededChance(`${key}|avers`) < 0.3) {
            const dis = c.food?.dislikes || [];
            const [ru, en] = dis.length && seededChance(`${key}|fromdis`) < 0.5
                ? (x => [x, x])(dis[pickIndex(`${key}|dis`, dis.length)])
                : AVERSIONS[Math.floor(seededChance(`${key}|avwhat`) * AVERSIONS.length)];
            grantEffect(c, 'aversion', 6, added, ru);
            const e = findEffectIn(c, 'aversion');
            if (e) e.detailEn = en;
        }
    }
    // Изжога: третий триместр, после плотной еды, в половине случаев
    if (w >= 27 && (ev.mealKcal || 0) >= g * 0.2 && seededChance(`${key}|${ev.turn}|burn`) < 0.5) {
        grantEffect(c, 'heartburn', 2, added);
    }
    return out;
}

// ═══════════════════════════════════════════════════════════════
// БОЛЕЗНИ-СОБЫТИЯ — случаются сами, шанс зависит от иммунитета и еды
// ═══════════════════════════════════════════════════════════════
/**
 * @param {{ day:number, turn:number, foods?: Array<{item:string, risky?:boolean}>, drinks?: Array<{item:string, risky?:boolean}>, hard?: boolean, skip?: boolean }} ev
 * @returns {{ vomited: boolean }}
 */
export function illnessEvents(c, ev, added = []) {
    const out = { vomited: false };
    const has = (id) => c.diseases.some(d => d.id === id);
    const spawn = (id, sev) => {
        c.diseases.push(makeDisease(DISEASE_DB[id], capStage(id, sev)));
        added.push(id);
    };
    const imm = Math.round(c.immAvg ?? calculateImmunity(c));
    const key = c.charId || c.name || '?';
    const hist = isHistorical();
    const infMult = hist ? 2 : 1;   // без современной медицины и гигиены инфекции чаще

    // Лёгкий режим: пропуск времени — это «жили обычной жизнью», новые болезни
    // за кадром не начинаются (уже начатые идут своим ходом и проходят)
    if (ev.skip && !ev.hard) {
        c.illRollDay = ev.day;
        return out;
    }
    // Раз в игровой день (за каждый прошедший день, максимум 30)
    const from = Math.max((c.illRollDay ?? ev.day - 1) + 1, ev.day - 30);
    for (let d = from; d <= ev.day; d++) {
        if (!has('cold')) {
            // Крепкий иммунитет — простуда раз в несколько месяцев, слабый — раз в пару недель
            let p = 0.004 + Math.max(0, 60 - imm) / 100 * 0.25;
            if (hasEffect(c, 'sleep_deprived')) p += 0.04;
            if (hasEffect(c, 'exhaustion')) p += 0.03;
            if (hasEffect(c, 'hangover')) p += 0.02;
            if (c.water < 30) p += 0.02;
            if (seededChance(`${key}|${d}|cold`) < p * infMult) spawn('cold', imm < (hist ? 35 : 25) ? 'moderate' : 'mild');
        }
        if (!has('gastritis') && ((c.daysWithDeficit || 0) >= 3 || (c.hoursSinceLastMeal || 0) >= 16)) {
            let p = 0.04;
            if ((c.caffeine || 0) > 200) p += 0.02;
            if ((c.bacPeak || 0) > 0.5) p += 0.02;
            if (seededChance(`${key}|${d}|gastr`) < p) spawn('gastritis', 'mild');
        }
    }
    c.illRollDay = ev.day;

    // Отравление: сомнительная еда (сырое, испорченное, лесные грибы, дичь) или совсем слабый иммунитет
    if (!has('food_poisoning')) {
        for (const f of ev.foods || []) {
            let p = f.risky ? (ev.hard ? 0.1 : 0.05) : 0;
            if (hist) p = p * infMult + 0.002;   // в старину даже обычная еда иногда подводит
            if (imm < 30) p += 0.02;
            if (p <= 0 || seededChance(`${key}|${ev.turn}|${f.item}|fp`) >= p) continue;
            const r = seededChance(`${key}|${ev.turn}|fpsev`);
            const sev = r < (hist ? 0.45 : 0.55) ? 'mild' : r < (hist ? 0.85 : 0.9) ? 'moderate' : 'severe';
            spawn('food_poisoning', sev);
            if (capStage('food_poisoning', sev) !== 'mild') out.vomited = true;
            break;
        }
    }
    // Дизентерия: сырая вода из ручья, реки, колодца, пруда
    if (!has('dysentery')) {
        for (const d of ev.drinks || []) {
            if (!d.risky) continue;
            let p = hist ? 0.06 : 0.01;
            if (ev.hard) p *= 1.5;
            if (imm < 40) p += 0.02;
            if (seededChance(`${key}|${ev.turn}|${d.item}|dys`) >= p) continue;
            spawn('dysentery', seededChance(`${key}|${ev.turn}|dyssev`) < (hist ? 0.35 : 0.2) ? 'moderate' : 'mild');
            break;
        }
    }
    return out;
}

/**
 * Лёгкий режим: болезни от голода и жажды не доходят до тяжёлых стадий.
 */
const HUNGER_DISEASES = ['hypoglycemia', 'starvation', 'dehydration_disease', 'malnutrition'];
export function capHungerSeverity(c) {
    for (const d of c.diseases) {
        if (!HUNGER_DISEASES.includes(d.id)) continue;
        if (d.severity === 'severe' || d.severity === 'critical') {
            const def = DISEASE_DB[d.id];
            const stage = def.stages.moderate ? 'moderate' : 'mild';
            Object.assign(d, stageFields(def, stage));
        }
    }
}

/**
 * Эффекты, которые зависят от события хода (сон, еда, рвота).
 * @param {{ slept?: number, mealKcal?: number, vomited?: boolean }} ev
 */
export function applyTurnEvents(c, ev, added = []) {
    const g = goalOf(c);
    // Выспался — только после сна, который был в сцене (не за кадром на пропуске), и ненадолго
    if ((ev.sceneSleep || 0) >= 6) grantEffect(c, 'rested', 4, added);
    // Хорошо поели — настоящая трапеза и сытость
    if ((ev.mealKcal || 0) >= g * 0.2 && c.satiety >= 70) grantEffect(c, 'well_fed', 3, added);
    // Напились вдоволь
    if ((ev.waterGain || 0) >= 20 && c.water >= 80) grantEffect(c, 'hydrated', 2, added);
    const ed = c.ed || {};
    if ((ev.mealKcal || 0) >= 150 && (ed.anorexia || ed.bulimia)) {
        grantEffect(c, 'post_meal_anxiety', ed.anorexia === 'severe' || ed.bulimia === 'severe' ? 4 : 2, added);
    }
    if ((ev.mealKcal || 0) >= g * 0.6 && (ed.bulimia || ed.binge)) grantEffect(c, 'shame', 4, added);
    if (ev.vomited && ed.bulimia) grantEffect(c, 'shame', 6, added);
}

// ═══════════════════════════════════════════════════════════════
// ЗАМЕТНОСТЬ СОСТОЯНИЙ — что попадает в сцену
// Раньше эффект повторялся каждые N ответов, а ответ — это ~0,1 игрового часа,
// поэтому тяга на 4 ч всплывала 10+ раз. Теперь:
//   • эффект: 1 показ на экземпляр (голод, жажда, опьянение — до 2, с паузой в игровых часах);
//     большинство эффектов — не чаще раза в игровой день;
//   • болезни и РПП — по игровым часам (лёгкая раз в 8 ч, тяжёлая раз в 3 ч);
//   • не больше одного события на персонажа за ответ и пауза минимум 4 ответа
//     между событиями одного персонажа (кроме критического).
// Показ засчитывается, когда событие выдано в промпт: shown= больше не нужен.
// ═══════════════════════════════════════════════════════════════
const DISEASE_GAP_H = { mild: 8, moderate: 5, severe: 3, critical: 1 };
const ED_GAP_H = { mild: 12, moderate: 8, severe: 5 };
const SEVERITY_RANK = { critical: 4, severe: 3, moderate: 2, mild: 1 };
const MAX_FOCUS = 1;          // событий на персонажа за ответ
const CHAR_GAP_TURNS = 6;     // ответов между событиями одного персонажа
const NEW_GAP_TURNS = 2;      // новое (только что появившееся) — можно чуть раньше

const DISEASE_CUES = {
    hypoglycemia: ['fine tremor in the fingers', 'cold sweat at the temples', 'a wave of dizziness', 'sudden pallor'],
    dehydration_disease: ['pounding headache', 'dizzy when standing up', 'heart racing at rest'],
    starvation: ['clothes hang looser than before', 'constantly cold', 'muscles give out quickly'],
    malnutrition: ['dull, tired-looking skin', 'tires faster than expected', 'looks paler than usual'],
};

function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
}

function cuesFor(c, id, isUser = false) {
    if (id.startsWith('ed_')) return ED_DB[id.slice(3)]?.cues;
    const d = c.diseases.find(x => x.id === id);
    if (d) return DISEASE_DB[id]?.stages?.[d.severity]?.cues || DISEASE_CUES[id];
    // Для персонажа игрока — только тело и мир вокруг: мысли и слова {{user}} ИИ не пишет
    const info = EFFECT_INFO[id];
    return (isUser && info?.userCues) || info?.cues;
}

// «{x}» в подсказке — то, к чему тяга (квашеная капуста)
function fillCue(c, id, cue) {
    if (!cue || !cue.includes('{x}')) return cue;
    const e = [...(c.buffs || []), ...(c.debuffs || [])].find(x => x.id === id);
    return cue.replace(/\{x\}/g, e?.detailEn || e?.detail || 'it');
}

/**
 * @param {Set<string>} changed — появившиеся/ухудшившиеся id
 * @param {{ foodInScene?: boolean, isUser?: boolean, clock?: number }} opts
 */
export function updateFocus(charData, turn, changed = new Set(), opts = {}) {
    const c = charData;
    const clock = opts.clock ?? 0;
    const day = Math.floor(clock / 24);
    c.seenAt = c.seenAt || {};      // id → игровые часы последнего показа
    c.shownDay = c.shownDay || {};  // id → игровой день последнего показа
    delete c.salience;              // старый учёт по ходам
    const cands = [];

    for (const d of c.diseases) {
        const cat = DISEASE_DB[d.id]?.category;
        cands.push({ id: d.id, gapH: (DISEASE_GAP_H[d.severity] ?? 5) * (d.recovering ? 1.5 : 1),
            rank: (cat === 'mental' ? 8 : 10) + (SEVERITY_RANK[d.severity] || 1),
            critical: d.severity === 'critical' && !d.recovering });
    }
    for (const e of edList(c)) {
        // РПП — чаще, когда в сцене едят, но тоже по часам
        const gap = ED_GAP_H[e.severity] ?? 8;
        cands.push({ id: `ed_${e.id}`, gapH: opts.foodInScene ? gap / 2 : gap, rank: 9 + (SEVERITY_RANK[e.severity] || 1) });
    }
    for (const e of [...c.debuffs, ...c.buffs]) {
        const info = EFFECT_INFO[e.id];
        if (!info?.every) continue;
        if (e.fading && !info.timed && !changed.has(e.id)) continue;   // проходящее — только фон
        if ((e.shows || 0) >= (info.shows ?? 1)) continue;             // этот экземпляр уже показан
        if (info.daily !== false && c.shownDay[e.id] === day && !e.shows) continue;   // раз в день
        cands.push({ id: e.id, gapH: info.gapH ?? 3, eff: e,
            rank: effectLevel(e)?.kind === 'negative' || info.kind === 'negative' ? 3 : 2 });
    }

    const lastBeat = c.lastBeatTurn ?? -99;
    const due = cands.filter(x => {
        const seen = c.seenAt[x.id];
        if (seen != null && clock - seen < x.gapH && !changed.has(x.id)) return false;
        const need = x.critical ? 0 : changed.has(x.id) ? NEW_GAP_TURNS : CHAR_GAP_TURNS;
        return turn - lastBeat >= need;
    }).sort((a, b) => (changed.has(b.id) - changed.has(a.id)) || (b.rank - a.rank));

    const focus = due.slice(0, MAX_FOCUS).map(x => x.id);
    c.focusCue = {};
    c.lastCue = c.lastCue || {};
    c.prevCue = {};
    for (const id of focus) {
        const x = due.find(y => y.id === id);
        c.seenAt[id] = clock;
        c.lastBeatTurn = turn;
        if (x.eff) {
            x.eff.shows = (x.eff.shows || 0) + 1;
            c.shownDay[id] = day;
        }
        const pool = (cuesFor(c, id, !!opts.isUser) || []).map(q => fillCue(c, id, q));
        if (!pool.length) continue;
        let idx = (turn + hashStr(c.name || '') + hashStr(id)) % pool.length;
        if (pool.length > 1 && pool[idx] === c.lastCue[id]) idx = (idx + 1) % pool.length;
        if (c.lastCue[id] && !x.eff) c.prevCue[id] = c.lastCue[id];   // «не повторяй» — только для болезней
        c.focusCue[id] = pool[idx];
        c.lastCue[id] = pool[idx];
    }
    const present = new Set(cands.map(x => x.id));
    for (const id of Object.keys(c.seenAt)) {
        if (!present.has(id) && !hasEffect(c, id) && !c.diseases.some(d => d.id === id)) delete c.seenAt[id];
    }
    for (const id of Object.keys(c.shownDay)) if (c.shownDay[id] < day - 1) delete c.shownDay[id];
    c.focus = focus;
}

// ═══════════════════════════════════════════════════════════════
// PROMPT GENERATION
// ═══════════════════════════════════════════════════════════════
function effectPrompt(e) {
    const lv = effectLevel(e);
    const base = lv?.prompt || EFFECT_INFO[e.id]?.prompt || e.id;
    return e.detailEn ? `${base}: ${e.detailEn}` : base;
}

function edPrompt(e) {
    const def = ED_DB[e.id];
    return `${def.nameEn} (${e.severity}): ${def.prompt}; at this stage ${def.stages[e.severity]}`;
}

/**
 * Блок состояния одного персонажа для системного промпта.
 */
export function buildConditionPrompt(charData, charName, opts = {}) {
    // Сцены-события выводятся отдельно, в конце промпта (buildBeats): на глубине 4 в длинных чатах их не видно
    const focus = new Set(opts.noSurface ? [] : charData.focus || []);
    const beatIds = new Set(opts.noSurface ? charData.focus || [] : []);
    const surface = [];
    const background = [];
    const cue = (id) => {
        let t = charData.focusCue?.[id] ? ` E.g. ${charData.focusCue[id]}.` : '';
        if (charData.prevCue?.[id]) t += ` Not again: ${charData.prevCue[id]}.`;
        return t;
    };
    // Для персонажа игрока — непроизвольная реакция тела или мир вокруг, без мыслей и слов
    const bodyNote = opts.isUser ? ' — through their body or the world around them' : '';

    for (const d of charData.diseases) {
        const def = DISEASE_DB[d.id];
        const stage = def?.stages?.[d.severity];
        const kind = def?.category === 'mental' ? 'mental' : 'physical';
        const label = `${d.id} (${kind}, ${d.severity}, healed ${Math.round(d.progress || 0)}%${d.recovering ? ', recovering slowly' : ''})`;
        if (focus.has(d.id)) surface.push(`${label}: ${stage?.symptoms || ''}${cue(d.id)}`);
        else if (!beatIds.has(d.id)) background.push(label);
    }
    for (const e of edList(charData)) {
        const id = `ed_${e.id}`;
        if (focus.has(id)) surface.push(`${edPrompt(e)}.${cue(id)}`);
        else background.push(`${ED_DB[e.id].nameEn} (${e.severity}) — shapes their reactions whenever food, meals, bodies or weight come up`);
    }
    for (const d of charData.debuffs) {
        if (focus.has(d.id)) surface.push(`${effectPrompt(d)}.${cue(d.id)}`);
        else if (!beatIds.has(d.id)) background.push(d.fading && !EFFECT_INFO[d.id]?.timed ? `${effectPrompt(d)} (passing)` : effectPrompt(d));
    }
    for (const b of charData.buffs) if (!beatIds.has(b.id)) background.push(effectPrompt(b));

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
        out.push(`  Surface now${bodyNote}:`);
        for (const l of surface) out.push(`    • ${l}`);
    }
    if (background.length) {
        out.push(`  Background: ${background.join('; ')}.`);
    }
    return out.join('\n');
}

/**
 * Сцены-события на этот ответ: то, что модель обязана показать, с id для shown=.
 * Ставится в правило тега — последнее системное сообщение, его модель видит лучше всего.
 */
export function buildBeats(charData, charName, opts = {}) {
    const out = [];
    const cue = (id) => {
        let t = charData.focusCue?.[id] ? ` E.g. ${charData.focusCue[id]}.` : '';
        if (charData.prevCue?.[id]) t += ` Not again: ${charData.prevCue[id]}.`;
        return t;
    };
    // Персонаж игрока: только видимый признак или реакция других — без его слов, мыслей и поступков
    const how = opts.isUser ? ` Only as a visible sign or someone else's reaction.` : '';
    for (const id of charData.focus || []) {
        let what = null;
        const d = charData.diseases.find(x => x.id === id);
        if (d) what = `${DISEASE_DB[id]?.nameEn || id} (${d.severity}): ${DISEASE_DB[id]?.stages?.[d.severity]?.symptoms || ''}`;
        else if (id.startsWith('ed_')) {
            const e = edList(charData).find(x => `ed_${x.id}` === id);
            if (e) what = edPrompt(e);
        } else {
            const e = [...charData.debuffs, ...charData.buffs].find(x => x.id === id);
            if (e) what = effectPrompt(e);
        }
        if (what) out.push(`• ${charName}: ${what}.${how}${cue(id)}`);
    }
    return out;
}

/** Общие правила для РПП — добавляются в промпт, если оно есть хоть у кого-то */
export const ED_GUIDANCE = `Eating disorders here are illnesses, not personality quirks or aesthetics. Portray them with realism and care: the fear, secrecy, shame and ambivalence, and the real cost to the body and to relationships. Never glamorize thinness or restriction, never frame weight loss as an achievement, and never include methods, tricks, numbers or targets in the narration — keep any purging off-page or to a brief mention. Other characters can notice and care; recovery and support are possible.`;
