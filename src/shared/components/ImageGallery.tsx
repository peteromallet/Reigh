import React, { useState, useEffect, useRef } from "react";
import { Trash2, Info, Settings, CheckCircle, AlertTriangle, Download, PlusCircle, Check, Sparkles, Filter } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { 
  Tooltip, 
  TooltipContent, 
  TooltipProvider, 
  TooltipTrigger 
} from "@/shared/components/ui/tooltip";
import FullscreenImageModal from "@/shared/components/ui/FullscreenImageModal";
import { useToast } from "@/shared/hooks/use-toast";
import { Shot } from "@/types/shots";
import { useLastAffectedShot } from "@/shared/hooks/useLastAffectedShot";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Label } from "@/shared/components/ui/label";
import { nanoid } from "nanoid";
import { formatDistanceToNow } from "date-fns";
import { useCurrentShot } from '@/shared/contexts/CurrentShotContext';
import { DraggableImage } from "@/shared/components/DraggableImage";

// Define the structure for individual LoRA details within metadata
export interface MetadataLora {
  id: string; // Added Model ID
  name: string; // Added Name
  path: string;
  strength: number; // Changed from scale (string) to strength (number 0-100)
  previewImageUrl?: string; // Added preview image
}

// Define the structure of the metadata object we expect for display
export interface DisplayableMetadata extends Record<string, any> {
  prompt?: string;
  imagesPerPrompt?: number;
  seed?: number;
  width?: number;
  height?: number;
  content_type?: string;
  activeLoras?: MetadataLora[];
  depthStrength?: number; // Normalized (0-1)
  softEdgeStrength?: number; // Normalized (0-1)
  userProvidedImageUrl?: string | null;
  num_inference_steps?: number;
  guidance_scale?: number;
  scheduler?: string;
  tool_type?: string; // Added for filtering
  original_image_filename?: string;
  original_frame_timestamp?: number; // For video frames
  source_frames?: number; // For reconstructed videos
  original_duration?: number; // For reconstructed videos
  // Allow any other keys for flexibility
}

// Updated interface for images passed to the gallery
export interface GeneratedImageWithMetadata {
  id: string;
  url: string; // This will now be a relative path for DB-sourced images
  prompt?: string;
  seed?: number;
  metadata?: DisplayableMetadata;
  temp_local_path?: string; // For unsaved local generations
  error?: string; // To display an error message on the image card
  file?: File; // Optional file object, e.g. for unsaved SDXL Turbo gens
  isVideo?: boolean; // To distinguish video from image in the gallery
  unsaved?: boolean; // Optional flag for images not saved to DB
  createdAt?: string; // Add a creation timestamp
}

interface ImageGalleryProps {
  images: GeneratedImageWithMetadata[];
  onDelete?: (id: string) => void;
  isDeleting?: string | null;
  onApplySettings?: (metadata: DisplayableMetadata) => void;
  allShots: Shot[];
  lastShotId?: string;
  lastShotNameForTooltip?: string;
  onAddToLastShot: (generationId: string, imageUrl?: string, thumbUrl?: string) => Promise<boolean>;
  currentToolType?: string; // Added for filtering
  initialFilterState?: boolean; // Added for default filter state
  onImageSaved?: (imageId: string, newImageUrl: string) => void; // Callback when image is saved with changes
  /** Zero-based offset of the first image in `images` relative to the full list after any server-side filtering/pagination. */
  offset?: number;
  /** Total number of items in the full list (after any server-side filtering/pagination but before client-side page slice). */
  totalCount?: number;
}

