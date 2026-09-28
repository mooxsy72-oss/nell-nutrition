// nell-nutrition/nutrition-engine.js
import { calculateBMR } from './analyzer.js';
import { hasEffect, widmarkR } from './effects.js';
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
    // Здоровье отнимают болезни и истощение; голод, жажда и сонливость сами по себе — нет
    exhaustion: 0.3,
};


// Вес: 1 кг жировой ткани ≈ 7700 ккал
export const KCAL_PER_KG = 7700;
// При полном голоде тело теряет ещё воду и мышцы (кг/час)
export const STARVING_LEAN_LOSS_PER_HOUR = 0.012;
// ─── Активность в сцене ───
// pal    — во сколько раз расход выше базового обмена (как MET)
// strain — во сколько раз быстрее тратятся вода, сытость и энергия
// Подобрано так, что день «8 ч сна + 16 ч низкой активности» ≈ сидячему
// образу жизни (×1.2 к базовому обмену).
export const SCENE_ACTIVITY = {
    low:    { pal: 1.35, strain: 1.0, labelRu: 'низкая' },
    medium: { pal: 2.8,  strain: 1.4, labelRu: 'средняя' },
    high:   { pal: 5.5,  strain: 2.2, labelRu: 'высокая' },
};
export const SLEEP_PAL = 0.95;
export const SLEEP_STRAIN = 0.5;

/** Приводит любое значение активности (и старые resting/normal/active/intense) к low|medium|high */
export function normalizeActivity(a) {
    const x = String(a || '').toLowerCase().trim();
    if (SCENE_ACTIVITY[x]) return x;
    if (/^(rest|resting|idle|sit|sitting|calm|light|normal|низк|отдых|покой)/.test(x)) return 'low';
    if (/^(mod|moderate|active|walk|walking|work|average|mid|средн|умерен|актив)/.test(x)) return 'medium';
    if (/^(intense|hard|heavy|extreme|combat|fight|run|max|высок|интенс|тяжел)/.test(x)) return 'high';
    return null;
}

/** Базовый обмен персонажа (ккал/сутки) + добавка на беременность */
export function bmrOf(c) {
    let bmr = calculateBMR(c);
    if (c.pregnant && c.pregnancyWeek > 0) {
        bmr += c.pregnancyWeek >= 27 ? 450 : c.pregnancyWeek >= 13 ? 340 : 100;
    }
    return bmr;
}

/** Расход в ккал/час при данной активности */
export function burnPerHour(c, activity = 'low', sleeping = false) {
    const pal = sleeping ? SLEEP_PAL : (SCENE_ACTIVITY[normalizeActivity(activity) || 'low'].pal);
    // После нескольких дней недоедания тело экономит энергию
    const adapt = hasEffect(c, 'slow_metabolism') ? 0.88 : 1;
    return bmrOf(c) / 24 * pal * adapt;
}

// Алкоголь: печень выводит ~0.15‰ в час; кофеин: период полувыведения ~5 ч
export const BAC_ELIMINATION_PER_HOUR = 0.15;
export const CAFFEINE_HALF_LIFE = 5;

