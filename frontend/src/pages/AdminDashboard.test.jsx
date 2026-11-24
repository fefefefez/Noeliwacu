import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { act } from 'react';
import AdminDashboard from './AdminDashboard';
import * as api from '../services/api';

jest.mock('../services/api');
// RTL 13 utilise encore l'ancien point d'entree act ; garder le meme outil
// avec l'API React fournie par le lockfile, sans masquer les console.error.
jest.mock('react-dom/test-utils', () => ({ ...jest.requireActual('react-dom/test-utils'), act: jest.requireActual('react').act }));
const people = [
    { _id: 'p1', name: 'Alice', email: 'parent@example.invalid', familyGroup: 'A', wishList: ['Livre'] },
    { _id: 'p2', name: 'Bob', email: 'parent@example.invalid', familyGroup: 'B', wishList: [] }
];
const pendingTracking = { success: true, trackingAvailable: true,
    counts: { total: 2, pending: 2, sending: 0, accepted: 0, failed: 0, uncertain: 0, simulated: 0 },
    notifications: people.map(p => ({ participantId: p._id, giverName: p.name, recipientEmail: p.email, status: 'pending', attemptCount: 0,
        receiverId: 'GIFT_RECEIVER_SECRET', pairsGenerated: ['PRIVATE_PAIR'] })) };
function reads({ done = false, canDraw = !done, tracking } = {}) {
    api.getParty.mockResolvedValue({ success: true, party: { name: 'Noël famille', families: ['A', 'B'], drawDone: done,
        pairsGenerated: ['PRIVATE_PAIR'], receiverId: 'GIFT_RECEIVER_SECRET' } });
    api.getParticipants.mockResolvedValue({ success: true, participants: people });
    api.getDrawStatus.mockResolvedValue({ success: true, status: { drawDone: done, canDraw, participantCount: 2 } });
    api.getNotifications.mockResolvedValue(tracking || (done ? pendingTracking :
        { success: true, trackingAvailable: false, code: 'DRAW_NOT_PREPARED', counts: null, notifications: [] }));
}
function LocationState() {
    const location = useLocation();
    return <output data-testid="location-state">{JSON.stringify(location.state)}</output>;
}
function open(state = null) {
    return render(<MemoryRouter initialEntries={[{ pathname: '/admin/TEST21', state }]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes><Route path="/admin/:code" element={<><AdminDashboard /><LocationState /></>} /></Routes>
    </MemoryRouter>);
}
async function login() {
    fireEvent.change(screen.getByLabelText(/Code PIN/), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Accéder au Dashboard' }));
    await screen.findByRole('heading', { name: /Dashboard Administrateur/ });
    await screen.findByRole('heading', { name: /Informations de la Fête/ });
    await waitFor(() => expect(screen.getByRole('button', { name: /Actualiser le suivi/ })).toBeEnabled());
}
const prepareButton = () => screen.getByRole('button', { name: /Préparer le tirage définitif|Tirage déjà enregistré|Préparation en cours/ });
function noLeaksOrSending() {
    expect(document.body.textContent).not.toMatch(/GIFT_RECEIVER_SECRET|PRIVATE_PAIR|receiverId|pairsGenerated/);
    expect(api.sendNotification).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /renvoyer/i })).not.toBeInTheDocument();
}
beforeEach(() => {
    jest.resetAllMocks();
    sessionStorage.clear(); localStorage.clear();
    api.verifyAdminPin.mockResolvedValue({ success: true });
    reads();
    jest.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

test('avant tirage : PIN verifie, participants et familles, aucune generation automatique', async () => {
    open();
    expect(api.getParticipants).not.toHaveBeenCalled();
    await login();
    expect(screen.getByRole('heading', { name: '👥 Participants inscrits (2)' })).toBeInTheDocument();
    expect(screen.getByText('Famille A (1)')).toBeInTheDocument();
    expect(screen.getByText('Famille B (1)')).toBeInTheDocument();
    expect(prepareButton()).toBeEnabled();
    expect(api.getNotifications).toHaveBeenCalledWith('TEST21', '1234');
    expect(api.getParticipants).toHaveBeenCalledTimes(1);
    expect(api.prepareDraw).not.toHaveBeenCalled();
    noLeaksOrSending();
});

test('confirmation annulee : aucune preparation et aucun marqueur', async () => {
    window.confirm.mockReturnValue(false);
    open(); await login(); fireEvent.click(prepareButton());
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/inscriptions seront clôturées/));
    expect(api.prepareDraw).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
});

