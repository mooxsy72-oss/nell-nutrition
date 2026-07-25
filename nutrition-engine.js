// nell-nutrition/nutrition-engine.js
// Модуль расчётов: расход калорий, воды, энергии по времени.
// Болезни, баффы, дебаффы — условия появления и снятия.

// ═══════════════════════════════════════════════════════════════
// CONSTANTS — базовые скорости расхода (в час игрового времени)
// ═══════════════════════════════════════════════════════════════

// Калории сгорают ~90 ккал/час при обычной активности
export const BASE_CALORIE_BURN_PER_HOUR = 90;

// Вода падает ~3% в час
export const BASE_WATER_LOSS_PER_HOUR = 3;

// Энергия падает ~2% в час при бодрствовании
export const BASE_ENERGY_LOSS_PER_HOUR = 2;

// Сытость падает ~6% в час
export const BASE_SATIETY_LOSS_PER_HOUR = 6;

// Здоровье восстанавливается +1%/час если всё хорошо, падает если голод/болезнь
export const HEALTH_REGEN_PER_HOUR = 0.8;
export const HEALTH_LOSS_PER_HOUR_STARVING = 3;
export const HEALTH_LOSS_PER_HOUR_DEHYDRATED = 4;

// Утечка здоровья/энергии от болезней (в час), масштабируется по тяжести.
// Раньше эти цифры лежали внутри tickTime и были слишком маленькими —
// перенесла на уровень модуля и подняла значения.
export const DISEASE_DRAIN = {
    mild:     { health: 1.0, energy: 1.5 },
    moderate: { health: 2.2, energy: 3.0 },
    severe:   { health: 4.5, energy: 5.5 },
    critical: { health: 8.0, energy: 8.0 },
};

// Утечка здоровья от дебаффов (в час) — раньше дебаффы не трогали здоровье вообще
export const DEBUFF_HEALTH_DRAIN = {
    hunger: 0.4,
    dehydration: 0.6,
    exhaustion: 1.0,
    overeating: 0.3,
    drowsiness: 0.2,
};


// Сон восстанавливает энергию: +12%/час
export const ENERGY_REGEN_SLEEPING = 12;

// Множители активности
export const ACTIVITY_MULTIPLIERS = {
    resting: 0.5,
    normal: 1.0,
    active: 1.5,
    intense: 2.2,
};

// Беременность увеличивает потребности
export const PREGNANCY_MULTIPLIER = {
    calories: 1.25,  // +25% калорий
    water: 1.15,     // +15% воды
    energy: 1.1,     // быстрее устаёт
};