// Сон восстанавливает энергию: +12%/час
export const ENERGY_REGEN_SLEEPING = 12;


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

    // ── Дополнительные блюда (ккал за обычную порцию) ──
    'похлёбка': 300, 'похлебка': 300, 'жаркое': 550, 'гуляш': 450, 'солянка': 280, 'окрошка': 220,
    'вареники': 450, 'голубцы': 400, 'оладьи': 400, 'оладушки': 400, 'драники': 400, 'лепёшка': 250, 'лепешка': 250,
    'пышки': 350, 'ватрушка': 280, 'кулебяка': 450, 'расстегай': 300, 'калач': 300, 'бублик': 250, 'баранки': 200,
    'пряник': 150, 'пряники': 300, 'сушки': 150, 'халва': 250, 'пастила': 150, 'кулич': 400, 'шаньга': 300,
    'запеканка': 350, 'тефтели': 350, 'фрикадельки': 300, 'отбивная': 450, 'стейк': 550, 'рёбрышки': 600, 'ребрышки': 600,
    'крылышки': 450, 'окорок': 400, 'буженина': 350, 'холодец': 250, 'студень': 250, 'жульен': 300,
    'пицца': 700, 'бургер': 600, 'гамбургер': 550, 'шаурма': 600, 'сэндвич': 400, 'тост': 150, 'тосты': 300, 'гренки': 250,
    'хлопья': 250, 'мюсли': 300, 'лаваш': 250, 'рамен': 500, 'суши': 400, 'роллы': 450, 'манты': 500, 'хинкали': 500,
    'чебурек': 350, 'беляш': 350, 'самса': 350, 'хачапури': 700, 'кекс': 350, 'маффин': 350, 'пончик': 300,
    'круассан': 250, 'вафли': 300, 'мороженое': 250, 'репа': 50, 'редис': 20, 'капуста': 50, 'свёкла': 60, 'свекла': 60,
    'сосиска': 150, 'сосиски': 300, 'колбаса': 300, 'сало': 250, 'ветчина': 190, 'бекон': 250, 'пирожки': 540,
    'лапша': 400, 'спагетти': 450, 'картофель фри': 400, 'фри': 400, 'наггетсы': 350, 'хот-дог': 400, 'хотдог': 400,
    'сухофрукты': 200, 'изюм': 150, 'финики': 200, 'персик': 60, 'слива': 40, 'сливы': 120, 'вишня': 80, 'клубника': 60,
    'малина': 60, 'черника': 60, 'арбуз': 90, 'дыня': 100, 'мандарин': 40, 'мандарины': 120, 'лимон': 20,
    'хлебец': 30, 'краюха': 250, 'горбушка': 150, 'ломоть': 100, 'сухпаёк': 800, 'сухпаек': 800, 'паёк': 600, 'паек': 600,
    'похлёбку': 300, 'жаркого': 550,
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

    'сбитень': 20, 'взвар': 22, 'какао': 18, 'медовуха': 8, 'наливка': 2, 'настойка': 1, 'эль': 8,
    'минералка': 25, 'газировка': 20, 'кола': 20, 'холодный чай': 22, 'энергетик': 15, 'латте': 18, 'капучино': 15,
};


// ═══════════════════════════════════════════════════════════════
// МОДЕЛЬ КАЛОРИЙ
//   calories     — съедено за текущий игровой день (сбрасывается в полночь)
//   burned       — сожжено за текущий день
//   reserve      — краткосрочный запас энергии (растёт от еды, тает со временем);
//                  по нему считаются гипогликемия и голодание
//   recentIntake — съедено «недавно» (затухает ~2ч), для переедания
// ═══════════════════════════════════════════════════════════════
export function goalOf(c) {
    if (!c) return 2000;
    return c.manualGoal ?? c.calorieGoal ?? 2000;
}

/**
 * Обновляет состояние персонажа за прошедшие часы.
 * @returns {{ events: string[] }}
 */
