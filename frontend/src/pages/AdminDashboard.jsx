import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { getParty, getParticipants, generateDrawPreview, sendDraw, verifyAdminPin } from '../services/api';

export default function AdminDashboard() {
    const navigate = useNavigate();
    const { code } = useParams();
    const location = useLocation();
    const [partyInfo, setPartyInfo] = useState(null);
    const [participants, setParticipants] = useState([]);
    const [adminPin, setAdminPin] = useState(location.state?.adminPin || '');
    const [showingPinPrompt, setShowingPinPrompt] = useState(!location.state?.adminPin);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [sendingEmails, setSendingEmails] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');
    const [pinVerified, setPinVerified] = useState(!!location.state?.adminPin);

    // ✅ MODIFIÉ : Utiliser verifyAdminPin au lieu de generateDrawPreview
    const verifyPinAndLoadData = async (pin) => {
        setLoading(true);
        setError('');

        try {
            // ✅ CHANGÉ : Vérifier le PIN avec la nouvelle route
            const pinCheck = await verifyAdminPin(code, pin);

            if (!pinCheck.success) {
                setError('❌ PIN Admin incorrect. Veuillez réessayer.');
                setLoading(false);
                return false;
            }

            setPinVerified(true);

            // Charger les données
            await loadData();
            return true;
        } catch (err) {
            setError('Erreur de connexion au serveur. Vérifiez que le backend est démarré.');
            setLoading(false);
            return false;
        }
    };

    const loadData = useCallback(async () => {
        setLoading(true);
        setError('');

        try {
            // Charger les infos de la party
            const partyData = await getParty(code);
            if (partyData.success) {
                setPartyInfo(partyData.party);
            } else {
                setError(partyData.message);
            }

            // Charger les participants
            const participantsData = await getParticipants(code);
            if (participantsData.success) {
                setParticipants(participantsData.participants);
            }
        } catch (err) {
            setError('Erreur de chargement des données.');
        } finally {
            setLoading(false);
        }
    }, [code]);

    // ✅ MODIFIÉ : Charger les données SEULEMENT si PIN déjà vérifié (venant de CreateParty)
    useEffect(() => {
        if (code && pinVerified) {
            loadData();
        }
    }, [code, pinVerified, loadData]);

    const handlePinSubmit = async (e) => {
        e.preventDefault();

        if (adminPin.length !== 4) {
            setError('Le PIN doit contenir exactement 4 chiffres.');
            return;
        }

        const isValid = await verifyPinAndLoadData(adminPin);

        if (isValid) {
            setShowingPinPrompt(false);  // ✅ Masquer le prompt seulement si PIN OK
        } else {
            setAdminPin('');  // ✅ Vider le PIN seulement en cas d'erreur
        }
    };

    const handlePerformDrawAndSend = async () => {
        if (!window.confirm('⚠️ Êtes-vous sûr de vouloir effectuer le tirage et envoyer les emails ?\n\nCette action est IRRÉVERSIBLE et tous les participants recevront leur assignation par email.')) {
            return;
        }

        setSendingEmails(true);
        setError('');
        setSuccessMessage('');

        try {
            // 1. Générer le tirage
            const drawData = await generateDrawPreview(code, adminPin);

            if (!drawData.success) {
                setError(drawData.message);
                setSendingEmails(false);
                return;
            }

            // 2. Envoyer les emails
            const emailData = await sendDraw(code, adminPin);

            if (emailData.success) {
                setSuccessMessage(`✅ Tirage effectué et ${emailData.emailsSent} emails envoyés avec succès ! 🎉`);
                await loadData();
            } else {
                setError(emailData.message);
            }
        } catch (err) {
            setError('Erreur lors du tirage. Vérifiez que le backend est en marche.');
        } finally {
            setSendingEmails(false);
        }
    };

    // Grouper participants par famille
    const participantsByFamily = participants.reduce((acc, participant) => {
        if (!acc[participant.familyGroup]) {
            acc[participant.familyGroup] = [];
        }
        acc[participant.familyGroup].push(participant);
        return acc;
    }, {});

    // Vérifier si le tirage est possible
    const canDraw = participants.length >= 2 && Object.keys(participantsByFamily).length >= 2;

    if (showingPinPrompt) {
        return (
            <>
                <header>
                    <h1>🔐 Accès Administrateur</h1>
                    <p>Entrez votre code PIN pour gérer la fête</p>
                </header>

                <main className="container">
                    <div className="card" style={{ maxWidth: '500px', margin: '40px auto' }}>
                        <form onSubmit={handlePinSubmit}>
                            <div>
                                <label>Code PIN Administrateur (4 chiffres)</label>
                                <input
                                    type="password"
                                    placeholder="1234"
                                    pattern="[0-9]{4}"
                                    value={adminPin}
                                    onChange={(e) => setAdminPin(e.target.value)}
                                    maxLength={4}
                                    required
                                    autoFocus
                                    disabled={loading}  // ✅ AJOUTÉ : Désactiver pendant le chargement
                                />
                            </div>

                            {error && (
                                <div className="alert alert-error" style={{ marginTop: '15px' }}>
                                    {error}
                                </div>
                            )}

                            <button
                                type="submit"
                                className="primary"
                                style={{ width: '100%', marginTop: '20px' }}
                                disabled={loading || adminPin.length !== 4}  // ✅ MODIFIÉ
                            >
                                {loading ? '⏳ Vérification...' : '🔓 Accéder au Dashboard'}
                            </button>
                        </form>

                        <button
                            onClick={() => navigate('/')}
                            style={{
                                width: '100%',
                                marginTop: '10px',
                                background: '#6c757d',
                                color: 'white'
                            }}
                            disabled={loading}  // ✅ AJOUTÉ
                        >
                            ← Retour à l'accueil
                        </button>
                    </div>
                </main>
            </>
        );
    }

    if (loading && !partyInfo) {  // ✅ MODIFIÉ : Afficher loading seulement si pas encore de données
        return (
            <>
                <header>
                    <h1>⏳ Chargement...</h1>
                </header>
            </>
        );
    }

    return (
        <>
            <header>
                <h1>🎅 Dashboard Administrateur</h1>
                <p>Gérez votre fête Secret Santa</p>
            </header>

            <main className="container">
                {/* Info de la Party */}
                {partyInfo && (
                    <div className="card">
                        <h2>📋 Informations de la Fête</h2>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginTop: '20px' }}>
                            <div>
                                <strong>Nom :</strong>
                                <p>{partyInfo.name}</p>
                            </div>
                            <div>
                                <strong>Party Code :</strong>
                                <p style={{ fontSize: '1.5rem', color: 'var(--christmas-gold)' }}>{code}</p>
                            </div>
                            {partyInfo.budget && (
                                <div>
                                    <strong>Budget :</strong>
                                    <p>{partyInfo.budget}€</p>
                                </div>
                            )}
                            {partyInfo.date && (
                                <div>
                                    <strong>Date :</strong>
                                    <p>{new Date(partyInfo.date).toLocaleDateString('fr-FR')}</p>
                                </div>
                            )}
                        </div>

                        <div style={{ marginTop: '30px' }}>
                            <strong>Familles :</strong>
                            <div style={{ display: 'flex', gap: '10px', marginTop: '10px', flexWrap: 'wrap' }}>
                                {partyInfo.families.map((family) => (
                                    <span key={family} className="family-badge">
                                        {family}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* Liste des Participants */}
                <div className="card">
                    <h2>👥 Participants ({participants.length})</h2>

                    {participants.length === 0 ? (
                        <div className="alert alert-info" style={{ marginTop: '20px' }}>
                            Aucun participant pour le moment. Partagez le code <strong>{code}</strong> pour inviter des personnes !
                        </div>
                    ) : (
                        <div style={{ marginTop: '20px' }}>
                            {Object.entries(participantsByFamily).map(([family, members]) => (
                                <div key={family} style={{ marginBottom: '30px' }}>
                                    <h3 style={{ color: 'var(--christmas-gold)', marginBottom: '15px' }}>
                                        👨‍👩‍👧‍👦 Famille {family} ({members.length})
                                    </h3>
                                    {members.map((participant) => (
                                        <div key={participant._id} className="participant-item">
                                            <div className="participant-info">
                                                <h3>{participant.name}</h3>
                                                <p>📧 {participant.email}</p>
                                                {participant.wishList && participant.wishList.length > 0 && (
                                                    <p style={{ marginTop: '5px' }}>
                                                        🎁 Liste : {participant.wishList.join(', ')}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="card">
                    <h2>🎲 Actions</h2>

                    {!canDraw && (
                        <div className="alert alert-error">
                            ❌ Impossible de faire le tirage :
                            <ul style={{ marginTop: '10px', paddingLeft: '20px' }}>
                                {participants.length < 2 && <li>Il faut au moins 2 participants</li>}
                                {Object.keys(participantsByFamily).length < 2 && <li>Il faut au moins 2 familles différentes</li>}
                            </ul>
                        </div>
                    )}

                    {canDraw && (
                        <div className="alert alert-success">
                            ✅ Tout est prêt pour le tirage au sort !
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '10px', marginTop: '20px', flexWrap: 'wrap' }}>
                        <button
                            className="primary"
                            onClick={handlePerformDrawAndSend}
                            disabled={!canDraw || sendingEmails || partyInfo?.drawDone}
                            style={{ flex: 1 }}
                        >
                            {sendingEmails ? '⏳ Envoi en cours...' : partyInfo?.drawDone ? '✅ Tirage déjà effectué' : '🎁 Effectuer le Tirage et Envoyer les Emails'}
                        </button>

                        <button
                            className="secondary"
                            onClick={loadData}
                            style={{ flex: 1 }}
                        >
                            🔄 Actualiser
                        </button>
                    </div>

                    <button
                        onClick={() => navigate('/')}
                        style={{
                            width: '100%',
                            marginTop: '10px',
                            background: '#6c757d',
                            color: 'white'
                        }}
                    >
                        ← Retour à l'accueil
                    </button>

                    {/* ✅ DÉPLACER LES MESSAGES ICI (à l'intérieur du card) */}
                    {error && (
                        <div className="alert alert-error" style={{ marginTop: '20px' }}>
                            {error}
                        </div>
                    )}

                    {successMessage && (
                        <div className="alert alert-success" style={{ marginTop: '20px' }}>
                            {successMessage}
                        </div>
                    )}
                </div>

                {/* ❌ SUPPRIMER LES MESSAGES ICI (en dehors du card) */}
            </main>
        </>
    );
}