// ═══════════════════════════════════════════════════════════════
// FOOD DATABASE — примерные калории для распознанных продуктов
// ═══════════════════════════════════════════════════════════════
export const MEAL_CALORIES = {
    // ─── Полные приёмы пищи ───
    breakfast: 450,
    lunch: 650,
    dinner: 700,
    supper: 500,
    meal: 550,
    feast: 1200,
    snack: 150,
    brunch: 550,

    // ─── Конкретные продукты (EN) ───
    bread: 120,
    soup: 250,
    stew: 400,
    meat: 350,
    chicken: 300,
    pork: 380,
    beef: 400,
    fish: 280,
    salmon: 320,
    salad: 150,
    fruit: 80,
    apple: 70,
    banana: 90,
    orange: 60,
    berries: 50,
    sandwich: 350,
    porridge: 300,
    oatmeal: 300,
    rice: 250,
    pasta: 380,
    noodles: 350,
    cake: 400,
    pie: 450,
    pastry: 350,
    cookie: 150,
    cookies: 200,
    cheese: 180,
    egg: 90,
    eggs: 180,
    omelette: 250,
    milk: 100,
    yogurt: 120,
    butter: 100,
    nuts: 200,
    chocolate: 250,
    candy: 150,
    pizza: 500,
    burger: 550,
    sausage: 280,
    bacon: 200,
    ham: 150,
    vegetables: 100,
    potato: 150,
    potatoes: 200,
    mushrooms: 80,
    beans: 200,
    lentils: 220,
    tofu: 150,
    wine: 150,
    beer: 180,
    alcohol: 200,
    vodka: 220,
    whiskey: 200,

    // ─── Русские названия ───
    завтрак: 450,
    обед: 650,
    ужин: 700,
    перекус: 150,
    еда: 500,
    пир: 1200,
    хлеб: 105,
    сухарь: 65,
    сухари: 130,
    суп: 150,
    борщ: 150,
    щи: 120,
    рагу: 400,
    мясо: 375,
    говядина: 375,
    свинина: 525,
    баранина: 450,
    курица: 330,
    грудка: 250,
    индейка: 285,
    утка: 510,
    котлета: 260,
    шашлык: 600,
    тушёнка: 900,
    тушенка: 900,
    печень: 315,
    рыба: 300,
    лосось: 375,
    сёмга: 375,
    семга: 375,
    треска: 160,
    сельдь: 250,
    креветки: 115,
    кальмары: 120,
    икра: 80,
    салат: 150,
    фрукт: 80,
    фрукты: 120,
    яблоко: 75,
    груша: 70,
    банан: 110,
    апельсин: 70,
    виноград: 70,
    ягоды: 45,
    огурец: 15,
    помидор: 25,
    морковь: 35,
    ягода: 45,
    бутерброд: 350,
    каша: 250,
    овсянка: 250,
    гречка: 260,
    рис: 260,
    перловка: 240,
    плов: 525,
    пельмени: 675,
    макароны: 320,
    паста: 380,
    лапша: 350,
    картошка: 170,
    картофель: 170,
    пюре: 220,
    торт: 420,
    пирог: 360,
    пирожок: 245,
    булочка: 240,
    выпечка: 300,
    печенье: 175,
    блины: 345,
    сырники: 330,
    творог: 320,
    сыр: 145,
    сметана: 100,
    йогурт: 130,
    яйцо: 85,
    яйца: 170,
    яичница: 220,
    омлет: 280,
    молоко: 150,
    кефир: 100,
    масло: 100,
    орехи: 240,
    шоколад: 275,
    конфеты: 60,
    конфета: 60,
    мёд: 65,
    мед: 65,
    варенье: 75,
    грибы: 90,
    фасоль: 200,
    чечевица: 220,
    каравай: 300,
    компот: 75,
    кисель: 100,
    // ─── Дичь и подножный корм ───
    заяц: 360,
    кролик: 340,
    крольчатина: 340,
    белка: 180,
    оленина: 288,
    олень: 288,
    кабан: 450,
    кабанятина: 450,
    дичь: 400,
    куропатка: 270,
    перепёлка: 170,
    перепелка: 170,
    голубь: 265,
    лягушка: 70,
    улитки: 90,
    жёлуди: 195,
    желуди: 195,
    каштаны: 145,
    коренья: 135,
    черемша: 30,
    // ─── Алкоголь ───
    вино: 130,
    пиво: 225,
    водка: 120,
    виски: 125,
};

export const HYDRATING_ITEMS = {
    // EN
    water: 25,
    tea: 15,
    coffee: 10,
    juice: 18,
    milk: 12,
    soup: 15,
    fruit: 8,
    wine: 5,
    beer: 5,
    broth: 20,
    smoothie: 15,
    lemonade: 18,
    soda: 12,

    // RU
    вода: 25,
    чай: 15,
    кофе: 10,
    сок: 18,
    молоко: 12,
    суп: 15,
    борщ: 12,
    бульон: 20,
    компот: 18,
    кисель: 12,
    кефир: 15,
    лимонад: 18,
    смузи: 15,
    вино: 5,
    пиво: 5,
    водка: 0,
    морс: 18,
    отвар: 20,
    крапива: 20,
    квас: 15,
};


// ═══════════════════════════════════════════════════════════════
// TICK — обработка прошедшего времени
// ═══════════════════════════════════════════════════════════════

