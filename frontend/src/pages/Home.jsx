import { useNavigate } from 'react-router-dom';
import { useState } from 'react';

export default function Home() {
    const navigate = useNavigate();
    const [showAdminModal, setShowAdminModal] = useState(false);
    const [adminCode, setAdminCode] = useState('');

    const handleAdminAccess = () => {
        if (adminCode.trim().length === 6) {
            navigate(`/admin/${adminCode.toUpperCase()}`);
        }
    };

    return (
        <>
            <header>
                <h1>🎄 Noeli Iwacu Secret Santa V2.0 🎅</h1>
                <p>Organisons Secret Santa ensemble !</p>
            </header>

            <main className="container">
                <div className="card text-center" style={{ maxWidth: '600px', margin: '40px auto' }}>
                    <h2>🎁 Bienvenue ! Welcome to Secret Santa! 🎁</h2>

                    <p style={{ fontSize: '1.1rem', marginBottom: '30px', opacity: 0.9, lineHeight: '1.6' }}>
                        Choisissez votre action :
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                        <button
                            className="secondary"
                            onClick={() => navigate('/join')}
                            style={{ padding: '15px', fontSize: '1.1rem' }}
                        >
                            🎁 Rejoindre une fête
                        </button>

                        <button
                            className="primary"
                            onClick={() => navigate('/create-party')}
                            style={{ padding: '15px', fontSize: '1.1rem' }}
                        >
                            🎅 Organiser une fête
                        </button>

                        <button
                            className="admin-button"
                            onClick={() => setShowAdminModal(true)}
                        >
                            🔑 Accès Admin
                        </button>
                    </div>
                </div>

                {/* ✅ MODAL ADMIN ACCESS */}
                {showAdminModal && (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'rgba(0, 0, 0, 0.7)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 1000
                    }}>
                        <div className="card" style={{ maxWidth: '400px', margin: '20px' }}>
                            <h2>🔑 Accès Admin</h2>
                            <p style={{ marginBottom: '20px', opacity: 0.9, fontSize: '1rem' }}>
                                Entrez votre code de fête (6 lettres)
                            </p>

                            <input
                                type="text"
                                placeholder="Ex: ABC123"
                                value={adminCode}
                                onChange={(e) => setAdminCode(e.target.value.toUpperCase())}
                                maxLength={6}
                                style={{
                                    textTransform: 'uppercase',
                                    fontSize: '1.3rem',
                                    textAlign: 'center',
                                    letterSpacing: '3px',
                                    padding: '12px'
                                }}
                                onKeyPress={(e) => e.key === 'Enter' && handleAdminAccess()}
                            />

                            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                                <button
                                    onClick={() => setShowAdminModal(false)}
                                    style={{
                                        flex: 1,
                                        background: '#6c757d',
                                        color: 'white',
                                        padding: '12px'
                                    }}
                                >
                                    Annuler
                                </button>
                                <button
                                    className="primary"
                                    onClick={handleAdminAccess}
                                    disabled={adminCode.trim().length !== 6}
                                    style={{ flex: 1, padding: '12px' }}
                                >
                                    Accéder
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                <div className="card" style={{ maxWidth: '800px', margin: '40px auto' }}>
                    <h2 style={{ textAlign: 'center', marginBottom: '20px' }}>✨ Comment ça marche ?</h2>

                    <ol style={{ lineHeight: '2.2', fontSize: '1.05rem', paddingLeft: '25px' }}>
                        <li>
                            <strong>L'Admin crée une fête</strong> et partage le code avec la famille
                        </li>
                        <li>
                            <strong>Chacun rejoint</strong> en entrant le code et ses informations
                        </li>
                        <li>
                            <strong>L'Admin lance le tirage</strong> quand tout le monde a rejoint
                        </li>
                        <li>
                            <strong>Tout le monde reçoit un email</strong> avec le nom de son Secret Santa à gâter
                        </li>
                        <li>
                            <strong>On échange les cadeaux</strong> le jour J ! 🎉
                        </li>
                    </ol>
                </div>
            </main>
        </>
    );
}