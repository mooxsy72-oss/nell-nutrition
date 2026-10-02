// nell-nutrition/effects.js
// Активные эффекты — временные состояния тела и настроения.
// kind: positive | negative | neutral. Хранятся в charData.buffs (positive)
// и charData.debuffs (negative/neutral) — так совместимо со старыми сохранениями.

// Как часто эффект попадает в сцену (см. updateFocus в conditions.js):
//   every — эффект вообще может всплывать (значение больше не используется как период)
//   shows — сколько раз показать один экземпляр за всё время действия (по умолчанию 1)
//   gapH  — минимум игровых часов между показами одного экземпляра (если shows > 1)
//   daily — не чаще раза в игровой день (по умолчанию да; голод, жажда и т.п. — нет)
// Формулировки нейтральные: без рычания, жадности, «звериного» поведения.
export const EFFECT_INFO = {
    // ─── Голод и жажда ───
    hunger: {
        name: 'Голод', kind: 'negative', icon: 'fa-utensils', every: 1, shows: 2, gapH: 4, daily: false,
        text: 'Хочется есть, силы тратятся быстрее',
        prompt: 'hungry — a little less patient, harder to focus',
        cues: ['suggests getting something to eat', 'a light-headed pause before answering', 'mentions they skipped a meal'],
        userCues: ['a quiet rumble from their stomach', 'someone suggests they eat something'],
    },
    dehydration: {
        name: 'Жажда', kind: 'negative', icon: 'fa-droplet-slash', every: 1, shows: 2, gapH: 3, daily: false,
        text: 'Хочется пить, силы тратятся быстрее',
        prompt: 'thirsty — dry mouth, mild headache, a little sluggish',
        cues: ['lips dry, licked absently', 'a dull ache behind the eyes', 'voice slightly hoarse',
            'glances toward any source of water', 'swallowing feels dry and scratchy'],
        userCues: ['lips look dry', 'someone hands them water'],
    },
    irritability: {
        name: 'Раздражительность', kind: 'negative', icon: 'fa-face-angry', every: 1, mental: true,
        text: 'Вспыльчивость, меньше терпения',
        prompt: 'a bit irritable because hungry — slightly short-tempered, nothing more',
        cues: ['a sharper tone than intended', 'sighs at a minor delay', 'a clipped reply, regretted a moment later'],
        userCues: ['someone notices they seem tired and hungry and offers food'],
    },
    overeating: {
        name: 'Переедание', kind: 'negative', icon: 'fa-weight-hanging', every: 1,
        text: 'Тяжесть в животе, вялость',
        prompt: 'overfull — heavy stomach, sluggish, wants to sit down',
        cues: ['shifts to ease a heavy stomach', 'waves off more food', 'moves more slowly than usual'],
        userCues: ['moves a little slower after the meal', 'someone notices they have had enough'],
    },
    slow_metabolism: {
        name: 'Замедленный обмен', kind: 'negative', icon: 'fa-temperature-low', every: 1,
        text: 'Тело экономит силы: калорий тратится меньше, быстро мёрзнет',
        prompt: 'body in energy-saving mode after days of too little food — feels cold easily, low stamina, slow to warm up',
        cues: ['pulls a layer tighter against a chill no one else feels', 'cold fingertips', 'needs longer to get going'],
        userCues: ['fingers cold to the touch', 'a shiver in a warm room', 'someone notices and drapes something warm over them'],
    },

    // ─── Сон и силы ───
    exhaustion: {
        name: 'Истощение сил', kind: 'negative', icon: 'fa-face-tired', every: 1, shows: 2, gapH: 3, daily: false,
        text: 'Сил почти нет: тяжёлые действия не удаются',
        prompt: 'exhausted — heavy limbs, slow reactions; strenuous actions fail easily',
        cues: ['movements heavy and deliberate', 'needs a moment to steady after standing',
            'breath short after small effort', 'sits down at the first chance'],
        userCues: ['knees nearly buckle after standing', 'breath short after small effort', 'someone steadies them by the elbow'],
    },
    drowsiness: {
        name: 'Сонливость', kind: 'negative', icon: 'fa-bed', every: 1,
        text: 'Клонит в сон, внимание рассеивается',
        prompt: 'sleepy — attention drifts, reactions a touch slow',
        cues: ['a suppressed yawn', 'loses the thread of a sentence for a second', 'rubs the eyes', 'slower to react to a question'],
        userCues: ['a yawn escapes before they can stop it', 'eyelids heavy', 'someone remarks that they look half asleep'],
    },
    sleep_deprived: {
        name: 'Недосып', kind: 'negative', icon: 'fa-eye-slash', every: 1,
        text: 'Давно без сна: силы уходят быстрее, слабее иммунитет',
        prompt: 'awake far too long — foggy, emotionally raw, misses details',
        cues: ['stares a beat too long at nothing', 'laughs at something not that funny', 'forgets what was just said',
            'eyes red-rimmed'],
        userCues: ['eyes red-rimmed', 'dark circles someone comments on', 'a slow blink that lasts too long'],
    },
    rested: {
        name: 'Выспался', nameF: 'Выспалась', kind: 'positive', icon: 'fa-sun', timed: true,
        text: 'Хорошо выспался: силы расходуются медленнее',
        textF: 'Хорошо выспалась: силы расходуются медленнее',
        prompt: 'well rested — clear, steady',
    },

    // ─── Питьё ───
    caffeine: {
        name: 'Кофеин', kind: 'positive', icon: 'fa-mug-hot',
        text: 'Бодрит: сон не берёт, силы расходуются медленнее',
        prompt: 'caffeinated — alert, a bit quicker',
    },
    caffeine_jitters: {
        name: 'Перебор кофеина', kind: 'negative', icon: 'fa-heart-circle-bolt', every: 1,
        text: 'Дрожь в руках, сердцебиение, тревожность',
        prompt: 'too much caffeine — jittery, restless, heart racing, a little anxious',
        cues: ['a tapping foot that won\'t stop', 'fingers drum on the table', 'talks a touch too fast'],
        userCues: ['a visible tremor in the hands', 'heart pounding hard enough to notice', 'someone notices the restless leg'],
    },
    intoxication: {
        name: 'Опьянение', kind: 'neutral', icon: 'fa-wine-glass', every: 1, shows: 2, gapH: 1.5, daily: false,
        text: '',
        levels: [
            { min: 0.3, name: 'Лёгкое опьянение', kind: 'neutral', text: 'Расслаблен, разговорчив', textF: 'Расслаблена, разговорчива',
                prompt: 'tipsy — relaxed, warmer, more talkative, slightly less filtered' },
            { min: 0.9, name: 'Опьянение', kind: 'negative', text: 'Хуже координация и суждения, вода уходит быстрее',
                prompt: 'drunk — clumsy, loud or sentimental, poor judgement, words slur a little' },
            { min: 1.8, name: 'Сильное опьянение', kind: 'negative', text: 'Шатается, путается, тошнит — сложное не удаётся',
                prompt: 'very drunk — unsteady on their feet, confused, nauseous; complex actions fail' },
        ],
        cues: ['a laugh a little too loud', 'leans on the table for balance', 'loses the end of a sentence',
            'cheeks flushed', 'misjudges a step'],
        userCues: ['cheeks flushed', 'a stumble on an easy step', 'someone steadies them or takes the glass away'],
    },
    hangover: {
        name: 'Похмелье', kind: 'negative', icon: 'fa-head-side-virus', every: 1, timed: true,
        text: 'Болит голова, мутит, сильно хочется пить',
        prompt: 'hungover — pounding head, light-sensitive, queasy, very thirsty',
        cues: ['winces at a loud sound', 'squints against the light', 'nurses a cup of water', 'queasy at the smell of food'],
        userCues: ['a wince at a loud noise', 'squinting against the light', 'someone slides water and something plain their way'],
    },

    // ─── РПП ───
    post_meal_anxiety: {
        name: 'Тревога после еды', kind: 'negative', icon: 'fa-face-frown', every: 1, timed: true, mental: true, daily: false,
        text: 'Беспокойство, навязчивые мысли о съеденном',
        prompt: 'anxious after eating — restless, preoccupied with what was eaten, may withdraw',
        cues: ['goes quiet after the meal', 'fidgets with a sleeve', 'finds a reason to step away',
            'pushes the plate a little further off'],
        userCues: ['someone notices the untouched rest of the plate', 'shoulders stiff after the meal', 'someone quietly changes the subject away from food'],
    },
    shame: {
        name: 'Стыд и вина', kind: 'negative', icon: 'fa-face-sad-tear', every: 1, timed: true, mental: true, daily: false,
        text: 'Подавленность, хочется спрятаться',
        prompt: 'ashamed after an episode with food — withdrawn, avoids eye contact, self-critical, secretive',
        cues: ['avoids eye contact', 'answers in single words', 'covers it with a forced smile', 'wants to be alone'],
        userCues: ['someone notices the downcast look and softens', 'color rises in their face', 'someone gives them space without comment'],
    },

    // ─── Беременность: события ───
    morning_sickness: {
        name: 'Утренняя тошнота', kind: 'negative', icon: 'fa-face-grimace', every: 1, timed: true,
        text: 'Мутит, еда почти не лезет и хуже насыщает',
        prompt: 'morning sickness — queasy, food and strong smells turn the stomach; can barely eat',
        cues: ['turns away from the smell of cooking', 'nibbles a dry crust and stops', 'a hand pressed to the mouth',
            'pale, breathing slowly through the nose', 'pushes the plate away after two bites'],
        userCues: ['looks pale at the smell of food', 'someone opens a window or brings dry bread and water'],
    },
    pregnancy_appetite: {
        name: 'Аппетит', kind: 'neutral', icon: 'fa-drumstick-bite', every: 1,
        text: 'Беременность: голод просыпается чуть раньше обычного',
        prompt: 'pregnant — gets hungry a little sooner than before; an ordinary appetite, nothing dramatic',
        cues: ['gladly takes a second helping', 'mentions she could eat something'],
        userCues: ['someone offers her a bite to eat'],
    },
    craving: {
        name: 'Тяга к еде', kind: 'neutral', icon: 'fa-lemon', every: 1, timed: true,
        text: 'Очень хочется чего-то конкретного',
        prompt: 'fancies one particular food today',
        cues: ['asks if there is any {x}', 'mentions {x} in passing'],
        userCues: ['someone mentions they have {x}', '{x} turns up on the table'],
    },
    // ─── Пищевой профиль: любимое, нелюбимое, отвращение ───
    favorite_food: {
        name: 'Любимая еда', kind: 'positive', icon: 'fa-face-smile-beam', timed: true,
        text: 'Ел любимое — настроение теплее, еда в радость',
        textF: 'Ела любимое — настроение теплее, еда в радость',
        prompt: 'enjoyed the meal — slightly better mood',
        cues: ['mood visibly softens over {x}', 'compliments the {x}'],
        userCues: ['someone notices they enjoy the {x}'],
    },
    disliked_food: {
        name: 'Невкусно', kind: 'negative', icon: 'fa-face-grimace', timed: true,
        text: 'Пришлось есть нелюбимое — через силу',
        prompt: 'didn\'t enjoy the meal much',
        cues: ['pushes {x} around the plate', 'chews {x} with a barely hidden grimace', 'washes {x} down quickly', 'leaves most of {x} untouched'],
        userCues: ['someone offers to swap the {x} for something else'],
    },
    aversion: {
        name: 'Отвращение к еде', kind: 'negative', icon: 'fa-ban', every: 1, timed: true,
        text: 'От одной мысли о еде мутит',
        prompt: 'food aversion — the smell or sight of one food turns the stomach',
        cues: ['turns away from the smell of {x}', 'covers the nose near {x}', 'pales when {x} is mentioned', 'asks to take {x} away'],
        userCues: ['someone moves the {x} out of reach'],
    },
    sugar_crash: {
        name: 'Сахарный спад', kind: 'negative', icon: 'fa-candy-cane', every: 1, timed: true,
        text: 'После сладкого — вялость и снова тянет есть',
        prompt: 'sugar crash after sweets — sluggish, foggy, hungry again soon',
        cues: ['a heavy yawn after the sweets', 'loses the thread for a second', 'eyes drift back to the food'],
        userCues: ['eyelids suddenly heavy after the sweets', 'someone notices the slump', 'a slow, foggy blink'],
    },
    warmed: {
        name: 'Согрелся', nameF: 'Согрелась', kind: 'positive', icon: 'fa-temperature-arrow-up', every: 1, timed: true,
        text: 'Горячая еда согрела изнутри',
        prompt: 'warmed through by hot food or drink — loosened, comfortable',
        cues: ['cups the warm bowl with both hands', 'colour returns to the face', 'shoulders drop as the warmth spreads'],
        userCues: ['colour returns to their cheeks', 'fingers stop trembling around the warm cup', 'someone notices and pours more'],
    },
    heartburn: {
        name: 'Изжога', kind: 'negative', icon: 'fa-fire', every: 1, timed: true,
        text: 'Жжение за грудиной после еды',
        prompt: 'heartburn after eating — burning chest, uncomfortable lying down',
        cues: ['rubs the breastbone', 'sits up straighter', 'sips water to ease a burning'],
        userCues: ['a hand goes to the breastbone on its own', 'a sour burp', 'someone offers milk or water for the burning'],
    },

    // ─── Положительные ───
    well_fed: {
        name: 'Сытость', kind: 'positive', icon: 'fa-bowl-rice', timed: true,
        text: 'Сыт после хорошей еды: силы и здоровье восстанавливаются',
        textF: 'Сыта после хорошей еды: силы и здоровье восстанавливаются',
        prompt: 'well fed — steady strength and endurance',
    },
    hydrated: {
        name: 'Жажда утолена', kind: 'positive', icon: 'fa-droplet', timed: true,
        text: 'Напился вдоволь: вода расходуется медленнее',
        textF: 'Напилась вдоволь: вода расходуется медленнее',
        prompt: 'well hydrated — clear-headed, good stamina',
    },
    high_energy: {
        name: 'Бодрость', kind: 'positive', icon: 'fa-bolt',
        text: 'Бодр и собран: силы расходуются медленнее',
        prompt: 'energetic — quick and alert',
    },
};

