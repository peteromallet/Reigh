import React, { useState, useEffect, useRef } from 'react';

interface TrailPoint {
  x: number;
  y: number;
  opacity: number;
  id: number;
}

/**
 * Title text with a gold spotlight effect that follows the mouse cursor,
 * leaving a fading trail of gold behind.
 */
export const GoldSpotlight: React.FC = () => {
  const [titleHover, setTitleHover] = useState({ x: 0, y: 0, active: false });
  const [goldTrail, setGoldTrail] = useState<TrailPoint[]>([]);
  const titleRef = useRef<HTMLDivElement>(null);
  const trailIdRef = useRef(0);

  // Handle mouse move over title for gold spotlight effect with trailing fade
  const handleTitleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!titleRef.current) return;
    const rect = titleRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setTitleHover({ x, y, active: true });

    // Add a trail point
    const newId = trailIdRef.current++;
    setGoldTrail(prev => [...prev, { x, y, opacity: 1, id: newId }]); // Points only removed when fully faded
  };

  const handleTitleMouseLeave = () => {
    setTitleHover(prev => ({ ...prev, active: false }));
  };

  // Fade out trail points over time
  useEffect(() => {
    if (goldTrail.length === 0) return;

    const interval = setInterval(() => {
      setGoldTrail(prev =>
        prev
          .map(point => ({ ...point, opacity: point.opacity - 0.008 }))
          .filter(point => point.opacity > 0)
      );
    }, 50);

    return () => clearInterval(interval);
  }, [goldTrail.length]);  

  return (
    <div
      ref={titleRef}
      className="relative inline-block cursor-default"
      onMouseMove={handleTitleMouseMove}
      onMouseLeave={handleTitleMouseLeave}
    >
      {/* Base text */}
      <h1 className="text-8xl md:text-[10rem] text-[#ecede3] mb-0 leading-tight select-none">
        Samstag
      </h1>
      {/* Gold trail - fading spots where cursor has been */}
      {goldTrail.map(point => (
        <h1
          key={point.id}
          className="absolute inset-0 text-8xl md:text-[10rem] mb-0 leading-tight select-none pointer-events-none text-amber-400"
          style={{
            opacity: point.opacity,
            filter: 'blur(0.4px)',
            maskImage: `radial-gradient(circle 80px at ${point.x}px ${point.y}px, black 0%, black 30%, rgba(0,0,0,0.7) 50%, rgba(0,0,0,0.3) 70%, transparent 100%)`,
            WebkitMaskImage: `radial-gradient(circle 80px at ${point.x}px ${point.y}px, black 0%, black 30%, rgba(0,0,0,0.7) 50%, rgba(0,0,0,0.3) 70%, transparent 100%)`,
          }}
          aria-hidden="true"
        >
          Samstag
        </h1>
      ))}
      {/* Current cursor spotlight - solid gold */}
      <h1
        className="absolute inset-0 text-8xl md:text-[10rem] mb-0 leading-tight select-none pointer-events-none text-amber-400"
        style={{
          opacity: titleHover.active ? 1 : 0,
          filter: 'blur(0.4px)',
          maskImage: `radial-gradient(circle 90px at ${titleHover.x}px ${titleHover.y}px, black 0%, black 30%, rgba(0,0,0,0.7) 50%, rgba(0,0,0,0.3) 70%, transparent 100%)`,
          WebkitMaskImage: `radial-gradient(circle 90px at ${titleHover.x}px ${titleHover.y}px, black 0%, black 30%, rgba(0,0,0,0.7) 50%, rgba(0,0,0,0.3) 70%, transparent 100%)`,
          transition: 'opacity 0.15s ease-out'
        }}
        aria-hidden="true"
      >
        Samstag
      </h1>
    </div>
  );
};
