import { useEffect } from 'react';

export default function Alert({ type = 'info', message, onClose, autoClose = false, autoCloseDuration = 5000 }) {
    useEffect(() => {
        if (autoClose && message) {
            const timer = setTimeout(() => {
                onClose?.();
            }, autoCloseDuration);
            return () => clearTimeout(timer);
        }
    }, [autoClose, message, onClose, autoCloseDuration]);

    if (!message) return null;

    const styles = {
        error: {
            background: 'linear-gradient(135deg, rgba(220, 38, 38, 0.15) 0%, rgba(153, 27, 27, 0.15) 100%)',
            backdropFilter: 'blur(10px)',
            borderLeft: '4px solid #dc2626',
            color: '#fca5a5',
            boxShadow: '0 8px 32px rgba(220, 38, 38, 0.2)'
        },
        success: {
            background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.15) 0%, rgba(21, 128, 61, 0.15) 100%)',
            backdropFilter: 'blur(10px)',
            borderLeft: '4px solid #22c55e',
            color: '#86efac',
            boxShadow: '0 8px 32px rgba(34, 197, 94, 0.2)'
        },
        warning: {
            background: 'linear-gradient(135deg, rgba(234, 179, 8, 0.15) 0%, rgba(161, 98, 7, 0.15) 100%)',
            backdropFilter: 'blur(10px)',
            borderLeft: '4px solid #eab308',
            color: '#fde047',
            boxShadow: '0 8px 32px rgba(234, 179, 8, 0.2)'
        },
        info: {
            background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(29, 78, 216, 0.15) 100%)',
            backdropFilter: 'blur(10px)',
            borderLeft: '4px solid #3b82f6',
            color: '#93c5fd',
            boxShadow: '0 8px 32px rgba(59, 130, 246, 0.2)'
        }
    };

    const icons = {
        error: '❌',
        success: '✅',
        warning: '⚠️',
        info: 'ℹ️'
    };

    return (
        <div
            style={{
                ...styles[type],
                padding: '15px 50px 15px 15px',
                borderRadius: '12px',
                marginTop: '20px',
                position: 'relative',
                fontSize: '0.95rem',
                lineHeight: '1.6',
                animation: 'slideInDown 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
                border: '1px solid rgba(255, 255, 255, 0.1)'
            }}
            role="alert"
        >
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '1.2rem', marginRight: '10px', flexShrink: 0 }}>
                    {icons[type]}
                </span>
                <span style={{ flex: 1 }}>{message}</span>
            </div>

            {onClose && (
                <button
                    onClick={onClose}
                    style={{
                        position: 'absolute',
                        top: '15px',
                        right: '15px',
                        background: 'rgba(255, 255, 255, 0.15)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        borderRadius: '6px',
                        width: '28px',
                        height: '28px',
                        cursor: 'pointer',
                        fontSize: '14px',
                        color: 'inherit',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.2s',
                        opacity: 0.7
                    }}
                    onMouseEnter={(e) => {
                        e.target.style.background = 'rgba(255, 255, 255, 0.25)';
                        e.target.style.opacity = '1';
                        e.target.style.transform = 'scale(1.1)';
                    }}
                    onMouseLeave={(e) => {
                        e.target.style.background = 'rgba(255, 255, 255, 0.15)';
                        e.target.style.opacity = '0.7';
                        e.target.style.transform = 'scale(1)';
                    }}
                    aria-label="Fermer"
                >
                    ✕
                </button>
            )}
        </div>
    );
}