test('preparation confirmee, double clic bloque, compte enregistre puis suivi recharge', async () => {
    let resolve;
    api.prepareDraw.mockImplementation(() => new Promise(done => { resolve = done; }));
    open(); await login();
    fireEvent.click(prepareButton()); fireEvent.click(prepareButton());
    expect(api.prepareDraw).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('noeliwacu:draw-verification:TEST21')).toBe('required');
    reads({ done: true });
    await act(async () => resolve({ success: true, outcome: 'confirmed', draw: { participantCount: 2, receiverId: 'GIFT_RECEIVER_SECRET' } }));
    expect(await screen.findByText('2 attributions enregistrées')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(prepareButton()).toBeDisabled();
    expect(screen.getByText('Tirage sauvegardé définitivement. Aucun email n’a été envoyé.')).toBeInTheDocument();
    expect(sessionStorage.length).toBe(0);
    noLeaksOrSending();
});

test('apres tirage : six compteurs fiables, adresses partagees et tentatives, sans paire', async () => {
    const states = ['pending', 'sending', 'accepted', 'failed', 'uncertain', 'simulated'];
    reads({ done: true, tracking: { ...pendingTracking, counts: { total: 6, ...Object.fromEntries(states.map(s => [s, 1])) },
        notifications: states.map((status, i) => ({ participantId: `p${i}`, giverName: `Donneur ${i}`,
            recipientEmail: 'parent@example.invalid', status, attemptCount: i, receiverId: 'GIFT_RECEIVER_SECRET' })) } });
    open(); await login();
    expect(screen.getByText('6 attributions enregistrées')).toBeInTheDocument();
    states.forEach(status => expect(screen.getByText(new RegExp(`\\(${status}\\)`))).toBeInTheDocument());
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(7);
    expect(screen.getByText('Simulation — aucun email réel')).toBeInTheDocument();
    expect(prepareButton()).toBeDisabled();
    noLeaksOrSending();
});

test('rafraichissement manuel : nouveaux statuts lus sans preparation', async () => {
    reads({ done: true }); open(); await login();
    reads({ done: true, tracking: { ...pendingTracking, counts: { ...pendingTracking.counts, pending: 1, accepted: 1 },
        notifications: pendingTracking.notifications.map((n, i) => i ? n : { ...n, status: 'accepted', attemptCount: 1 }) } });
    fireEvent.click(screen.getByRole('button', { name: /Actualiser le suivi/ }));
    await screen.findByRole('cell', { name: 'Accepté par SMTP' });
    expect(api.prepareDraw).not.toHaveBeenCalled();
});

test('rechargement de page : PIN redemande et suivi MongoDB conserve', async () => {
    reads({ done: true });
    const view = open(); await login(); view.unmount();
    open();
    expect(screen.getByLabelText(/Code PIN/)).toHaveValue('');
    await login();
    expect(screen.getByText('2 attributions enregistrées')).toBeInTheDocument();
    expect(api.prepareDraw).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
});

for (const failure of [Object.assign(new Error(), { outcome: 'unknown', status: 503 }), new TypeError('Failed to fetch')]) {
    test(`preparation non confirmee (${failure.name}, ${failure.outcome || 'reseau'}) : aucun retry, blocage apres rechargement`, async () => {
        api.prepareDraw.mockRejectedValue(failure);
        const view = open(); await login(); fireEvent.click(prepareButton());
        await screen.findByText(/Résultat du tirage inconnu/);
        expect(prepareButton()).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: /Actualiser le suivi/ }));
        await waitFor(() => expect(screen.getByRole('button', { name: /Actualiser le suivi/ })).toBeEnabled());
        expect(prepareButton()).toBeDisabled(); // Une lecture negative n'annule pas un commit potentiellement en cours.
        view.unmount(); open(); await login();
        expect(prepareButton()).toBeDisabled();
        expect(api.prepareDraw).toHaveBeenCalledTimes(1);
        expect(localStorage.length).toBe(0);
        expect(Object.values(sessionStorage).join('')).not.toContain('1234');
    });
}