/**
 * Обновляет состояние персонажа на основе прошедших часов.
 * @param {Object} charData — объект состояния персонажа (мутируется)
 * @param {number} hours — сколько игровых часов прошло
 * @param {string} activity — resting | normal | active | intense
 * @param {boolean} sleeping — спит ли персонаж
 * @returns {Object} — { events: string[] } — что произошло (для логов)
 */
export function tickTime(charData, hours, activity = 'normal', sleeping = false, goal = null) {
    if (hours <= 0) return { events: [] };
    const events = [];

    const actMult = ACTIVITY_MULTIPLIERS[activity] || 1.0;
    const pregMult = charData.pregnant ? PREGNANCY_MULTIPLIER : { calories: 1, water: 1, energy: 1 };

    // ─── Модификаторы от бафов/дебафов ───
    const has = (arr, id) => Array.isArray(arr) && arr.some(x => x.id === id);
    let energyMult = 1.0;   // скорость траты энергии
    let waterMult = 1.0;    // скорость траты воды
    let satietyMult = 1.0;  // скорость траты сытости

    if (has(charData.debuffs, 'hunger'))      energyMult += 0.20;
    if (has(charData.debuffs, 'exhaustion'))  energyMult += 0.30;
    if (has(charData.debuffs, 'dehydration')) energyMult += 0.15;
    if (has(charData.debuffs, 'overeating'))  energyMult += 0.10;

    if (has(charData.buffs, 'well_fed'))    { energyMult -= 0.15; satietyMult -= 0.10; }
    if (has(charData.buffs, 'hydrated'))      waterMult  -= 0.10;
    if (has(charData.buffs, 'high_energy'))   energyMult -= 0.12;

    energyMult = Math.max(0.5, energyMult);
    waterMult = Math.max(0.6, waterMult);
    satietyMult = Math.max(0.6, satietyMult);

    // ─── Калории: ИНДИВИДУАЛЬНЫЙ метаболизм ───
    const dailyGoal = goal ?? charData.calorieGoal ?? 2000;
    const sleepMult = sleeping ? 0.65 : 1.0;
    const calBurn = Math.round((dailyGoal / 24) * hours * actMult * sleepMult);
    charData.calories = Math.max(0, charData.calories - calBurn);

    // ─── Сытость ───
    const satLoss = BASE_SATIETY_LOSS_PER_HOUR * hours * actMult * satietyMult * (sleeping ? 0.5 : 1);
    charData.satiety = Math.max(0, Math.round(charData.satiety - satLoss));

    // ─── Вода (беременность = +потребность; вес тоже влияет) ───
    const weightMult = Math.max(0.7, Math.min(1.5, (charData.weight || 65) / 65));
    const waterLoss = BASE_WATER_LOSS_PER_HOUR * hours * actMult * pregMult.water * weightMult * waterMult * (sleeping ? 0.6 : 1);
    charData.water = Math.max(0, Math.round(charData.water - waterLoss));

    // ─── Энергия ───
    // ВАЖНО: energy и health теперь храним БЕЗ округления внутри тика.
    // Округление на каждом шаге "съедало" мелкие потери (<0.5) и они
    // никогда не накапливались. Округляем только при отображении в UI.
    if (sleeping) {
        const energyGain = ENERGY_REGEN_SLEEPING * hours;
        charData.energy = Math.min(100, charData.energy + energyGain);
        events.push('sleep_regen');
    } else {
        const energyLoss = BASE_ENERGY_LOSS_PER_HOUR * hours * actMult * pregMult.energy * energyMult;
        charData.energy = Math.max(0, charData.energy - energyLoss);
    }

    // ─── Урон от болезней и дебаффов (считаем ДО решения о регене) ───
    let diseaseHealthDrain = 0;
    let diseaseEnergyDrain = 0;
    if (Array.isArray(charData.diseases)) {
        for (const d of charData.diseases) {
            const drain = DISEASE_DRAIN[d.severity];
            if (!drain) continue;
            const mult = d.recovering ? 0.4 : 1; // на выздоровлении тянет слабее
            diseaseHealthDrain += drain.health * mult;
            diseaseEnergyDrain += drain.energy * mult;
        }
    }

    let debuffHealthDrain = 0;
    if (Array.isArray(charData.debuffs)) {
        for (const deb of charData.debuffs) {
            const dmg = DEBUFF_HEALTH_DRAIN[deb.id];
            if (!dmg) continue;
            debuffHealthDrain += deb.fading ? dmg * 0.3 : dmg; // затухающий дебафф тянет слабее
        }
    }

    if (diseaseEnergyDrain > 0) {
        charData.energy = Math.max(0, charData.energy - diseaseEnergyDrain * hours);
    }

    // ─── Здоровье ───
    const isStarving = charData.satiety <= 0 && charData.calories <= 0;
    const isDehydrated = charData.water <= 15;
    const hasHealthThreat = diseaseHealthDrain > 0 || debuffHealthDrain > 0;

    if (isStarving) {
        charData.health = Math.max(0, charData.health - HEALTH_LOSS_PER_HOUR_STARVING * hours);
        events.push('starving');
    }
    if (isDehydrated) {
        charData.health = Math.max(0, charData.health - HEALTH_LOSS_PER_HOUR_DEHYDRATED * hours);
        events.push('dehydrated');
    }

    // Болезни и дебаффы тянут здоровье вниз ВСЕГДА, независимо от голода/жажды
    if (diseaseHealthDrain > 0) {
        charData.health = Math.max(0, charData.health - diseaseHealthDrain * hours);
        if (charData.diseases.some(d => !d.recovering && (d.severity === 'severe' || d.severity === 'critical'))) {
            events.push('disease_drain');
        }
    }
    if (debuffHealthDrain > 0) {
        charData.health = Math.max(0, charData.health - debuffHealthDrain * hours);
    }

    // Регенерация — только если организм ДЕЙСТВИТЕЛЬНО в порядке:
    // сыт, не обезвожен, бодр, и нет болезней/дебаффов, бьющих по здоровью
    if (!isStarving && !isDehydrated && !hasHealthThreat
        && charData.satiety > 30 && charData.water > 40 && charData.energy > 25) {
        charData.health = Math.min(100, charData.health + HEALTH_REGEN_PER_HOUR * hours);
    }

    // ─── Бонусы от баффов: активное восстановление ───
    const BUFF_REGEN = {
        well_fed:    { energy: 0.8, health: 0.5 },  // сытый организм восстанавливается
        hydrated:    { energy: 0.3, health: 0.5 },  // вода — залог регенерации
        high_energy: { health: 0.3 },               // бодрость укрепляет тело
    };

    if (Array.isArray(charData.buffs)) {
        for (const b of charData.buffs) {
            const regen = BUFF_REGEN[b.id];
            if (!regen) continue;
            if (regen.energy && !sleeping) {
                charData.energy = Math.min(100, charData.energy + regen.energy * hours);
            }
            if (regen.health) {
                charData.health = Math.min(100, charData.health + regen.health * hours);
            }
        }
    }

    // ─── Смерть от истощения/жажды ───
    if (charData.health <= 0) {
        events.push('dying');
    }

    // ─── Потеря веса при длительном голоде ───
    if (isStarving && hours >= 4) {
        const weightLoss = 0.05 * hours;
        charData.weight = Math.max(30, +(charData.weight - weightLoss).toFixed(1));
        events.push('weight_loss');
    }

    charData.hoursSinceLastMeal = (charData.hoursSinceLastMeal || 0) + hours;

    return { events };
}


