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
export const BASE_SATIETY_LOSS_PER_HOUR = 6;   // больше не используется: сытость считается по желудку (см. ниже)

// ═══════════════════════════════════════════════════════════════
// СЫТОСТЬ = ЖЕЛУДОК, А НЕ ДНЕВНАЯ НОРМА
//   gut — сколько ккал сейчас в желудке и переваривается. Еда кладёт туда калории
//   сразу, желудок пустеет за 4–6 ч (быстрее, когда полон; во сне медленнее).
//   Сытость = «фон» + наполненность: 100 × (1 − e^(−gut/K)).
//   Обед 700 ккал → ~90%, через 3 ч ~60%, через 5 ч ~30%, к утру после ужина ~20%.
//   Фон 30% держится 6 ч после еды и потом медленно тает (−1,2 в час):
//   пустой желудок ≠ «умирает от голода».
// ═══════════════════════════════════════════════════════════════
export function stomachK(goal) { return 300 + Math.max(-60, Math.min(120, ((goal || 2000) - 2000) * 0.08)); }
function satBase(c) { return Math.max(0, 30 - 1.2 * Math.max(0, (c.hoursSinceLastMeal || 0) - 6)); }
export function satietyFrom(c, goal) {
    const base = satBase(c);
    return Math.max(0, Math.min(100, base + (100 - base) * (1 - Math.exp(-(c.gut || 0) / stomachK(goal)))));
}
/** Сколько должно быть в желудке, чтобы сытость была v (ниже фона — 0) */
export function gutFor(c, v, goal) {
    const base = satBase(c);
    const t = Math.min(99.5, v);
    if (t <= base) return 0;
    return -stomachK(goal) * Math.log(1 - (t - base) / (100 - base));
}
/** Поставить сытость (ИИ, калибровка, отладка): пересчитывает желудок, а если ниже фона — и часы без еды */
export function setSatiety(c, v, goal) {
    const t = Math.max(0, Math.min(100, v));
    if (t < satBase(c)) c.hoursSinceLastMeal = Math.max(c.hoursSinceLastMeal || 0, 6 + (30 - t) / 1.2);
    c.gut = gutFor(c, t, goal);
    c.satiety = Math.round(satietyFrom(c, goal));
}
function ensureGut(c, goal) {
    if (c.gut == null || !isFinite(c.gut)) setSatiety(c, c.satiety ?? 60, goal);
}

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
    ensureGut(charData, dailyGoal);

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

    // Беременность: со второго триместра голод нарастает чуть быстрее
    // (норма калорий у беременной и так выше — большие множители давали вечный голод)
    const pw = charData.pregnant ? (charData.pregnancyWeek || 0) : 0;
    if (pw >= 27) satietyMult += 0.12;
    else if (pw >= 14) satietyMult += 0.08;

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
    if (fromFat > 0) bankFat(charData, -fromFat / KCAL_PER_KG);
    // Пока без еды меньше 14 ч, организм добирает нехватку из жира и держит
    // небольшой запас — гипогликемия бывает только при настоящем голодании
    if ((charData.hoursSinceLastMeal || 0) < 14) {
        const floor = dailyGoal * 0.15;
        if (charData.reserve < floor) {
            bankFat(charData, -(floor - charData.reserve) / KCAL_PER_KG);
            charData.reserve = floor;
        }
    }

    // Недавно съеденное «переваривается» (период полураспада ~2ч)
    charData.recentIntake = (charData.recentIntake || 0) * Math.pow(0.5, hours / 2);

    // ─── Сытость: желудок пустеет (полный — быстрее), во сне медленнее ───
    {
        const speed = Math.sqrt(actMult) * satietyMult * (sleeping ? 0.7 : 1);
        let left = hours;
        while (left > 1e-6) {
            const dt = Math.min(0.5, left);
            left -= dt;
            const g = charData.gut || 0;
            charData.gut = Math.max(0, g - Math.max(90, g * 0.25) * speed * dt);
        }
    }

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
        bankFat(charData, -STARVING_LEAN_LOSS_PER_HOUR * hours);
        events.push('weight_loss');
    }

    charData.hoursSinceLastMeal = (charData.hoursSinceLastMeal || 0) + hours;
    // Часы почти без воды (для обезвоживания): копятся при воде ≤ 20, сбрасываются, когда напились
    if (charData.water <= 20) charData.dryHours = (charData.dryHours || 0) + hours;
    else if (charData.water > 30) charData.dryHours = 0;
    charData.satiety = Math.round(satietyFrom(charData, dailyGoal));

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

/**
 * Жир от баланса калорий копится за игровой день и списывается в полночь
 * (settleDayFat в index.js): так недоигранный день — утро и сразу скип —
 * не превращается в потерю веса, если персонаж не ложился голодным.
 */
export function bankFat(charData, kg) {
    if (!kg) return;
    charData.fatLedger = (charData.fatLedger || 0) + kg;
}

function storeEnergy(charData, kcal, goal) {
    const cap = reserveCap(goal);
    const next = (charData.reserve || 0) + kcal;
    if (next > cap) {
        bankFat(charData, (next - cap) / KCAL_PER_KG);
        charData.reserve = cap;
    } else {
        charData.reserve = next;
    }
}

/**
 * Применяет приём пищи (все блюда хода одной суммой).
 * @returns {{ overfed: boolean }}
 */
export function applyMeal(charData, calories, waterGain = 0, goal = null, opts = {}) {
    const g = goal ?? goalOf(charData);
    const cal = Math.max(0, calories || 0);
    if (cal <= 0 && waterGain <= 0) return { overfed: false };

    charData.calories = (charData.calories || 0) + cal;
    storeEnergy(charData, cal, g);
    // Жадно и быстро — сигнал сытости запаздывает, переедание наступает раньше
    charData.recentIntake = (charData.recentIntake || 0) + cal * (opts.greedy ? 1.3 : 1);

    // Сытость — от того, что лежит в желудке (не от доли дневной нормы).
    // При анорексии переполненность наступает раньше; при тошноте еда «не лезет»
    ensureGut(charData, g);
    const earlyFull = charData.ed?.anorexia ? 1.3 : 1;
    const nausea = hasEffect(charData, 'morning_sickness') ? 0.7 : 1;
    charData.gut = (charData.gut || 0) + cal * earlyFull * nausea;

    // Настоящая еда (от 50 ккал) сбрасывает часы голода
    if (cal >= 50) {
        charData.hoursSinceLastMeal = 0;
    }   // крошка (облизнул пальцы, попробовал) часы голода не сбрасывает
    charData.satiety = Math.round(satietyFrom(charData, g));
    const overflow = charData.gut > stomachK(g) * 3 ? 15 : 0;   // в желудке больше ~900 ккал — объелся

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
        // Калорийное питьё насыщает слабее еды
        ensureGut(charData, g);
        charData.gut = (charData.gut || 0) + calories * 0.5;
        charData.satiety = Math.round(satietyFrom(charData, g));
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
    charData.gut = (charData.gut || 0) * 0.3;
    charData.satiety = Math.round(satietyFrom(charData, goalOf(charData)));
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