export function tickTime(charData, hours, activity = 'low', sleeping = false, goal = null, opts = {}) {
    if (hours <= 0) return { events: [] };
    const events = [];
    const dailyGoal = goal ?? goalOf(charData);

    const level = normalizeActivity(activity) || 'low';
    const actMult = sleeping ? 1 : SCENE_ACTIVITY[level].strain;
    const pregMult = charData.pregnant ? PREGNANCY_MULTIPLIER : { calories: 1, water: 1, energy: 1 };

    const has = (arr, id) => Array.isArray(arr) && arr.some(x => x.id === id);
    let energyMult = 1.0, waterMult = 1.0, satietyMult = 1.0;

    if (has(charData.debuffs, 'hunger'))      energyMult += 0.20;
    if (has(charData.debuffs, 'exhaustion'))  energyMult += 0.30;
    if (has(charData.debuffs, 'dehydration')) energyMult += 0.15;
    if (has(charData.debuffs, 'overeating'))  energyMult += 0.10;
    if (has(charData.buffs, 'well_fed'))    { energyMult -= 0.15; satietyMult -= 0.10; }
    if (has(charData.buffs, 'hydrated'))      waterMult  -= 0.10;
    if (has(charData.buffs, 'high_energy'))   energyMult -= 0.12;
    if (hasEffect(charData, 'rested'))          energyMult -= 0.20;
    if (hasEffect(charData, 'caffeine'))        energyMult -= 0.30;
    if (hasEffect(charData, 'sleep_deprived'))  energyMult += 0.30;
    if (hasEffect(charData, 'hangover'))      { energyMult += 0.30; waterMult += 0.30; }
    if ((charData.bac || 0) >= 0.9)           { energyMult += 0.15; waterMult += 0.25; }
    const sick = (id) => (charData.diseases || []).find(d => d.id === id);
    const fp = sick('food_poisoning');
    if (fp && !fp.recovering)                   waterMult += fp.severity === 'mild' ? 0.2 : 0.6;
    const dys = sick('dysentery');
    if (dys && !dys.recovering)                 waterMult += dys.severity === 'mild' ? 0.4 : 0.9;
    if (sick('cold'))                         { energyMult += 0.2; waterMult += 0.15; }
    if (sick('anemia'))                         energyMult += 0.25;

    // Беременность: со второго триместра голод нарастает быстрее
    const pw = charData.pregnant ? (charData.pregnancyWeek || 0) : 0;
    if (pw >= 27) satietyMult += 0.25;
    else if (pw >= 14) satietyMult += 0.15;

    energyMult = Math.max(0.5, energyMult);
    waterMult = Math.max(0.6, waterMult);
    satietyMult = Math.max(0.6, satietyMult);

    // ─── Калории: базовый обмен (пол, вес, рост, возраст, мышцы) × активность ───
    const calBurn = burnPerHour(charData, level, sleeping) * hours;
    charData.burned = (charData.burned || 0) + calBurn;
    const reserve = charData.reserve ?? dailyGoal * 0.5;
    // Запаса не хватило — остаток сжигается из жира
    const fromFat = Math.max(0, calBurn - reserve);
    charData.reserve = Math.max(0, reserve - calBurn);
    if (fromFat > 0) changeWeight(charData, -fromFat / KCAL_PER_KG);
    // Пока без еды меньше 14 ч, организм добирает нехватку из жира и держит
    // небольшой запас — гипогликемия бывает только при настоящем голодании
    if ((charData.hoursSinceLastMeal || 0) < 14) {
        const floor = dailyGoal * 0.15;
        if (charData.reserve < floor) {
            changeWeight(charData, -(floor - charData.reserve) / KCAL_PER_KG);
            charData.reserve = floor;
        }
    }

    // Недавно съеденное «переваривается» (период полураспада ~2ч)
    charData.recentIntake = (charData.recentIntake || 0) * Math.pow(0.5, hours / 2);

    // ─── Сытость ───
    const satLoss = BASE_SATIETY_LOSS_PER_HOUR * hours * actMult * satietyMult * (sleeping ? 0.5 : 1);
    charData.satiety = Math.max(0, charData.satiety - satLoss);

    // ─── Вода ───
    const weightMult = Math.max(0.7, Math.min(1.5, (charData.weight || 65) / 65));
    const waterLoss = BASE_WATER_LOSS_PER_HOUR * hours * actMult * pregMult.water * weightMult * waterMult * (sleeping ? 0.6 : 1);
    charData.water = Math.max(0, charData.water - waterLoss);

    // ─── Энергия ───
    if (sleeping) {
        charData.energy = Math.min(100, charData.energy + ENERGY_REGEN_SLEEPING * hours);
        events.push('sleep_regen');
    } else {
        charData.energy = Math.max(0, charData.energy - BASE_ENERGY_LOSS_PER_HOUR * hours * actMult * pregMult.energy * energyMult);
    }

    // ─── Урон от болезней и дебаффов ───
    let diseaseHealthDrain = 0, diseaseEnergyDrain = 0;
    for (const d of (charData.diseases || [])) {
        const drain = DISEASE_DRAIN[d.severity];
        if (!drain) continue;
        const mult = d.recovering ? 0.4 : 1;
        diseaseHealthDrain += drain.health * mult;
        diseaseEnergyDrain += drain.energy * mult;
    }
    let debuffHealthDrain = 0;
    for (const deb of (charData.debuffs || [])) {
        const dmg = DEBUFF_HEALTH_DRAIN[deb.id];
        if (dmg) debuffHealthDrain += deb.fading ? dmg * 0.3 : dmg;
    }
    if (diseaseEnergyDrain > 0) {
        charData.energy = Math.max(0, charData.energy - diseaseEnergyDrain * hours);
    }

    // ─── Здоровье ───
    const isStarving = charData.satiety <= 0 && charData.reserve <= 0;
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
    if (diseaseHealthDrain > 0) {
        charData.health = Math.max(0, charData.health - diseaseHealthDrain * hours);
    }
    if (debuffHealthDrain > 0) {
        charData.health = Math.max(0, charData.health - debuffHealthDrain * hours);
    }
    if (!isStarving && !isDehydrated && !hasHealthThreat
        && charData.satiety > 30 && charData.water > 40 && charData.energy > 25) {
        // При цинге всё заживает вдвое медленнее
        const slow = (charData.diseases || []).some(d => d.id === 'scurvy') ? 0.5 : 1;
        charData.health = Math.min(100, charData.health + HEALTH_REGEN_PER_HOUR * hours * slow);
    }

    const BUFF_REGEN = {
        well_fed:    { energy: 0.8, health: 0.5 },
        hydrated:    { energy: 0.3, health: 0.5 },
        high_energy: { health: 0.3 },
    };
    for (const b of (charData.buffs || [])) {
        const regen = BUFF_REGEN[b.id];
        if (!regen) continue;
        if (regen.energy && !sleeping) charData.energy = Math.min(100, charData.energy + regen.energy * hours);
        if (regen.health) charData.health = Math.min(100, charData.health + regen.health * hours);
    }

    // Лёгкий режим: голод и жажда не доводят до смерти
    if (opts.healthFloor != null && charData.health < opts.healthFloor) charData.health = opts.healthFloor;

    if (charData.health <= 0) events.push('dying');

    if (isStarving) {
        changeWeight(charData, -STARVING_LEAN_LOSS_PER_HOUR * hours);
        events.push('weight_loss');
    }

    charData.hoursSinceLastMeal = (charData.hoursSinceLastMeal || 0) + hours;

    // ─── Алкоголь, кофеин, электролиты, часы без сна ───
    charData.bac = Math.max(0, (charData.bac || 0) - BAC_ELIMINATION_PER_HOUR * hours);
    charData.caffeine = (charData.caffeine || 0) * Math.pow(0.5, hours / CAFFEINE_HALF_LIFE);
    if (charData.caffeine < 5) charData.caffeine = 0;
    charData.electrolyte = Math.max(0, (charData.electrolyte || 0) - 1.5 * hours);
    if (sleeping) {
        charData.sleepStreak = (charData.sleepStreak || 0) + hours;
        if (charData.sleepStreak >= 3) charData.hoursAwake = 0;
    } else {
        charData.sleepStreak = 0;
        charData.hoursAwake = (charData.hoursAwake || 0) + hours;
    }
    // Самый долгий пост — для пищевой тревожности
    charData.maxFastHours = Math.max(charData.maxFastHours || 0, charData.hoursSinceLastMeal);

    return { events };
}