// ═══════════════════════════════════════════════════════════════
// EATING & DRINKING
// ═══════════════════════════════════════════════════════════════

/**
 * Применяет приём пищи к состоянию персонажа.
 * @param {Object} charData
 * @param {number} calories — сколько ккал съедено
 * @param {number} waterGain — сколько % воды восстановлено (0 если еда без жидкости)
 * @returns {Object} — { overfed: boolean }
 */
export function applyMeal(charData, calories, waterGain = 0) {
    charData.calories += calories;
    charData.hoursSinceLastMeal = 0;
    charData.lastMealTime = Date.now();

    // Сытость: +1% за каждые 15 ккал, максимум +60% за один приём
    const satGain = Math.min(60, Math.round(calories / 15));
    charData.satiety = Math.min(100, charData.satiety + satGain);

    // Энергия: немного восстанавливается от еды
    const energyGain = Math.min(15, Math.round(calories / 50));
    charData.energy = Math.min(100, charData.energy + energyGain);

    // Вода
    if (waterGain > 0) {
        charData.water = Math.min(100, charData.water + waterGain);
    }

    // Переедание
    const overfed = charData.calories > charData.calorieGoal * 1.3;
    return { overfed };
}

/**
 * Применяет питьё.
 * @param {Object} charData
 * @param {number} waterGain — % воды
 */