// ─── Режим: эффекты, которые работают только в хардкоре ───
// Сейчас список пуст — в обоих режимах работают все эффекты (голод, жажда, усталость,
// беременность и т.д.). Чтобы убрать что-то из лёгкого режима, впишите id сюда.
let effectsFull = true;
const HARD_ONLY_EFFECTS = new Set([]);
export function setEffectsMode(hard) { effectsFull = !!hard; }
export const effectAllowed = (id) => effectsFull || !HARD_ONLY_EFFECTS.has(id);

/** Эффект по тому, как его назвал ИИ: id, русское название или первые слова описания */
export function resolveEffectId(name) {
    const n = String(name || '').toLowerCase().replace(/ё/g, 'е').trim().replace(/\s+/g, '_');
    if (!n) return null;
    if (EFFECT_INFO[n]) return n;
    const ALIASES = { nausea: 'morning_sickness', sickness: 'morning_sickness', тошнота: 'morning_sickness', токсикоз: 'morning_sickness',
        thirst: 'dehydration', жажда: 'dehydration', голод: 'hunger', irritable: 'irritability', раздражительность: 'irritability',
        sleepy: 'drowsiness', tired: 'exhaustion', drunk: 'intoxication', опьянение: 'intoxication', похмелье: 'hangover',
        кофеин: 'caffeine', стыд: 'shame', тревога: 'post_meal_anxiety', изжога: 'heartburn', тяга: 'craving' };
    if (ALIASES[n]) return ALIASES[n];
    for (const [id, info] of Object.entries(EFFECT_INFO)) {
        const names = [info.name, info.nameF, info.prompt?.split(/[ —,]/)[0]].filter(Boolean)
            .map(x => String(x).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, '_'));
        if (names.some(x => x === n || x.startsWith(n))) return id;
    }
    return null;
}

