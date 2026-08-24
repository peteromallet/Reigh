import * as React from "react"
import { Loader2, Send, X } from "lucide-react"
import { cn } from "@/shared/components/ui/contracts/cn"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip"
import { TouchableTooltip } from "@/shared/components/ui/composed/touchableTooltip"
import { TextAction } from "@/shared/components/ui/composed/text-action"
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover"
import { useVoiceRecording } from "@/shared/hooks/useVoiceRecording"
import { useIsMobile } from "@/shared/hooks/mobile"
import { useAIInputMode } from "@/shared/contexts/AIInputModeContext"
import { useAIInputTextPopover } from "@/shared/components/ai-input/useAIInputTextPopover"
import {
  getButtonStyles,
  getMainIcon,
  getTooltipText,
} from "@/shared/components/ai-input/aiInputButton.visuals"

interface PopoverFormContentProps {
  inputRef: React.Ref<HTMLTextAreaElement>
  inputValue: string
  setInputValue: (value: string) => void
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  handleTextSubmit: () => void
  textState: string
  showDesktopHint?: boolean
}

function PopoverFormContent({ inputRef, inputValue, setInputValue, handleKeyDown, handleTextSubmit, textState, showDesktopHint }: PopoverFormContentProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs text-muted-foreground">
        Describe what you want:
      </div>
      <div className="relative">
        <textarea
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Your prompt creation/edit instructions..."
          disabled={textState === "processing"}
          className={cn(
            "w-full min-h-[60px] max-h-[120px] rounded-md border border-input bg-background px-3 py-2 pr-8 text-base lg:text-sm preserve-case",
            "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "resize-none",
            textState === "processing" && "opacity-50"
          )}
          rows={2}
        />
        <button
          type="button"
          onClick={handleTextSubmit}
          disabled={!inputValue.trim() || textState === "processing"}
          className={cn(
            "absolute bottom-3 right-2 h-5 w-5 rounded flex items-center justify-center transition-colors",
            inputValue.trim() && textState !== "processing"
              ? "bg-purple-500 text-white hover:bg-purple-600"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          )}
        >
          {textState === "processing" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Send className="h-3 w-3" />
          )}
        </button>
      </div>
      {showDesktopHint && (
        <div className="text-[10px] text-muted-foreground/70">
          Press Enter to submit, Shift+Enter for new line
        </div>
      )}
    </div>
  )
}

interface AIInputButtonProps {
  onResult: (result: { transcription: string; prompt?: string }) => void
  onError?: (error: string) => void
  onActiveStateChange?: (isActive: boolean) => void
  task?: "transcribe_only" | "transcribe_and_write"
  context?: string
  example?: string
  existingValue?: string
  disabled?: boolean
  className?: string
}

export const AIInputButton = React.forwardRef<
  HTMLButtonElement,
  AIInputButtonProps