test('409 : blocage puis verification positive sans nouveau POST', async () => {
    api.prepareDraw.mockRejectedValue(Object.assign(new Error(), { status: 409, outcome: 'rejected' }));
    open(); await login(); fireEvent.click(prepareButton());
    await screen.findByText(/Conflit : un tirage existe/);
    expect(prepareButton()).toBeDisabled();
    reads({ done: true }); fireEvent.click(screen.getByRole('button', { name: /Actualiser le suivi/ }));
    await screen.findByText('2 attributions enregistrées');
    expect(api.prepareDraw).toHaveBeenCalledTimes(1);
    expect(prepareButton()).toBeDisabled();
});

test('refus confirme : actualisation requise avant une nouvelle action manuelle', async () => {
    api.prepareDraw.mockRejectedValue(Object.assign(new Error(), { status: 400, outcome: 'rejected' }));
    open(); await login(); fireEvent.click(prepareButton());
    await screen.findByText(/Préparation refusée/);
    expect(prepareButton()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Actualiser le suivi/ }));
    await waitFor(() => expect(prepareButton()).toBeEnabled());
    expect(api.prepareDraw).toHaveBeenCalledTimes(1);
});

test('erreur de lecture : anciens compteurs conserves mais explicitement non actualises', async () => {
    reads({ done: true }); open(); await login();
    api.getNotifications.mockRejectedValue(new TypeError('Network failure'));
    fireEvent.click(screen.getByRole('button', { name: /Actualiser le suivi/ }));
    await screen.findByText(/Les données affichées peuvent être anciennes/);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(prepareButton()).toBeDisabled();
    expect(api.prepareDraw).not.toHaveBeenCalled();
});

for (const done of [true, false]) {
    test(`ancienne V2, drawDone=${done} : aucun nouveau tirage et aucun faux compteur SMTP`, async () => {
        reads({ done, canDraw: false, tracking: { success: true, trackingAvailable: false,
            code: done ? 'LEGACY_DRAW_UNTRACKED' : 'DRAW_NOT_PREPARED', notifications: [], counts: null } });
        open(); await login();
        expect(prepareButton()).toBeDisabled();
        expect(screen.getByText(/Ancien tirage V2/)).toBeInTheDocument();
        expect(screen.queryByRole('table')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Lancer les envois' })).not.toBeInTheDocument();
        expect(api.prepareDraw).not.toHaveBeenCalled();
        noLeaksOrSending();
    });
}

test('PIN transfere depuis la creation : retire de history.state et conserve uniquement en memoire', async () => {
    open({ adminPin: '1234' });
    await waitFor(() => expect(screen.getByTestId('location-state')).toHaveTextContent('null'));
    expect(screen.getByLabelText(/Code PIN/)).toHaveValue('1234');
    fireEvent.click(screen.getByRole('button', { name: 'Accéder au Dashboard' }));
    await screen.findByRole('heading', { name: /Informations de la Fête/ });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
});

test('PIN incorrect : donnees privees non chargees', async () => {
    api.verifyAdminPin.mockRejectedValue(new Error());
    open(); fireEvent.change(screen.getByLabelText(/Code PIN/), { target: { value: '9999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Accéder au Dashboard' }));
    await screen.findByText(/Accès non confirmé/);
    expect(api.getParticipants).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Code PIN/)).toHaveValue('');
});

test('56 participants avec email commun : repertoire complet et repartition familiale', async () => {
    const participants = Array.from({ length: 56 }, (_, i) => ({ ...people[i % 2], _id: `p${i}`, name: `Participant ${i}` }));
    api.getParticipants.mockResolvedValue({ success: true, participants });
    api.getDrawStatus.mockResolvedValue({ success: true, status: { drawDone: false, canDraw: true, participantCount: 56 } });
    open(); await login();
    expect(screen.getByRole('heading', { name: '👥 Participants inscrits (56)' })).toBeInTheDocument();
    expect(screen.getByText('Famille A (28)')).toBeInTheDocument();
    expect(screen.getByText('Famille B (28)')).toBeInTheDocument();
    expect(screen.getAllByText('📧 parent@example.invalid')).toHaveLength(56);
    expect(prepareButton()).toBeEnabled();
    expect(api.prepareDraw).not.toHaveBeenCalled();
});

