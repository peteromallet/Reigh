import React, { useEffect, useState, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { X, ChevronLeft, ChevronRight, FlipHorizontal, Save } from 'lucide-react';
import { GenerationRow } from '@/types/shots';
import HoverScrubVideo from '@/shared/components/HoverScrubVideo';
import { getDisplayUrl } from '../lib/utils';
import { usePanes } from '@/shared/contexts/PanesContext';
import { Button } from '@/shared/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/components/ui/tooltip';
import { useToast } from '@/shared/hooks/use-toast';

interface MediaLightboxProps {
  media: GenerationRow;
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onImageSaved?: (newImageUrl: string) => void; // Callback when image is saved with changes
}

const isVideo = (media: GenerationRow): boolean => {
  const url = media.location || media.imageUrl;
  return url ? (url.toLowerCase().endsWith('.webm') || url.toLowerCase().endsWith('.mp4') || url.toLowerCase().endsWith('.mov')) : false;
};

const MediaLightbox: React.FC<MediaLightboxProps> = ({ media, onClose, onNext, onPrevious, onImageSaved }) => {
  const [isFlippedHorizontally, setIsFlippedHorizontally] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const { toast } = useToast();

  const { 
    isTasksPaneLocked, 
    tasksPaneWidth, 
    isShotsPaneLocked, 
    shotsPaneWidth, 
    isGenerationsPaneLocked, 
    generationsPaneHeight 
  } = usePanes();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onNext();
      if (e.key === 'ArrowLeft') onPrevious();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, onNext, onPrevious]);

  // Function to create a canvas with the flipped image
  const createFlippedCanvas = useCallback(async (): Promise<HTMLCanvasElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        canvas.width = img.width;
        canvas.height = img.height;

        // Apply horizontal flip if needed
        if (isFlippedHorizontally) {
          ctx.scale(-1, 1);
          ctx.drawImage(img, -img.width, 0);
        } else {
          ctx.drawImage(img, 0, 0);
        }

        resolve(canvas);
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = getDisplayUrl(media.imageUrl);
    });
  }, [media.imageUrl, isFlippedHorizontally]);

  const handleFlipHorizontal = () => {
    setIsFlippedHorizontally(!isFlippedHorizontally);
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!hasChanges) return;
    
    setIsSaving(true);
    try {
      const canvas = await createFlippedCanvas();
      
      // Convert canvas to blob
      canvas.toBlob(async (blob) => {
        if (!blob) {
          throw new Error('Failed to create image blob');
        }

        // Create a FormData object to send the file
        const formData = new FormData();
        const fileName = `flipped_${media.id || 'image'}_${Date.now()}.png`;
        const file = new File([blob], fileName, { type: 'image/png' });
        formData.append('file', file);

        try {
          // Send to your API endpoint to save the flipped image
          const response = await fetch('/api/upload-flipped-image', {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            throw new Error(`Failed to save image: ${response.status} ${response.statusText}`);
          }

          const result = await response.json();
          const newImageUrl = result.url || result.imageUrl;

          if (newImageUrl && onImageSaved) {
            onImageSaved(newImageUrl);
          }

          setHasChanges(false);
          toast({ 
            title: "Image Saved", 
            description: "Flipped image has been saved successfully",
          });
        } catch (error) {
          console.error('Error saving flipped image:', error);
          toast({ 
            title: "Save Failed", 
            description: "Could not save the flipped image",
            variant: "destructive"
          });
        }
      }, 'image/png');
    } catch (error) {
      console.error('Error creating flipped image:', error);
      toast({ 
        title: "Save Failed", 
        description: "Could not process the image",
        variant: "destructive"
      });
    } finally {
      setIsSaving(false);
    }
  };

  const modalStyle = {
    left: isShotsPaneLocked ? `${shotsPaneWidth}px` : '0px',
    right: isTasksPaneLocked ? `${tasksPaneWidth}px` : '0px',
    bottom: isGenerationsPaneLocked ? `${generationsPaneHeight}px` : '0px',
    top: '0px',
    transition: 'left 300ms ease-in-out, right 300ms ease-in-out, bottom 300ms ease-in-out',
  };

  const mediaIsVideo = isVideo(media);

  return ReactDOM.createPortal(
    <TooltipProvider>
      <div 
        className="fixed bg-black/80 flex items-center justify-center z-50 animate-in fade-in"
        style={modalStyle}
        onClick={onClose}
      >
        <button 
          onClick={(e) => { e.stopPropagation(); onPrevious(); }} 
          className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white transition-colors z-10 p-2 rounded-full bg-black/20 hover:bg-black/40"
          aria-label="Previous image"
        >
          <ChevronLeft size={40} />
        </button>

        <div 
          className="relative w-full max-w-5xl h-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {mediaIsVideo ? (
              <HoverScrubVideo
                  src={getDisplayUrl(media.location || media.imageUrl)}
                  poster={getDisplayUrl(media.thumbUrl)}
                  className="w-full h-full object-contain"
              />
          ) : (
              <img 
                  ref={imgRef}
                  src={getDisplayUrl(media.imageUrl)} 
                  alt={media.metadata?.prompt || 'Lightbox image'} 
                  className={`max-h-[90vh] w-full object-contain transition-transform duration-200 ${
                    isFlippedHorizontally ? 'scale-x-[-1]' : ''
                  }`}
              />
          )}

          {/* Image controls (only show for images, not videos) */}
          {!mediaIsVideo && (
            <div className="absolute bottom-4 left-4 flex items-center space-x-2">
              {/* Flip Horizontal Button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={`bg-black/50 hover:bg-black/70 text-white border-white/20 ${
                      isFlippedHorizontally ? 'bg-blue-600 border-blue-400' : ''
                    }`}
                    onClick={handleFlipHorizontal}
                  >
                    <FlipHorizontal className="h-4 w-4 mr-2" />
                    Flip
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top"><p>Flip Horizontally</p></TooltipContent>
              </Tooltip>

              {/* Save Button (only show when there are changes) */}
              {hasChanges && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="default"
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                      onClick={handleSave}
                      disabled={isSaving}
                    >
                      {isSaving ? (
                        <>
                          <div className="h-4 w-4 mr-2 animate-spin rounded-full border-b-2 border-current"></div>
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="h-4 w-4 mr-2" />
                          Save
                        </>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top"><p>Save Changes</p></TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
        </div>

        <button 
          onClick={(e) => { e.stopPropagation(); onNext(); }} 
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white transition-colors z-10 p-2 rounded-full bg-black/20 hover:bg-black/40"
          aria-label="Next image"
        >
          <ChevronRight size={40} />
        </button>

        <button 
          onClick={onClose} 
          className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
          aria-label="Close lightbox"
        >
          <X size={32} />
        </button>
      </div>
    </TooltipProvider>,
    document.body
  );
};

export default MediaLightbox; 