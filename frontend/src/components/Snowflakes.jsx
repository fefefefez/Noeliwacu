import { useEffect, useState } from 'react';

export default function Snowflakes() {
    const [snowflakes, setSnowflakes] = useState([]);

    useEffect(() => {
        // Générer 20 flocons de neige avec des propriétés aléatoires
        const flakes = Array.from({ length: 20 }, (_, i) => ({
            id: i,
            left: Math.random() * 100,
            animationDuration: 5 + Math.random() * 10,
            opacity: 0.1 + Math.random() * 0.3,
            size: 3 + Math.random() * 6,
            delay: Math.random() * 5
        }));
        setSnowflakes(flakes);
    }, []);

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: -1,
            overflow: 'hidden',
            willChange: 'transform'
        }}>
            {snowflakes.map(flake => (
                <div
                    key={flake.id}
                    style={{
                        position: 'absolute',
                        top: '-20px',
                        left: `${flake.left}%`,
                        width: `${flake.size}px`,
                        height: `${flake.size}px`,
                        background: '#D0E0F9',
                        borderRadius: '50%',
                        opacity: flake.opacity,
                        animation: `fall ${flake.animationDuration}s linear infinite`,
                        animationDelay: `${flake.delay}s`,
                        boxShadow: '0 0 10px rgba(255, 255, 255, 0.5)',
                        willChange: 'transform'
                    }}
                />
            ))}

            <style>
                {`
                    @keyframes fall {
                        0% {
                            transform: translateY(0) rotate(0deg);
                        }
                        100% {
                            transform: translateY(100vh) rotate(360deg);
                        }
                    }
                `}
            </style>
        </div>
    );
}