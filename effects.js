// nell-nutrition/effects.js
// Активные эффекты — временные состояния тела и настроения.
// kind: positive | negative | neutral. Хранятся в charData.buffs (positive)
// и charData.debuffs (negative/neutral) — так совместимо со старыми сохранениями.

export const EFFECT_INFO = {
    // ─── Голод и жажда ───
    hunger: {
        name: 'Голод', kind: 'negative', icon: 'fa-utensils', every: 4,
        text: '−20% восстановления энергии, −15% концентрации',
        prompt: 'hungry — shorter temper, harder to focus, tires a bit faster',
        cues: ['attention drifts to a smell of food nearby', 'a hollow, light-headed pause before answering',
            'eyes linger a second too long on someone else\'s food', 'a quiet growl from the stomach, quickly ignored',
            'hands feel a little weak gripping something'],
    },
    dehydration: {
        name: 'Жажда', kind: 'negative', icon: 'fa-droplet-slash', every: 4,
        text: '−15% выносливости, −10% концентрации',
        prompt: 'thirsty — dry mouth, mild headache, a little sluggish',
        cues: ['lips dry, licked absently', 'a dull ache behind the eyes', 'voice slightly hoarse',
            'glances toward any source of water', 'swallowing feels dry and scratchy'],
    },
    irritability: {
        name: 'Раздражительность', kind: 'negative', icon: 'fa-face-angry', every: 4, mental: true,
        text: 'Вспыльчивость, меньше терпения',
        prompt: 'irritable from hunger — snappier, less patient, small things grate; not rage, just a short fuse',
        cues: ['a sharper tone than intended', 'impatience with a slow answer', 'sighs at a minor delay',
            'a clipped reply, regretted a moment later'],
    },
    overeating: {
        name: 'Переедание', kind: 'negative', icon: 'fa-weight-hanging', every: 3,
        text: 'Вялость, −10% энергии',
        prompt: 'overfull — heavy stomach, sluggish, wants to sit down',
        cues: ['shifts to ease a heavy stomach', 'waves off more food', 'moves more slowly than usual'],
    },
    slow_metabolism: {
        name: 'Замедленный обмен', kind: 'negative', icon: 'fa-temperature-low', every: 6,
        text: '−12% расхода калорий, мёрзнет',
        prompt: 'body in energy-saving mode after days of too little food — feels cold easily, low stamina, slow to warm up',
        cues: ['pulls a layer tighter against a chill no one else feels', 'cold fingertips', 'needs longer to get going'],
    },

    // ─── Сон и силы ───
    exhaustion: {
        name: 'Истощение сил', kind: 'negative', icon: 'fa-face-tired', every: 3,
        text: '−30% к физическим действиям, −25% фокуса',
        prompt: 'exhausted — heavy limbs, slow reactions; strenuous actions fail easily',
        cues: ['movements heavy and deliberate', 'needs a moment to steady after standing',
            'breath short after small effort', 'sits down at the first chance'],
    },
    drowsiness: {
        name: 'Сонливость', kind: 'negative', icon: 'fa-bed', every: 5,
        text: '−10% фокуса и реакции',
        prompt: 'sleepy — attention drifts, reactions a touch slow',
        cues: ['a suppressed yawn', 'loses the thread of a sentence for a second', 'rubs the eyes', 'slower to react to a question'],
    },
    sleep_deprived: {
        name: 'Недосып', kind: 'negative', icon: 'fa-eye-slash', every: 4,
        text: 'Энергия тратится на 30% быстрее, хуже настроение',
        prompt: 'awake far too long — foggy, emotionally raw, misses details',
        cues: ['stares a beat too long at nothing', 'laughs at something not that funny', 'forgets what was just said',
            'eyes red-rimmed'],
    },
    rested: {
        name: 'Выспался', kind: 'positive', icon: 'fa-sun', timed: true,
        text: 'Энергия тратится на 20% медленнее',
        prompt: 'well rested — clear, steady',
    },

    // ─── Питьё ───
    caffeine: {
        name: 'Кофеин', kind: 'positive', icon: 'fa-mug-hot',
        text: 'Энергия тратится на 30% медленнее, сонливость не наступает',
        prompt: 'caffeinated — alert, a bit quicker',
    },
    caffeine_jitters: {
        name: 'Перебор кофеина', kind: 'negative', icon: 'fa-heart-circle-bolt', every: 3,
        text: 'Тремор, тревожность, сердцебиение',
        prompt: 'too much caffeine — jittery, restless, heart racing, a little anxious',
        cues: ['a tapping foot that won\'t stop', 'fingers drum on the table', 'talks a touch too fast'],
    },
    intoxication: {
        name: 'Опьянение', kind: 'neutral', icon: 'fa-wine-glass', every: 2,
        text: '',
        levels: [
            { min: 0.3, name: 'Лёгкое опьянение', kind: 'neutral', text: 'Расслабленность, разговорчивость',
                prompt: 'tipsy — relaxed, warmer, more talkative, slightly less filtered' },
            { min: 0.9, name: 'Опьянение', kind: 'negative', text: 'Хуже координация и суждения, вода уходит быстрее',
                prompt: 'drunk — clumsy, loud or sentimental, poor judgement, words slur a little' },
            { min: 1.8, name: 'Сильное опьянение', kind: 'negative', text: 'Шатается, путается, тошнит',
                prompt: 'very drunk — unsteady on their feet, confused, nauseous; complex actions fail' },
        ],
        cues: ['a laugh a little too loud', 'leans on the table for balance', 'loses the end of a sentence',
            'cheeks flushed', 'misjudges a step'],
    },
    hangover: {
        name: 'Похмелье', kind: 'negative', icon: 'fa-head-side-virus', every: 2, timed: true,
        text: 'Головная боль, жажда, энергия и вода уходят на 30% быстрее',
        prompt: 'hungover — pounding head, light-sensitive, queasy, very thirsty',
        cues: ['winces at a loud sound', 'squints against the light', 'nurses a cup of water', 'queasy at the smell of food'],
    },

    // ─── РПП ───
    post_meal_anxiety: {
        name: 'Тревога после еды', kind: 'negative', icon: 'fa-face-frown', every: 1, timed: true, mental: true,
        text: 'Беспокойство, навязчивые мысли о съеденном',
        prompt: 'anxious after eating — restless, preoccupied with what was eaten, may withdraw',
        cues: ['goes quiet after the meal', 'fidgets with a sleeve', 'finds a reason to step away',
            'pushes the plate a little further off'],
    },
    shame: {
        name: 'Стыд и вина', kind: 'negative', icon: 'fa-face-sad-tear', every: 1, timed: true, mental: true,
        text: 'Подавленность, желание спрятаться',
        prompt: 'ashamed after an episode with food — withdrawn, avoids eye contact, self-critical, secretive',
        cues: ['avoids eye contact', 'answers in single words', 'covers it with a forced smile', 'wants to be alone'],
    },

    // ─── Беременность: события ───
    morning_sickness: {
        name: 'Утренняя тошнота', kind: 'negative', icon: 'fa-face-grimace', every: 1, timed: true,
        text: 'Мутит, еда не лезет — насыщает на 40% хуже',
        prompt: 'morning sickness — queasy, food and strong smells turn the stomach; can barely eat',
        cues: ['turns away from the smell of cooking', 'nibbles a dry crust and stops', 'a hand pressed to the mouth',
            'pale, breathing slowly through the nose', 'pushes the plate away after two bites'],
    },
    pregnancy_appetite: {
        name: 'Зверский аппетит', kind: 'neutral', icon: 'fa-drumstick-bite', every: 3,
        text: 'Голод беременной: хочется есть чаще и больше',
        prompt: 'pregnant and ravenous — hungry sooner than usual, thinks about the next meal',
        cues: ['eyes the bread basket', 'asks when dinner will be', 'finishes a plate faster than expected', 'raids the pantry'],
    },
    craving: {
        name: 'Тяга к еде', kind: 'neutral', icon: 'fa-lemon', every: 1, timed: true,
        text: 'Очень хочется чего-то конкретного',
        prompt: 'a pregnancy craving',
        cues: ['can\'t stop thinking about it', 'asks if there is any', 'describes it longingly', 'would trade a lot for it right now'],
    },
    heartburn: {
        name: 'Изжога', kind: 'negative', icon: 'fa-fire', every: 1, timed: true,
        text: 'Жжение за грудиной после еды',
        prompt: 'heartburn after eating — burning chest, uncomfortable lying down',
        cues: ['rubs the breastbone', 'sits up straighter', 'sips water to ease a burning'],
    },
    baby_kicks: {
        name: 'Малыш толкается', kind: 'positive', icon: 'fa-baby', every: 1, timed: true,
        text: 'Шевеления',
        prompt: 'the baby is kicking',
        cues: ['a hand goes to the belly', 'a surprised little laugh', 'pauses mid-sentence to feel a kick', 'guides someone\'s hand to feel it'],
    },

    // ─── Положительные ───
    well_fed: {
        name: 'Сытость', kind: 'positive', icon: 'fa-bowl-rice',
        text: '+0.8% энергии/ч, +0.5% здоровья/ч, −15% траты энергии',
        prompt: 'well fed — steady strength and endurance',
    },
    hydrated: {
        name: 'Гидратация', kind: 'positive', icon: 'fa-droplet',
        text: '+0.3% энергии/ч, +0.5% здоровья/ч, −10% траты воды',
        prompt: 'well hydrated — clear-headed, good stamina',
    },
    high_energy: {
        name: 'Бодрость', kind: 'positive', icon: 'fa-bolt',
        text: '+0.3% здоровья/ч, −12% траты энергии',
        prompt: 'energetic — quick and alert',
    },
};