test('rechargement pendant le POST : le marqueur precede la confirmation serveur', async () => {
    let resolve;
    api.prepareDraw.mockImplementation(() => new Promise(done => { resolve = done; }));
    const view = open(); await login(); fireEvent.click(prepareButton());
    view.unmount(); open(); await login();
    expect(prepareButton()).toBeDisabled();
    await act(async () => resolve({ success: true, outcome: 'confirmed', draw: { participantCount: 2 } }));
    expect(prepareButton()).toBeDisabled();
    expect(api.prepareDraw).toHaveBeenCalledTimes(1);
});

test('stockage de verification indisponible : aucun POST declenche', async () => {
    open(); await login();
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    fireEvent.click(prepareButton());
    await screen.findByText(/Le navigateur ne permet pas de conserver le suivi/);
    expect(api.prepareDraw).not.toHaveBeenCalled();
});

test('preparation confirmee puis erreur de lecture : nombre conserve, sans faux diagnostic V2', async () => {
    open(); await login();
    api.prepareDraw.mockResolvedValue({ success: true, outcome: 'confirmed', draw: { participantCount: 2 } });
    api.getNotifications.mockRejectedValue(new Error('Network'));
    fireEvent.click(prepareButton());
    await screen.findByText(/Les données affichées peuvent être anciennes/);
    expect(screen.getByText('2 attributions enregistrées')).toBeInTheDocument();
    expect(screen.queryByText(/Le suivi individuel de cette ancienne fête V2/)).not.toBeInTheDocument();
    expect(prepareButton()).toBeDisabled();
});

function distributionFixture() {
    const notifications = pendingTracking.notifications.map(n => ({ ...n }));
    const snapshot = () => ({ ...pendingTracking,
        notifications: notifications.map(n => ({ ...n })),
        counts: { total: notifications.length, ...Object.fromEntries(['pending', 'sending', 'accepted', 'failed', 'uncertain', 'simulated']
            .map(status => [status, notifications.filter(n => n.status === status).length])) } });
    reads({ done: true, tracking: snapshot() });
    api.getNotifications.mockImplementation(async () => snapshot());
    api.sendNotification.mockImplementation(async (code, pin, id) => {
        const item = notifications.find(n => n.participantId === id);
        item.status = 'accepted'; item.attemptCount++;
        return { success: true, participantId: id, status: item.status };
    });
    return { notifications, snapshot };
}
async function launchDistribution() {
    jest.useFakeTimers();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Lancer les envois' })); });
}
async function nextRequest() {
    await act(async () => { jest.advanceTimersByTime(6100); });
}

test('distribution : confirmation, double clic protege et compteurs relus apres chaque demande', async () => {
    distributionFixture(); open(); await login();
    await launchDistribution();
    fireEvent.click(screen.getByRole('button', { name: 'Lancer les envois' }));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/une à la fois/));
    expect(api.sendNotification).not.toHaveBeenCalled();
    await nextRequest();
    expect(api.sendNotification).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('cell', { name: 'Accepté par SMTP' })).toBeInTheDocument();
    await nextRequest();
    expect(api.sendNotification).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole('cell', { name: 'Accepté par SMTP' })).toHaveLength(2);
    expect(screen.getByText(/Séquence terminée/)).toBeInTheDocument();
    expect(screen.getByText(/Demandes effectuées dans cette séquence : 2 \/ 2/)).toBeInTheDocument();
    expect(sessionStorage.length).toBe(0);
    expect(document.body.textContent).not.toMatch(/GIFT_RECEIVER_SECRET|PRIVATE_PAIR/);
});

test('confirmation de distribution refusee : aucun POST', async () => {
    distributionFixture(); open(); await login(); window.confirm.mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Lancer les envois' }));
    expect(api.sendNotification).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Suspendre/ })).not.toBeInTheDocument();
});

