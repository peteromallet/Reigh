import React from 'react';
import { Button } from '@/shared/components/ui/button';
import { Palette, Crown, Star, Wrench, PlusCircle, Settings } from 'lucide-react';
import { cn } from '@/shared/components/ui/contracts/cn';
import { darkIconColors, getDarkIconStyle, getReferralButtonText, type HeaderSession } from './types';
import type { ReferralStats } from './types';

export interface GlobalHeaderSharedActionsProps {
  onOpenSettings?: () => void;
  session: HeaderSession | null;
  referralStats: ReferralStats | null;
  isBrandFlash: boolean;
  triggerBrandFlash: () => void;
  onOpenCreateProject: (initialName?: string) => void;
  onOpenProjectSettings: () => void;
  onOpenReferralModal: () => void;
}

type HeaderDensity = 'desktop' | 'desktop-compact' | 'mobile';

interface GlobalHeaderBrandProps {
  density: HeaderDensity;
  darkMode: boolean;
  isBrandFlash: boolean;
  triggerBrandFlash: () => void;
  onNavigateHome: () => void;
}

export const GlobalHeaderBrand: React.FC<GlobalHeaderBrandProps> = ({
  density,
  darkMode,
  isBrandFlash,
  triggerBrandFlash,
  onNavigateHome,
}) => {
  const isMobile = density === 'mobile';

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label="Go to homepage"
      onPointerDown={triggerBrandFlash}
      onPointerUp={onNavigateHome}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          onNavigateHome();
        }
      }}
      className={cn(
        'group relative cursor-pointer z-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-wes-vintage-gold/50',
        isMobile ? 'rounded-xl' : 'p-2 -m-2 rounded-2xl flex items-center gap-x-4',
      )}
    >
      <div className={cn('relative', isMobile && 'flex items-center gap-x-2')}>
        <div className="relative">
          <div
            className={cn(
              'flex items-center justify-center bg-gradient-to-br from-wes-pink via-wes-lavender to-wes-dusty-blue',
              'dark:bg-none dark:border-2 rounded-sm',
              'touch-border-gold',
              isMobile
                ? 'w-12 h-12 shadow-[-3px_3px_0_0_hsl(var(--shadow-header)_/_0.15)] dark:shadow-[-3px_3px_0_0_hsl(var(--shadow-header-dark)_/_0.4)] group-hover:shadow-[-1px_1px_0_0_hsl(var(--shadow-header)_/_0.15)] dark:group-hover:shadow-[-1px_1px_0_0_hsl(var(--shadow-header-dark)_/_0.4)]'
                : 'w-16 h-16 shadow-[-4px_4px_0_0_hsl(var(--shadow-header)_/_0.15)] dark:shadow-[-4px_4px_0_0_hsl(var(--shadow-header-dark)_/_0.4)] group-hover:shadow-[-2px_2px_0_0_hsl(var(--shadow-header)_/_0.15)] dark:group-hover:shadow-[-2px_2px_0_0_hsl(var(--shadow-header-hover)_/_0.4)]',
              'group-hover:translate-x-[1px] group-hover:translate-y-[1px] transition-all duration-300',
              isBrandFlash && darkMode ? '!border-wes-vintage-gold' : null,
            )}
            style={getDarkIconStyle(darkIconColors.palette, darkMode)}
          >
            <Palette
              className={cn(
                'group-hover:rotate-12 transition-all duration-300',
                'drop-shadow-lg dark:drop-shadow-none touch-hover-gold',
                isMobile ? 'h-6 w-6' : 'h-8 w-8',
                darkMode
                  ? 'text-[#a098a8] animate-color-shift group-hover:animate-none'
                  : 'text-white',
                isBrandFlash
                  ? (darkMode ? 'animate-none !text-wes-vintage-gold' : '!text-[#f0ebe3]')
                  : null,
              )}
            />
          </div>
          <div className={cn('absolute pointer-events-none', isMobile ? '-top-1 -right-1' : '-top-2 -right-2')}>
            <Crown
              className={cn(
                'text-wes-vintage-gold animate-bounce-gentle opacity-60',
                isMobile ? 'w-2.5 h-2.5' : 'w-4 h-4',
              )}
            />
          </div>
          {!isMobile && (
            <div className="absolute -inset-1 border border-wes-vintage-gold/20 rounded-2xl animate-rotate-slow opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
          )}
        </div>

        {isMobile && (
          <div className="relative">
            <span className="font-heading text-xl font-theme-heading tracking-wide text-primary text-shadow-vintage group-hover:animate-vintage-glow transition-all duration-300">
              Reigh
            </span>
            <div className="absolute -top-1 -right-1 pointer-events-none">
              <Star className="w-2 h-2 text-wes-vintage-gold animate-rotate-slow opacity-50" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface GlobalHeaderProjectButtonsProps {
  density: HeaderDensity;
  darkMode: boolean;
  isLoadingProjects: boolean;
  hasSelectedProject: boolean;
  onOpenProjectSettings: () => void;
  onOpenCreateProject: (initialName?: string) => void;
}

export const GlobalHeaderProjectButtons: React.FC<GlobalHeaderProjectButtonsProps> = ({
  density,
  darkMode,
  isLoadingProjects,
  hasSelectedProject,
  onOpenProjectSettings,
  onOpenCreateProject,
}) => {
  const isMobile = density === 'mobile';
  const isCompact = density === 'desktop-compact';
  const buttonSizeClass = isCompact ? 'h-[22px] w-[38px]' : isMobile ? 'h-10 w-10' : 'h-12 w-12';
  const wrenchIconClass = isCompact ? 'h-3 w-3' : isMobile ? 'h-4 w-4' : 'h-5 w-5';
  const plusIconClass = isCompact ? 'h-3 w-3' : isMobile ? 'h-4 w-4' : 'h-5 w-5';
  const shadowClass = isCompact
    ? 'shadow-[-1px_1px_0_0_hsl(var(--shadow-header)_/_0.15)] dark:shadow-[-1px_1px_0_0_hsl(var(--shadow-header-dark)_/_0.4)] hover:shadow-none hover:translate-x-[0.5px] hover:translate-y-[0.5px]'
    : isMobile
    ? 'shadow-[-2px_2px_0_0_hsl(var(--shadow-header)_/_0.15)] dark:shadow-[-2px_2px_0_0_hsl(var(--shadow-header-dark)_/_0.4)] hover:shadow-[-1px_1px_0_0_hsl(var(--shadow-header)_/_0.15)] dark:hover:shadow-[-1px_1px_0_0_hsl(var(--shadow-header-hover)_/_0.4)] hover:translate-x-[0.5px] hover:translate-y-[0.5px]'
    : 'shadow-[-3px_3px_0_0_hsl(var(--shadow-header)_/_0.15)] dark:shadow-[-3px_3px_0_0_hsl(var(--shadow-header-dark)_/_0.4)] hover:shadow-[-1px_1px_0_0_hsl(var(--shadow-header)_/_0.15)] dark:hover:shadow-[-1px_1px_0_0_hsl(var(--shadow-header-hover)_/_0.4)] hover:translate-x-[1px] hover:translate-y-[1px]';

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={onOpenProjectSettings}
        className={cn(
          buttonSizeClass,
          shadowClass,
          'gradient-icon-coral dark:bg-none dark:border-2 rounded-sm group disabled:cursor-not-allowed transition-all duration-300',
        )}
        disabled={isLoadingProjects || !hasSelectedProject}
        style={getDarkIconStyle(darkIconColors.coral, darkMode)}
      >
        <Wrench className={cn(wrenchIconClass, 'group-hover:animate-wrench-turn')} style={{ color: darkMode ? darkIconColors.coral : 'white' }} />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={() => onOpenCreateProject(undefined)}
        className={cn(
          buttonSizeClass,
          shadowClass,
          'wes-button-pulse gradient-icon-yellow dark:bg-none dark:border-2 rounded-sm group transition-all duration-300',
        )}
        style={getDarkIconStyle(darkIconColors.yellow, darkMode)}
      >
        <PlusCircle className={cn(plusIconClass, 'transition-transform duration-300 group-hover:scale-110')} style={{ color: darkMode ? darkIconColors.yellow : 'white' }} />
      </Button>
    </>
  );
};

interface GlobalHeaderReferralButtonProps {
  density: HeaderDensity;
  session: HeaderSession | null;
  referralStats: ReferralStats | null;
  onOpenReferralModal: () => void;
}

export const GlobalHeaderReferralButton: React.FC<GlobalHeaderReferralButtonProps> = ({
  density,
  session,
  referralStats,
  onOpenReferralModal,
}) => {
  const isMobile = density === 'mobile';

  return (
    <button
      className={cn(
        'text-muted-foreground underline cursor-pointer font-thin hover:text-foreground transition-colors duration-200 text-right touch-manipulation active:text-foreground/70 relative z-50',
        isMobile
          ? 'text-[10px] min-h-[44px] px-2 py-2 max-w-[64px] leading-tight'
          : 'text-xs mb-0.5',
      )}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenReferralModal();
      }}
      onTouchStart={isMobile ? (event) => event.stopPropagation() : undefined}
      onTouchEnd={isMobile ? (event) => event.stopPropagation() : undefined}
      type="button"
    >
      {getReferralButtonText(session, referralStats)}
    </button>
  );
};

