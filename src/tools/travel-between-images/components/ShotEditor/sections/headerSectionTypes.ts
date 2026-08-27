import type React from 'react';

export interface HeaderSectionCallbacks {
  onBack: () => void;
  onPreviousShot?: () => void;
  onNextShot?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
  onUpdateShotName?: (name: string) => void;
  onNameClick: () => void;
  onNameSave: () => void;
  onNameCancel: (e?: React.MouseEvent) => void;
  onNameKeyDown: (e: React.KeyboardEvent) => void;
}

export interface HeaderSectionLayout {
  readOnly?: boolean;
  headerContainerRef?: (node: HTMLDivElement | null) => void;
  centerSectionRef: React.RefObject<HTMLDivElement>;
  isSticky?: boolean;
}