export function effectLevel(e) {
    const info = EFFECT_INFO[e.id];
    if (!info?.levels) return null;
    return info.levels[Math.min(info.levels.length - 1, Math.max(0, e.level || 0))];
}

/** Имя, тип, иконка и описание эффекта для отображения */
export function effectView(e, gender = null) {
    const info = EFFECT_INFO[e.id] || {};
    const lv = effectLevel(e);
    const f = gender === 'female';
    const base = lv?.name || (f && info.nameF) || info.name || e.name || e.id;
    return {
        name: e.detail ? `${base}: ${e.detail}` : base,
        kind: lv?.kind || info.kind || 'neutral',
        icon: info.icon || 'fa-circle',
        text: (lv && ((f && lv.textF) || lv.text)) || (f && info.textF) || info.text || e.effect || '',
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
    off = !!off;
    const ex = findEffect(c, id);
    if (!effectAllowed(id)) {
        if (ex) { removeEffect(c, id); removed.push(id); }
        return;
    }
    if (on) {
        if (!ex) {
            listFor(c, id).push({ id, fading: false, fadeLeft: 0, idle: 0 });
            added.push(id);
        } else {
            ex.idle = 0;
            if (ex.fading) { ex.fading = false; ex.fadeLeft = 0; }
        }
        return;
    }
    if (!ex) return;
    // Причина ушла, но и порог «выключения» не пройден (застряли между ними):
    // через 6 часов без подтверждения эффект всё равно начинает проходить
    if (!off && !ex.fading) {
        ex.idle = (ex.idle || 0) + hours;
        if (ex.idle >= 6) off = true;
    }
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
    if (!effectAllowed(id)) return;
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
    [['медовух', 'mead', 'сидр', 'cider', 'браг', 'хмельн'], 0.07],
    [['сивух'], 0.40],
    [['кумыс'], 0.02],
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