interface GlobalHeaderSettingsButtonProps {
  density: HeaderDensity;
  darkMode: boolean;
  onOpenSettings?: () => void;
}

export const GlobalHeaderSettingsButton: React.FC<GlobalHeaderSettingsButtonProps> = ({
  density,
  darkMode,
  onOpenSettings,
}) => {
  const isMobile = density === 'mobile';
  const buttonSizeClass = isMobile ? 'h-10 w-10' : 'h-12 w-12';
  const iconClass = isMobile ? 'h-4 w-4' : 'h-5 w-5';
  const shadowClass = isMobile
    ? 'shadow-[-2px_2px_0_0_hsl(var(--shadow-header)_/_0.15)] dark:shadow-[-2px_2px_0_0_hsl(var(--shadow-header-dark)_/_0.4)] hover:shadow-[-1px_1px_0_0_hsl(var(--shadow-header)_/_0.15)] dark:hover:shadow-[-1px_1px_0_0_hsl(var(--shadow-header-hover)_/_0.4)] hover:translate-x-[0.5px] hover:translate-y-[0.5px]'
    : 'shadow-[-3px_3px_0_0_hsl(var(--shadow-header)_/_0.15)] dark:shadow-[-3px_3px_0_0_hsl(var(--shadow-header-dark)_/_0.4)] hover:shadow-[-1px_1px_0_0_hsl(var(--shadow-header)_/_0.15)] dark:hover:shadow-[-1px_1px_0_0_hsl(var(--shadow-header-hover)_/_0.4)] hover:translate-x-[1px] hover:translate-y-[1px]';

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onOpenSettings}
      className={cn(
        buttonSizeClass,
        shadowClass,
        'no-sweep wes-button-spin-pulse gradient-icon-blue dark:bg-none dark:border-2 rounded-sm group relative overflow-hidden transition-all duration-300',
      )}
      style={getDarkIconStyle(darkIconColors.blue, darkMode)}
    >
      <div className="absolute inset-0 bg-film-grain opacity-20 animate-film-grain pointer-events-none" />
      <Settings className={cn(iconClass, 'relative z-10 transition-transform duration-500 group-hover:[transform:rotate(360deg)] delay-100')} style={{ color: darkMode ? darkIconColors.blue : 'white' }} />
    </Button>
  );
};