// Helper to format metadata for display
const formatMetadataForDisplay = (metadata: DisplayableMetadata): string => {
  
  let displayText = "";
  if (metadata.prompt) displayText += `Prompt: ${metadata.prompt}\n`;
  if (metadata.seed) displayText += `Seed: ${metadata.seed}\n`;
  if (metadata.imagesPerPrompt) displayText += `Images/Prompt: ${metadata.imagesPerPrompt}\n`;
  if (metadata.width && metadata.height) displayText += `Dimensions: ${metadata.width}x${metadata.height}\n`;
  if (metadata.num_inference_steps) displayText += `Steps: ${metadata.num_inference_steps}\n`;
  if (metadata.guidance_scale) displayText += `Guidance: ${metadata.guidance_scale}\n`;
  if (metadata.scheduler) displayText += `Scheduler: ${metadata.scheduler}\n`;
  if (metadata.tool_type) displayText += `Tool: ${metadata.tool_type}\n`; // Display tool_type
  
  if (metadata.activeLoras && metadata.activeLoras.length > 0) {
    displayText += "Active LoRAs:\n";
    metadata.activeLoras.forEach(lora => {
      // Now using lora.name and lora.strength directly
      const displayName = lora.name || lora.id; // Fallback to ID if name is missing
      displayText += `  - ${displayName} (Strength: ${lora.strength}%)\n`;
    });
  }
  if (metadata.depthStrength !== undefined) displayText += `Depth Strength: ${(metadata.depthStrength * 100).toFixed(0)}%\n`;
  if (metadata.softEdgeStrength !== undefined) displayText += `Soft Edge Strength: ${(metadata.softEdgeStrength * 100).toFixed(0)}%\n`;
  if (metadata.userProvidedImageUrl) {
    const urlParts = metadata.userProvidedImageUrl.split('/');
    const imageName = urlParts[urlParts.length -1] || metadata.userProvidedImageUrl;
    displayText += `User Image: ${imageName}\n`;
  }
  
  return displayText.trim() || "No metadata available.";
};

