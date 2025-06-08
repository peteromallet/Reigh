import React from 'react';
import { Outlet } from 'react-router-dom';
import { GlobalHeader } from '@/shared/components/GlobalHeader';
import TasksPane from '@/shared/components/TasksPane/TasksPane';
import ShotsPane from '@/shared/components/ShotsPane/ShotsPane';
import GenerationsPane from '@/shared/components/GenerationsPane/GenerationsPane';
import { cn } from '@/shared/lib/utils';
import { usePanes } from '@/shared/contexts/PanesContext';

const Layout: React.FC = () => {
  const { 
    isTasksPaneLocked, 
    tasksPaneWidth, 
    isShotsPaneLocked, 
    shotsPaneWidth, 
    isGenerationsPaneLocked, 
    generationsPaneHeight 
  } = usePanes();

  const mainContentStyle = {
    marginRight: isTasksPaneLocked ? `${tasksPaneWidth}px` : '0px',
    marginLeft: isShotsPaneLocked ? `${shotsPaneWidth}px` : '0px',
    paddingBottom: isGenerationsPaneLocked ? `${generationsPaneHeight}px` : '0px',
    transition: 'margin 300ms ease-in-out, padding 300ms ease-in-out',
  };

  return (
    <div className="flex flex-col min-h-screen wes-texture">
      {/* Subtle background gradient */}
      <div className="fixed inset-0 bg-gradient-to-br from-wes-cream via-white to-wes-mint/10 opacity-60 pointer-events-none"></div>
      
      <GlobalHeader 
        contentOffsetRight={isTasksPaneLocked ? tasksPaneWidth : 0} 
        contentOffsetLeft={isShotsPaneLocked ? shotsPaneWidth : 0}
      />
      
      <div 
        className="flex-grow relative z-10"
        style={mainContentStyle}
      >
        <main className="container mx-auto py-8 px-4 md:px-6 h-full overflow-y-auto">
          <div className="wes-frame min-h-full">
            <Outlet /> 
          </div>
        </main>
      </div>
      
      <TasksPane />
      <ShotsPane />
      <GenerationsPane />
      
      {/* Decorative footer line */}
      <div className="h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent relative z-10"></div>
    </div>
  );
};

export default Layout; 