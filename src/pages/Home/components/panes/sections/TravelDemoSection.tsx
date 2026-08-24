import React from 'react';
import { cn } from '@/shared/components/ui/contracts/cn';
import { getThumbPath } from '../../motion/VideoWithPoster';
import { TravelSelector } from '../../motion/TravelSelector';
import {
  PLACEHOLDER_MEDIA,
  type PhilosophyAutoAdvance,
  type PhilosophyExampleStyle,
  type PhilosophyTravelExample,
} from './philosophyTypes';

const Skeleton = ({ className }: { className?: string }) => (
  <div className={cn('animate-pulse bg-muted/50 rounded', className)} />
);

interface TravelVideoCardSource {
  videoSrc: string;
  posterSrc: string;
  videoKey?: string;
  preload?: 'auto' | 'metadata';
  crossOrigin?: 'anonymous' | 'use-credentials';
  disableRemotePlayback?: boolean;
}

interface TravelVideoCardPlayback {
  isEnded: boolean;
  isPlayed: boolean;
  isPosterLoaded: boolean;
  onPosterLoad: () => void;
  onPlay: () => void;
  onTimeUpdate: (video: HTMLVideoElement) => void;
  onEnded: () => void;
}

interface TravelVideoCardProps {
  containerClassName: string;
  videoRef: (el: HTMLVideoElement | null) => void;
  source: TravelVideoCardSource;
  playback: TravelVideoCardPlayback;
  playButtonClassName?: string;
}

function TravelVideoCard({
  containerClassName,
  videoRef,
  source,
  playback,
  playButtonClassName,
}: TravelVideoCardProps) {
  const {
    videoSrc,
    posterSrc,
    videoKey,
    preload = 'metadata',
    crossOrigin,
    disableRemotePlayback,
  } = source;
  const {
    isEnded,
    isPlayed,
    isPosterLoaded,
    onPosterLoad,
    onPlay,
    onTimeUpdate,
    onEnded,
  } = playback;

  return (
    <div
      className={containerClassName}
      style={{ transform: 'translateZ(0)', willChange: 'transform' }}
    >
      <video
        key={videoKey}
        ref={videoRef}
        src={videoSrc}
        muted
        playsInline
        preload={preload}
        {...(crossOrigin ? { crossOrigin } : {})}
        {...(disableRemotePlayback ? { disableRemotePlayback: true } : {})}
        className="w-full h-full object-cover"
        onTimeUpdate={(event) => onTimeUpdate(event.currentTarget)}
        onEnded={onEnded}
      />
      <img
        src={getThumbPath(posterSrc)}
        alt=""
        className={cn(
          'absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-300',
          (!isEnded || isPlayed) && 'opacity-0',
        )}
      />
      <img
        src={posterSrc}
        alt=""
        onLoad={onPosterLoad}
        className={cn(
          'absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-300',
          (!isEnded || isPlayed || !isPosterLoaded) && 'opacity-0',
        )}
      />
      <button
        onClick={onPlay}
        className={cn(
          'absolute inset-0 bg-black/40 flex items-center justify-center text-white hover:bg-black/50 transition-all duration-300',
          isEnded ? 'opacity-100' : 'opacity-0 pointer-events-none',
          playButtonClassName,
        )}
      >
        <svg className="w-8 h-8 sm:w-12 sm:h-12" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
      </button>
    </div>
  );
}

interface TravelDemoSectionProps {
  currentExample: PhilosophyExampleStyle;
  selectedExampleStyle: string;
  travelExamples: PhilosophyTravelExample[];
  selectedTravelExample: number;
  autoAdvance: PhilosophyAutoAdvance;
  loadedImages: Set<string>;
  philosophyVideoRef: React.MutableRefObject<HTMLVideoElement | null>;
  travelVideoRefs: React.MutableRefObject<Array<HTMLVideoElement | null>>;
  handleImageLoad: (src: string) => void;
  handleImageRef: (img: HTMLImageElement | null, src: string) => void;
  handleSelectExample: (idx: number) => void;
  handleVideoTimeUpdate: (idx: number, video: HTMLVideoElement) => void;
  handleTravelVideoEnded: (idx: number) => void;
  playTravelVideo: (idx: number) => void;
}

