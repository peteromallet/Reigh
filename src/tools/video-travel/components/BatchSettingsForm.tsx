import React from 'react';
import { Button } from "@/shared/components/ui/button";
import { Slider } from "@/shared/components/ui/slider";
import { Textarea } from "@/shared/components/ui/textarea";
import { Label } from "@/shared/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/components/ui/collapsible";
import { Switch } from "@/shared/components/ui/switch";
import { Input } from "@/shared/components/ui/input";
import { ChevronsUpDown, Info } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from "@/shared/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { SteerableMotionSettings } from './ShotEditor';
import { Project } from '@/types/project';
import { ASPECT_RATIO_TO_RESOLUTION } from '@/shared/lib/aspectRatios';
import { ToggleGroup, ToggleGroupItem } from '@/shared/components/ui/toggle-group';

interface BatchSettingsFormProps {
  batchVideoPrompt: string;
  onBatchVideoPromptChange: (value: string) => void;
  batchVideoFrames: number;
  onBatchVideoFramesChange: (value: number) => void;
  batchVideoContext: number;
  onBatchVideoContextChange: (value: number) => void;
  batchVideoSteps: number;
  onBatchVideoStepsChange: (value: number) => void;
  dimensionSource: 'project' | 'firstImage' | 'custom';
  onDimensionSourceChange: (source: 'project' | 'firstImage' | 'custom') => void;
  customWidth?: number;
  onCustomWidthChange: (v: number | undefined) => void;
  customHeight?: number;
  onCustomHeightChange: (v: number | undefined) => void;
  steerableMotionSettings: SteerableMotionSettings;
  onSteerableMotionSettingsChange: (settings: Partial<SteerableMotionSettings>) => void;
  projects: Project[];
  selectedProjectId: string | null;
  enhancePrompt: boolean;
  onEnhancePromptChange: (enhance: boolean) => void;
  generationMode: 'batch' | 'by-pair';
  onGenerationModeChange: (mode: 'batch' | 'by-pair') => void;
}

