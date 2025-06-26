import React, { useState, useRef, useCallback } from 'react';
import { Download, FlipHorizontal, Save } from 'lucide-react'; // Import FlipHorizontal and Save icons
import { Button } from "./button"; // Updated
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "./tooltip"; // Updated
import { useToast } from "@/shared/hooks/use-toast"; // Updated
import { usePanes } from "@/shared/contexts/PanesContext"; // Added


interface FullscreenImageModalProps {
  imageUrl: string | null;
  imageAlt?: string; // Optional alt text
  imageId?: string; // Optional image ID for download filename
  onClose: () => void;
  onImageSaved?: (newImageUrl: string) => void; // Callback when image is saved with changes
}

const FullscreenImageModal: React.FC<FullscreenImageModalProps> = ({ imageUrl, imageAlt, imageId, onClose, onImageSaved }) => {
  const [isDownloading, setIsDownloading] = useState(false); // State for download button loading
  const [isSaving, setIsSaving] = useState(false); // State for save button loading
  const [isFlippedHorizontally, setIsFlippedHorizontally] = useState(false); // State for horizontal flip
  const [hasChanges, setHasChanges] = useState(false); // State to track if there are unsaved changes
  const imgRef = useRef<HTMLImageElement>(null); // Reference to the image element
  const { toast } = useToast(); // Initialize useToast
  
  // Get pane state for positioning adjustments
  const { 
    isTasksPaneLocked, 
    tasksPaneWidth, 
    isShotsPaneLocked, 
    shotsPaneWidth, 
    isGenerationsPaneLocked, 
    generationsPaneHeight 
  } = usePanes();

  // Debug: Check if callback is provided
  console.log(`[FullscreenImageModal] Component initialized with:`, {
    imageId,
    imageUrl,
    hasOnImageSavedCallback: !!onImageSaved,
    onImageSavedType: typeof onImageSaved
  });

  if (!imageUrl) return null;

  const downloadFileName = `artful_pane_craft_fullscreen_${imageId || 'image'}_${Date.now()}.png`;

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
      img.src = imageUrl;
    });
  }, [imageUrl, isFlippedHorizontally]);

  const handleFlipHorizontal = () => {
    setIsFlippedHorizontally(!isFlippedHorizontally);
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!hasChanges) return;
    
    console.log(`[FlipSave] Starting save process for image:`, { imageId, imageUrl, isFlippedHorizontally });
    
    setIsSaving(true);
    try {
      console.log(`[FlipSave] Creating flipped canvas...`);
      const canvas = await createFlippedCanvas();
      console.log(`[FlipSave] Canvas created:`, { width: canvas.width, height: canvas.height });
      
      // Convert canvas to blob
      canvas.toBlob(async (blob) => {
        if (!blob) {
          console.error(`[FlipSave] ERROR: Failed to create image blob from canvas`);
          throw new Error('Failed to create image blob');
        }

        console.log(`[FlipSave] Blob created:`, { size: blob.size, type: blob.type });

        // Create a FormData object to send the file
        const formData = new FormData();
        const fileName = `flipped_${imageId || 'image'}_${Date.now()}.png`;
        const file = new File([blob], fileName, { type: 'image/png' });
        formData.append('file', file);

        console.log(`[FlipSave] Uploading file:`, { fileName, fileSize: file.size, fileType: file.type });

        try {
          // Send to your API endpoint to save the flipped image
          const response = await fetch('/api/upload-flipped-image', {
            method: 'POST',
            body: formData,
          });

          console.log(`[FlipSave] Upload response status:`, response.status, response.statusText);

          if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            console.error(`[FlipSave] Upload failed:`, { status: response.status, statusText: response.statusText, errorText });
            throw new Error(`Failed to save image: ${response.status} ${response.statusText}`);
          }

          const result = await response.json();
          console.log(`[FlipSave] Upload successful, server response:`, result);
          
          const newImageUrl = result.url || result.imageUrl;
          console.log(`[FlipSave] New image URL:`, newImageUrl);

          console.log(`[FlipSave] CRITICAL CHECK - About to call callback:`, {
            hasNewImageUrl: !!newImageUrl,
            hasOnImageSavedCallback: !!onImageSaved,
            newImageUrl: newImageUrl,
            callbackFunction: onImageSaved?.toString()
          });

          if (newImageUrl && onImageSaved) {
            console.log(`[FlipSave] Calling onImageSaved callback with:`, { newImageUrl });
            onImageSaved(newImageUrl);
            console.log(`[FlipSave] onImageSaved callback called successfully`);
          } else {
            console.warn(`[FlipSave] WARNING: No newImageUrl or onImageSaved callback`, { newImageUrl, hasCallback: !!onImageSaved });
          }

          setHasChanges(false);
          console.log(`[FlipSave] Save process completed successfully`);
          toast({ 
            title: "Image Saved", 
            description: "Flipped image has been saved successfully",
          });
        } catch (error) {
          console.error('[FlipSave] ERROR during upload:', error);
          toast({ 
            title: "Save Failed", 
            description: "Could not save the flipped image",
            variant: "destructive"
          });
        }
      }, 'image/png');
    } catch (error) {
      console.error('[FlipSave] ERROR creating flipped image:', error);
      toast({ 
        title: "Save Failed", 
        description: "Could not process the image",
        variant: "destructive"
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownloadClick = async () => {
    if (!imageUrl) return;
    setIsDownloading(true);

    try {
      let downloadUrl = imageUrl;
      let downloadName = downloadFileName;

      // If the image has been flipped, download the flipped version
      if (isFlippedHorizontally) {
        const canvas = await createFlippedCanvas();
        canvas.toBlob((blob) => {
          if (blob) {
            downloadUrl = URL.createObjectURL(blob);
            downloadName = `flipped_${downloadFileName}`;
            
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = downloadUrl;
            a.download = downloadName;
            document.body.appendChild(a);
            a.click();
            URL.revokeObjectURL(downloadUrl);
            document.body.removeChild(a);
          }
        }, 'image/png');
        return;
      }

      // Use XMLHttpRequest for original image download
      const xhr = new XMLHttpRequest();
      xhr.open('GET', imageUrl, true);
      xhr.responseType = 'blob';

      xhr.onload = function() {
        if (this.status === 200) {
          const blob = new Blob([this.response], { type: 'image/png' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = url;
          a.download = downloadName;
          document.body.appendChild(a);
          a.click();
          URL.revokeObjectURL(url);
          document.body.removeChild(a);
        } else {
          throw new Error(`Failed to fetch image: ${this.status} ${this.statusText}`);
        }
      };

      xhr.onerror = function() {
        throw new Error('Network request failed');
      };

      xhr.send();
    } catch (error) {
      console.error("Error downloading image:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      toast({ 
        title: "Download Failed", 
        description: `Could not download ${downloadFileName}. ${errorMessage}`,
        variant: "destructive"
      });
    } finally {
      setIsDownloading(false);
    }
  };

  // Calculate positioning adjustments for locked panes
  const modalStyle = {
    left: isShotsPaneLocked ? `${shotsPaneWidth}px` : '0px',
    right: isTasksPaneLocked ? `${tasksPaneWidth}px` : '0px',
    bottom: isGenerationsPaneLocked ? `${generationsPaneHeight}px` : '0px',
    top: '0px',
    transition: 'left 300ms ease-in-out, right 300ms ease-in-out, bottom 300ms ease-in-out',
  };

  return (
    <TooltipProvider>
      <div
        className="fixed z-50 flex items-center justify-center bg-black bg-opacity-75 transition-opacity duration-300 ease-in-out"
        style={modalStyle}
        onClick={onClose} // Close on backdrop click
      >
        <div
          className="relative p-4 bg-white rounded-lg shadow-xl max-w-4xl max-h-[90vh] overflow-hidden flex flex-col animate-fadeIn"
          onClick={(e) => e.stopPropagation()} // Prevent modal close when clicking on the image/modal content itself
        >
          <img
            ref={imgRef}
            src={imageUrl}
            alt={imageAlt || "Fullscreen view"}
            className={`w-auto h-auto max-w-full max-h-[calc(85vh-40px)] object-contain rounded mb-2 transition-transform duration-200 ${
              isFlippedHorizontally ? 'scale-x-[-1]' : ''
            }`}
          />
          {/* Buttons container */}
          <div className="flex justify-between items-center mt-auto pt-2">
            {/* Left side buttons */}
            <div className="flex items-center space-x-2">
              {/* Download Button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-black/10 hover:bg-black/20 text-black"
                    onClick={handleDownloadClick}
                    disabled={isDownloading}
                  >
                    {isDownloading ? (
                      <>
                        <div className="h-4 w-4 mr-2 animate-spin rounded-full border-b-2 border-current"></div>
                        Downloading...
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4 mr-2" />
                        Download
                      </>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top"><p>Download Image</p></TooltipContent>
              </Tooltip>

              {/* Flip Horizontal Button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={`bg-black/10 hover:bg-black/20 text-black ${
                      isFlippedHorizontally ? 'bg-blue-100 border-blue-300' : ''
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

            {/* Close Button (Bottom Right) */}
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="bg-black/10 hover:bg-black/20 text-black"
              aria-label="Close image view"
            >
              <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Close
            </Button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
};

export default FullscreenImageModal;

// Basic fadeIn animation for the modal
// This should ideally be in your global CSS or a Tailwind plugin
const style = document.createElement('style');
style.innerHTML = `
  @keyframes fadeIn {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }
  .animate-fadeIn {
    animation: fadeIn 0.3s ease-out forwards;
  }
`;
document.head.appendChild(style); 