export function TravelDemoSection({
  currentExample,
  selectedExampleStyle,
  travelExamples,
  selectedTravelExample,
  autoAdvance,
  loadedImages,
  philosophyVideoRef,
  travelVideoRefs,
  handleImageLoad,
  handleImageRef,
  handleSelectExample,
  handleVideoTimeUpdate,
  handleTravelVideoEnded,
  playTravelVideo,
}: TravelDemoSectionProps) {
  return (
    <div className="space-y-2 !mt-4 mb-4">
      <div className="flex gap-4 items-center justify-center h-[210px] sm:h-[264px]">
        {(() => {
          const images = selectedTravelExample === 0
            ? [currentExample.image1, currentExample.image2]
            : travelExamples[selectedTravelExample].images;
          const imageCount = images.length;

          if (imageCount === 2) {
            return (
              <div className="flex flex-col gap-2">
                {images.map((img, idx) => {
                  const imgSrc = selectedTravelExample === 0 ? img : PLACEHOLDER_MEDIA;
                  return (
                    <div key={idx} className="w-20 h-20 sm:w-32 sm:h-32 flex-shrink-0 relative">
                      {!loadedImages.has(imgSrc) && <Skeleton className="absolute inset-0 rounded-lg" />}
                      <img
                        ref={(imgEl) => handleImageRef(imgEl, imgSrc)}
                        src={imgSrc}
                        alt={`Input image ${idx + 1}`}
                        className={cn(
                          'w-full h-full object-cover border rounded-lg transition-opacity duration-300',
                          !loadedImages.has(imgSrc) && 'opacity-0',
                        )}
                        onLoad={() => handleImageLoad(imgSrc)}
                      />
                    </div>
                  );
                })}
              </div>
            );
          }

          if (imageCount === 7) {
            const example = travelExamples[selectedTravelExample];
            return (
              <div className="flex flex-col gap-2 items-center justify-end h-full">
                <div className="flex gap-1">
                  {images.map((img, idx) => (
                    <div
                      key={idx}
                      className="w-[40px] h-[30px] sm:w-[56px] sm:h-[42px] flex-shrink-0 overflow-hidden rounded border relative"
                    >
                      <img
                        src={getThumbPath(img)}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                      <img
                        ref={(imgEl) => handleImageRef(imgEl, img)}
                        src={img}
                        alt={`Input image ${idx + 1}`}
                        className={cn(
                          'absolute inset-0 w-full h-full object-cover transition-opacity duration-300',
                          !loadedImages.has(img) && 'opacity-0',
                        )}
                        onLoad={() => handleImageLoad(img)}
                      />
                    </div>
                  ))}
                </div>
                <TravelVideoCard
                  containerClassName="w-[240px] h-[172px] sm:w-[296px] sm:h-[212px] flex-shrink-0 relative overflow-hidden rounded-lg border"
                  videoRef={(el) => {
                    travelVideoRefs.current[2] = el;
                  }}
                  source={{
                    videoSrc: example.video,
                    posterSrc: example.poster,
                  }}
                  playback={{
                    isEnded: autoAdvance.videoEnded.has(2),
                    isPlayed: autoAdvance.videoPlayed.has(2),
                    isPosterLoaded: loadedImages.has(example.poster),
                    onPosterLoad: () => handleImageLoad(example.poster),
                    onPlay: () => playTravelVideo(2),
                    onTimeUpdate: (video) => handleVideoTimeUpdate(2, video),
                    onEnded: () => handleTravelVideoEnded(2),
                  }}
                />
              </div>
            );
          }

          if (imageCount === 4) {
            const example = travelExamples[selectedTravelExample];
            return (
              <div className="flex gap-2 items-center">
                <div className="grid grid-cols-2 gap-1">
                  {images.map((img, idx) => (
                    <div
                      key={idx}
                      className="w-[42px] h-[75px] sm:w-[73px] sm:h-[130px] flex-shrink-0 overflow-hidden rounded-lg border relative"
                    >
                      <img
                        src={getThumbPath(img)}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                      <img
                        ref={(imgEl) => handleImageRef(imgEl, img)}
                        src={img}
                        alt={`Input image ${idx + 1}`}
                        className={cn(
                          'absolute inset-0 w-full h-full object-cover transition-opacity duration-300',
                          !loadedImages.has(img) && 'opacity-0',
                        )}
                        onLoad={() => handleImageLoad(img)}
                      />
                    </div>
                  ))}
                </div>
                <TravelVideoCard
                  containerClassName="w-[117px] h-[208px] sm:w-[148px] sm:h-[264px] flex-shrink-0 relative overflow-hidden rounded-lg border"
                  videoRef={(el) => {
                    travelVideoRefs.current[1] = el;
                  }}
                  source={{
                    videoSrc: example.video,
                    posterSrc: example.poster,
                  }}
                  playback={{
                    isEnded: autoAdvance.videoEnded.has(1),
                    isPlayed: autoAdvance.videoPlayed.has(1),
                    isPosterLoaded: loadedImages.has(example.poster),
                    onPosterLoad: () => handleImageLoad(example.poster),
                    onPlay: () => playTravelVideo(1),
                    onTimeUpdate: (video) => handleVideoTimeUpdate(1, video),
                    onEnded: () => handleTravelVideoEnded(1),
                  }}
                  playButtonClassName="rounded-lg"
                />
              </div>
            );
          }

          return null;
        })()}

        {selectedTravelExample === 0 && (
          <TravelVideoCard
            containerClassName="w-[168px] h-[168px] sm:w-[264px] sm:h-[264px] flex-shrink-0 relative overflow-hidden rounded-lg border"
            videoRef={(video) => {
              philosophyVideoRef.current = video;
              travelVideoRefs.current[0] = video;
            }}
            source={{
              videoKey: selectedExampleStyle,
              videoSrc: currentExample.video,
              posterSrc: currentExample.image1,
              preload: 'auto',
              crossOrigin: 'anonymous',
              disableRemotePlayback: true,
            }}
            playback={{
              isEnded: autoAdvance.videoEnded.has(0),
              isPlayed: autoAdvance.videoPlayed.has(0),
              isPosterLoaded: loadedImages.has(currentExample.image1),
              onPosterLoad: () => handleImageLoad(currentExample.image1),
              onPlay: () => playTravelVideo(0),
              onTimeUpdate: (video) => handleVideoTimeUpdate(0, video),
              onEnded: () => handleTravelVideoEnded(0),
            }}
          />
        )}
      </div>

      <TravelSelector
        examples={travelExamples}
        selectedIndex={selectedTravelExample}
        onSelect={handleSelectExample}
        nextAdvanceIdx={autoAdvance.nextAdvanceIdx}
        prevAdvanceIdx={autoAdvance.prevAdvanceIdx}
        drainingIdx={autoAdvance.drainingIdx}
        videoProgress={autoAdvance.videoProgress}
        videoEnded={autoAdvance.videoEnded}
        loadedImages={loadedImages}
        onImageLoad={handleImageLoad}
        twoImageImages={[currentExample.image1, currentExample.image2]}
      />
    </div>
  );
}
