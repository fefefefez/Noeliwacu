export default function Footer() {
    return (
        <footer style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '12px 20px',
            background: 'rgba(0, 0, 0, 0.4)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            textAlign: 'center',
            fontSize: '0.85rem',
            color: 'rgba(255, 255, 255, 0.8)',
            zIndex: 100,
            boxShadow: '0 -8px 32px rgba(0, 0, 0, 0.3)',
            transition: 'all 0.3s ease'
        }}>
            <div style={{
                maxWidth: '1200px',
                margin: '0 auto',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '15px',
                flexWrap: 'wrap'
            }}>
                <span>
                    Made with ❤️ by{' '}
                    <strong style={{
                        color: '#fff',
                        textShadow: '0 0 10px rgba(255, 255, 255, 0.5)',
                        fontSize: '0.95rem'
                    }}>
                        Ruremesha Fernand
                    </strong>
                </span>

                <span style={{ opacity: 0.5 }}>•</span>

                <span>🎅 Secret Santa V2.0</span>

                <span style={{ opacity: 0.5 }}>•</span>

                <span>© {new Date().getFullYear()}</span>

                <span style={{ opacity: 0.5 }}>•</span>

                <a
                    href="mailto:fefefefez.school@gmail.com"
                    style={{
                        color: 'rgba(255, 255, 255, 0.8)',
                        textDecoration: 'none',
                        transition: 'color 0.3s'
                    }}
                    onMouseEnter={(e) => e.target.style.color = '#fff'}
                    onMouseLeave={(e) => e.target.style.color = 'rgba(255, 255, 255, 0.8)'}
                >
                    📧 Contact
                </a>
            </div>
        </footer>
    );
}