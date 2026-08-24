import React from 'react';
import { cn } from '@/shared/components/ui/contracts/cn';
import { getThumbPath } from '../../motion/VideoWithPoster';

const Skeleton = ({ className }: { className?: string }) => (
  <div className={cn('animate-pulse bg-muted/50 rounded', className)} />
);

interface LoraStyleSectionProps {
  loraPlaying: boolean;
  loadedImages: Set<string>;
  loadedVideos: Set<string>;
  loraVideosRef: React.MutableRefObject<Array<HTMLVideoElement | null>>;
  handleImageLoad: (src: string) => void;
  handleImageRef: (img: HTMLImageElement | null, src: string) => void;
  handleVideoLoad: (src: string) => void;
  handleLoraVideoEnded: () => void;
  toggleLoraPlay: () => void;
}

export function LoraStyleSection({
  loraPlaying,
  loadedImages,
  loadedVideos,
  loraVideosRef,
  handleImageLoad,
  handleImageRef,
  handleVideoLoad,
  handleLoraVideoEnded,
  toggleLoraPlay,
}: LoraStyleSectionProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm leading-7">
        You can also combine community-trained LoRAs to <span className="text-wes-vintage-gold">craft a truly unique style of motion</span>:
      </p>

      <div className="flex gap-4 items-center">
        <div className="flex flex-col gap-2">
          <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] italic text-muted-foreground/60">starting</span>
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg overflow-hidden border border-muted/50 relative">
              <img
                src={getThumbPath('/lora-3.webp')}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
              />
              <img
                ref={(imgEl) => handleImageRef(imgEl, '/lora-3.webp')}
                src="/lora-3.webp"
                alt="starting image"
                className={cn(
                  'absolute inset-0 w-full h-full object-cover transition-opacity duration-300',
                  !loadedImages.has('/lora-3.webp') && 'opacity-0',
                )}
                onLoad={() => handleImageLoad('/lora-3.webp')}
              />
            </div>
          </div>
          <div className="flex flex-col items-center gap-1">
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg overflow-hidden border border-muted/50 relative">
              <img
                src={getThumbPath('/lora-4.webp')}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
              />
              <img
                ref={(imgEl) => handleImageRef(imgEl, '/lora-4.webp')}
                src="/lora-4.webp"
                alt="ending image"
                className={cn(
                  'absolute inset-0 w-full h-full object-cover transition-opacity duration-300',
                  !loadedImages.has('/lora-4.webp') && 'opacity-0',
                )}
                onLoad={() => handleImageLoad('/lora-4.webp')}
              />
            </div>
            <span className="text-[10px] italic text-muted-foreground/60">ending</span>
          </div>
        </div>

        <div className="flex-1 relative min-w-0">
          <div className="aspect-square bg-muted/30 rounded-lg border border-muted/50 overflow-hidden relative">
            {!loadedVideos.has('/lora-grid-pingpong.mp4') && <Skeleton className="absolute inset-0 z-0" />}
            <video
              ref={(el) => {
                if (el) {
                  loraVideosRef.current[0] = el;
                }
              }}
              src="/lora-grid-pingpong.mp4"
              muted
              playsInline
              preload="auto"
              onCanPlay={() => handleVideoLoad('/lora-grid-pingpong.mp4')}
              onEnded={handleLoraVideoEnded}
              className="w-full h-full object-cover"
            />
            <img
              src={getThumbPath('/lora-grid-combined-poster.jpg')}
              alt=""
              className={cn(
                'absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-300',
                loraPlaying ? 'opacity-0' : 'opacity-100',
              )}
            />
            <img
              ref={(imgEl) => handleImageRef(imgEl, '/lora-grid-combined-poster.jpg')}
              src="/lora-grid-combined-poster.jpg"
              alt=""
              onLoad={() => handleImageLoad('/lora-grid-combined-poster.jpg')}
              className={cn(
                'absolute inset-0 w-full h-full object-cover transition-opacity duration-300 pointer-events-none',
                loraPlaying || !loadedImages.has('/lora-grid-combined-poster.jpg') ? 'opacity-0' : 'opacity-100',
              )}
            />

            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-0 left-0 w-1/2 h-1/2">
                <span className="absolute bottom-0 right-0 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded-tl z-10 w-20 h-8 flex items-center justify-center text-center leading-tight">
                  slow motion explode
                </span>
              </div>
              <div className="absolute top-0 right-0 w-1/2 h-1/2">
                <span className="absolute bottom-0 left-0 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded-tr z-10 w-20 h-8 flex items-center justify-center text-center leading-tight">
                  animatediff
                </span>
              </div>
              <div className="absolute bottom-0 left-0 w-1/2 h-1/2">
                <span className="absolute top-0 right-0 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded-bl z-10 w-20 h-8 flex items-center justify-center text-center leading-tight">
                  water morphing
                </span>
              </div>
              <div className="absolute bottom-0 right-0 w-1/2 h-1/2">
                <span className="absolute top-0 left-0 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded-br z-10 w-20 h-8 flex items-center justify-center text-center leading-tight">
                  steampunk willy
                </span>
              </div>
            </div>
          </div>

          {!loraPlaying && (
            <button
              onClick={toggleLoraPlay}
              className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/40 rounded-lg transition-all duration-300 z-20 group"
            >
              <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm border border-white/50 flex items-center justify-center group-hover:scale-105 transition-transform">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </div>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