export function effectLevel(e) {
    const info = EFFECT_INFO[e.id];
    if (!info?.levels) return null;
    return info.levels[Math.min(info.levels.length - 1, Math.max(0, e.level || 0))];
}

/** Имя, тип, иконка и описание эффекта для отображения */
export function effectView(e) {
    const info = EFFECT_INFO[e.id] || {};
    const lv = effectLevel(e);
    const base = lv?.name || info.name || e.name || e.id;
    return {
        name: e.detail ? `${base}: ${e.detail}` : base,
        kind: lv?.kind || info.kind || 'neutral',
        icon: info.icon || 'fa-circle',
        text: lv?.text || info.text || e.effect || '',
        timed: !!info.timed,
        mental: !!info.mental,
    };
}

export const hasEffect = (c, id) =>
    (c.buffs || []).some(x => x.id === id) || (c.debuffs || []).some(x => x.id === id);

const listFor = (c, id) => (EFFECT_INFO[id]?.kind === 'positive' ? c.buffs : c.debuffs);

function findEffect(c, id) {
    return (c.buffs || []).find(x => x.id === id) || (c.debuffs || []).find(x => x.id === id);
}

function removeEffect(c, id) {
    c.buffs = (c.buffs || []).filter(x => x.id !== id);
    c.debuffs = (c.debuffs || []).filter(x => x.id !== id);
}

