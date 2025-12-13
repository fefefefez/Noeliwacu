import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { generateDrawPreview, sendDraw } from "../services/api";  // ✅ Noms corrects

export default function DrawPage() {
    const navigate = useNavigate();
    const { code } = useParams();
    const location = useLocation();
    const [adminPin, setAdminPin] = useState(location.state?.adminPin || '');
    const [showPinPrompt, setShowPinPrompt] = useState(!location.state?.adminPin);  // ✅ Inverser le !
    const [drawResult, setDrawResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [sendingEmails, setSendingEmails] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const performDrawAction = useCallback(async () => {
        if (!adminPin || adminPin.length !== 4) {
            setError('Code PIN administrateur invalide.');
            return;
        }

        setLoading(true);
        setError('');

        try {
            console.log('🎲 Appel generateDrawPreview avec code:', code, 'PIN:', adminPin);  // ✅ DEBUG

            const data = await generateDrawPreview(code, adminPin);

            console.log('📦 Réponse API generateDrawPreview:', data);  // ✅ DEBUG
            console.log('📊 data.assignments:', data.assignments);  // ✅ DEBUG

            if (data.success) {
                if (!data.assignments || data.assignments.length === 0) {
                    console.error('❌ Assignments est vide ou undefined:', data);  // ✅ DEBUG
                    setError('Aucun tirage généré. Vérifiez les conditions.');
                    setLoading(false);
                    return;
                }

                console.log('✅ Tirage reçu, nombre d\'assignments:', data.assignments.length);  // ✅ DEBUG
                setDrawResult(data.assignments);
                setSuccess('✅ Tirage effectué avec succès !');
            } else {
                console.error('❌ API a retourné success: false -', data.message);  // ✅ DEBUG
                setError(data.message);
            }
        } catch (err) {
            console.error('❌ Erreur catch lors du tirage:', err);  // ✅ DEBUG
            setError('Erreur lors du tirage. Vérifiez que le backend est en marche.');
        } finally {
            setLoading(false);
        }
    }, [code, adminPin]);

    useEffect(() => {
        if (code && adminPin && !showPinPrompt) {
            performDrawAction();
        }
    }, [code, adminPin, showPinPrompt, performDrawAction]);

    const handlePinSubmit = (e) => {
        e.preventDefault();
        if (adminPin.length === 4) {
            setShowPinPrompt(false);
        }
    };

    const handleSendEmails = async () => {
        if (!drawResult || drawResult.length === 0) {
            setError('Aucun tirage à envoyer par email.');
            return;
        }

        setSendingEmails(true);
        setError('');
        setSuccess('');

        try {
            const data = await sendDraw(code, adminPin);  // ✅ Nom correct
            if (data.success) {
                setSuccess(`✅ ${data.emailsSent} emails envoyés avec succès ! 🎉`);
            } else {
                setError(data.message);
            }
        } catch (err) {
            setError('Erreur lors de l\'envoi des emails. Vérifiez que la configuration SMTP est correcte.');
        } finally {
            setSendingEmails(false);
        }
    };

    const handleRedraw = () => {
        setDrawResult(null);
        setSuccess('');
        setError('');
        performDrawAction();
    };

    if (showPinPrompt) {
        return (
            <>
                <header>
                    <h1>🔐 Accès Administrateur</h1>
                    <p>Entrez votre code PIN pour effectuer le tirage</p>
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
                                />
                            </div>

                            <button
                                type="submit"
                                className="primary"
                                style={{ width: '100%', marginTop: '20px' }}
                            >
                                🔓 Continuer
                            </button>
                        </form>

                        <button
                            onClick={() => navigate(`/admin/${code}`)}
                            style={{
                                width: '100%',
                                marginTop: '10px',
                                background: '#6c757d',
                                color: 'white'
                            }}
                        >
                            ← Retour au Dashboard
                        </button>
                    </div>
                </main>
            </>
        );
    }

    if (loading) {
        return (
            <>
                <header>
                    <h1>🎲 Tirage en cours...</h1>
                    <p>Veuillez patienter</p>
                </header>
            </>
        );
    }

    return (
        <>
            <header>
                <h1>🎁 Résultat du Tirage</h1>
                <p>Code de la fête : {code}</p>
            </header>

            <main className="container">
                {/* Messages */}
                {error && <div className="alert alert-error">{error}</div>}
                {success && <div className="alert alert-success">{success}</div>}

                {/* Résultat du Tirage */}
                {drawResult && drawResult.length > 0 && (
                    <>
                        <div className="card">
                            <h2>🎯 Aperçu du Tirage</h2>
                            <p style={{ color: 'rgba(255, 255, 255, 0.7)', marginBottom: '20px' }}>
                                Voici qui offre à qui. Ces informations seront envoyées par email individuellement.
                            </p>

                            <div style={{ marginTop: '20px' }}>
                                {drawResult.map((assignment, index) => (
                                    <div
                                        key={index}
                                        style={{
                                            background: 'rgba(255, 255, 255, 0.05)',
                                            padding: '15px',
                                            borderRadius: '10px',
                                            marginBottom: '10px',
                                            border: '1px solid rgba(255, 255, 255, 0.1)'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flexWrap: 'wrap' }}>
                                            <div style={{ flex: 1, minWidth: '200px' }}>
                                                <strong style={{ color: 'var(--christmas-red)' }}>
                                                    {assignment.giver.name}
                                                </strong>
                                                <p style={{ fontSize: '0.9rem', opacity: 0.7, margin: '5px 0 0 0' }}>
                                                    Famille {assignment.giver.familyGroup}
                                                </p>
                                            </div>

                                            <div style={{ fontSize: '1.5rem' }}>
                                                🎁 →
                                            </div>

                                            <div style={{ flex: 1, minWidth: '200px' }}>
                                                <strong style={{ color: 'var(--christmas-green)' }}>
                                                    {assignment.receiver.name}
                                                </strong>
                                                <p style={{ fontSize: '0.9rem', opacity: 0.7, margin: '5px 0 0 0' }}>
                                                    Famille {assignment.receiver.familyGroup}
                                                </p>
                                                {assignment.receiver.wishList && assignment.receiver.wishList.length > 0 && (
                                                    <p style={{ fontSize: '0.85rem', marginTop: '8px', color: 'var(--christmas-gold)' }}>
                                                        💡 Souhaits : {assignment.receiver.wishList.join(', ')}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="card">
                            <h2>📧 Envoi des Emails</h2>
                            <p style={{ color: 'rgba(255, 255, 255, 0.7)', marginBottom: '20px' }}>
                                Chaque participant recevra un email avec le nom de la personne à qui offrir un cadeau.
                            </p>

                            <div className="alert alert-info">
                                ⚠️ Assurez-vous que les informations ci-dessus sont correctes avant d'envoyer les emails !
                            </div>

                            <div style={{ display: 'flex', gap: '10px', marginTop: '20px', flexWrap: 'wrap' }}>
                                <button
                                    className="primary"
                                    onClick={handleSendEmails}
                                    disabled={sendingEmails}
                                    style={{ flex: 1 }}
                                >
                                    {sendingEmails ? '📤 Envoi en cours...' : '📧 Envoyer les Emails'}
                                </button>

                                <button
                                    className="secondary"
                                    onClick={handleRedraw}
                                    disabled={sendingEmails}
                                    style={{ flex: 1 }}
                                >
                                    🔄 Refaire le Tirage
                                </button>
                            </div>

                            <button
                                onClick={() => navigate(`/admin/${code}`, { state: { adminPin } })}
                                style={{
                                    width: '100%',
                                    marginTop: '10px',
                                    background: '#6c757d',
                                    color: 'white'
                                }}
                            >
                                ← Retour au Dashboard
                            </button>
                        </div>
                    </>
                )}

                {/* Aucun résultat */}
                {!drawResult && !loading && (
                    <div className="card">
                        <div className="alert alert-error">
                            Impossible d'effectuer le tirage. Retournez au dashboard pour vérifier les conditions.
                        </div>
                        <button
                            onClick={() => navigate(`/admin/${code}`, { state: { adminPin } })}
                            style={{
                                width: '100%',
                                marginTop: '20px',
                                background: '#6c757d',
                                color: 'white'
                            }}
                        >
                            ← Retour au Dashboard
                        </button>
                    </div>
                )}
            </main>
        </>
    );
}