import { Loader2 } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Label } from '@/shared/components/ui/primitives/label';
import { Textarea } from '@/shared/components/ui/textarea';
import { NumberInput } from '@/shared/components/ui/number-input';
import { Slider } from '@/shared/components/ui/slider';
import { Switch } from '@/shared/components/ui/switch';
import type { JoinSettings } from '../hooks/useVideoItemJoinClips';

interface JoinClipsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  segmentCount: number;
  isJoiningClips: boolean;
  onConfirmJoin: () => void;
  settings: JoinSettings;
}

export function JoinClipsModal({
  open,
  onOpenChange,
  segmentCount,
  isJoiningClips,
  onConfirmJoin,
  settings,
}: JoinClipsModalProps) {
  const {
    joinPrompt, setJoinPrompt,
    joinNegativePrompt, setJoinNegativePrompt,
    joinContextFrames, setJoinContextFrames,
    joinGapFrames, setJoinGapFrames,
    joinReplaceMode, setJoinReplaceMode,
  } = settings;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Join {segmentCount} Segments</DialogTitle>
          <DialogDescription>
            Configure settings for joining the segments into a single video
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Prompts */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="join-prompt">Prompt: (Optional)</Label>
              <Textarea
                id="join-prompt"
                value={joinPrompt}
                onChange={(e) => setJoinPrompt(e.target.value)}
                placeholder="Describe what you want for the transitions between segments"
                rows={3}
                className="resize-none"
                clearable
                onClear={() => setJoinPrompt('')}
                voiceInput
                voiceContext="This is a prompt for video segment transitions. Describe the motion, style, or visual effect you want when joining video clips together. Focus on how elements should move or transform."
                onVoiceResult={(result) => {
                  setJoinPrompt(result.prompt || result.transcription);
                }}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="join-negative-prompt">Negative Prompt: (Optional)</Label>
              <Textarea
                id="join-negative-prompt"
                value={joinNegativePrompt}
                onChange={(e) => setJoinNegativePrompt(e.target.value)}
                placeholder="What to avoid in the transitions"
                rows={2}
                className="resize-none"
                clearable
                onClear={() => setJoinNegativePrompt('')}
                voiceInput
                voiceContext="This is a negative prompt - things to AVOID in video transitions. List unwanted qualities like 'jerky, flickering, blurry'. Keep it as a comma-separated list."
                onVoiceResult={(result) => {
                  setJoinNegativePrompt(result.prompt || result.transcription);
                }}
              />
            </div>
          </div>

          {/* Frame Controls */}
          <div className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="join-gap-frames" className="text-sm">
                  Gap Frames
                </Label>
                <span className="text-sm font-medium">{joinGapFrames}</span>
              </div>
              <Slider
                id="join-gap-frames"
                min={1}
                max={Math.max(1, 81 - (joinContextFrames * 2))}
                step={1}
                value={Math.max(1, joinGapFrames)}
                onValueChange={(value) => {
                  if (value !== null) {
                    setJoinGapFrames(Math.max(1, value));
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">Frames to generate in each transition</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="join-context-frames" className="text-sm">
                Context Frames
              </Label>
              <NumberInput
                id="join-context-frames"
                min={1}
                max={30}
                value={joinContextFrames}
                onChange={(val) => {
                  const contextFrames = val ?? 0;
                  const maxGap = Math.max(1, 81 - (contextFrames * 2));
                  const newGapFrames = joinGapFrames > maxGap ? maxGap : joinGapFrames;
                  setJoinContextFrames(contextFrames);
                  setJoinGapFrames(newGapFrames);
                }}
              />
              <p className="text-xs text-muted-foreground">Context frames from each clip</p>
            </div>

            <div className="flex items-center justify-between gap-3 px-3 py-3 border rounded-lg">
              <Label htmlFor="join-replace-mode" className="text-sm text-center flex-1 cursor-pointer">
                Replace Frames
              </Label>
              <Switch
                id="join-replace-mode"
                checked={!joinReplaceMode}
                onCheckedChange={(checked) => {
                  setJoinReplaceMode(!checked);
                }}
              />
              <Label htmlFor="join-replace-mode" className="text-sm text-center flex-1 cursor-pointer">
                Generate New
              </Label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirmJoin}
            disabled={isJoiningClips}
          >
            {isJoiningClips ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating Task...
              </>
            ) : (
              `Join ${segmentCount} Segments`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