export function applyDrink(charData, waterGain) {
    charData.water = Math.min(100, charData.water + waterGain);
}

// ═══════════════════════════════════════════════════════════════
// CONDITIONS — проверка и обновление болезней/баффов/дебаффов
// ═══════════════════════════════════════════════════════════════

/**
 * Проверяет состояние персонажа и добавляет/снимает условия.
 * Вызывается после каждого tickTime.
 * @param {Object} charData
 * @returns {Object} — { added: string[], removed: string[] }
 */
export function updateConditions(charData) {
    const added = [];
    const removed = [];

    // ─── ДЕБАФФЫ ───

    // Голод
    if (charData.satiety <= 20 && charData.hoursSinceLastMeal >= 6) {
        if (!charData.debuffs.find(d => d.id === 'hunger')) {
            charData.debuffs.push({
                id: 'hunger', name: 'Hunger', icon: '🍽',
                effect: '-20% Energy',
                effects: ['Energy Recovery -20%', 'Concentration -15%'],
            });
            added.push('hunger');
        }
    } else {
        if (charData.debuffs.find(d => d.id === 'hunger')) {
            charData.debuffs = charData.debuffs.filter(d => d.id !== 'hunger');
            removed.push('hunger');
        }
    }

    // Обезвоживание
    if (charData.water <= 25) {
        if (!charData.debuffs.find(d => d.id === 'dehydration')) {
            charData.debuffs.push({
                id: 'dehydration', name: 'Dehydration', icon: '💧',
                effect: '-15% Stamina',
                effects: ['Stamina -15%', 'Focus -10%'],
            });
            added.push('dehydration');
        }
    } else if (charData.water > 35) {
        if (charData.debuffs.find(d => d.id === 'dehydration')) {
            charData.debuffs = charData.debuffs.filter(d => d.id !== 'dehydration');
            removed.push('dehydration');
        }
    }

    // Истощение энергии
    if (charData.energy <= 15) {
        if (!charData.debuffs.find(d => d.id === 'exhaustion')) {
            charData.debuffs.push({
                id: 'exhaustion', name: 'Exhaustion', icon: '😴',
                effect: '-30% All Actions',
                effects: ['Physical Actions -30%', 'Mental Focus -25%'],
            });
            added.push('exhaustion');
        }
    } else if (charData.energy > 30) {
        if (charData.debuffs.find(d => d.id === 'exhaustion')) {
            charData.debuffs = charData.debuffs.filter(d => d.id !== 'exhaustion');
            removed.push('exhaustion');
        }
    }

    // Переедание
    if (charData.calories > charData.calorieGoal * 1.4) {
        if (!charData.debuffs.find(d => d.id === 'overeating')) {
            charData.debuffs.push({
                id: 'overeating', name: 'Overeating', icon: '🤢',
                effect: '-10% Energy',
                effects: ['Sluggishness', 'Energy -10%'],
            });
            added.push('overeating');
        }
    } else {
        if (charData.debuffs.find(d => d.id === 'overeating')) {
            charData.debuffs = charData.debuffs.filter(d => d.id !== 'overeating');
            removed.push('overeating');
        }
    }

    // Сонливость (низкая энергия, но не критичная)
    if (charData.energy <= 30 && charData.energy > 15) {
        if (!charData.debuffs.find(d => d.id === 'drowsiness')) {
            charData.debuffs.push({
                id: 'drowsiness', name: 'Drowsiness', icon: '💤',
                effect: '-10% Focus',
                effects: ['Focus -10%', 'Reaction Time -10%'],
            });
            added.push('drowsiness');
        }
    } else {
        if (charData.debuffs.find(d => d.id === 'drowsiness')) {
            charData.debuffs = charData.debuffs.filter(d => d.id !== 'drowsiness');
            removed.push('drowsiness');
        }
    }

    // ─── БАФФЫ ───

    // Сытость (хорошо поел)
    if (charData.satiety >= 75 && charData.calories >= charData.calorieGoal * 0.6) {
        if (!charData.buffs.find(b => b.id === 'well_fed')) {
            charData.buffs.push({
                id: 'well_fed', name: 'Well Fed', icon: '🍲',
                effect: '+15% Energy',
            });
            added.push('well_fed');
        }
    } else {
        if (charData.buffs.find(b => b.id === 'well_fed')) {
            charData.buffs = charData.buffs.filter(b => b.id !== 'well_fed');
            removed.push('well_fed');
        }
    }

    // Хорошая гидратация
    if (charData.water >= 80) {
        if (!charData.buffs.find(b => b.id === 'hydrated')) {
            charData.buffs.push({
                id: 'hydrated', name: 'Well Hydrated', icon: '💧',
                effect: '+10% Stamina',
            });
            added.push('hydrated');
        }
    } else if (charData.water < 65) {
        if (charData.buffs.find(b => b.id === 'hydrated')) {
            charData.buffs = charData.buffs.filter(b => b.id !== 'hydrated');
            removed.push('hydrated');
        }
    }

    // Высокая энергия
    if (charData.energy >= 85) {
        if (!charData.buffs.find(b => b.id === 'high_energy')) {
            charData.buffs.push({
                id: 'high_energy', name: 'High Energy', icon: '⚡',
                effect: '+12% Stamina',
            });
            added.push('high_energy');
        }
    } else if (charData.energy < 70) {
        if (charData.buffs.find(b => b.id === 'high_energy')) {
            charData.buffs = charData.buffs.filter(b => b.id !== 'high_energy');
            removed.push('high_energy');
        }
    }

    // ─── БОЛЕЗНИ ───

    // Гипогликемия — калории на нуле + голод > 12 часов
    if (charData.calories <= 0 && charData.hoursSinceLastMeal >= 12) {
        if (!charData.diseases.find(d => d.id === 'hypoglycemia')) {
            charData.diseases.push({
                id: 'hypoglycemia', name: 'Hypoglycemia',
                severity: charData.hoursSinceLastMeal >= 24 ? 'severe' : 'moderate',
                effects: ['Dizziness', 'Weakness', 'Tremor', 'Confusion'],
                since: `Since ${Math.round(charData.hoursSinceLastMeal)}h`,
            });
            added.push('hypoglycemia');
        } else {
            // Обновить severity
            const d = charData.diseases.find(d => d.id === 'hypoglycemia');
            if (charData.hoursSinceLastMeal >= 24) d.severity = 'severe';
            if (charData.hoursSinceLastMeal >= 48) d.severity = 'critical';
            d.since = `Since ${Math.round(charData.hoursSinceLastMeal)}h`;
        }
    } else if (charData.calories > 100 && charData.satiety > 30) {
        if (charData.diseases.find(d => d.id === 'hypoglycemia')) {
            charData.diseases = charData.diseases.filter(d => d.id !== 'hypoglycemia');
            removed.push('hypoglycemia');
        }
    }

    // Обезвоживание (болезнь) — вода ниже 10%
    if (charData.water <= 10) {
        if (!charData.diseases.find(d => d.id === 'severe_dehydration')) {
            charData.diseases.push({
                id: 'severe_dehydration', name: 'Severe Dehydration',
                severity: charData.water <= 5 ? 'critical' : 'severe',
                effects: ['Organ Stress', 'Confusion', 'Fainting Risk', 'Muscle Cramps'],
                since: 'Critical',
            });
            added.push('severe_dehydration');
        }
    } else if (charData.water > 20) {
        if (charData.diseases.find(d => d.id === 'severe_dehydration')) {
            charData.diseases = charData.diseases.filter(d => d.id !== 'severe_dehydration');
            removed.push('severe_dehydration');
        }
    }

    // Истощение (болезнь) — голод > 36 часов
    if (charData.hoursSinceLastMeal >= 36 && charData.calories <= 0) {
        if (!charData.diseases.find(d => d.id === 'starvation')) {
            charData.diseases.push({
                id: 'starvation', name: 'Starvation',
                severity: charData.hoursSinceLastMeal >= 72 ? 'critical' : 'severe',
                effects: ['Muscle Loss -15%', 'Weight Loss', 'Immune Weakness', 'Cognitive Decline'],
                since: `Since ${Math.round(charData.hoursSinceLastMeal)}h`,
            });
            added.push('starvation');
        } else {
            const d = charData.diseases.find(d => d.id === 'starvation');
            if (charData.hoursSinceLastMeal >= 72) d.severity = 'critical';
            d.since = `Since ${Math.round(charData.hoursSinceLastMeal)}h`;
        }
    } else if (charData.satiety > 40 && charData.calories > 200) {
        if (charData.diseases.find(d => d.id === 'starvation')) {
            charData.diseases = charData.diseases.filter(d => d.id !== 'starvation');
            removed.push('starvation');
        }
    }

    return { added, removed };
}