/**
 * Эффект по условию, с «затуханием» после того как причина ушла.
 * on — причина есть; off — причина точно ушла (между ними — гистерезис).
 */
export function toggleEffect(c, id, { on, off, linger = 0 }, hours, added, removed) {
    const ex = findEffect(c, id);
    if (on) {
        if (!ex) {
            listFor(c, id).push({ id, fading: false, fadeLeft: 0 });
            added.push(id);
        } else if (ex.fading) {
            ex.fading = false;
            ex.fadeLeft = 0;
        }
        return;
    }
    if (!ex) return;
    if (off && !ex.fading) {
        if (linger <= 0) { removeEffect(c, id); removed.push(id); return; }
        ex.fading = true;
        ex.fadeLeft = linger;
        return;
    }
    if (ex.fading) {
        ex.fadeLeft -= hours;
        if (ex.fadeLeft <= 0) { removeEffect(c, id); removed.push(id); }
    }
}

/** Эффект на время (выспался, похмелье, стыд) — таймер обновляется */
export function grantEffect(c, id, hoursLeft, added = [], detail = null) {
    const ex = findEffect(c, id);
    if (ex) {
        ex.fading = true;
        ex.fadeLeft = Math.max(ex.fadeLeft || 0, hoursLeft);
        if (detail) ex.detail = detail;
        return;
    }
    listFor(c, id).push({ id, fading: true, fadeLeft: hoursLeft, ...(detail ? { detail } : {}) });
    added.push(id);
}