>(({ onResult, onError, onActiveStateChange, task = "transcribe_and_write", context, example, existingValue = "", disabled = false, className }, ref) => {
  const isMobile = useIsMobile()
  const { mode, setMode } = useAIInputMode()
  
  // Voice recording state
  const { state: voiceState, audioLevel, remainingSeconds, isActive: isVoiceActive, toggleRecording, cancelRecording } = useVoiceRecording({
    onResult,
    onError,
    task,
    context,
    example,
    existingValue,
  })
  
  // Text prompt state
  const {
    textState,
    inputValue,
    setInputValue,
    isPopoverOpen,
    inputRef,
    handlePopoverOpenChange,
    handleTextSubmit,
    handleKeyDown,
  } = useAIInputTextPopover({
    onResult,
    onError,
    context,
    example,
    existingValue,
  })
  
  const isTextActive = textState === "open" || textState === "processing" || textState === "success"
  const isActive = isVoiceActive || isTextActive
  
  // Notify parent about active state changes
  React.useEffect(() => {
    onActiveStateChange?.(isActive)
  }, [isActive, onActiveStateChange])

  const hasExistingContent = existingValue.trim().length > 0

  // Voice mode handlers
  const handledRef = React.useRef(false)
  
  const handleVoiceInteraction = (e: React.MouseEvent | React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (handledRef.current) return
    handledRef.current = true
    setTimeout(() => { handledRef.current = false }, 300)
    
    if (!disabled && voiceState !== "processing") {
      toggleRecording()
    }
  }

  const handleCancel = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    cancelRecording()
  }
  const visuals = React.useMemo(() => ({
    mode,
    voiceState,
    textState,
    hasExistingContent,
  }), [mode, voiceState, textState, hasExistingContent])

  // Check if className contains flex-1 (for stretching)
  const isStretching = className?.includes('flex-1')

  // Voice mode button content
  const voiceButtonContent = (
    <button
      ref={ref}
      type="button"
      onClick={handleVoiceInteraction}
      onPointerDown={isMobile ? handleVoiceInteraction : undefined}
      disabled={disabled || voiceState === "processing"}
      className={cn(
        "relative rounded-md flex items-center justify-center transition-colors z-10",
        !isStretching && "h-6 w-6",
        getButtonStyles(visuals),
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
      tabIndex={-1}
    >
      {/* Audio level ring indicator */}
      {voiceState === "recording" && (
        <span 
          className="absolute inset-0 rounded-md border-2 border-white/80 pointer-events-none"
          style={{
            transform: `scale(${1 + audioLevel * 0.5})`,
            opacity: 0.3 + audioLevel * 0.7,
            transition: 'transform 50ms ease-out, opacity 50ms ease-out',
          }}
        />
      )}
      {/* Secondary expanding ring */}
      {voiceState === "recording" && audioLevel > 0.1 && (
        <span 
          className="absolute inset-0 rounded-md border border-red-300 pointer-events-none"
          style={{
            transform: `scale(${1.2 + audioLevel * 0.6})`,
            opacity: Math.max(0, audioLevel - 0.1) * 0.5,
            transition: 'transform 80ms ease-out, opacity 80ms ease-out',
          }}
        />
      )}
      
      {/* Countdown timer - bottom left corner */}
      {voiceState === "recording" && (
        <span 
          className="absolute -bottom-0.5 -left-0.5 bg-red-600 text-white text-[8px] font-bold rounded px-0.5 leading-none py-0.5 tabular-nums shadow-sm"
        >
          {remainingSeconds}
        </span>
      )}
      
      {/* Cancel button - top right corner */}
      {voiceState === "recording" && (
        <span
          role="button"
          onClick={handleCancel}
          className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-gray-600 hover:bg-gray-700 text-white flex items-center justify-center shadow-sm cursor-pointer"
          title="Cancel"
        >
          <X className="h-2 w-2" />
        </span>
      )}

      {getMainIcon(visuals)}
    </button>
  )

  // Text mode button content (with popover)
  const textButtonTrigger = (
    <button
      ref={ref}
      type="button"
      disabled={disabled || textState === "processing"}
      className={cn(
        "relative rounded-md flex items-center justify-center transition-colors z-10",
        !isStretching && "h-6 w-6",
        getButtonStyles(visuals),
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
      tabIndex={-1}
    >
      {getMainIcon(visuals)}
    </button>
  )

  // On mobile, skip the tooltip wrapper entirely but keep Popover for text mode
  if (isMobile) {
    if (mode === "voice") {
      return voiceButtonContent
    }
    // Text mode on mobile - wrap in Popover without Tooltip
    return (
      <Popover open={isPopoverOpen} onOpenChange={handlePopoverOpenChange}>
        <PopoverTrigger asChild>
          {textButtonTrigger}
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          sideOffset={8}
          className="w-72 p-2"
        >
          <PopoverFormContent
            inputRef={inputRef}
            inputValue={inputValue}
            setInputValue={setInputValue}
            handleKeyDown={handleKeyDown}
            handleTextSubmit={handleTextSubmit}
            textState={textState}
          />
        </PopoverContent>
      </Popover>
    )
  }

  // Voice mode: touchable tooltip with mode switch action
  if (mode === "voice") {
    return (
      <TouchableTooltip
        side="top"
        contentClassName="flex flex-col gap-1"
        content={
          <>
            <p className="text-xs">{getTooltipText(visuals)}</p>
            <TextAction
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setMode("text");
              }}
              className="text-left"
            >
              Switch to text input
            </TextAction>
          </>
        }
      >
        {voiceButtonContent}
      </TouchableTooltip>
    )
  }

  // Text mode: tooltip and popover both wrap the button
  return (
    <Tooltip open={!isPopoverOpen ? undefined : false}>
      <Popover open={isPopoverOpen} onOpenChange={handlePopoverOpenChange}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            {textButtonTrigger}
          </PopoverTrigger>
        </TooltipTrigger>
        <PopoverContent
          side="top"
          align="end"
          sideOffset={8}
          className="w-72 p-2"
        >
          <PopoverFormContent
            inputRef={inputRef}
            inputValue={inputValue}
            setInputValue={setInputValue}
            handleKeyDown={handleKeyDown}
            handleTextSubmit={handleTextSubmit}
            textState={textState}
            showDesktopHint={!isMobile}
          />
        </PopoverContent>
      </Popover>
      <TooltipContent side="top" sideOffset={5} className="flex flex-col gap-1">
        <p className="text-xs">{getTooltipText(visuals)}</p>
        <TextAction
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setMode("voice");
          }}
          className="text-left"
        >
          Switch to voice input
        </TextAction>
      </TooltipContent>
    </Tooltip>
  )
})

AIInputButton.displayName = "AIInputButton"
