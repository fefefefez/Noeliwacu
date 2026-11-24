import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { getParty, getParticipants, getDrawStatus, prepareDraw, getNotifications, sendNotification, verifyAdminPin } from '../services/api';
import { createNotificationDistribution, isValidNotificationSnapshot } from '../services/notificationDistribution';
import { addAdminParticipant, updateAdminParticipant, deleteAdminParticipant } from '../services/api';
import AdminParticipantForm from '../components/AdminParticipantForm';

const statusLabels = {
    pending: 'En attente', sending: 'Tentative en cours', accepted: 'Accepté par SMTP',
    failed: 'Échec confirmé', uncertain: 'Résultat incertain', simulated: 'Simulation — aucun email réel'
};
const markerKey = code => `noeliwacu:draw-verification:${encodeURIComponent(code)}`;
function needsVerification(code) {
    try { return sessionStorage.getItem(markerKey(code)) === 'required'; }
    catch { return true; } // Stockage indisponible : ne pas autoriser une préparation risquée.
}
function markVerification(code, required) {
    try {
        if (required) sessionStorage.setItem(markerKey(code), 'required');
        else sessionStorage.removeItem(markerKey(code));
        return true;
    } catch { return false; }
}

const sendMarkerKey = code => `noeliwacu:notification-verification:${encodeURIComponent(code)}`;
function readSendMarkers(code) {
    try {
        const ids = JSON.parse(sessionStorage.getItem(sendMarkerKey(code)) || '[]');
        return Array.isArray(ids) && ids.every(id => typeof id === 'string' && id) ? ids : null;
    } catch { return null; }
}
function writeSendMarkers(code, ids) {
    try {
        if (ids.length) sessionStorage.setItem(sendMarkerKey(code), JSON.stringify(ids));
        else sessionStorage.removeItem(sendMarkerKey(code));
        return true;
    } catch { return false; }
}

export default function AdminDashboard() {
    const { code } = useParams();
    return <Dashboard key={code} code={code} />;
}