/** Детерминированная «случайность»: одно и то же для свайпов одного ответа */
export function seededChance(seed) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 10000) / 10000;
}

// ═══════════════════════════════════════════════════════════════
// АЛКОГОЛЬ И КОФЕИН ПО НАЗВАНИЮ НАПИТКА
// ═══════════════════════════════════════════════════════════════
const ABV = [
    [['водк', 'виски', 'коньяк', 'бренди', 'самогон', 'абсент', 'джин', 'текил', 'горилк', 'vodka', 'whisk', 'brandy', 'cognac', 'gin', 'tequila', 'absinth'], 0.40],
    [['ром', 'rum'], 0.40],
    [['ликёр', 'ликер', 'настойк', 'наливк', 'liqueur'], 0.25],
    [['вин', 'шампанск', 'глинтвейн', 'wine', 'champagne', 'mulled'], 0.12],
    [['медовух', 'mead', 'сидр', 'cider'], 0.07],
    [['пив', 'эль', 'ale', 'beer', 'lager', 'стаут', 'stout'], 0.05],
    [['квас', 'kvass'], 0.012],
];
const ABV_EXCLUDE = ['ромаш', 'виног', 'винегр', 'эльф'];

const CAFFEINE_MG_PER_ML = [
    [['эспрессо', 'espresso'], 2.1],
    [['энергетик', 'energy'], 0.32],
    [['кофе', 'coffee', 'латте', 'капучино', 'американо', 'latte', 'cappuccino'], 0.4],
    [['мате', 'mate'], 0.3],
    [['чай', 'чая', 'чаю', 'чаем', 'tea'], 0.2],
    [['кол', 'cola'], 0.1],
    [['какао', 'cocoa', 'шоколад'], 0.05],
];

function tokensOf(name) {
    return String(name || '').toLowerCase().replace(/ё/g, 'е').split(/[^\p{L}]+/u).filter(Boolean);
}

/**
 * @returns {{ alcoholG: number, caffeineMg: number }}
 */
export function drinkExtras(name, ml) {
    const toks = tokensOf(name);
    const starts = (list) => toks.some(t => list.some(p => t.startsWith(p.replace(/ё/g, 'е')))
        && !ABV_EXCLUDE.some(x => t.startsWith(x)));
    let abv = 0;
    if (!toks.some(t => /^(безалк|non|alcohol-free|безалкогол)/.test(t))) {
        for (const [list, v] of ABV) if (starts(list)) { abv = v; break; }
    }
    let caf = 0;
    if (!toks.some(t => t.startsWith('декаф') || t.startsWith('decaf') || t.startsWith('травян') || t.startsWith('ромаш') || t.startsWith('herbal'))) {
        for (const [list, v] of CAFFEINE_MG_PER_ML) if (starts(list)) { caf = v; break; }
    }
    return {
        alcoholG: Math.round((ml || 0) * abv * 0.789 * 10) / 10,
        caffeineMg: Math.round((ml || 0) * caf),
    };
}

/** Коэффициент Уидмарка: доля воды в теле зависит от пола */
export function widmarkR(gender) {
    return gender === 'male' ? 0.68 : gender === 'female' ? 0.55 : 0.62;
}