const BatchSettingsForm: React.FC<BatchSettingsFormProps> = ({
  batchVideoPrompt,
  onBatchVideoPromptChange,
  batchVideoFrames,
  onBatchVideoFramesChange,
  batchVideoContext,
  onBatchVideoContextChange,
  batchVideoSteps,
  onBatchVideoStepsChange,
  dimensionSource,
  onDimensionSourceChange,
  customWidth,
  onCustomWidthChange,
  customHeight,
  onCustomHeightChange,
  steerableMotionSettings,
  onSteerableMotionSettingsChange,
  projects,
  selectedProjectId,
  enhancePrompt,
  onEnhancePromptChange,
  generationMode,
  onGenerationModeChange,
}) => {
    const [showAdvanced, setShowAdvanced] = React.useState(false);

    return (
        <div className="space-y-6 mb-8">
          <div className="p-4 border rounded-lg bg-card shadow-md space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold">Generation Settings</h3>
              <ToggleGroup type="single" value={generationMode} onValueChange={(value: 'batch' | 'by-pair') => value && onGenerationModeChange(value)} className="my-2">
                <ToggleGroupItem value="batch" aria-label="Toggle batch">
                  Batch
                </ToggleGroupItem>
                <ToggleGroupItem value="by-pair" aria-label="Toggle by-pair">
                  By Pair
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            {generationMode === 'batch' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="relative">
                    <Label htmlFor="batchVideoPrompt" className="text-sm font-medium block mb-1.5">Prompt:</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="absolute top-0 right-0 text-muted-foreground cursor-help hover:text-foreground transition-colors">
                          <Info className="h-4 w-4" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>This prompt guides the style and transition for all video segments. <br /> Small changes can have a big impact.</p>
                      </TooltipContent>
                    </Tooltip>
                    <Textarea 
                      id="batchVideoPrompt"
                      value={batchVideoPrompt}
                      onChange={(e) => onBatchVideoPromptChange(e.target.value)}
                      placeholder="Enter a global prompt for all video segments... (e.g., cinematic transition)"
                      className="min-h-[70px] text-sm"
                      rows={3}
                    />
                    <div className="flex items-center space-x-2 mt-2">
                      <Label htmlFor="enhancePrompt" className="text-sm font-medium">
                        Enhance Prompts
                      </Label>
                      <Switch 
                        id="enhancePrompt"
                        checked={enhancePrompt}
                        onCheckedChange={(checked) => onEnhancePromptChange(checked as boolean)}
                      />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-muted-foreground cursor-help hover:text-foreground transition-colors">
                            <Info className="h-4 w-4" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Use AI to enhance and improve your prompt for better results. <br /> Requires OpenAI API key to be set in Settings.</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                  <div className="relative">
                    <Label htmlFor="negative_prompt" className="text-sm font-medium block mb-1.5">Negative Prompt:</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="absolute top-0 right-0 text-muted-foreground cursor-help hover:text-foreground transition-colors">
                          <Info className="h-4 w-4" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Specify what you want to avoid in the generated videos, <br /> like 'blurry' or 'distorted'.</p>
                      </TooltipContent>
                    </Tooltip>
                    <Textarea
                      id="negative_prompt"
                      value={steerableMotionSettings.negative_prompt}
                      onChange={(e) => onSteerableMotionSettingsChange({ negative_prompt: e.target.value })}
                      placeholder="e.g., blurry, low quality"
                      className="min-h-[70px] text-sm"
                      rows={3}
                    />
                  </div>
              </div>
            )}
            
            {generationMode === 'batch' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="relative">
                    <Label htmlFor="batchVideoFrames" className="text-sm font-medium block mb-1">Frames per pair: {batchVideoFrames}</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="absolute top-0 right-0 text-muted-foreground cursor-help hover:text-foreground transition-colors">
                          <Info className="h-4 w-4" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Determines the duration of the video segment for each image. <br /> More frames result in a longer segment.</p>
                      </TooltipContent>
                    </Tooltip>
                    <Slider
                      id="batchVideoFrames"
                      min={10}
                      max={81} 
                      step={1}
                      value={[batchVideoFrames]}
                      onValueChange={(value) => onBatchVideoFramesChange(value[0])}
                    />
                  </div>
                  <div className="relative">
                    <Label htmlFor="batchVideoContext" className="text-sm font-medium block mb-1">Number of Context Frames: {batchVideoContext}</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="absolute top-0 right-0 text-muted-foreground cursor-help hover:text-foreground transition-colors">
                          <Info className="h-4 w-4" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>How many frames from one segment to reference for the next. <br /> Helps create smoother transitions.</p>
                      </TooltipContent>
                    </Tooltip>
                    <Slider
                      id="batchVideoContext"
                      min={0}
                      max={60}
                      step={1}
                      value={[batchVideoContext]}
                      onValueChange={(value) => onBatchVideoContextChange(value[0])}
                    />
                  </div>
              </div>
            )}

            {generationMode === 'by-pair' && (
              <div className="grid grid-cols-1 gap-4">
                <div className="flex items-center space-x-2 mt-2">
                      <Label htmlFor="enhancePromptByPair" className="text-sm font-medium">
                        Enhance Prompts
                      </Label>
                      <Switch 
                        id="enhancePromptByPair"
                        checked={enhancePrompt}
                        onCheckedChange={(checked) => onEnhancePromptChange(checked as boolean)}
                      />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-muted-foreground cursor-help hover:text-foreground transition-colors">
                            <Info className="h-4 w-4" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Use AI to enhance and improve your prompt for better results. <br /> Requires OpenAI API key to be set in Settings.</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
              </div>
            )}

            <div className="relative">
              <Label htmlFor="batchVideoSteps" className="text-sm font-medium block mb-1">Generation Steps: {batchVideoSteps}</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="absolute top-0 right-0 text-muted-foreground cursor-help hover:text-foreground transition-colors">
                    <Info className="h-4 w-4" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Number of processing steps for each frame. <br /> Higher values can improve quality but increase generation time.</p>
                </TooltipContent>
              </Tooltip>
              <Slider
                id="batchVideoSteps"
                min={1}
                max={20}
                step={1}
                value={[batchVideoSteps]}
                onValueChange={(value) => onBatchVideoStepsChange(value[0])}
              />
            </div>
            <div>
              <Label className="text-sm font-medium block mb-2">Dimension Source</Label>
              <RadioGroup
                value={dimensionSource || 'firstImage'}
                onValueChange={(value) => {
                  const newSource = value as 'project' | 'firstImage' | 'custom';
                  onDimensionSourceChange(newSource);
                  if (newSource === 'custom' && (!customWidth || !customHeight)) {
                    const project = projects.find(p => p.id === selectedProjectId);
                    if (project && project.aspectRatio) {
                      const res = ASPECT_RATIO_TO_RESOLUTION[project.aspectRatio];
                      if (res) {
                        const [width, height] = res.split('x').map(Number);
                        onCustomWidthChange(width);
                        onCustomHeightChange(height);
                      }
                    }
                  }
                }}
                className="flex space-x-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="firstImage" id="r_firstImage" />
                  <Label htmlFor="r_firstImage">Use First Image Dimensions</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="project" id="r_project" />
                  <Label htmlFor="r_project">Use Project Dimensions</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="custom" id="r_custom" />
                  <Label htmlFor="r_custom">Custom</Label>
                </div>
              </RadioGroup>
            </div>
            {dimensionSource === 'custom' && (
              <div className="grid grid-cols-2 gap-4 p-4 border rounded-md bg-muted/20">
                <div>
                  <Label htmlFor="customWidth">Width</Label>
                  <Input
                    id="customWidth"
                    type="number"
                    value={customWidth || ''}
                    onChange={(e) => onCustomWidthChange(parseInt(e.target.value, 10) || undefined)}
                    placeholder="e.g., 1024"
                  />
                </div>
                <div>
                  <Label htmlFor="customHeight">Height</Label>
                  <Input
                    id="customHeight"
                    type="number"
                    value={customHeight || ''}
                    onChange={(e) => onCustomHeightChange(parseInt(e.target.value, 10) || undefined)}
                    placeholder="e.g., 576"
                  />
                </div>
                {(customWidth || 0) > 2048 || (customHeight || 0) > 2048 ? (
                  <p className="col-span-2 text-sm text-destructive">Warning: Very large dimensions may lead to slow generation or failures.</p>
                ) : null}
              </div>
            )}
            
            <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="w-full justify-center text-sm">
                  <ChevronsUpDown className="h-4 w-4 mr-2" />
                  {showAdvanced ? 'Hide' : 'Show'} Advanced Settings
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="model_name">Model Name</Label>
                    <Input
                      id="model_name"
                      value={steerableMotionSettings.model_name}
                      onChange={(e) => onSteerableMotionSettingsChange({ model_name: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="seed">Seed</Label>
                    <Input
                      id="seed"
                      type="number"
                      value={steerableMotionSettings.seed}
                      onChange={(e) => onSteerableMotionSettingsChange({ seed: parseInt(e.target.value, 10) || 0 })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 items-center">
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="debug"
                      checked={steerableMotionSettings.debug ?? true}
                      onCheckedChange={(v) => onSteerableMotionSettingsChange({ debug: v })}
                    />
                    <Label htmlFor="debug">Debug Mode</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="apply_reward_lora"
                      checked={steerableMotionSettings.apply_reward_lora ?? true}
                      onCheckedChange={(v) => onSteerableMotionSettingsChange({ apply_reward_lora: v })}
                    />
                    <Label htmlFor="apply_reward_lora">Apply Reward LoRA</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="apply-causvid"
                      checked={steerableMotionSettings.apply_causvid ?? true}
                      onCheckedChange={(v) => onSteerableMotionSettingsChange({ apply_causvid: v })}
                    />
                    <Label htmlFor="apply-causvid">Apply Causvid</Label>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </div>
    );
};

export default BatchSettingsForm; 