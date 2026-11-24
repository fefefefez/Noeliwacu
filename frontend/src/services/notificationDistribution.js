const statuses = ['pending', 'sending', 'accepted', 'failed', 'uncertain', 'simulated'];

export function isValidNotificationSnapshot(snapshot) {
    const entries = snapshot?.notifications;
    if (snapshot?.success !== true || snapshot.trackingAvailable !== true || !Array.isArray(entries) || entries.length < 2 ||
        snapshot.counts?.total !== entries.length) return false;
    if (entries.some(n => !n || typeof n.participantId !== 'string' || !n.participantId || !statuses.includes(n.status) ||
        !Number.isInteger(n.attemptCount) || n.attemptCount < 0)) return false;
    if (new Set(entries.map(n => n.participantId)).size !== entries.length) return false;
    return statuses.every(status => snapshot.counts[status] === entries.filter(n => n.status === status).length);
}

// Une instance par action explicite dans l'onglet. Aucun retry, aucun worker,
// aucun AbortController SMTP. pause() ne reveille que l'attente entre demandes.
export function createNotificationDistribution({ read, send, beforeSend, isBlocked,
    onSnapshot, onProgress, onNotSent = () => {}, isActive = () => true, intervalMs = 6100 }) {
    let stopped = false;
    let running = false;
    let wake;
    const pause = () => { stopped = true; wake?.(); };
    function waitBeforeNext() {
        return new Promise(resolve => {
            const timer = setTimeout(() => { wake = undefined; resolve(); }, intervalMs);
            wake = () => { clearTimeout(timer); wake = undefined; resolve(); };
        });
    }
    async function snapshot() {
        const value = await read();
        if (!isValidNotificationSnapshot(value)) throw new Error('Invalid snapshot');
        onSnapshot(value);
        return value;
    }
    async function run() {
        if (running) return { reason: 'busy', attempted: 0 };
        running = true;
        let attempted = 0;
        try {
            let current = await snapshot();
            const initialUncertain = new Set(current.notifications.filter(n => n.status === 'uncertain').map(n => n.participantId));
            const candidates = new Set(current.notifications.filter(n => n.status === 'pending' && !isBlocked(n.participantId)).map(n => n.participantId));
            const total = candidates.size;
            onProgress({ attempted, total, phase: 'waiting' });
            while (candidates.size && !stopped) {
                if (current.reconciliationPending) return { reason: 'reconciliation', attempted };
                await waitBeforeNext();
                if (stopped) break;
                // Relire apres l'attente : un autre administrateur a pu traiter la ligne.
                if (!isActive()) return { reason: 'paused', attempted };
                current = await snapshot();
                if (stopped) break;
                if (current.reconciliationPending) return { reason: 'reconciliation', attempted };
                if (current.notifications.some(n => n.status === 'uncertain' && !initialUncertain.has(n.participantId))) {
                    return { reason: 'uncertain', attempted };
                }
                for (const id of candidates) {
                    if (!current.notifications.some(n => n.participantId === id && n.status === 'pending' && !isBlocked(id))) candidates.delete(id);
                }
                const next = current.notifications.find(n => candidates.has(n.participantId) && n.status === 'pending' && !isBlocked(n.participantId));
                if (!next) return { reason: 'completed', attempted };
                // Une ligne ne peut etre demandee qu'une fois dans cette sequence.
                candidates.delete(next.participantId);
                if (!beforeSend(next.participantId)) return { reason: 'storage', attempted };
                onProgress({ attempted, total, phase: 'sending' });
                let result;
                let failure;
                try {
                    attempted++;
                    result = await send(next.participantId);
                } catch (error) { failure = error; }
                // Toujours tenter une lecture apres SMTP, meme si pause est demandee.
                // Si la page a ete quittee, sa prochaine ouverture relira MongoDB.
                if (!isActive()) return { reason: 'paused', attempted };
                current = await snapshot();
                onProgress({ attempted, total, phase: 'waiting' });
                if (failure) {
                    // Ce code precis est emis par le limiter AVANT reservation/SMTP.
                    if (failure.status === 429 && failure.code === 'NOTIFICATION_RATE_LIMITED') onNotSent(next.participantId);
                    return { reason: failure.status === 429 ? 'rateLimited' : 'unconfirmed', attempted };
                }
                if (result?.success !== true || result.participantId !== next.participantId || result.verificationRequired ||
                    result.outcome === 'unknown' || !['accepted', 'failed', 'simulated', 'uncertain'].includes(result.status)) {
                    return { reason: 'unconfirmed', attempted };
                }
                if (result.status === 'uncertain' || current.notifications.some(n => n.status === 'uncertain' && !initialUncertain.has(n.participantId))) {
                    return { reason: 'uncertain', attempted };
                }
                const persisted = current.notifications.find(n => n.participantId === next.participantId);
                if (persisted?.status !== result.status) return { reason: 'unconfirmed', attempted };
            }
            return { reason: stopped ? 'paused' : 'completed', attempted };
        } catch {
            return { reason: 'readFailed', attempted };
        } finally {
            running = false;
        }
    }
    return { run, pause };
}