// ═══════════════════════════════════════════════════════════════
// ЕДА И ПИТЬЁ
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// ВЕС
// Запас энергии (reserve) работает как буфер: обычное питание его
// колеблет, не трогая вес. Всё, что не влезло в полный запас,
// откладывается в вес; всё, что сожжено при пустом запасе, уходит из веса.
// ═══════════════════════════════════════════════════════════════
export function reserveCap(goal) { return goal * 1.25; }

export function changeWeight(charData, kg) {
    if (!kg) return;
    charData.weight = Math.max(30, Math.round(((charData.weight || 65) + kg) * 1000) / 1000);
}

function storeEnergy(charData, kcal, goal) {
    const cap = reserveCap(goal);
    const next = (charData.reserve || 0) + kcal;
    if (next > cap) {
        changeWeight(charData, (next - cap) / KCAL_PER_KG);
        charData.reserve = cap;
    } else {
        charData.reserve = next;
    }
}

/**
 * Применяет приём пищи (все блюда хода одной суммой).
 * @returns {{ overfed: boolean }}
 */
export function applyMeal(charData, calories, waterGain = 0, goal = null) {
    const g = goal ?? goalOf(charData);
    const cal = Math.max(0, calories || 0);
    if (cal <= 0 && waterGain <= 0) return { overfed: false };

    charData.calories = (charData.calories || 0) + cal;
    storeEnergy(charData, cal, g);
    charData.recentIntake = (charData.recentIntake || 0) + cal;

    // Сытость зависит от нормы: для нормы 2000 обед в 600 ккал ≈ +39%
    // При анорексии чувство переполненности наступает раньше
    const earlyFull = charData.ed?.anorexia ? 1.3 : 1;
    // Утренняя тошнота: еда «не лезет» — насыщает хуже
    const nausea = hasEffect(charData, 'morning_sickness') ? 0.6 : 1;
    const satGain = Math.min(85, cal / g * 130 * earlyFull * nausea);
    const overflow = charData.satiety + satGain - 100;
    charData.satiety = Math.min(100, Math.round(charData.satiety + satGain));

    // Перекус сокращает «часы без еды» частично, полноценный приём — обнуляет
    const mealSize = g * 0.12;
    if (cal >= mealSize) {
        charData.hoursSinceLastMeal = 0;
    } else if (cal > 0) {
        charData.hoursSinceLastMeal = (charData.hoursSinceLastMeal || 0) * (1 - cal / mealSize);
    }
    if (cal > 0) charData.lastMealTime = Date.now();

    charData.energy = Math.min(100, charData.energy + Math.min(12, cal / 60));
    if (waterGain > 0) charData.water = Math.min(100, charData.water + waterGain);

    return { overfed: overflow > 10 };
}

