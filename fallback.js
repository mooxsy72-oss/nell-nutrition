// nell-nutrition/fallback.js
// Запасной ИИ-анализатор: доступ к профилям Connection Manager и запросы через них.
// Запрос идёт мимо Generate (ConnectionManagerRequestService → Chat/TextCompletionService),
// поэтому GENERATION_STARTED не срабатывает и инджект не пересчитывается.

let sharedMod = null;
import('../../shared.js').then(m => { sharedMod = m; }).catch(() => {});

const ctx = () => (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null);

function service() {
    return ctx()?.ConnectionManagerRequestService || sharedMod?.ConnectionManagerRequestService || null;
}

/**
 * Что сейчас доступно.
 * @returns {{ status: 'ok'|'off'|'empty', profiles: {id:string,name:string,group:string}[] }}
 */
export function cmProfiles() {
    const c = ctx();
    const svc = service();
    if (!c || !svc || c.extensionSettings?.disabledExtensions?.includes('connection-manager')) {
        return { status: 'off', profiles: [] };
    }
    let list = [];
    try {
        list = typeof svc.getSupportedProfiles === 'function'
            ? svc.getSupportedProfiles()
            : (c.extensionSettings?.connectionManager?.profiles || []).filter(p => svc.isProfileSupported?.(p) ?? !!p.api);
    } catch (e) {
        return { status: 'off', profiles: [] };
    }
    const groups = svc.getAllowedTypes?.() || {};
    const profiles = list.map(p => ({
        id: p.id,
        name: p.name || p.id,
        group: groups[c.CONNECT_API_MAP?.[p.api]?.selected] || '',
    })).sort((a, b) => a.name.localeCompare(b.name));
    return { status: profiles.length ? 'ok' : 'empty', profiles };
}

export function profileExists(id) {
    return !!id && cmProfiles().profiles.some(p => p.id === id);
}

/** Иконка модели профиля (<img>) — есть не во всех версиях таверны */
export function profileIcon(id) {
    try { return service()?.getProfileIcon?.(id) || null; } catch { return null; }
}

function errText(e) {
    const m = e?.cause?.message || e?.message || String(e || '');
    return m.replace(/^Error:\s*/, '').slice(0, 90);
}

/** Запрос к профилю. Возвращает текст ответа (без рассуждений). */
export async function askProfile(profileId, messages, maxTokens, signal) {
    const svc = service();
    if (!svc) throw new Error('Connection Manager недоступен');
    const res = await svc.sendRequest(profileId, messages, maxTokens, {
        stream: false, signal, extractData: true, includePreset: true, includeInstruct: true,
    });
    return typeof res === 'string' ? res : String(res?.content ?? '');
}

/** Проверка подключения: короткий запрос, засекаем время. */
export async function checkProfile(profileId) {
    const t0 = performance.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
        await askProfile(profileId, [{ role: 'user', content: 'Reply with one word: OK' }], 32, ctrl.signal);
        return { ok: true, ms: performance.now() - t0 };
    } catch (e) {
        return { ok: false, error: ctrl.signal.aborted ? 'нет ответа 30 с' : errText(e) };
    } finally {
        clearTimeout(timer);
    }
}
