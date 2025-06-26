import React from 'react';
import ReactDOM from 'react-dom';
import { X } from 'lucide-react';
import { GenerationRow } from '@/types/shots';
import SimpleVideoPlayer from './SimpleVideoPlayer';
import { usePanes } from '@/shared/contexts/PanesContext';

interface VideoLightboxProps {
  video: GenerationRow;
  onClose: () => void;
  onImageSaved?: (newImageUrl: string) => void; // Callback when image is saved with changes
}

const VideoLightbox: React.FC<VideoLightboxProps> = ({ video, onClose, onImageSaved }) => {
  // Get pane state for positioning adjustments
  const { 
    isTasksPaneLocked, 
    tasksPaneWidth, 
    isShotsPaneLocked, 
    shotsPaneWidth, 
    isGenerationsPaneLocked, 
    generationsPaneHeight 
  } = usePanes();

  // Calculate positioning adjustments for locked panes
  const modalStyle = {
    left: isShotsPaneLocked ? `${shotsPaneWidth}px` : '0px',
    right: isTasksPaneLocked ? `${tasksPaneWidth}px` : '0px',
    bottom: isGenerationsPaneLocked ? `${generationsPaneHeight}px` : '0px',
    top: '0px',
    transition: 'left 300ms ease-in-out, right 300ms ease-in-out, bottom 300ms ease-in-out',
  };

  return ReactDOM.createPortal(
    <div 
      className="fixed bg-black/80 flex items-center justify-center z-50 p-8"
      style={modalStyle}
      onClick={onClose}
    >
      <div 
        className="relative w-full max-w-4xl h-auto"
        onClick={(e) => e.stopPropagation()} // Prevent closing when clicking on the video
      >
        <SimpleVideoPlayer
          src={video.location || video.imageUrl}
          poster={video.thumbUrl}
          className="w-full h-full"
        />
      </div>
      <button 
        onClick={onClose} 
        className="absolute top-4 right-4 text-white hover:text-gray-300"
        aria-label="Close lightbox"
      >
        <X size={32} />
      </button>
    </div>,
    document.body
  );
};

export default VideoLightbox; 