/**
 * Применяет напиток. Калорийные напитки (сок, молоко, пиво) немного насыщают.
 */
export function applyDrink(charData, waterGain, calories = 0, goal = null, extras = {}) {
    const g = goal ?? goalOf(charData);
    if (extras.alcoholG > 0) {
        // Формула Уидмарка: промилле = граммы спирта / (вес × доля воды в теле)
        const add = extras.alcoholG / ((charData.weight || 65) * widmarkR(charData.gender));
        charData.bac = (charData.bac || 0) + add;
        charData.bacPeak = Math.max(charData.bacPeak || 0, charData.bac);
    }
    if (extras.caffeineMg > 0) charData.caffeine = (charData.caffeine || 0) + extras.caffeineMg;
    charData.water = Math.min(100, charData.water + Math.max(0, waterGain || 0));
    if (calories > 0) {
        charData.calories = (charData.calories || 0) + calories;
        storeEnergy(charData, calories, g);
        charData.recentIntake = (charData.recentIntake || 0) + calories * 0.5;
        charData.satiety = Math.min(100, Math.round(charData.satiety + Math.min(20, calories / g * 60)));
    }
}

/**
 * Рвота: теряется часть недавно съеденного, вода и электролиты.
 */
export function applyVomit(charData) {
    const lost = Math.min((charData.recentIntake || 0) * 0.5, charData.reserve || 0);
    charData.reserve = Math.max(0, (charData.reserve || 0) - lost);
    charData.calories = Math.max(0, (charData.calories || 0) - lost);
    charData.recentIntake = (charData.recentIntake || 0) * 0.4;
    charData.satiety = Math.max(0, charData.satiety - 30);
    charData.water = Math.max(0, charData.water - 10);
    charData.health = Math.max(0, charData.health - 2);
    charData.electrolyte = Math.min(100, (charData.electrolyte || 0) + 25);
    charData.bac = (charData.bac || 0) * 0.85;
    return Math.round(lost);
}

// ═══════════════════════════════════════════════════════════════
// ОБЩИЙ СТАТУС
// ═══════════════════════════════════════════════════════════════
export function getPhysicalStatus(charData) {
    charData = { ...charData, diseases: charData.diseases.filter(d => !['food_obsession', 'hunger_apathy', 'food_insecurity'].includes(d.id)) };
    if (charData.diseases.some(d => d.severity === 'critical')) return 'critical';
    if (charData.diseases.some(d => d.severity === 'severe')) return 'severe';
    if (charData.diseases.length > 0 || charData.health < 40) return 'poor';
    if (charData.debuffs.length > 0 || charData.satiety < 30 || charData.water < 30) return 'stressed';
    if (charData.health > 70 && charData.energy > 60) return 'healthy';
    return 'stable';
}
