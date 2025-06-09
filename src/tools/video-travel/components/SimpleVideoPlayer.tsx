import React, { useRef, useState, useEffect } from 'react';
import { Button } from '@/shared/components/ui/button';
import { getDisplayUrl } from '@/shared/lib/utils';

interface SimpleVideoPlayerProps {
  src: string;
  poster?: string;
  className?: string;
}

const SimpleVideoPlayer: React.FC<SimpleVideoPlayerProps> = ({
  src,
  poster,
  className = '',
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);

  const speedOptions = [0.5, 1, 1.5, 2];

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    
    // Auto-play when component mounts
    const handleLoadedData = () => {
      video.play().catch(error => {
        console.log('Auto-play was prevented:', error);
        // Auto-play was prevented, user will need to click play
      });
    };

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('loadeddata', handleLoadedData);

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('loadeddata', handleLoadedData);
    };
  }, []);

  const handleSpeedChange = (speed: number) => {
    const video = videoRef.current;
    if (!video) return;

    video.playbackRate = speed;
    setPlaybackRate(speed);
  };

  return (
    <div className={`flex flex-col items-center space-y-4 ${className}`}>
      <video
        ref={videoRef}
        src={getDisplayUrl(src)}
        poster={poster ? getDisplayUrl(poster) : undefined}
        controls
        loop
        muted
        playsInline
        autoPlay
        preload="auto"
        className="w-full h-full object-contain"
      >
        Your browser does not support the video tag.
      </video>
      
      <div className="flex items-center space-x-2">
        {speedOptions.map((speed) => (
          <Button
            key={speed}
            variant={playbackRate === speed ? "default" : "outline"}
            size="sm"
            onClick={() => handleSpeedChange(speed)}
            className="min-w-[60px]"
          >
            {speed}x
          </Button>
        ))}
      </div>
    </div>
  );
};

export default SimpleVideoPlayer; 