import React, { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { GenerationRow } from '@/types/shots';
import { SortableImageItem } from '@/tools/video-travel/components/SortableImageItem'; // Adjust path as needed
import MediaLightbox from './MediaLightbox';
import { cn } from '@/shared/lib/utils';
import { MultiImagePreview, SingleImagePreview } from './ImageDragPreview';
import { PairConfig } from '@/tools/video-travel/components/ShotEditor';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Slider } from './ui/slider';

export interface ShotImageManagerProps {
  images: GenerationRow[];
  onImageDelete: (shotImageEntryId: string) => void;
  onImageReorder: (orderedShotGenerationIds: string[]) => void;
  columns?: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  generationMode: 'batch' | 'by-pair';
  pairConfigs: PairConfig[];
  onPairConfigChange: (id: string, field: 'prompt' | 'frames' | 'negativePrompt' | 'context', value: string | number) => void;
  onImageSaved?: (imageId: string, newImageUrl: string) => void; // Callback when image is saved with changes
}

const ShotImageManager: React.FC<ShotImageManagerProps> = ({
  images,
  onImageDelete,
  onImageReorder,
  columns = 4,
  generationMode,
  pairConfigs,
  onPairConfigChange,
  onImageSaved,
}) => {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, {
      // Require the mouse to move by 5 pixels before activating
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(TouchSensor, {
      // Press delay of 250ms, with tolerance of 5px of movement
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    setActiveId(active.id as string);
    if (!selectedIds.includes(active.id as string)) {
      setSelectedIds([]);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    const activeIsSelected = selectedIds.includes(active.id as string);

    if (!activeIsSelected || selectedIds.length <= 1) {
      const oldIndex = images.findIndex((img) => img.shotImageEntryId === active.id);
      const newIndex = images.findIndex((img) => img.shotImageEntryId === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(images, oldIndex, newIndex);
        onImageReorder(newOrder.map((img) => img.shotImageEntryId));
      }
      setSelectedIds([]);
      return;
    }

    // Multi-drag logic
    if (selectedIds.includes(over.id as string)) {
      return; // Avoid dropping a selection onto part of itself
    }

    const overIndex = images.findIndex((img) => img.shotImageEntryId === over.id);
    const activeIndex = images.findIndex((img) => img.shotImageEntryId === active.id);

    const selectedItems = images.filter((img) => selectedIds.includes(img.shotImageEntryId));
    const remainingItems = images.filter((img) => !selectedIds.includes(img.shotImageEntryId));

    const overInRemainingIndex = remainingItems.findIndex((img) => img.shotImageEntryId === over.id);

    let newItems: GenerationRow[];
    if (activeIndex > overIndex) {
      // Dragging up
      newItems = [
        ...remainingItems.slice(0, overInRemainingIndex),
        ...selectedItems,
        ...remainingItems.slice(overInRemainingIndex),
      ];
    } else {
      // Dragging down
      newItems = [
        ...remainingItems.slice(0, overInRemainingIndex + 1),
        ...selectedItems,
        ...remainingItems.slice(overInRemainingIndex + 1),
      ];
    }

    onImageReorder(newItems.map((img) => img.shotImageEntryId));
    setSelectedIds([]);
  };

  const handleItemClick = (id: string, event: React.MouseEvent) => {
    event.preventDefault(); // Prevent any default behavior like navigation
    if (event.metaKey || event.ctrlKey) {
      setSelectedIds((prev) =>
        prev.includes(id) ? prev.filter((selectedId) => selectedId !== id) : [...prev, id],
      );
    } else {
      setSelectedIds([id]);
    }
  };

  const handleNext = () => {
    if (lightboxIndex !== null) {
      setLightboxIndex((lightboxIndex + 1) % images.length);
    }
  };

  const handlePrevious = () => {
    if (lightboxIndex !== null) {
      setLightboxIndex((lightboxIndex - 1 + images.length) % images.length);
    }
  };

  const activeImage = activeId ? images.find((img) => img.shotImageEntryId === activeId) : null;

  if (!images || images.length === 0) {
    return <p className="text-sm text-muted-foreground">No images to display.</p>;
  }

  if (generationMode === 'by-pair') {
    const imagePairs = images.slice(0, -1).map((image, index) => {
      const nextImage = images[index + 1];
      const pairId = `${image.id}-${nextImage.id}`;
      const config = pairConfigs.find(p => p.id === pairId) || { 
        prompt: '', 
        frames: 30, 
        negativePrompt: '', 
        context: 16 
      };

      return {
        id: pairId,
        imageA: image,
        imageB: nextImage,
        config: config,
        isFirstPair: index === 0,
      };
    });

    return (
      <div className="space-y-4">
        {imagePairs.map(pair => (
          <div key={pair.id} className="p-4 border rounded-lg bg-card shadow-md">
            <div className="flex space-x-4">
              <div className="flex-1">
                <SortableImageItem
                  image={pair.imageA}
                  isSelected={false}
                  onClick={() => {}}
                  onDelete={() => onImageDelete(pair.imageA.shotImageEntryId)}
                  onDoubleClick={() => {}}
                />
              </div>
              <div className="flex-1">
                <SortableImageItem
                  image={pair.imageB}
                  isSelected={false}
                  onClick={() => {}}
                  onDelete={() => onImageDelete(pair.imageB.shotImageEntryId)}
                  onDoubleClick={() => {}}
                />
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor={`prompt-${pair.id}`}>Prompt Per Pair:</Label>
                  <Textarea
                    id={`prompt-${pair.id}`}
                    value={pair.config.prompt}
                    onChange={e => onPairConfigChange(pair.id, 'prompt', e.target.value)}
                    placeholder="e.g., cinematic transition"
                    className="min-h-[70px] text-sm"
                    rows={3}
                  />
                </div>
                <div>
                  <Label htmlFor={`negative-prompt-${pair.id}`}>Negative Prompt Per Pair:</Label>
                  <Textarea
                    id={`negative-prompt-${pair.id}`}
                    value={pair.config.negativePrompt}
                    onChange={e => onPairConfigChange(pair.id, 'negativePrompt', e.target.value)}
                    placeholder="e.g., blurry, low quality"
                    className="min-h-[70px] text-sm"
                    rows={3}
                  />
                </div>
              </div>
              <div className={pair.isFirstPair ? "grid grid-cols-1 gap-4" : "grid grid-cols-1 md:grid-cols-2 gap-4"}>
                <div>
                  <Label htmlFor={`frames-${pair.id}`}>Frames per pair: {pair.config.frames}</Label>
                  <Slider
                    id={`frames-${pair.id}`}
                    min={10}
                    max={82}
                    step={1}
                    value={[pair.config.frames]}
                    onValueChange={([value]) => onPairConfigChange(pair.id, 'frames', value)}
                  />
                </div>
                {!pair.isFirstPair && (
                  <div>
                    <Label htmlFor={`context-${pair.id}`}>Context Frames Per Pair: {pair.config.context}</Label>
                    <Slider
                      id={`context-${pair.id}`}
                      min={0}
                      max={60}
                      step={1}
                      value={[pair.config.context]}
                      onValueChange={([value]) => onPairConfigChange(pair.id, 'context', value)}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  const gridColsClass = {
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
    5: 'grid-cols-5',
    6: 'grid-cols-6',
    7: 'grid-cols-7',
    8: 'grid-cols-8',
    9: 'grid-cols-9',
    10: 'grid-cols-10',
    11: 'grid-cols-11',
    12: 'grid-cols-12',
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={images.map((img) => img.shotImageEntryId)} strategy={rectSortingStrategy}>
        <div className={cn("grid gap-3", gridColsClass[columns])}>
          {images.map((image, index) => (
            <SortableImageItem
              key={image.shotImageEntryId}
              image={image}
              isSelected={selectedIds.includes(image.shotImageEntryId)}
              onClick={(e) => handleItemClick(image.shotImageEntryId, e)}
              onDelete={() => onImageDelete(image.shotImageEntryId)}
              onDoubleClick={() => setLightboxIndex(index)}
            />
          ))}
        </div>
      </SortableContext>
      <DragOverlay>
        {activeId && activeImage ? (
          <>
            {selectedIds.length > 1 && selectedIds.includes(activeId) ? (
              <MultiImagePreview count={selectedIds.length} image={activeImage} />
            ) : (
              <SingleImagePreview image={activeImage} />
            )}
          </>
        ) : null}
      </DragOverlay>
      {lightboxIndex !== null && (
        <MediaLightbox
          media={images[lightboxIndex]}
          onClose={() => setLightboxIndex(null)}
          onNext={handleNext}
          onPrevious={handlePrevious}
          onImageSaved={onImageSaved ? (newImageUrl: string) => onImageSaved(images[lightboxIndex].id, newImageUrl) : undefined}
        />
      )}
    </DndContext>
  );
};

export default ShotImageManager; 