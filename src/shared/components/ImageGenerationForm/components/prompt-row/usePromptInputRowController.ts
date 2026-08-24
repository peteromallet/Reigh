import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useIsMobile } from '@/shared/hooks/mobile';
import { useTouchDragDetection } from '@/shared/hooks/useTouchDragDetection';
import { PromptInputRowProps } from '../../types';

interface PromptInputRowController {
  currentPlaceholder: string;
  displayText: string;
  handleBlur: () => void;
  handlePromptRowClick: () => void;
  handleFocus: () => void;
  handleFullPromptChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  handlePointerDown: (event: React.PointerEvent) => void;
  handleTouchStart: (event: React.TouchEvent) => void;
  handleVoiceResult: (result: { prompt?: string; transcription?: string }) => void;
  isEditingFullPrompt: boolean;
  isMobile: boolean;
  promptContainerRef: React.MutableRefObject<HTMLDivElement>;
  textareaRef: React.MutableRefObject<HTMLTextAreaElement>;
  clearPrompt: () => void;
}

export const usePromptInputRowController = ({
  autoEnterEditWhenActive = false,
  forceExpanded = false,
  index,
  isActiveForFullView,
  onSetActiveForFullView,
  onUpdate,
  promptEntry,
}: Pick<
  PromptInputRowProps,
  | 'autoEnterEditWhenActive'
  | 'forceExpanded'
  | 'index'
  | 'isActiveForFullView'
  | 'onSetActiveForFullView'
  | 'onUpdate'
  | 'promptEntry'
>): PromptInputRowController => {
  const textareaRef = useRef<HTMLTextAreaElement>(null!);
  const promptContainerRef = useRef<HTMLDivElement>(null!);
  const [isEditingFullPrompt, setIsEditingFullPrompt] = useState(false);
  const [localFullPrompt, setLocalFullPrompt] = useState(promptEntry.fullPrompt);
  const isMobile = useIsMobile();
  const [pendingEnterEdit, setPendingEnterEdit] = useState(false);
  const { isDragging, handleTouchStart } = useTouchDragDetection();
  const [lastParentUpdate, setLastParentUpdate] = useState(promptEntry.fullPrompt);

  useEffect(() => {
    if (!isEditingFullPrompt && promptEntry.fullPrompt !== lastParentUpdate) {
      setLocalFullPrompt(promptEntry.fullPrompt);
      setLastParentUpdate(promptEntry.fullPrompt);
    }
  }, [promptEntry.fullPrompt, isEditingFullPrompt, lastParentUpdate]);

  useEffect(() => {
    if (!isActiveForFullView && isEditingFullPrompt) {
      setIsEditingFullPrompt(false);
    }
  }, [isActiveForFullView, isEditingFullPrompt]);

  useEffect(() => {
    if (isMobile && pendingEnterEdit && isActiveForFullView) {
      setIsEditingFullPrompt(true);
      setPendingEnterEdit(false);
    }
  }, [isMobile, pendingEnterEdit, isActiveForFullView]);

  useEffect(() => {
    if (isMobile && autoEnterEditWhenActive && isActiveForFullView && !isEditingFullPrompt) {
      setIsEditingFullPrompt(true);
    }
  }, [isMobile, autoEnterEditWhenActive, isActiveForFullView, isEditingFullPrompt]);

  const autoResizeTextarea = useCallback(() => {
    if (!textareaRef.current) {
      return;
    }

    textareaRef.current.style.height = 'auto';
    const scrollHeight = textareaRef.current.scrollHeight;

    if (isActiveForFullView || isEditingFullPrompt || forceExpanded) {
      const minHeight = isMobile ? 96 : 72;
      textareaRef.current.style.height = `${Math.max(minHeight, scrollHeight)}px`;
      return;
    }

    const fixedHeight = isMobile ? 56 : 32;
    textareaRef.current.style.height = `${fixedHeight}px`;
  }, [isActiveForFullView, isEditingFullPrompt, forceExpanded, isMobile]);

  const displayText = isEditingFullPrompt ? localFullPrompt : promptEntry.fullPrompt;

  useEffect(() => {
    autoResizeTextarea();
  }, [displayText, autoResizeTextarea]);

  useEffect(() => {
    if (isMobile && isEditingFullPrompt && textareaRef.current) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    }
  }, [isMobile, isEditingFullPrompt]);

  useEffect(() => {
    if (isMobile && isActiveForFullView && promptContainerRef.current) {
      setTimeout(() => {
        promptContainerRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest',
        });
      }, 100);
    }
  }, [isMobile, isActiveForFullView]);

  const handleFullPromptChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = event.target.value;
    console.count(`[PromptEditResetTrace] Row:${promptEntry.id}:onChange`);
    setLocalFullPrompt(newText);
    onUpdate(promptEntry.id, 'fullPrompt', newText);
  }, [promptEntry.id, onUpdate]);

  const handleFocus = useCallback(() => {
    if (!isMobile) {
      setIsEditingFullPrompt(true);
      onSetActiveForFullView(promptEntry.id);
    }
  }, [isMobile, onSetActiveForFullView, promptEntry.id]);

  const handlePromptRowClick = useCallback(() => {
    if (isMobile && !isDragging.current) {
      setPendingEnterEdit(true);
      onSetActiveForFullView(promptEntry.id);
    }
  }, [isMobile, isDragging, onSetActiveForFullView, promptEntry.id]);

  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    if (
      isMobile
      && event.isPrimary
      && (event.pointerType === 'touch' || event.pointerType === 'pen')
    ) {
      event.preventDefault();
    }
  }, [isMobile]);

  const handleBlur = useCallback(() => {
    setIsEditingFullPrompt(false);
    if (localFullPrompt !== promptEntry.fullPrompt) {
      onUpdate(promptEntry.id, 'fullPrompt', localFullPrompt);
    }
  }, [localFullPrompt, onUpdate, promptEntry.fullPrompt, promptEntry.id]);

  useEffect(() => {
    if (
      !isEditingFullPrompt
      && localFullPrompt !== promptEntry.fullPrompt
      && localFullPrompt !== lastParentUpdate
    ) {
      onUpdate(promptEntry.id, 'fullPrompt', localFullPrompt);
    }
  }, [
    isEditingFullPrompt,
    localFullPrompt,
    promptEntry.fullPrompt,
    promptEntry.id,
    lastParentUpdate,
    onUpdate,
  ]);

  const clearPrompt = useCallback(() => {
    setLocalFullPrompt('');
    onUpdate(promptEntry.id, 'fullPrompt', '');
  }, [onUpdate, promptEntry.id]);

  const handleVoiceResult = useCallback((result: { prompt?: string; transcription?: string }) => {
    const text = result.prompt || result.transcription || '';
    setLocalFullPrompt(text);
    onUpdate(promptEntry.id, 'fullPrompt', text);
  }, [onUpdate, promptEntry.id]);

  const currentPlaceholder = isEditingFullPrompt
    ? `Editing prompt #${index + 1}...`
    : `Enter prompt #${index + 1}...`;

  return {
    currentPlaceholder,
    displayText,
    handleBlur,
    handlePromptRowClick,
    handleFocus,
    handleFullPromptChange,
    handlePointerDown,
    handleTouchStart,
    handleVoiceResult,
    isEditingFullPrompt,
    isMobile,
    promptContainerRef,
    textareaRef,
    clearPrompt,
  };
};
