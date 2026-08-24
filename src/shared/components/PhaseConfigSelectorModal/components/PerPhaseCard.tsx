import React from 'react';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent } from '@/shared/components/ui/card';
import { NumberInput } from '@/shared/components/ui/number-input';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/primitives/label';
import { Slider } from '@/shared/components/ui/slider';
import { TextAction } from '@/shared/components/ui/composed/text-action';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { AlertTriangle, Download, Search, Trash2 } from 'lucide-react';
import { PREDEFINED_LORAS, getDisplayNameFromUrl } from '@/domains/lora/lib/loraUtils';
import { validateHuggingFaceUrl } from '@/domains/lora/components/LoraSelectorModal/utils/validation-utils';
import { updateLoraField } from '../PhaseConfigVertical.helpers';
import type { PerPhaseCardProps } from '../types';

function groupPredefinedLoras() {
  return Object.entries(
    PREDEFINED_LORAS.reduce((accumulator, lora) => {
      if (!accumulator[lora.category]) {
        accumulator[lora.category] = [];
      }
      accumulator[lora.category].push(lora);
      return accumulator;
    }, {} as Record<string, typeof PREDEFINED_LORAS>),
  );
}

export const PerPhaseCard: React.FC<PerPhaseCardProps> = ({
  phaseConfig,
  onPhaseConfigChange,
  phaseIdx,
  phase,
  label,
  availableLoras,
  focusedLoraInput,
  onFocusLoraInput,
  onOpenLoraModal,
  onBlurSave,
}) => {
  return (
    <Card className="bg-muted/30 relative">
      <div className="absolute top-3 left-3 z-10">
        <span className="text-sm font-medium border border-border rounded-md px-2 py-1 bg-background/50">
          {label}
        </span>
      </div>

      <CardContent className="pt-12 px-4 pb-4">
        <div className="grid grid-cols-3 gap-6">
          <div className="space-y-3">
            <div>
              <Label htmlFor={`steps_${phaseIdx}`} className="text-sm font-light block mb-1.5">
                Steps: {phaseConfig.steps_per_phase[phaseIdx]}
              </Label>
              <Slider
                id={`steps_${phaseIdx}`}
                min={1}
                max={15}
                step={1}
                value={phaseConfig.steps_per_phase[phaseIdx]}
                onValueChange={(value) => {
                  const nextValue = Array.isArray(value)
                    ? (value[0] ?? phaseConfig.steps_per_phase[phaseIdx])
                    : value;
                  const updatedSteps = [...phaseConfig.steps_per_phase];
                  updatedSteps[phaseIdx] = nextValue;
                  onPhaseConfigChange({
                    ...phaseConfig,
                    steps_per_phase: updatedSteps,
                  });
                }}
              />
            </div>

            <div>
              <Label htmlFor={`guidance_scale_${phaseIdx}`} className="text-sm font-light block mb-1.5">
                Guidance Scale:
              </Label>
              <NumberInput
                id={`guidance_scale_${phaseIdx}`}
                min={0}
                max={10}
                step={0.1}
                value={phase.guidance_scale}
                onChange={(value) => {
                  const updatedPhases = phaseConfig.phases.map((currentPhase, index) =>
                    index === phaseIdx
                      ? { ...currentPhase, guidance_scale: value ?? currentPhase.guidance_scale }
                      : currentPhase,
                  );
                  onPhaseConfigChange({
                    ...phaseConfig,
                    phases: updatedPhases,
                  });
                }}
              />
            </div>
          </div>

          <div className="col-span-2">
            <Label className="text-sm font-medium mb-1.5 block">LoRAs:</Label>
            <div className="grid grid-cols-2 gap-2 mb-1.5 w-full">
              <Button size="sm" variant="outline" onClick={() => onOpenLoraModal(phaseIdx)} type="button">
                <Search className="h-3 w-3 mr-1" /> Search
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" type="button">
                    <Download className="h-3 w-3 mr-1" /> Utility
                  </Button>
                </DropdownMenuTrigger>

                <DropdownMenuContent align="end" className="w-72">
                  {groupPredefinedLoras().map(([category, loras], index) => (
                    <React.Fragment key={category}>
                      {index > 0 && <DropdownMenuSeparator />}
                      <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground">
                        {category}
                      </DropdownMenuLabel>
                      {loras.map((predefinedLora) => (
                        <DropdownMenuItem
                          key={predefinedLora.url}
                          onClick={() => {
                            const updatedPhases = phaseConfig.phases.map((currentPhase, currentIndex) =>
                              currentIndex === phaseIdx
                                ? {
                                    ...currentPhase,
                                    loras: [
                                      ...currentPhase.loras.filter((lora) => lora.url && lora.url.trim() !== ''),
                                      { url: predefinedLora.url, multiplier: '1.0' },
                                    ],
                                  }
                                : currentPhase,
                            );
                            onPhaseConfigChange({
                              ...phaseConfig,
                              phases: updatedPhases,
                            });
                          }}
                          className="text-xs preserve-case"
                        >
                          {predefinedLora.name}
                        </DropdownMenuItem>
                      ))}
                    </React.Fragment>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {phase.loras.map((lora, loraIdx) => {
              const inputId = `lora-${phaseIdx}-${loraIdx}`;
              const isFocused = focusedLoraInput === inputId;
              const loraValidation = lora.url ? validateHuggingFaceUrl(lora.url) : null;

              return (
                <div key={loraIdx} className="space-y-0.5 mb-1.5">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1 min-w-0">
                      <Input
                        placeholder="LoRA URL"
                        value={isFocused ? lora.url : getDisplayNameFromUrl(lora.url, availableLoras)}
                        className={`pr-8 ${
                          loraValidation && !loraValidation.isValid
                            ? 'border-yellow-500 focus-visible:ring-yellow-500'
                            : ''
                        }`}
                        onChange={(event) => {
                          onPhaseConfigChange({
                            ...phaseConfig,
                            phases: updateLoraField(
                              phaseConfig,
                              phaseIdx,
                              loraIdx,
                              'url',
                              event.target.value,
                            ),
                          });
                        }}
                        onFocus={() => onFocusLoraInput(inputId)}
                        onBlur={() => {
                          onFocusLoraInput(null);
                          onBlurSave?.();
                        }}
                        title={lora.url}
                      />

                      <div className="absolute right-1 top-1/2 -translate-y-1/2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => {
                            const updatedPhases = phaseConfig.phases.map((currentPhase, currentIndex) =>
                              currentIndex === phaseIdx
                                ? {
                                    ...currentPhase,
                                    loras: currentPhase.loras.filter((_, currentLoraIndex) => currentLoraIndex !== loraIdx),
                                  }
                                : currentPhase,
                            );
                            onPhaseConfigChange({
                              ...phaseConfig,
                              phases: updatedPhases,
                            });
                          }}
                          type="button"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <NumberInput
                      placeholder="Multiplier"
                      value={parseFloat(lora.multiplier) || 0}
                      min={0}
                      max={2}
                      step={0.1}
                      onChange={(value) => {
                        onPhaseConfigChange({
                          ...phaseConfig,
                          phases: updateLoraField(
                            phaseConfig,
                            phaseIdx,
                            loraIdx,
                            'multiplier',
                            String(value),
                          ),
                        });
                      }}
                      className="w-20 flex-shrink-0"
                    />
                  </div>

                  {loraValidation && !loraValidation.isValid && (
                    <div className="flex items-center gap-1 text-yellow-500 text-xs px-1">
                      <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                      <span>{loraValidation.message}</span>
                    </div>
                  )}
                </div>
              );
            })}

            <TextAction
              onClick={() => {
                const updatedPhases = phaseConfig.phases.map((currentPhase, currentIndex) =>
                  currentIndex === phaseIdx
                    ? {
                        ...currentPhase,
                        loras: [
                          ...currentPhase.loras.filter((lora) => lora.url && lora.url.trim() !== ''),
                          { url: '', multiplier: '1.0' },
                        ],
                      }
                    : currentPhase,
                );
                onPhaseConfigChange({
                  ...phaseConfig,
                  phases: updatedPhases,
                });
              }}
              className="cursor-pointer"
            >
              + Add LoRA
            </TextAction>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