const ImageGallery: React.FC<ImageGalleryProps> = ({ images, onDelete, isDeleting, onApplySettings, allShots, lastShotId, onAddToLastShot, currentToolType, initialFilterState = true, onImageSaved, offset = 0, totalCount }) => {
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);
  const [lightboxImageAlt, setLightboxImageAlt] = useState<string>("Fullscreen view");
  const [lightboxImageId, setLightboxImageId] = useState<string | undefined>(undefined);
  const [downloadingImageId, setDownloadingImageId] = useState<string | null>(null);
  const { toast } = useToast();
  const { setLastAffectedShotId } = useLastAffectedShot();
  const { currentShotId } = useCurrentShot();
  const simplifiedShotOptions = React.useMemo(() => allShots.map(s => ({ id: s.id, name: s.name })), [allShots]);

  const [selectedShotIdLocal, setSelectedShotIdLocal] = useState<string>(() => 
    currentShotId || lastShotId || (simplifiedShotOptions.length > 0 ? simplifiedShotOptions[0].id : "")
  );
  const [showTickForImageId, setShowTickForImageId] = useState<string | null>(null);

  // State for the filter checkbox
  const [filterByToolType, setFilterByToolType] = useState<boolean>(initialFilterState);
  // State for the new media type filter
  const [mediaTypeFilter, setMediaTypeFilter] = useState<'all' | 'image' | 'video'>('all');

  const tickTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const baseUrl = import.meta.env.VITE_API_TARGET_URL || '';

  const getDisplayUrl = (relativePath: string | undefined): string => {
    if (!relativePath) return ''; // Or a placeholder image URL
    if (relativePath.startsWith('http') || relativePath.startsWith('blob:')) {
      return relativePath;
    }
    // Ensure no double slashes if baseUrl ends with / and relativePath starts with /
    const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const cleanRelative = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
    return `${cleanBase}/${cleanRelative}`;
  };

  useEffect(() => {
    const newSelectedShotId = currentShotId || lastShotId || (simplifiedShotOptions.length > 0 ? simplifiedShotOptions[0].id : "");
    setSelectedShotIdLocal(newSelectedShotId);
    if (newSelectedShotId) {
      setLastAffectedShotId(newSelectedShotId);
    }
  }, [currentShotId, lastShotId, simplifiedShotOptions, setLastAffectedShotId]);

  useEffect(() => {
    // When the component mounts or initialFilterState prop changes, update the filter state
    setFilterByToolType(initialFilterState);
  }, [initialFilterState]);

  useEffect(() => {
    return () => {
      if (tickTimeoutRef.current) {
        clearTimeout(tickTimeoutRef.current);
      }
    };
  }, []);

  const handleOpenLightbox = (image: GeneratedImageWithMetadata) => {
    setLightboxImageUrl(getDisplayUrl(image.url));
    setLightboxImageAlt(image.prompt || `Generated image with ID ${image.id}`);
    setLightboxImageId(image.id);
  };

  const handleCloseLightbox = () => {
    setLightboxImageUrl(null);
    setLightboxImageAlt("Fullscreen view");
    setLightboxImageId(undefined);
  };

  const handleImageSaved = (newImageUrl: string) => {
    if (lightboxImageId && onImageSaved) {
      onImageSaved(lightboxImageId, newImageUrl);
    }
  };

  const handleDownloadImage = async (rawUrl: string, filename: string, imageId?: string, isVideo?: boolean, originalContentType?: string) => {
    const currentDownloadId = imageId || filename;
    setDownloadingImageId(currentDownloadId);
    const accessibleImageUrl = getDisplayUrl(rawUrl); // Use display URL for download

    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', accessibleImageUrl, true); // Use accessibleImageUrl
      xhr.responseType = 'blob';

      xhr.onload = function() {
        if (this.status === 200) {
          const blobContentType = this.getResponseHeader('content-type') || originalContentType || (isVideo ? 'video/webm' : 'image/png');
          const blob = new Blob([this.response], { type: blobContentType });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = url;
          
          // Attempt to get a better filename extension
          let fileExtension = blobContentType.split('/')[1];
          if (!fileExtension || fileExtension === 'octet-stream') {
            // Fallback to guessing from URL or defaulting
            const urlParts = accessibleImageUrl.split('.');
            fileExtension = urlParts.length > 1 ? urlParts.pop()! : (isVideo ? 'webm' : 'png');
          }
          const downloadFilename = filename.includes('.') ? filename : `${filename}.${fileExtension}`;
          a.download = downloadFilename;

          document.body.appendChild(a);
          a.click();
          URL.revokeObjectURL(url);
          document.body.removeChild(a);
          toast({ title: "Download Started", description: filename });
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
        description: `Could not download ${filename}. ${errorMessage}`,
        variant: "destructive" 
      });
    } finally {
      setDownloadingImageId(null);
    }
  };

  const filteredImages = React.useMemo(() => {
    const galleryLogId = nanoid(5);

    let currentFiltered = images;

    // 1. Apply tool_type filter
    if (filterByToolType && currentToolType) {
      currentFiltered = currentFiltered.filter(image => {
        const metadata = image.metadata;
        if (!metadata || !metadata.tool_type) return false; // No metadata or tool_type, exclude
        
        // If currentToolType is 'edit-travel', we want to include anything that starts with 'edit-travel'
        // This covers 'edit-travel', 'edit-travel-flux', 
        // 'edit-travel-reconstructed-client', 'edit-travel-reconstructed-flux-client', etc.
        if (currentToolType === 'edit-travel') {
          return metadata.tool_type.startsWith('edit-travel');
        }
        
        // For other tools, it's an exact match to the tool_type or its reconstructed client version
        // (e.g., 'image-generation' or 'image-generation-reconstructed-client')
        // This part might need adjustment if other tools also have varied reconstructed types.
        // For now, assuming reconstructed videos from other tools might also follow a pattern.
        // A more robust way for generic tools would be needed if they also have diverse sub-types.
        if (metadata.tool_type === currentToolType) return true;
        if (metadata.tool_type === `${currentToolType}-reconstructed-client`) return true; // Example for a generic tool

        // Fallback for exact match if no special handling for currentToolType
        return metadata.tool_type === currentToolType;
      });
    }

    // 2. Apply mediaTypeFilter
    if (mediaTypeFilter !== 'all') {
      currentFiltered = currentFiltered.filter(image => {
        const urlIsVideo = image.url && (image.url.toLowerCase().endsWith('.webm') || image.url.toLowerCase().endsWith('.mp4') || image.url.toLowerCase().endsWith('.mov'));
        const isActuallyVideo = typeof image.isVideo === 'boolean' ? image.isVideo : urlIsVideo;
        
        // console.log(
        //     `[ImageGallery_${galleryLogId}_FilterItem_Media] ID: ${image.id}, isVideo: ${image.isVideo}, urlIsVideo: ${urlIsVideo}, isActuallyVideo: ${isActuallyVideo}, mediaTypeFilter: ${mediaTypeFilter}, Match: ${mediaTypeFilter === 'image' ? !isActuallyVideo : isActuallyVideo}`
        // );

        if (mediaTypeFilter === 'image') {
          return !isActuallyVideo;
        }
        if (mediaTypeFilter === 'video') {
          return isActuallyVideo;
        }
        return true; // Should not be reached if filter is 'image' or 'video'
      });
    }
        
    return currentFiltered;
  }, [images, filterByToolType, currentToolType, mediaTypeFilter]);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-4">
        <div className="flex flex-wrap justify-between items-center mb-2 gap-x-4 gap-y-2"> {/* Added gap-y-2 and flex-wrap for better responsiveness */}
            {images.length > 0 && (
              <h2 className="text-xl font-medium">
                Showing {offset + 1}-{offset + filteredImages.length} (out of {totalCount ?? images.length})
              </h2>
            )}
            <div className="flex items-center gap-x-4 gap-y-2 flex-wrap"> {/* Grouping filters, added flex-wrap */}
                {/* New Media Type Filter */}
                <div className="flex items-center space-x-1.5">
                    <Label htmlFor="media-type-filter" className="text-sm font-medium text-muted-foreground">Type:</Label>
                    <Select value={mediaTypeFilter} onValueChange={(value: 'all' | 'image' | 'video') => setMediaTypeFilter(value)}>
                        <SelectTrigger id="media-type-filter" className="h-8 text-xs w-[100px]"> {/* Adjusted width slightly */}
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all" className="text-xs">All</SelectItem>
                            <SelectItem value="image" className="text-xs">Images</SelectItem>
                            <SelectItem value="video" className="text-xs">Videos</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* Existing Tool Type Filter */}
                {currentToolType && (
                    <div className="flex items-center space-x-2"> {/* Removed pt-1 as alignment handled by flex group */}
                        <Checkbox
                            id={`filter-tool-${currentToolType}`}
                            checked={filterByToolType}
                            onCheckedChange={(checked) => setFilterByToolType(Boolean(checked))}
                            aria-label={`Filter by ${currentToolType} tool`}
                        />
                        <Label htmlFor={`filter-tool-${currentToolType}`} className="text-sm font-medium cursor-pointer">
                            Only from "{currentToolType}"
                        </Label>
                    </div>
                )}
            </div>
        </div>

        {images.length > 0 && filteredImages.length === 0 && (filterByToolType || mediaTypeFilter !== 'all') && (
          <div className="text-center py-8 text-muted-foreground border rounded-lg bg-card shadow-sm">
            <Filter className="mx-auto h-10 w-10 mb-3 opacity-60" />
            <p className="font-semibold">No items match the current filters.</p>
            <p className="text-sm">Adjust the filters or uncheck them to see all items.</p>
          </div>
        )}

        {images.length === 0 && (
           <div className="text-center py-8 text-muted-foreground border rounded-lg bg-card shadow-sm">
             <Sparkles className="mx-auto h-10 w-10 mb-3 opacity-60" />
             <p className="font-semibold">No images generated yet.</p>
             <p className="text-sm">Use the controls above to generate some images.</p>
           </div>
        )}

        {filteredImages.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4">
            {filteredImages.map((image, index) => {
                const displayUrl = getDisplayUrl(image.url);
                const metadataForDisplay = image.metadata ? formatMetadataForDisplay(image.metadata) : "No metadata available.";
                const isCurrentDeleting = isDeleting === image.id;
                const imageKey = image.id || `image-${displayUrl}-${index}`;
                const galleryRenderLogId = nanoid(5);

                // Determine if it's a video by checking the URL extension if isVideo prop is not explicitly set
                const urlIsVideo = displayUrl && (displayUrl.toLowerCase().endsWith('.webm') || displayUrl.toLowerCase().endsWith('.mp4') || displayUrl.toLowerCase().endsWith('.mov'));
                const isActuallyVideo = typeof image.isVideo === 'boolean' ? image.isVideo : urlIsVideo;

                // Placeholder check should ideally rely on more than just !image.id if placeholders are actual objects in the array
                // For this implementation, we assume placeholders passed to `images` prop might not have `id`
                const isPlaceholder = !image.id && displayUrl === "/placeholder.svg";
                const currentTargetShotName = selectedShotIdLocal ? simplifiedShotOptions.find(s => s.id === selectedShotIdLocal)?.name : undefined;
                
                let aspectRatioPadding = '100%'; 
                if (image.metadata?.width && image.metadata?.height) {
                aspectRatioPadding = `${(image.metadata.height / image.metadata.width) * 100}%`;
                }

                // If it's a placeholder (e.g. from Array(4).fill for loading state), render simplified placeholder item
                // This specific placeholder rendering should only occur if filteredImages actually contains such placeholders.
                // The filter logic above might already exclude them if they don't have metadata.tool_type
                if (isPlaceholder) {
                  return (
                    <div 
                      key={imageKey}
                      className="border rounded-lg overflow-hidden bg-muted animate-pulse"
                    >
                      <div style={{ paddingBottom: aspectRatioPadding }} className="relative">
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Sparkles className="h-12 w-12 text-muted-foreground opacity-30" />
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                <DraggableImage key={`draggable-${imageKey}`} image={image}>
                  <div 
                      className="border rounded-lg overflow-hidden hover:shadow-md transition-shadow relative group bg-card"
                  >
                    <div className="relative w-full">
                    <div style={{ paddingBottom: aspectRatioPadding }} className="relative bg-gray-200">
                        {isActuallyVideo ? (
                            <video
                                src={displayUrl}
                                controls
                                playsInline
                                loop
                                muted
                                className="absolute inset-0 w-full h-full object-contain group-hover:opacity-80 transition-opacity duration-300 bg-black"
                                onDoubleClick={() => handleOpenLightbox(image)} // Consider if lightbox makes sense for video, or a different action
                                style={{ cursor: 'pointer' }}
                            />
                        ) : (
                            <img
                                src={displayUrl}
                                alt={image.prompt || `Generated image ${index + 1}`}
                                className="absolute inset-0 w-full h-full object-cover group-hover:opacity-80 transition-opacity duration-300"
                                onDoubleClick={() => handleOpenLightbox(image)}
                                style={{ cursor: 'pointer' }}
                            />
                        )}
                    </div>
                    </div>
                    
                    {/* Action buttons and UI elements */}
                    {image.id && ( // Ensure image has ID for actions
                    <>
                        {/* Add to Shot UI - Top Left */}
                        {simplifiedShotOptions.length > 0 && onAddToLastShot && (
                        <div className="absolute top-2 left-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                            <Select
                                value={selectedShotIdLocal}
                                onValueChange={(value) => {
                                    setSelectedShotIdLocal(value);
                                    setLastAffectedShotId(value); 
                                }}
                            >
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <SelectTrigger
                                            className="h-7 px-2 py-1 rounded-md bg-black/50 hover:bg-black/70 text-white text-xs min-w-[70px] max-w-[120px] truncate focus:ring-0 focus:ring-offset-0"
                                            aria-label="Select target shot"
                                            onMouseEnter={(e) => e.stopPropagation()}
                                            onMouseLeave={(e) => e.stopPropagation()}
                                        >
                                            <SelectValue placeholder="Shot..." />
                                        </SelectTrigger>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom">
                                        <p>Target Shot: {currentTargetShotName || "Select a shot"}</p>
                                    </TooltipContent>
                                </Tooltip>
                                <SelectContent className="z-[9999]" style={{ zIndex: 10000 }}>
                                    {simplifiedShotOptions.map(shot => (
                                        <SelectItem key={shot.id} value={shot.id} className="text-xs">
                                            {shot.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className={`h-7 w-7 p-0 rounded-full bg-black/50 hover:bg-black/70 text-white ${showTickForImageId === image.id ? 'bg-green-500 hover:bg-green-600 !text-white' : ''}`}
                                        onClick={async () => {
                                            if (!selectedShotIdLocal) {
                                                toast({ title: "Select a Shot", description: "Please select a shot first to add this image.", variant: "destructive" });
                                                return;
                                            }
                                            const success = await onAddToLastShot(image.id!, displayUrl, displayUrl);
                                            if (success) {
                                                setShowTickForImageId(image.id!);
                                                if (tickTimeoutRef.current) clearTimeout(tickTimeoutRef.current);
                                                tickTimeoutRef.current = setTimeout(() => {
                                                    setShowTickForImageId(null);
                                                }, 2000);
                                            }
                                        }}
                                        disabled={!selectedShotIdLocal || showTickForImageId === image.id}
                                        aria-label={showTickForImageId === image.id ? `Added to ${currentTargetShotName}` : (currentTargetShotName ? `Add to shot: ${currentTargetShotName}` : "Add to selected shot")}
                                    >
                                        {showTickForImageId === image.id ? <Check className="h-4 w-4" /> : <PlusCircle className="h-4 w-4" />}
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">
                                    {showTickForImageId === image.id ? `Added to ${currentTargetShotName || 'shot'}` :
                                    (selectedShotIdLocal && currentTargetShotName ? `Add to: ${currentTargetShotName}` : "Select a shot then click to add")}
                                </TooltipContent>
                            </Tooltip>
                        </div>
                        )}

                        {/* Other action buttons - Top Right */}
                        <div className="absolute top-2 right-2 flex flex-col items-end gap-1.5">
                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                {image.metadata && (
                                    <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="secondary" size="icon" className="h-7 w-7 p-0 rounded-full bg-black/50 hover:bg-black/70 text-white">
                                        <Info className="h-3.5 w-3.5" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent 
                                        side="bottom" 
                                        className="max-w-md text-xs p-3 leading-relaxed shadow-lg bg-background border max-h-80 overflow-y-auto"
                                    >
                                        {image.metadata.userProvidedImageUrl && (
                                        <img 
                                            src={image.metadata.userProvidedImageUrl} 
                                            alt="User provided image preview"
                                            className="w-full h-auto max-h-24 object-contain rounded-sm mb-2 border"
                                        />
                                        )}
                                        <pre className="font-sans whitespace-pre-wrap">{metadataForDisplay}</pre>
                                    </TooltipContent>
                                    </Tooltip>
                                )}
                                {image.createdAt && (
                                    <span className="text-xs text-white bg-black/50 px-1.5 py-0.5 rounded-md">
                                        {formatDistanceToNow(new Date(image.createdAt), { addSuffix: true })}
                                    </span>
                                )}
                            </div>

                            <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                {onDelete && (
                                    <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button 
                                        variant="destructive" 
                                        size="icon" 
                                        className="h-7 w-7 p-0 rounded-full"
                                        onClick={() => onDelete(image.id!)}
                                        disabled={isCurrentDeleting}
                                        >
                                        {isCurrentDeleting ? (
                                            <div className="h-3 w-3 animate-spin rounded-full border-b-2 border-white"></div>
                                        ) : (
                                            <Trash2 className="h-3.5 w-3.5" />
                                        )}
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom"><p>Delete Image</p></TooltipContent>
                                    </Tooltip>
                                )}
                                {image.metadata && onApplySettings && (
                                    <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button 
                                        variant="outline"
                                        size="icon" 
                                        className="h-7 w-7 p-0 rounded-full bg-black/50 hover:bg-black/70 text-white"
                                        onClick={() => onApplySettings(image.metadata!)}
                                        >
                                        <Settings className="h-4 w-4 mr-1" /> Apply
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Apply these generation settings to the form</TooltipContent>
                                    </Tooltip>
                                )}
                            </div>
                        </div>

                        {/* Download button - Bottom Left */}
                        <div className="absolute bottom-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                variant="outline"
                                size="icon"
                                className="h-7 w-7 p-0 rounded-full bg-black/50 hover:bg-black/70 text-white"
                                onClick={() => handleDownloadImage(
                                    displayUrl, 
                                    `artful_pane_craft_${isActuallyVideo ? 'video' : 'image'}_${image.id || index}`,
                                    image.id || imageKey,
                                    isActuallyVideo,
                                    image.metadata?.content_type
                                )}
                                disabled={downloadingImageId === (image.id || imageKey)}
                                >
                                {downloadingImageId === (image.id || imageKey) ? (
                                    <div className="h-3 w-3 animate-spin rounded-full border-b-2 border-current"></div>
                                ) : (
                                    <Download className="h-3.5 w-3.5" />
                                )}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top"><p>Download Image</p></TooltipContent>
                            </Tooltip>
                        </div>
                    </>)
                    }
                  </div>
                </DraggableImage>
                );
            })}
            </div>
        )}
      </div>
      
      {lightboxImageUrl && (
        <FullscreenImageModal
          imageUrl={lightboxImageUrl}
          imageAlt={lightboxImageAlt}
          onClose={handleCloseLightbox}
          imageId={lightboxImageId}
          onImageSaved={handleImageSaved}
        />
      )}
    </TooltipProvider>
  );
};

export default ImageGallery; 