test('suspension puis reprise manuelle : la demande active se termine sans annulation', async () => {
    const f = distributionFixture();
    let resolve;
    api.sendNotification.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    open(); await login(); await launchDistribution(); await nextRequest();
    fireEvent.click(screen.getByRole('button', { name: 'Suspendre après la requête en cours' }));
    expect(screen.getByText(/La requête en cours se termine/)).toBeInTheDocument();
    await nextRequest(); expect(api.sendNotification).toHaveBeenCalledTimes(1);
    f.notifications[0].status = 'accepted'; f.notifications[0].attemptCount = 1;
    await act(async () => resolve({ success: true, participantId: 'p1', status: 'accepted' }));
    expect(screen.getByText(/Séquence suspendue/)).toBeInTheDocument();
    await launchDistribution(); await nextRequest();
    expect(api.sendNotification.mock.calls.map(call => call[2])).toEqual(['p1', 'p2']);
    expect(api.sendNotification.mock.calls.every(call => call.length === 3)).toBe(true); // Aucun signal d'annulation fourni par pause.
});

test('reponse perdue puis rechargement : pending ambigu exclu, reprise explicite des autres pending', async () => {
    distributionFixture();
    api.sendNotification.mockRejectedValueOnce(new TypeError('Network'));
    const view = open(); await login(); await launchDistribution(); await nextRequest();
    expect(screen.getByText(/Séquence arrêtée : une tentative n’est pas confirmée/)).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem('noeliwacu:notification-verification:TEST21'))).toEqual(['p1']);
    view.unmount(); jest.useRealTimers(); open(); await login();
    expect(api.sendNotification).toHaveBeenCalledTimes(1); // Pas de reprise au montage.
    expect(screen.getByText(/Certaines tentatives doivent encore être vérifiées/)).toBeInTheDocument();
    expect(screen.getByText(/1 notification\(s\) pending éligible/)).toBeInTheDocument();
    await launchDistribution(); await nextRequest();
    expect(api.sendNotification.mock.calls.map(call => call[2])).toEqual(['p1', 'p2']);
    expect(JSON.stringify(sessionStorage)).not.toContain('1234');
    expect(localStorage.length).toBe(0);
});

test('uncertain ou relecture impossible : sequence arretee et aucun email suivant', async () => {
    const f = distributionFixture();
    api.sendNotification.mockImplementation(async (code, pin, id) => {
        f.notifications[0].status = 'uncertain'; f.notifications[0].attemptCount = 1;
        return { success: true, participantId: id, status: 'uncertain' };
    });
    open(); await login(); await launchDistribution(); await nextRequest();
    expect(screen.getByText(/Séquence arrêtée : un résultat est incertain/)).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Résultat incertain' })).toBeInTheDocument();
    await nextRequest(); expect(api.sendNotification).toHaveBeenCalledTimes(1);
});

test('relecture perdue apres POST : distribution bloquee jusqu’a actualisation manuelle', async () => {
    distributionFixture();
    api.sendNotification.mockImplementation(async () => {
        api.getNotifications.mockRejectedValue(new TypeError('Network'));
        return { success: true, participantId: 'p1', status: 'accepted' };
    });
    open(); await login(); await launchDistribution(); await nextRequest();
    expect(screen.getByText(/Séquence arrêtée : le suivi ne peut pas être confirmé/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lancer les envois' })).toBeDisabled();
    expect(screen.queryByRole('cell', { name: 'Accepté par SMTP' })).not.toBeInTheDocument();
    expect(api.sendNotification).toHaveBeenCalledTimes(1);
});

test('quitter pendant SMTP : aucun envoi suivant ni relecture en arriere-plan', async () => {
    distributionFixture(); let resolve;
    api.sendNotification.mockImplementation(() => new Promise(done => { resolve = done; }));
    const view = open(); await login(); await launchDistribution(); await nextRequest();
    const readsCount = api.getNotifications.mock.calls.length;
    view.unmount();
    await act(async () => resolve({ success: true, participantId: 'p1', status: 'accepted' }));
    await nextRequest();
    expect(api.getNotifications).toHaveBeenCalledTimes(readsCount);
    expect(api.sendNotification).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem('noeliwacu:notification-verification:TEST21'))).toEqual(['p1']);
});