// ═══════════════════════════════════════════════════════════════
// OVERALL STATUS (для промпта)
// ═══════════════════════════════════════════════════════════════
export function getPhysicalStatus(charData) {
    if (charData.diseases.some(d => d.severity === 'critical')) return 'critical';
    if (charData.diseases.some(d => d.severity === 'severe')) return 'severe';
    if (charData.diseases.length > 0 || charData.health < 40) return 'poor';
    if (charData.debuffs.length > 0 || charData.satiety < 30 || charData.water < 30) return 'stressed';
    if (charData.health > 70 && charData.energy > 60) return 'healthy';
    return 'stable';
}
// ═══════════════════════════════════════════════════════════════
// WEIGHT CHANGE — набор/потеря веса
// ═══════════════════════════════════════════════════════════════

/**
 * Обновляет вес на основе дневного баланса калорий.
 * Вызывается при смене «игрового дня» (когда tp > 16 часов или новый день).
 * Правило: +3500 ккал сверх нормы = +0.5 кг, -3500 = -0.5 кг (упрощённо).
 * @param {Object} charData
 * @param {number} dayCalories — калории за прошедший «день»
 * @returns {{ gained: number, lost: number }}
 */
export function updateWeight(charData, dayCalories) {
    const surplus = dayCalories - charData.calorieGoal;
    let change = 0;

    if (surplus > 500) {
        // Переедание — набор веса
        change = (surplus / 3500) * 0.5;
        charData.weight = +(charData.weight + change).toFixed(1);
        return { gained: +change.toFixed(2), lost: 0 };
    } else if (surplus < -800) {
        // Сильный дефицит — потеря (уже обрабатывается в tickTime при голоде)
        // Здесь дополнительная потеря за дефицит без полного голодания
        change = (Math.abs(surplus) / 7000) * 0.3;
        charData.weight = Math.max(30, +(charData.weight - change).toFixed(1));
        return { gained: 0, lost: +change.toFixed(2) };
    }

    return { gained: 0, lost: 0 };
}

/**
 * Сброс дневных калорий (вызывается при смене дня).
 * @param {Object} charData
 * @returns {number} — калории за прошедший день (до сброса)
 */
export function resetDailyCalories(charData) {
    const prev = charData.calories;
    charData.calories = 0;
    return prev;
}
