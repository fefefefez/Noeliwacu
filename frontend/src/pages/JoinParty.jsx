import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { addParticipant, getParty } from "../services/api";
import Alert from "../components/Alert";

export default function JoinParty() {
    const navigate = useNavigate();
    const { code } = useParams();
    const [partyCode, setPartyCode] = useState(code || '');
    const [partyInfo, setPartyInfo] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        familyGroup: '',
        wishList: ['', '', '']
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const loadPartyInfo = useCallback(async () => {
        try {
            const data = await getParty(partyCode);
            if (data.success) {
                setPartyInfo(data.party);
                setError('');
            } else {
                setError(data.message);
                setPartyInfo(null);
            }
        } catch (err) {
            setError('Erreur lors du chargement de la fête');
        }
    }, [partyCode]);

    useEffect(() => {
        if (partyCode && partyCode.length === 6) {
            loadPartyInfo();
        }
    }, [partyCode, loadPartyInfo]);

    const handleWishListChange = (index, value) => {
        const newWishList = [...formData.wishList];
        newWishList[index] = value;
        setFormData({ ...formData, wishList: newWishList });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        setLoading(true);

        if (!partyInfo) {
            setError('Veuillez entrer un code de fête valide');
            setLoading(false);
            return;
        }

        try {
            const data = await addParticipant(partyCode, {
                name: formData.name,
                email: formData.email,
                familyGroup: formData.familyGroup,
                wishList: formData.wishList.filter(w => w.trim() !== '')
            });

            if (data.success) {
                setSuccess(' Vous avez rejoint la fête avec succès ! Vous recevrez un email une fois le tirage effectué.');
                setFormData({
                    name: '',
                    email: '',
                    familyGroup: '',
                    wishList: ['', '', '']
                });
            } else {
                setError(data.message);
            }
        } catch (err) {
            setError(err.message || 'Erreur lors de l\'inscription. Veuillez réessayer.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <header>
                <h1>🎁 Rejoindre une Fête</h1>
                <p>Entrez le code de la fête pour participer</p>
            </header>

            <main className="container">
                <div className="card" style={{ maxWidth: '600px', margin: '40px auto' }}>
                    {/* Étape 1 : Entrer le code */}
                    <div>
                        <label>Party Code *</label>
                        <input
                            type="text"
                            placeholder="ABC123"
                            value={partyCode}
                            onChange={(e) => setPartyCode(e.target.value.toUpperCase())}
                            maxLength={6}
                            style={{ textTransform: 'uppercase', margin: 0 }}
                        />
                        {partyCode.length === 6 && !partyInfo && (
                            <button
                                onClick={loadPartyInfo}
                                className="secondary"
                                style={{ width: '100%', marginTop: '10px' }}
                            >
                                🔍 Vérifier le Code
                            </button>
                        )}
                    </div>

                    {/* Info de la party */}
                    {partyInfo && (
                        <div className="alert alert-success" style={{ marginTop: '20px' }}>
                            <h3 style={{ margin: 0, marginBottom: '10px' }}>🎄 {partyInfo.name}</h3>
                            {partyInfo.budget && <p style={{ margin: '5px 0' }}>💰 Budget : {partyInfo.budget}€</p>}
                            {partyInfo.date && <p style={{ margin: '5px 0' }}>📅 Date : {new Date(partyInfo.date).toLocaleDateString('fr-FR')}</p>}
                        </div>
                    )}

                    {/* Formulaire d'inscription */}
                    {partyInfo && (
                        <form onSubmit={handleSubmit} style={{ marginTop: '30px' }}>
                            <div>
                                <label>Votre Nom *</label>
                                <input
                                    type="text"
                                    placeholder="ex: Jean Bagabo"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    required
                                />
                                <small style={{
                                    color: 'rgba(255, 255, 255, 0.6)',
                                    fontSize: '0.85rem',
                                    display: 'block',
                                    marginTop: '5px'
                                }}>
                                    Lettres, espaces, accents et traits d'union uniquement (pas de chiffres)
                                </small>
                            </div>

                            <div>
                                <label>Votre Email *</label>
                                <input
                                    type="email"
                                    placeholder="ex: jean@exemple.com"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    required
                                />
                                <small style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.85rem', display: 'block', marginTop: '5px' }}>
                                    Vous recevrez votre Secret Santa ici
                                </small>
                            </div>

                            <div>
                                <label>Votre Famille *</label>
                                <select
                                    value={formData.familyGroup}
                                    onChange={(e) => setFormData({ ...formData, familyGroup: e.target.value })}
                                    required
                                    style={{ color: 'white' }}
                                >
                                    <option value="" style={{ color: 'rgba(255, 255, 255, 0.7)', backgroundColor: 'rgba(30, 30, 30, 0.95)', padding: '10px' }}>
                                        Sélectionnez votre famille
                                    </option>
                                    {partyInfo.families.map((family) => (
                                        <option key={family} value={family} style={{ color: 'white', backgroundColor: 'rgba(30, 30, 30, 0.95)', padding: '10px' }}>
                                            {family}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div style={{ marginTop: '20px' }}>
                                <label>Wishlist (optionnel - max 3 articles)</label>
                                <small style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.85rem', display: 'block', marginBottom: '10px' }}>
                                    Aidez votre Secret Santa à choisir le cadeau parfait !
                                </small>
                                {formData.wishList.map((wish, index) => (
                                    <input
                                        key={index}
                                        type="text"
                                        placeholder={`Idée cadeau ${index + 1}`}
                                        value={wish}
                                        onChange={(e) => handleWishListChange(index, e.target.value)}
                                    />
                                ))}
                            </div>

                            {/* ✅ ALERTES INTÉGRÉES DANS LE FORMULAIRE */}
                            <Alert
                                type="error"
                                message={error}
                                onClose={() => setError('')}
                            />

                            <Alert
                                type="success"
                                message={success}
                                onClose={() => setSuccess('')}
                                autoClose={true}
                                autoCloseDuration={5000}
                            />

                            <button
                                type="submit"
                                className="primary"
                                disabled={loading}
                                style={{ width: '100%', marginTop: '20px' }}
                            >
                                {loading ? 'Inscription en cours...' : '🎁 Rejoindre Secret Santa'}
                            </button>
                        </form>
                    )}

                    <button
                        onClick={() => navigate('/')}
                        style={{ width: '100%', marginTop: '10px', background: '#6c757d', color: 'white' }}
                    >
                        ← Retour à l'accueil
                    </button>
                </div>
            </main>
        </>
    );
}