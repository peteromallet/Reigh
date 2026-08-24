import React from 'react';
import { Textarea } from '@/shared/components/ui/textarea';
import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/primitives/label';
import { Trash2 } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';
import { PromptInputRowProps } from '../types';
import { usePromptInputRowController } from './prompt-row/usePromptInputRowController';

export const PromptInputRow: React.FC<PromptInputRowProps> = React.memo(({
  promptEntry,
  onUpdate,
  onRemove,
  canRemove,
  isGenerating,
  index,
  totalPrompts,
  onEditWithAI,
  aiEditButtonIcon,
  onSetActiveForFullView,
  isActiveForFullView,
  forceExpanded = false,
  autoEnterEditWhenActive = false,
  rightHeaderAddon,
  mobileInlineEditing = false,
  hideRemoveButton = false,
}) => {
  const controller = usePromptInputRowController({
    autoEnterEditWhenActive,
    forceExpanded,
    index,
    isActiveForFullView,
    onSetActiveForFullView,
    onUpdate,
    promptEntry,
  });

  const rowHeightClasses = isActiveForFullView || controller.isEditingFullPrompt || forceExpanded
    ? `overflow-y-auto ${controller.isMobile ? 'min-h-[96px]' : 'min-h-[72px]'}`
    : `overflow-hidden ${controller.isMobile ? 'h-[56px]' : 'h-[32px]'} cursor-pointer`;

  return (
    <div
      ref={(node) => {
        if (node) controller.promptContainerRef.current = node;
      }}
      className={`group pt-2 px-4 pb-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600 transition-colors ${forceExpanded ? 'mt-0' : ''}`}
    >
      <div className="flex justify-between items-center mb-2">
        {!controller.isMobile || !mobileInlineEditing ? (
          <div className="flex items-center gap-1.5">
            <Label htmlFor={`fullPrompt-${promptEntry.id}`} className="text-xs font-medium text-muted-foreground">
              {totalPrompts === 1 ? 'Prompt:' : `Prompt #${index + 1}:`}
            </Label>
            {canRemove && !hideRemoveButton && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onRemove(promptEntry.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/60 hover:text-destructive hover:bg-destructive/5 h-4 w-4 p-0"
                      disabled={isGenerating}
                      aria-label="Remove prompt"
                    >
                      <Trash2 className="h-2.5 w-2.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>Remove Prompt</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        ) : (
          <div className="h-5" />
        )}

        <div className={`flex items-center gap-x-1 ${controller.isMobile && mobileInlineEditing ? 'flex-1 justify-end' : ''}`}>
          {rightHeaderAddon ? (
            <div className={`flex items-center gap-2 ${controller.isMobile && mobileInlineEditing ? 'w-full' : ''}`}>
              {rightHeaderAddon}
            </div>
          ) : (
            onEditWithAI && aiEditButtonIcon && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={onEditWithAI}
                      className="text-primary/80 hover:text-primary hover:bg-primary/10 h-7 w-7"
                      disabled={isGenerating}
                      aria-label="Edit with AI"
                    >
                      {aiEditButtonIcon}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>{promptEntry.fullPrompt.trim() === '' ? 'Create with AI' : 'Edit with AI'}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )
          )}
        </div>
      </div>

      <div>
        {(!controller.isMobile || controller.isEditingFullPrompt) ? (
          <Textarea
            ref={(node) => {
              if (node) controller.textareaRef.current = node;
            }}
            id={`fullPrompt-${promptEntry.id}`}
            value={controller.displayText}
            onChange={controller.handleFullPromptChange}
            onFocus={controller.handleFocus}
            onBlur={controller.handleBlur}
            placeholder={controller.currentPlaceholder}
            className={`mt-1 resize-none ${rowHeightClasses}`}
            disabled={isGenerating}
            rows={controller.isMobile ? 2 : 1}
            clearable
            onClear={controller.clearPrompt}
            voiceInput
            voiceContext="This is an individual image generation prompt. Describe a single image with visual details like subject, composition, lighting, colors, and atmosphere. Be specific and descriptive."
            onVoiceResult={controller.handleVoiceResult}
          />
        ) : (
          <div
            onTouchStart={controller.handleTouchStart}
            onPointerDown={controller.handlePointerDown}
            onClick={controller.handlePromptRowClick}
            className={`mt-1 resize-none border border-input bg-background px-3 py-2 text-base lg:text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${rowHeightClasses} rounded-md`}
            style={{
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word',
              fontFamily: 'inherit',
            }}
          >
            {controller.displayText || (
              <span className="text-muted-foreground">{controller.currentPlaceholder}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

PromptInputRow.displayName = 'PromptInputRow';