test('ajout admin : familles autorisées et compteurs rafraîchis depuis le serveur', async () => {
    open(); await login();
    const added = { _id: 'p3', name: 'CHLOÉ', email: people[0].email, familyGroup: 'A', wishList: ['Jeu'] };
    api.addAdminParticipant.mockImplementation(async () => {
        api.getParticipants.mockResolvedValue({ success: true, participants: [...people, added] });
        return { success: true, outcome: 'confirmed' };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un participant' }));
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Chloé' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: added.email } });
    expect(within(screen.getByLabelText('Famille')).getAllByRole('option').map(o => o.value)).toEqual(['', 'A', 'B']);
    fireEvent.change(screen.getByLabelText('Famille'), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText(/Souhait 1/), { target: { value: 'Jeu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer l’inscription' }));
    expect(await screen.findByText('Famille A (2)')).toBeInTheDocument();
    expect(api.addAdminParticipant).toHaveBeenCalledWith('TEST21', '1234', { name: 'Chloé', email: added.email, familyGroup: 'A', wishList: ['Jeu', '', ''] });
    expect(screen.getByText(/Participants inscrits \(3\)/)).toBeInTheDocument();
});

test('modification puis suppression avec confirmation', async () => {
    open(); await login();
    const changed = { ...people[0], name: 'Clara', familyGroup: 'B', wishList: [] };
    api.updateAdminParticipant.mockImplementation(async () => {
        api.getParticipants.mockResolvedValue({ success: true, participants: [changed, people[1]] });
        return { success: true, outcome: 'confirmed' };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Modifier l’inscription de Alice' }));
    expect(screen.getByLabelText(/Souhait 1/)).toHaveValue('Livre');
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Clara' } });
    fireEvent.change(screen.getByLabelText('Famille'), { target: { value: 'B' } });
    fireEvent.change(screen.getByLabelText(/Souhait 1/), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer l’inscription' }));
    expect(await screen.findByText('Famille B (2)')).toBeInTheDocument();
    expect(api.updateAdminParticipant).toHaveBeenCalledWith('TEST21', '1234', 'p1', expect.objectContaining({ wishList: ['', '', ''] }));
    api.deleteAdminParticipant.mockImplementation(async () => {
        api.getParticipants.mockResolvedValue({ success: true, participants: [people[1]] });
        return { success: true, outcome: 'confirmed' };
    });
    const remove = screen.getByRole('button', { name: 'Supprimer l’inscription de Clara' });
    window.confirm.mockReturnValueOnce(false);
    fireEvent.click(remove);
    expect(api.deleteAdminParticipant).not.toHaveBeenCalled();
    fireEvent.click(remove);
    await screen.findByText(/Participants inscrits \(1\)/);
    expect(api.deleteAdminParticipant).toHaveBeenCalledTimes(1);
});

test('suppression inconnue : relecture des inscriptions sans répéter la demande', async () => {
    open(); await login();
    api.deleteAdminParticipant.mockImplementation(async () => {
        api.getParticipants.mockResolvedValue({ success: true, participants: [people[1]] });
        throw Object.assign(new Error(), { status: 503, outcome: 'unknown' });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer l’inscription de Alice' }));
    await screen.findByText(/Participants inscrits \(1\)/);
    expect(screen.getByRole('alert')).toHaveTextContent('Résultat inconnu');
    expect(api.deleteAdminParticipant).toHaveBeenCalledTimes(1);
});

test('tirage concurrent : un refus serveur clôture les actions, même si la relecture échoue', async () => {
    open(); await login();
    api.deleteAdminParticipant.mockImplementation(async () => {
        api.getParticipants.mockRejectedValue(new TypeError());
        throw Object.assign(new Error(), { status: 403, code: 'DRAW_ALREADY_EXISTS' });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer l’inscription de Alice' }));
    await screen.findByText(/Les inscriptions sont clôturées/);
    expect(screen.queryByRole('button', { name: 'Ajouter un participant' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Modifier l’inscription/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Supprimer l’inscription/ })).not.toBeInTheDocument();
});

test('ancienne fête verrouillée avec moins de deux inscrits : administration absente', async () => {
    api.getParticipants.mockResolvedValue({ success: true, participants: [people[0]] });
    api.getDrawStatus.mockResolvedValue({ success: true, status: { drawDone: false, drawLocked: true, participantCount: 1, canDraw: false } });
    open(); await login();
    expect(screen.queryByRole('button', { name: 'Ajouter un participant' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Supprimer l’inscription/ })).not.toBeInTheDocument();
});