function Dashboard({ code }) {
    const navigate = useNavigate();
    const location = useLocation();
    // Le PIN reste en mémoire. Supprimer aussi l'ancien transfert via history.state.
    const [adminPin, setAdminPin] = useState(location.state?.adminPin || '');
    const [pinVerified, setPinVerified] = useState(false);
    const [checkingPin, setCheckingPin] = useState(false);
    const [partyInfo, setPartyInfo] = useState(null);
    const [participants, setParticipants] = useState([]);
    const [drawStatus, setDrawStatus] = useState(null);
    const [tracking, setTracking] = useState(null);
    const [recordedCount, setRecordedCount] = useState(null);
    const [drawKnown, setDrawKnown] = useState(false);
    const [verificationRequired, setVerificationRequired] = useState(() => needsVerification(code));
    const [loading, setLoading] = useState(false);
    const [ready, setReady] = useState(false);
    const [preparing, setPreparing] = useState(false);
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [participantForm, setParticipantForm] = useState(null);
    const [savingParticipant, setSavingParticipant] = useState(false);
    const [participantNotice, setParticipantNotice] = useState(null);
    const participantWrite = useRef(false);
    const [distributing, setDistributing] = useState(false);
    const [pauseRequested, setPauseRequested] = useState(false);
    const [progress, setProgress] = useState(null);
    const [distributionMessage, setDistributionMessage] = useState('');
    const [blockedSends, setBlockedSends] = useState(() => readSendMarkers(code));
    const blockedSendsRef = useRef(blockedSends);
    const distributionRef = useRef(null);
    const preparingRef = useRef(false);
    const mounted = useRef(false);

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; distributionRef.current?.pause(); };
    }, []);
    useEffect(() => {
        if (location.state?.adminPin) navigate(location.pathname, { replace: true, state: null });
    }, [location.pathname, location.state, navigate]);

    const applyTracking = useCallback(value => {
        if (!mounted.current) return;
        setTracking(value);
        if (isValidNotificationSnapshot(value)) {
            setRecordedCount(value.counts.total);
            const markers = blockedSendsRef.current;
            if (markers) {
                // Un pending relu ne suffit pas a innocenter un POST encore en cours.
                const remaining = markers.filter(id => !value.notifications.some(n => n.participantId === id && n.status !== 'pending'));
                if (writeSendMarkers(code, remaining)) {
                    blockedSendsRef.current = remaining;
                    setBlockedSends(remaining);
                }
            }
        }
    }, [code]);

    const loadData = useCallback(async () => {
        setLoading(true);
        setReady(false);
        setError('');
        try {
            const [partyData, peopleData, statusData, notificationData] = await Promise.all([
                getParty(code), getParticipants(code, adminPin), getDrawStatus(code), getNotifications(code, adminPin)
            ]);
            if (!partyData.success || !peopleData.success || !statusData.success || !notificationData.success) throw new Error();
            if (!mounted.current) return;
            setPartyInfo(partyData.party);
            setParticipants(peopleData.participants);
            setDrawStatus(statusData.status);
            applyTracking(notificationData);
            // canDraw tient aussi compte des traces d'un ancien tirage V2.
            const existing = partyData.party.drawDone || statusData.status.drawLocked || statusData.status.drawDone || notificationData.trackingAvailable ||
                (statusData.status.canDraw === false && statusData.status.participantCount >= 2);
            if (existing) {
                setDrawKnown(true);
                setParticipantForm(null);
                setVerificationRequired(false);
                markVerification(code, false);
            }
            if (notificationData.trackingAvailable) setRecordedCount(notificationData.counts.total);
            setReady(true);
        } catch {
            if (mounted.current) setError('Lecture impossible. Les données affichées peuvent être anciennes. Actualisez pour vérifier l’état ; aucune préparation ni aucun envoi ne sera relancé.');
        } finally {
            if (mounted.current) setLoading(false);
        }
    }, [code, adminPin, applyTracking]);

    useEffect(() => {
        if (pinVerified) loadData();
    }, [pinVerified, loadData]);

    async function handlePinSubmit(event) {
        event.preventDefault();
        if (!/^[0-9]{4}$/.test(adminPin) || checkingPin) return;
        setCheckingPin(true);
        setError('');
        try {
            const response = await verifyAdminPin(code, adminPin);
            if (!response.success) throw new Error();
            if (mounted.current) {
                setLoading(true);
                setPinVerified(true);
            }
        } catch {
            if (mounted.current) {
                setError('Accès non confirmé. Vérifiez le PIN et la connexion au serveur.');
                setAdminPin('');
            }
        } finally {
            if (mounted.current) setCheckingPin(false);
        }
    }

    const canManageParticipants = ready && !drawKnown && !verificationRequired && !loading && !preparing && !savingParticipant;
    const canPrepare = canManageParticipants && drawStatus?.canDraw === true;
    async function saveParticipant(action, person, values) {
        if (!canManageParticipants || participantWrite.current || preparingRef.current) return;
        if (action === 'delete' && !window.confirm(`Supprimer définitivement l’inscription de ${person.name} ?`)) return;
        participantWrite.current = true;
        setSavingParticipant(true);
        setParticipantNotice(null);
        try {
            const result = action === 'delete' ? await deleteAdminParticipant(code, adminPin, person._id) :
                person ? await updateAdminParticipant(code, adminPin, person._id, values) : await addAdminParticipant(code, adminPin, values);
            if (result.outcome !== 'confirmed') throw new Error();
            if (!mounted.current) return;
            setParticipantForm(null);
            setParticipantNotice({ text: action === 'delete' ? 'Inscription supprimée.' : 'Inscription enregistrée.' });
            await loadData();
        } catch (failure) {
            if (!mounted.current) return;
            const unknown = failure.outcome === 'unknown' || failure.verificationRequired || !failure.status ||
                (failure.status >= 500 && failure.outcome !== 'rejected');
            if (failure.code === 'DRAW_ALREADY_EXISTS') {
                setDrawKnown(true);
                setParticipantForm(null);
            }
            if (unknown) setParticipantForm(null);
            setParticipantNotice({ error: true, text: unknown ?
                'Résultat inconnu. Vérifiez la liste relue avant toute nouvelle action. L’opération n’a pas été répétée.' :
                failure.detail || 'Opération refusée. Vérifiez les données de l’inscription.' });
            await loadData();
        } finally {
            participantWrite.current = false;
            if (mounted.current) setSavingParticipant(false);
        }
    }

    async function handlePrepare() {
        if (!canPrepare || preparingRef.current || participantWrite.current) return;
        if (!window.confirm('Préparer le tirage définitif ? Les inscriptions seront clôturées et les attributions seront enregistrées définitivement. Aucun email ne sera envoyé.')) return;
        // Le marqueur precede le POST : un rechargement pendant la requete reste protege.
        if (!markVerification(code, true)) {
            setError('Le navigateur ne permet pas de conserver le suivi de cette action. Le tirage n’a pas été déclenché.');
            return;
        }
        preparingRef.current = true;
        setPreparing(true);
        setVerificationRequired(true);
        setError('');
        setSuccessMessage('');
        try {
            const response = await prepareDraw(code, adminPin);
            if (!mounted.current) return;
            if (response.outcome !== 'confirmed') throw new Error();
            setDrawKnown(true);
            setVerificationRequired(false);
            markVerification(code, false);
            if (Number.isInteger(response.draw?.participantCount)) setRecordedCount(response.draw.participantCount);
            setSuccessMessage('Tirage sauvegardé définitivement. Aucun email n’a été envoyé.');
            await loadData();
        } catch (failure) {
            if (!mounted.current) return;
            if (failure.status === 409) {
                setError('Conflit : un tirage existe déjà ou la fête ne permet plus sa création. Actualisez le suivi. Aucune nouvelle préparation ne sera lancée.');
            } else if (failure.outcome === 'rejected' && !failure.verificationRequired) {
                markVerification(code, false);
                setVerificationRequired(false);
                setError('Préparation refusée par le serveur. Actualisez les participants avant une nouvelle action explicite.');
                setReady(false);
            } else {
                setError('Résultat du tirage inconnu : il peut avoir été enregistré. Ne recommencez pas la préparation. Actualisez uniquement le suivi pour vérifier son état.');
            }
        } finally {
            preparingRef.current = false;
            if (mounted.current) setPreparing(false);
        }
    }

    const validTracking = drawKnown && isValidNotificationSnapshot(tracking);
    const eligibleCount = validTracking && blockedSends ? tracking.notifications.filter(n =>
        n.status === 'pending' && !blockedSends.includes(n.participantId)).length : 0;
    async function handleDistribution() {
        if (distributionRef.current || !ready || !validTracking || loading || preparing || !eligibleCount ||
            !blockedSends || tracking.reconciliationPending) return;
        if (!window.confirm(`Lancer la distribution pour les notifications encore en attente ? Seules les notifications pending seront demandées, une à la fois. Les autres statuts seront ignorés. Vous pourrez suspendre après la requête en cours.`)) return;
        setDistributing(true);
        setPauseRequested(false);
        setError('');
        setSuccessMessage('');
        setDistributionMessage('');
        const sequence = createNotificationDistribution({
            read: () => getNotifications(code, adminPin),
            send: participantId => sendNotification(code, adminPin, participantId),
            isBlocked: participantId => !blockedSendsRef.current || blockedSendsRef.current.includes(participantId),
            beforeSend: participantId => {
                const ids = blockedSendsRef.current;
                if (!ids || ids.includes(participantId)) return false;
                const next = [...ids, participantId];
                if (!writeSendMarkers(code, next)) return false;
                blockedSendsRef.current = next;
                if (mounted.current) setBlockedSends(next);
                return true;
            },
            onNotSent: participantId => {
                const ids = blockedSendsRef.current;
                if (!ids) return;
                const remaining = ids.filter(id => id !== participantId);
                if (writeSendMarkers(code, remaining)) {
                    blockedSendsRef.current = remaining;
                    if (mounted.current) setBlockedSends(remaining);
                }
            },
            onSnapshot: applyTracking,
            onProgress: value => { if (mounted.current) setProgress(value); },
            isActive: () => mounted.current
        });
        distributionRef.current = sequence;
        const result = await sequence.run();
        if (!mounted.current) return;
        distributionRef.current = null;
        setDistributing(false);
        const messages = {
            completed: 'Séquence terminée : aucune autre notification éligible dans cette sélection. Les compteurs affichés proviennent du suivi enregistré.',
            paused: 'Séquence suspendue. Vous pouvez reprendre manuellement les seules notifications encore pending.',
            uncertain: 'Séquence arrêtée : un résultat est incertain. Vérifiez le suivi. Aucun nouvel envoi ne sera déclenché automatiquement.',
            unconfirmed: 'Séquence arrêtée : une tentative n’est pas confirmée. Le suivi a été relu ; aucun renvoi automatique ne sera effectué.',
            readFailed: 'Séquence arrêtée : le suivi ne peut pas être confirmé. Les compteurs affichés peuvent être anciens. Actualisez avant toute reprise manuelle.',
            rateLimited: 'Séquence arrêtée par la limite de demandes. Attendez avant une reprise manuelle des notifications pending ; aucun retry automatique.',
            reconciliation: 'Séquence arrêtée : des réservations expirées restent à vérifier. Actualisez le suivi avant une reprise manuelle.',
            storage: 'Séquence arrêtée : le navigateur ne permet pas de conserver la vérification des tentatives. Aucun nouvel envoi n’a été demandé.'
        };
        setDistributionMessage(messages[result.reason] || messages.unconfirmed);
        if (result.reason === 'readFailed') setReady(false);
    }

    function pauseDistribution() {
        setPauseRequested(true);
        distributionRef.current?.pause();
    }

    const participantsByFamily = participants.reduce((groups, person) => {
        const family = person.familyGroup || 'Non précisée';
        if (!groups.has(family)) groups.set(family, []);
        groups.get(family).push(person);
        return groups;
    }, new Map());

    if (!pinVerified) return <>
        <header><h1>🔐 Accès Administrateur</h1><p>Entrez votre PIN pour consulter le suivi de la fête.</p></header>
        <main className="container"><div className="card" style={{ maxWidth: '500px', margin: '40px auto' }}>
            <form onSubmit={handlePinSubmit}>
                <label htmlFor="admin-pin">Code PIN Administrateur (4 chiffres)</label>
                <input id="admin-pin" type="password" inputMode="numeric" pattern="[0-9]{4}" autoComplete="off"
                    value={adminPin} onChange={event => setAdminPin(event.target.value)} maxLength={4} required autoFocus disabled={checkingPin} />
                {error && <p role="alert" className="alert alert-error">{error}</p>}
                <button type="submit" className="primary" disabled={checkingPin || !/^[0-9]{4}$/.test(adminPin)}>
                    {checkingPin ? 'Vérification…' : 'Accéder au Dashboard'}
                </button>
            </form>
            <button onClick={() => navigate('/')}>← Retour à l’accueil</button>
        </div></main>
    </>;

    return <>
        <header><h1>🎅 Dashboard Administrateur</h1><p>Gérez votre fête Secret Santa</p></header>
        <main className="container" aria-busy={loading || preparing || distributing || savingParticipant}>
            {partyInfo && <section className="card">
                <h2>📋 Informations de la Fête</h2>
                <p><strong>Nom :</strong> {partyInfo.name}</p>
                <p><strong>Party Code :</strong> {code}</p>
                {partyInfo.budget != null && <p><strong>Budget :</strong> {partyInfo.budget}€</p>}
                {partyInfo.date && <p><strong>Date :</strong> {new Date(partyInfo.date).toLocaleDateString('fr-FR')}</p>}
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {partyInfo.families.map(family => <span key={family} className="family-badge">{family}</span>)}
                </div>
            </section>}

            <section className="card">
                <h2>👥 Participants inscrits ({participants.length})</h2>
                {!drawKnown && <button type="button" disabled={!canManageParticipants || participants.length >= 100}
                    onClick={() => { setParticipantForm({ person: null }); setParticipantNotice(null); }}>Ajouter un participant</button>}
                {!drawKnown && participantForm && <AdminParticipantForm key={participantForm.person?._id ?? 'new'}
                    person={participantForm.person} families={partyInfo?.families ?? []} disabled={!canManageParticipants}
                    onSave={values => saveParticipant('save', participantForm.person, values)} onCancel={() => setParticipantForm(null)} />}
                {participantNotice && <p role={participantNotice.error ? 'alert' : 'status'}
                    className={participantNotice.error ? 'alert alert-error' : 'alert alert-success'}>{participantNotice.text}</p>}
                {!participants.length && <p>{loading ? 'Chargement des participants…' : 'Aucun participant chargé.'}</p>}
                {Array.from(participantsByFamily, ([family, members]) => <div key={family}>
                    <h3>Famille {family} ({members.length})</h3>
                    {members.map(person => <div key={person._id} className="participant-item"><div className="participant-info">
                        <h3>{person.name}</h3><p>📧 {person.email}</p>
                        {person.wishList?.length > 0 && <p>🎁 Liste : {person.wishList.join(', ')}</p>}
                    </div>{!drawKnown && <div>
                        <button type="button" aria-label={`Modifier l’inscription de ${person.name}`} disabled={!canManageParticipants}
                            onClick={() => { setParticipantForm({ person }); setParticipantNotice(null); }}>Modifier</button>
                        <button type="button" aria-label={`Supprimer l’inscription de ${person.name}`} disabled={!canManageParticipants}
                            onClick={() => saveParticipant('delete', person)}>Supprimer</button>
                    </div>}</div>)}
                </div>)}
            </section>

            <section className="card">
                <h2>🎲 Tirage définitif</h2>
                {drawKnown ? <>
                    <p>Les inscriptions sont clôturées. Le tirage existant ne sera pas remplacé.</p>
                    {recordedCount != null ? <p><strong>{recordedCount} attributions enregistrées</strong></p> :
                        <p>Ancien tirage V2 : le nombre d’attributions enregistrées n’est pas disponible dans cette API.</p>}
                </> : <p>La préparation enregistre définitivement les attributions et clôture les inscriptions. Aucun email ne sera envoyé.</p>}
                {ready && !drawKnown && !drawStatus?.canDraw && <p>Au moins 2 participants sont nécessaires pour préparer le tirage.</p>}
                {verificationRequired && !drawKnown && <p className="alert alert-error" role="status">
                    Une préparation doit être vérifiée. Toute nouvelle préparation est bloquée, même après rechargement de cet onglet.
                </p>}
                <button className="primary" onClick={handlePrepare} disabled={!canPrepare}>
                    {preparing ? 'Préparation en cours…' : drawKnown ? 'Tirage déjà enregistré' : 'Préparer le tirage définitif'}
                </button>
            </section>

            <section className="card">
                <h2>📨 Suivi des notifications</h2>
                <p>« Accepté par SMTP » ne garantit pas la réception du message. Une simulation n’est pas un email réel.</p>
                {tracking?.trackingAvailable ? <>
                    <dl style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                        {Object.entries(statusLabels).map(([status, label]) => <div key={status}>
                            <dt>{label} ({status})</dt><dd>{tracking.counts[status]}</dd>
                        </div>)}
                    </dl>
                    {tracking.reconciliationPending && <p role="status">Des réservations expirées restent à vérifier. Actualisez à nouveau le suivi.</p>}
                    <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', textAlign: 'left' }}>
                        <caption>État persistant par participant donneur</caption>
                        <thead><tr><th scope="col">Participant</th><th scope="col">Adresse de réception</th><th scope="col">Statut</th><th scope="col">Tentatives</th></tr></thead>
                        <tbody>{tracking.notifications.map(item => <tr key={item.participantId}>
                            <th scope="row">{item.giverName || 'Participant indisponible'}</th><td>{item.recipientEmail}</td>
                            <td>{statusLabels[item.status] || 'Statut indisponible'}</td><td>{item.attemptCount}</td>
                        </tr>)}</tbody>
                    </table></div>
                </> : <p>{tracking?.code === 'LEGACY_DRAW_UNTRACKED' || (drawKnown && recordedCount == null && tracking) ?
                    'Le suivi individuel de cette ancienne fête V2 n’est pas disponible. Aucun nombre d’emails envoyés ne peut être confirmé.' :
                    drawKnown ? 'Le suivi des notifications doit encore être chargé. Actualisez pour vérifier son état.' :
                        'Les notifications seront disponibles après l’enregistrement du tirage.'}</p>}
                {validTracking && <div style={{ marginTop: '20px' }}>
                    <p>La distribution traite uniquement les notifications pending, avec au moins 6,1 secondes entre demandes pour respecter la limite du serveur. Gardez cet onglet ouvert.</p>
                    <p>{eligibleCount} notification(s) pending éligible(s). Aucun renvoi des échecs ou des simulations n’est proposé ici.</p>
                    {blockedSends === null ? <p role="alert">Le stockage local de vérification est indisponible. La distribution est bloquée.</p> :
                        blockedSends.length > 0 && <p role="status">Certaines tentatives doivent encore être vérifiées. Elles sont exclues des reprises tant que leur état persistant ne les confirme pas.</p>}
                    <button className="primary" onClick={handleDistribution}
                        disabled={!ready || loading || preparing || distributing || !eligibleCount || tracking.reconciliationPending || !blockedSends}>
                        Lancer les envois
                    </button>
                    {distributing && <button onClick={pauseDistribution} disabled={pauseRequested}>
                        {pauseRequested ? 'Suspension demandée…' : 'Suspendre après la requête en cours'}
                    </button>}
                    {distributing && <p role="status">{pauseRequested ? 'La requête en cours se termine avant la suspension.' :
                        progress?.phase === 'sending' ? 'Une tentative est en cours. Son résultat sera relu dans le suivi.' : 'Attente avant la prochaine demande.'}</p>}
                    {progress && <p>Demandes effectuées dans cette séquence : {progress.attempted} / {progress.total} initialement en attente. Ce nombre ne représente pas les emails acceptés.</p>}
                    {distributionMessage && <p role="status">{distributionMessage}</p>}
                </div>}
            </section>

            <section className="card">
                <button className="secondary" onClick={loadData} disabled={loading || preparing || distributing || savingParticipant}>
                    {loading ? 'Actualisation…' : 'Actualiser le suivi et les participants'}
                </button>
                <button onClick={() => navigate('/')}>← Retour à l’accueil</button>
                {error && <p role="alert" className="alert alert-error">{error}</p>}
                {successMessage && <p role="status" className="alert alert-success">{successMessage}</p>}
            </section>
        </main>
    </>;
}
