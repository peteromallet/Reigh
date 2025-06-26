import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from "react";
import { Input } from "@/shared/components/ui/input";
import { Button } from "@/shared/components/ui/button";
import { Label } from "@/shared/components/ui/label";
import { Textarea } from "@/shared/components/ui/textarea";
import { SliderWithValue } from "@/shared/components/ui/slider-with-value";
import { LoraSelectorModal, LoraModel } from "@/shared/components/LoraSelectorModal";
import { DisplayableMetadata } from "@/shared/components/ImageGallery";
import { X, UploadCloud, PlusCircle, Trash2, Edit3 } from "lucide-react";
import { toast } from "sonner";
import { cropImageToClosestAspectRatio, CropResult } from "@/shared/lib/imageCropper";
import PromptEditorModal from "@/shared/components/PromptEditorModal";
import { 
  Tooltip, 
  TooltipContent, 
  TooltipProvider, 
  TooltipTrigger 
} from "@/shared/components/ui/tooltip";
import { useToast } from "@/shared/hooks/use-toast";
import FileInput from "@/shared/components/FileInput";
import { fileToDataURL, dataURLtoFile } from "@/shared/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/components/ui/select";

const FORM_SETTINGS_KEY = 'artfulPaneCraftFormSettings';
const STARTING_IMAGE_KEY = 'artfulPaneCraftStartingImage';

type GenerationMode = 'wan-local' | 'flux-api' | 'hidream-api';

export interface MetadataLora {
    id: string;
    name: string;
    path: string;
    strength: number; 
    previewImageUrl?: string;
  }

export interface ImageGenerationFormHandles {
  applySettings: (settings: DisplayableMetadata) => void;
}

interface ImageGenerationFormProps {
  onGenerate: (formData: any) => void;
  isGenerating?: boolean;
  hasApiKey?: boolean;
  apiKey?: string;
  openaiApiKey?: string;
}

export interface PromptEntry {
  id: string;
  fullPrompt: string;
  shortPrompt?: string;
  selected?: boolean;
}

interface LoraDataEntry {
  "Model ID": string;
  Name: string;
  Author: string;
  Images: Array<{ url: string; alt_text: string; [key: string]: any; }>;
  "Model Files": Array<{ url: string; path: string; [key: string]: any; }>;
  [key: string]: any;
}

interface LoraData {
  models: LoraDataEntry[];
}

interface ActiveLora {
  id: string;
  name: string;
  path: string;
  strength: number;
  previewImageUrl?: string;
}

interface PersistedFormSettings {
  prompts?: PromptEntry[];
  imagesPerPrompt?: number;
  selectedLoras?: ActiveLora[];
  depthStrength?: number;
  softEdgeStrength?: number;
  beforeEachPromptText?: string;
  afterEachPromptText?: string;
  selectedLorasByMode?: Record<GenerationMode, ActiveLora[]>;
}

const defaultLorasConfig = [
  { modelId: "Shakker-Labs/FLUX.1-dev-LoRA-add-details", strength: 0.78 },
  { modelId: "Shakker-Labs/FLUX.1-dev-LoRA-AntiBlur", strength: 0.43 },
  { modelId: "kudzueye/boreal-flux-dev-v2", strength: 0.06 },
  { modelId: "strangerzonehf/Flux-Super-Realism-LoRA", strength: 0.40 },
];

export interface PromptInputRowProps {
  promptEntry: PromptEntry;
  onUpdate: (id: string, field: 'fullPrompt' | 'shortPrompt', value: string) => void;
  onRemove: (id: string) => void;
  canRemove: boolean;
  isGenerating?: boolean;
  hasApiKey?: boolean;
  index: number;
  onEditWithAI?: () => void;
  aiEditButtonIcon?: React.ReactNode;
  onSetActiveForFullView: (id: string | null) => void;
  isActiveForFullView: boolean;
}

export const PromptInputRow: React.FC<PromptInputRowProps> = ({
  promptEntry, onUpdate, onRemove, canRemove, isGenerating, hasApiKey, index,
  onEditWithAI,
  aiEditButtonIcon,
  onSetActiveForFullView,
  isActiveForFullView,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isEditingFullPrompt, setIsEditingFullPrompt] = useState(false);
  const [localFullPrompt, setLocalFullPrompt] = useState(promptEntry.fullPrompt);

  useEffect(() => {
    if (!isEditingFullPrompt) {
      setLocalFullPrompt(promptEntry.fullPrompt);
    }
  }, [promptEntry.fullPrompt, isEditingFullPrompt]);

  const effectiveShortPrompt = promptEntry.shortPrompt?.trim();
  
  let displayText = effectiveShortPrompt || promptEntry.fullPrompt;
  let currentPlaceholder = `Enter your detailed prompt #${index + 1}...`;
  let isShowingShort = !!effectiveShortPrompt;

  if (isActiveForFullView || isEditingFullPrompt) {
    displayText = isEditingFullPrompt ? localFullPrompt : promptEntry.fullPrompt;
    isShowingShort = false;
    if (isEditingFullPrompt) {
        currentPlaceholder = `Editing detailed prompt #${index + 1}...`;
    } else if (isActiveForFullView && effectiveShortPrompt) {
        currentPlaceholder = `Full prompt shown. (Summary: ${effectiveShortPrompt})`;
    } else {
        currentPlaceholder = `Full prompt shown. Click to edit.`;
    }
  } else if (effectiveShortPrompt) {
    displayText = effectiveShortPrompt;
    currentPlaceholder = `Click to see/edit full prompt... (Summary: ${effectiveShortPrompt})`;
    isShowingShort = true;
  }

  const autoResizeTextarea = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'inherit';
      const scrollHeight = textareaRef.current.scrollHeight;
      let baseHeight = 60;
      if (isShowingShort && !isActiveForFullView && !isEditingFullPrompt) {
         baseHeight = Math.max(36, Math.min(scrollHeight, 60)); 
      } else { 
         baseHeight = Math.max(60, scrollHeight);
      }
      textareaRef.current.style.height = `${baseHeight}px`;
    }
  };

  useEffect(() => {
    autoResizeTextarea();
  }, [displayText, isActiveForFullView, isEditingFullPrompt, isShowingShort]);

  useEffect(() => { autoResizeTextarea(); }, []);

  const handleFullPromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setLocalFullPrompt(newText);
    onUpdate(promptEntry.id, 'fullPrompt', newText);
  };

  const handleFocus = () => {
    setIsEditingFullPrompt(true);
    onSetActiveForFullView(promptEntry.id);
  };

  const handleBlur = () => {
    setIsEditingFullPrompt(false);
    if (localFullPrompt !== promptEntry.fullPrompt) {
      onUpdate(promptEntry.id, 'fullPrompt', localFullPrompt);
    }
  };

  return (
    <div 
      className="p-3 border rounded-md space-y-2 bg-slate-50/50 dark:bg-slate-800/30"
    >
      <div className="flex justify-between items-center">
        <Label htmlFor={`fullPrompt-${promptEntry.id}`} className="text-sm font-medium">
          Prompt #{index + 1}
        </Label>
        <div className="flex items-center space-x-1">
          {onEditWithAI && aiEditButtonIcon && hasApiKey && (
            <TooltipProvider delayDuration={200}>
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
                  <p>Edit with AI</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {canRemove && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onRemove(promptEntry.id)}
                    className="text-destructive hover:bg-destructive/10 h-7 w-7"
                    disabled={!hasApiKey || isGenerating}
                    aria-label="Remove prompt"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>Remove Prompt</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
      
      <div>
        <Textarea
          ref={textareaRef}
          id={`fullPrompt-${promptEntry.id}`}
          value={displayText}
          onChange={handleFullPromptChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={currentPlaceholder}
          className={`mt-1 resize-none overflow-y-hidden ${
            isShowingShort && !isActiveForFullView && !isEditingFullPrompt ? 'min-h-[36px] cursor-pointer' : 'min-h-[60px]'
          }`}
          disabled={!hasApiKey || isGenerating}
          readOnly={!isEditingFullPrompt && isActiveForFullView && !!effectiveShortPrompt && !isShowingShort}
          rows={1} 
        />
      </div>
    </div>
  );
};

const ImageGenerationForm = forwardRef<ImageGenerationFormHandles, ImageGenerationFormProps>((
  { onGenerate, isGenerating = false, hasApiKey: incomingHasApiKey = true, apiKey, openaiApiKey },
  ref
) => {
  const [prompts, setPrompts] = useState<PromptEntry[]>([]);
  const promptIdCounter = useRef(1);
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);
  const [imagesPerPrompt, setImagesPerPrompt] = useState(1);
  const [selectedLorasMap, setSelectedLorasMap] = useState<Record<GenerationMode, ActiveLora[]>>({
    'wan-local': [],
    'flux-api': [],
    'hidream-api': []
  });
  const [selectedLoras, setSelectedLoras] = useState<ActiveLora[]>([]);
  const [depthStrength, setDepthStrength] = useState(50);
  const [softEdgeStrength, setSoftEdgeStrength] = useState(20);
  const [startingImage, setStartingImage] = useState<File | null>(null);
  const [startingImagePreview, setStartingImagePreview] = useState<string | null>("https://v3.fal.media/files/kangaroo/RVIpigZlg_QbbNrVJbaBQ_d473ed359fd74cd0aeb462573ac92b47.png");
  const [determinedApiImageSize, setDeterminedApiImageSize] = useState<string | null>(null);
  const [isLoraModalOpen, setIsLoraModalOpen] = useState(false);
  const [availableLoras, setAvailableLoras] = useState<LoraModel[]>([]);
  const hasLoadedFromStorage = useRef(false);
  const defaultsApplied = useRef(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [directFormActivePromptId, setDirectFormActivePromptId] = useState<string | null>(null);
  const [generationMode, setGenerationMode] = useState<GenerationMode>('wan-local');

  // Text to prepend/append to every prompt
  const [beforeEachPromptText, setBeforeEachPromptText] = useState('');
  const [afterEachPromptText, setAfterEachPromptText] = useState('');

  // Treat Wan-local mode as not requiring a stored API key.
  const hasApiKey = generationMode === 'wan-local' ? true : incomingHasApiKey;

  const generatePromptId = () => `prompt-${promptIdCounter.current++}`;
  
  const processAndCropImageUrl = async (imageUrl: string, fromAppliedSettings = false) => { 
    try {
      toast.info("Processing applied starting image...");
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
      const blob = await response.blob();
      let fileName = "applied_image";
      try {
        const urlParts = new URL(imageUrl).pathname.split('/');
        fileName = urlParts[urlParts.length - 1] || fileName;
      } catch (e) { /* Ignore */ }
      if (!fileName.match(/\.(jpeg|jpg|png|webp)$/i)) {
        const ext = blob.type.split('/')[1] || 'png';
        fileName = `${fileName}.${ext}`;
      }
      const imageFile = new File([blob], fileName, { type: blob.type });
      const cropResult = await cropImageToClosestAspectRatio(imageFile);
      if (cropResult) {
        setStartingImage(cropResult.croppedFile);
        setDeterminedApiImageSize(cropResult.apiImageSize);
        toast.success("Applied starting image processed and sized!");
      } else {
        setDeterminedApiImageSize(null);
        toast.info("Could not auto-size applied starting image.");
      }
    } catch (error) {
      console.error("Error processing applied image URL:", error);
      toast.error("Failed to process applied starting image for sizing.");
      setDeterminedApiImageSize(null);
    }
  }; 

  useImperativeHandle(ref, () => ({
    applySettings: (settings: DisplayableMetadata) => {
      toast.info("Applying settings from selected image...");
      if (settings.prompt) {
        const newId = generatePromptId();
        const short = settings.prompt.substring(0, 30) + (settings.prompt.length > 30 ? "..." : "");
        setPrompts([{ id: newId, fullPrompt: settings.prompt, shortPrompt: short }]);
      }
      if (settings.imagesPerPrompt) setImagesPerPrompt(settings.imagesPerPrompt);
      if (settings.depthStrength !== undefined) setDepthStrength(Math.round(settings.depthStrength * 100));
      if (settings.softEdgeStrength !== undefined) setSoftEdgeStrength(Math.round(settings.softEdgeStrength * 100));
      
      if (settings.activeLoras && settings.activeLoras.length > 0 && availableLoras.length > 0) {
        const newSelectedLoras: ActiveLora[] = [];
        settings.activeLoras.forEach(metaLora => {
          const foundFullLora = availableLoras.find(al => al["Model ID"] === metaLora.id || al.Name === metaLora.name || al["Model Files"].some(f => f.url === metaLora.path) );
          if (foundFullLora) {
            newSelectedLoras.push({
              id: foundFullLora["Model ID"],
              name: foundFullLora.Name !== "N/A" ? foundFullLora.Name : foundFullLora["Model ID"],
              path: foundFullLora["Model Files"] && foundFullLora["Model Files"].length > 0 ? foundFullLora["Model Files"][0].url : metaLora.path, 
              strength: metaLora.strength, 
              previewImageUrl: foundFullLora.Images && foundFullLora.Images.length > 0 ? foundFullLora.Images[0].url : metaLora.previewImageUrl
            });
          }
        });
        setSelectedLoras(newSelectedLoras);
      } else if (settings.activeLoras && settings.activeLoras.length === 0) {
        setSelectedLoras([]); 
      }

      if (settings.userProvidedImageUrl) {
        setStartingImagePreview(settings.userProvidedImageUrl);
        setStartingImage(null);
        processAndCropImageUrl(settings.userProvidedImageUrl);
      } else {
        setStartingImagePreview(null);
        setStartingImage(null);
        setDeterminedApiImageSize(null);
      }

      if (settings.beforeEachPromptText !== undefined) setBeforeEachPromptText(settings.beforeEachPromptText);
      if (settings.afterEachPromptText !== undefined) setAfterEachPromptText(settings.afterEachPromptText);
    }
  }));

  useEffect(() => {
    const savedSettingsRaw = localStorage.getItem(FORM_SETTINGS_KEY);
    let loadedPrompts: PromptEntry[] | null = null;

    if (savedSettingsRaw) {
      try {
        const parsedSettings = JSON.parse(savedSettingsRaw);
        const settingsToLoad = parsedSettings as PersistedFormSettings & { prompt?: string }; 

        if (settingsToLoad.prompts && settingsToLoad.prompts.length > 0) {
            loadedPrompts = settingsToLoad.prompts.map(p => ({...p, id: p.id || generatePromptId() }));
        } else if (settingsToLoad.prompt && typeof settingsToLoad.prompt === 'string') { 
             const short = settingsToLoad.prompt.substring(0, 30) + (settingsToLoad.prompt.length > 30 ? "..." : "");
             loadedPrompts = [{ id: generatePromptId(), fullPrompt: settingsToLoad.prompt, shortPrompt: short }];
        }
        
        if (loadedPrompts && loadedPrompts.length > 0) {
            let maxIdNum = 0; 
            loadedPrompts.forEach(p => {
                const idStr = p.id || "";
                let idPart = idStr.startsWith('prompt-') ? idStr.substring('prompt-'.length) : idStr;
                if (idStr === 'initial-0') idPart = '0';
                if (idPart && !isNaN(parseInt(idPart))) {
                    maxIdNum = Math.max(maxIdNum, parseInt(idPart));
                }
            });
            promptIdCounter.current = maxIdNum + 1;
        } else {
            promptIdCounter.current = 1; 
        }

        if (settingsToLoad.imagesPerPrompt !== undefined) setImagesPerPrompt(settingsToLoad.imagesPerPrompt);
        if (settingsToLoad.selectedLorasByMode) {
            const emptyMap: Record<GenerationMode, ActiveLora[]> = { 'wan-local': [], 'flux-api': [], 'hidream-api': [] };
            setSelectedLorasMap({ ...emptyMap, ...(settingsToLoad.selectedLorasByMode as Record<GenerationMode, ActiveLora[]>) });
        } else if (settingsToLoad.selectedLoras !== undefined && settingsToLoad.selectedLoras.length > 0) {
            setSelectedLorasMap({ 'wan-local': [], 'flux-api': settingsToLoad.selectedLoras, 'hidream-api': [] });
        }
        if (settingsToLoad.depthStrength !== undefined) setDepthStrength(settingsToLoad.depthStrength);
        if (settingsToLoad.softEdgeStrength !== undefined) setSoftEdgeStrength(settingsToLoad.softEdgeStrength);

        if (settingsToLoad.beforeEachPromptText !== undefined) setBeforeEachPromptText(settingsToLoad.beforeEachPromptText);
        if (settingsToLoad.afterEachPromptText !== undefined) setAfterEachPromptText(settingsToLoad.afterEachPromptText);

      } catch (error) { 
          console.error("Error loading saved form settings:", error); 
          localStorage.removeItem(FORM_SETTINGS_KEY);
      }
    }

    if (loadedPrompts && loadedPrompts.length > 0) {
        setPrompts(loadedPrompts);
    } else {
        promptIdCounter.current = 1; 
        const initialPromptId = generatePromptId(); 
        setPrompts([{ id: initialPromptId, fullPrompt: "A majestic cat astronaut exploring a vibrant nebula, artstation", shortPrompt: "Cat Astronaut" }]);
        defaultsApplied.current = false;
    }

    // Load starting image from localStorage
    const savedImageRaw = localStorage.getItem(STARTING_IMAGE_KEY);
    if (savedImageRaw) {
      try {
        const savedImageData = JSON.parse(savedImageRaw);
        if (savedImageData && savedImageData.dataUrl && savedImageData.name && savedImageData.type) {
          const restoredFile = dataURLtoFile(savedImageData.dataUrl, savedImageData.name, savedImageData.type);
          if (restoredFile) {
            processFileInternal(restoredFile, true); // Pass a flag to avoid re-saving
          }
        }
      } catch (error) {
        console.error("Error loading starting image from localStorage:", error);
        localStorage.removeItem(STARTING_IMAGE_KEY);
      }
    }

    hasLoadedFromStorage.current = true;
  }, []);

  useEffect(() => {
    if (hasLoadedFromStorage.current) { 
      const currentSettings: PersistedFormSettings = { prompts, imagesPerPrompt, selectedLorasByMode: selectedLorasMap, depthStrength, softEdgeStrength, beforeEachPromptText, afterEachPromptText };
      console.log("[ImageGenerationForm] Saving to localStorage. Prompts count:", prompts.length, "Data:", currentSettings);
      localStorage.setItem(FORM_SETTINGS_KEY, JSON.stringify(currentSettings));
    }
  }, [prompts, imagesPerPrompt, selectedLorasMap, depthStrength, softEdgeStrength, beforeEachPromptText, afterEachPromptText]);

  useEffect(() => { fetch('/data/loras.json').then(response => response.json()).then((data: LoraData) => setAvailableLoras(data.models || [])).catch(error => console.error("Error fetching LoRA data:", error)); }, []);
  useEffect(() => { 
    if (hasLoadedFromStorage.current && !defaultsApplied.current && availableLoras.length > 0 && selectedLoras.length === 0) { 
      const newSelectedLoras: ActiveLora[] = [];
      for (const defaultConfig of defaultLorasConfig) {
        const foundLora = availableLoras.find(lora => lora["Model ID"] === defaultConfig.modelId);
        if (foundLora && foundLora["Model Files"] && foundLora["Model Files"].length > 0) {
          newSelectedLoras.push({
            id: foundLora["Model ID"], 
            name: foundLora.Name !== "N/A" ? foundLora.Name : foundLora["Model ID"],
            path: foundLora["Model Files"][0].url, 
            strength: defaultConfig.strength,
            previewImageUrl: foundLora.Images && foundLora.Images.length > 0 ? foundLora.Images[0].url : undefined,
          });
        }
      }
      if (newSelectedLoras.length > 0) {
        setSelectedLoras(newSelectedLoras);
        defaultsApplied.current = true;
      }
    } 
  }, [availableLoras, hasLoadedFromStorage.current, defaultsApplied.current, selectedLoras.length]);

  useEffect(() => {
    setSelectedLoras(selectedLorasMap[generationMode] || []);
  }, [generationMode, selectedLorasMap]);

  useEffect(() => {
    setSelectedLorasMap(prev => ({ ...prev, [generationMode]: selectedLoras }));
  }, [selectedLoras, generationMode]);

  const handleAddLora = (loraToAdd: LoraModel) => { 
    if (selectedLoras.find(sl => sl.id === loraToAdd["Model ID"])) { toast.info(`LoRA already added.`); return; }
    if (loraToAdd["Model Files"] && loraToAdd["Model Files"].length > 0) {
      setSelectedLoras(prevLoras => [ ...prevLoras, {
          id: loraToAdd["Model ID"], name: loraToAdd.Name !== "N/A" ? loraToAdd.Name : loraToAdd["Model ID"],
          path: loraToAdd["Model Files"][0].url, strength: 1.0, 
          previewImageUrl: loraToAdd.Images && loraToAdd.Images.length > 0 ? loraToAdd.Images[0].url : undefined,
        }]);
      toast.success(`LoRA added.`);
    } else { toast.error("Selected LoRA has no model file specified."); }
  };
  const handleRemoveLora = (loraIdToRemove: string) => setSelectedLoras(prevLoras => prevLoras.filter(lora => lora.id !== loraIdToRemove));
  const handleLoraStrengthChange = (loraId: string, newStrength: number) => setSelectedLoras(prevLoras => prevLoras.map(lora => lora.id === loraId ? { ...lora, strength: newStrength } : lora));
  const processFileInternal = async (file: File | null, fromLocalStorageLoad = false) => {
    if (startingImagePreview && startingImagePreview.startsWith("blob:")) {
      URL.revokeObjectURL(startingImagePreview);
    }
    if (file) {
      setStartingImage(file);
      const objectUrl = URL.createObjectURL(file);
      setStartingImagePreview(objectUrl);
      try {
        const cropResult: CropResult | null = await cropImageToClosestAspectRatio(file);
        if (cropResult) {
            setDeterminedApiImageSize(cropResult.apiImageSize);
            if (!fromLocalStorageLoad) toast.info(`Image ready. Using API size: ${cropResult.apiImageSize}.`);
        } else {
            setDeterminedApiImageSize(null);
            if (!fromLocalStorageLoad) toast.info("Could not auto-determine API size for image, using default.");
        }
        
        if (!fromLocalStorageLoad) {
          try {
            const dataUrl = await fileToDataURL(file);
            localStorage.setItem(STARTING_IMAGE_KEY, JSON.stringify({ dataUrl, name: file.name, type: file.type }));
          } catch (error) {
            console.error("Error saving starting image to localStorage:", error);
            toast.error("Could not save starting image locally.");
          }
        }
      } catch (error) {
        console.error("Error cropping image:", error);
        if (!fromLocalStorageLoad) toast.error("Could not process image for aspect ratio. Using original.");
        setDeterminedApiImageSize(null);
        if (!fromLocalStorageLoad) localStorage.removeItem(STARTING_IMAGE_KEY);
      }
    } else {
      setStartingImage(null);
      setStartingImagePreview(null);
      setDeterminedApiImageSize(null);
      if (!fromLocalStorageLoad) localStorage.removeItem(STARTING_IMAGE_KEY);
    }
  };
  const processFile = async (file: File | null) => {
    await processFileInternal(file, false);
  };
  const handleFileChange = (files: File[]) => {
    processFile(files.length > 0 ? files[0] : null);
  };
  const handleFileRemove = () => { processFile(null); };

  const handleAddPrompt = (source: 'form' | 'modal' = 'form') => {
    const newId = generatePromptId();
    const newPromptNumber = prompts.length + 1;
    const newPrompt = { id: newId, fullPrompt: "", shortPrompt: `Prompt ${newPromptNumber}` };
    setPrompts(prev => [...prev, newPrompt]);
  };

  const handleUpdatePrompt = (id: string, field: 'fullPrompt' | 'shortPrompt', value: string) => {
    setPrompts(prev => prev.map(p => {
      if (p.id === id) {
        const updatedPrompt = { ...p, [field]: value };
        if (field === 'fullPrompt' && (updatedPrompt.shortPrompt === "" || updatedPrompt.shortPrompt?.startsWith(p.fullPrompt.substring(0,20)))) {
          updatedPrompt.shortPrompt = value.substring(0, 30) + (value.length > 30 ? "..." : "");
        }
        return updatedPrompt;
      }
      return p;
    }));
  };

  const handleRemovePrompt = (id: string) => {
    if (prompts.length > 1) {
      setPrompts(prev => prev.filter(p => p.id !== id));
    } else {
      toast.error("Cannot remove the last prompt.");
    }
  };
  
  const handleSavePromptsFromModal = (updatedPrompts: PromptEntry[]) => {
    console.log("[ImageGenerationForm] Received prompts from modal 'Save & Close':", updatedPrompts);
    setPrompts(updatedPrompts.map(p => ({
        ...p,
        id: p.id || generatePromptId(),
        shortPrompt: p.shortPrompt || (p.fullPrompt.substring(0,30) + (p.fullPrompt.length > 30 ? "..." : ""))
    })));
    setIsPromptModalOpen(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log("[ImageGenerationForm] handleSubmit triggered. Event type:", e.type);

    const lorasForApi = selectedLoras.map(lora => ({ path: lora.path, strength: lora.strength }));    
    const normalizedDepthStrength = depthStrength / 100;
    const normalizedSoftEdgeStrength = softEdgeStrength / 100;
    const appliedStartingImageUrl = (startingImagePreview && !startingImagePreview.startsWith('data:image')) ? startingImagePreview : null;
    
    const activePrompts = prompts.filter(p => p.fullPrompt.trim() !== "");
    if (activePrompts.length === 0) {
        console.warn("[ImageGenerationForm] handleSubmit: No active prompts. Generation aborted.");
        toast.error("Please enter at least one valid prompt.");
        return;
    }

    const generationData = {
      prompts: activePrompts.map(p => {
        const combinedFull = `${beforeEachPromptText ? `${beforeEachPromptText} ` : ''}${p.fullPrompt}${afterEachPromptText ? ` ${afterEachPromptText}` : ''}`.trim();
        return {
          id: p.id,
          fullPrompt: combinedFull,
          shortPrompt: p.shortPrompt || (combinedFull.substring(0, 30) + (combinedFull.length > 30 ? "..." : ""))
        };
      }), 
      imagesPerPrompt, 
      loras: lorasForApi, 
      fullSelectedLoras: selectedLoras, 
      depthStrength: normalizedDepthStrength, 
      softEdgeStrength: normalizedSoftEdgeStrength, 
      startingImage,
      appliedStartingImageUrl,
      determinedApiImageSize,
      generationMode
    };

    console.log("[ImageGenerationForm] handleSubmit: Calling onGenerate with data:", JSON.stringify(generationData, null, 2));
    onGenerate(generationData);
  };
  
  const actionablePromptsCount = prompts.filter(p => p.fullPrompt.trim() !== "").length;

  return (
    <>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 bg-white rounded-lg shadow-sm">
        {/* Generation Mode Selector */}
        <div className="md:col-span-2 mb-6">
          <Label className="text-lg font-semibold mb-3 block">Generation Mode</Label>
          <Select value={generationMode} onValueChange={(value: GenerationMode) => setGenerationMode(value)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select generation mode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="wan-local">Wan (local)</SelectItem>
              <SelectItem value="flux-api">Flux (via API)</SelectItem>
              <SelectItem value="hidream-api">HiDream (via API)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-6">
          <div className="space-y-3">
            <div className="flex justify-between items-center mb-2">
              <Label className="text-lg font-semibold">Prompts</Label>
              <div className="flex items-center space-x-2">
                {prompts.length <= 3 && (
                  <Button type="button" variant="outline" size="sm" onClick={() => handleAddPrompt('form')} disabled={!hasApiKey || isGenerating}>
                    <PlusCircle className="mr-2 h-4 w-4" /> Add Prompt
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsPromptModalOpen(true)} 
                  disabled={!hasApiKey || isGenerating}
                  title="Open Advanced Prompt Editor"
                >
                  <Edit3 className="mr-2 h-4 w-4" /> 
                  {prompts.length > 3 ? `Manage Prompts (${prompts.length})` : "Manage Prompts"}
                </Button>
              </div>
            </div>

            {prompts.length <= 3 ? (
              prompts.map((promptEntry, index) => (
                <PromptInputRow
                  key={promptEntry.id}
                  promptEntry={promptEntry}
                  onUpdate={handleUpdatePrompt}
                  onRemove={handleRemovePrompt}
                  canRemove={prompts.length > 1}
                  isGenerating={isGenerating}
                  hasApiKey={hasApiKey}
                  index={index}
                  onEditWithAI={() => { /* Placeholder for direct form AI edit */ }}
                  aiEditButtonIcon={null} 
                  onSetActiveForFullView={setDirectFormActivePromptId}
                  isActiveForFullView={directFormActivePromptId === promptEntry.id}
                />
              ))
            ) : (
              <div className="p-3 border rounded-md text-center bg-slate-50/50 hover:border-primary/50 cursor-pointer" onClick={() => setIsPromptModalOpen(true)}>
                  <p className="text-sm text-muted-foreground"><span className="font-semibold text-primary">{prompts.length} prompts</span> currently active.</p>
                  <p className="text-xs text-primary">(Click to Edit)</p>
              </div>
            )}
          </div>

          {/* Before / After prompt modifiers */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="beforeEachPromptText">Before each prompt</Label>
              <Textarea
                id="beforeEachPromptText"
                value={beforeEachPromptText}
                onChange={(e) => setBeforeEachPromptText(e.target.value)}
                placeholder="Text to prepend"
                disabled={!hasApiKey || isGenerating}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="afterEachPromptText">After each prompt</Label>
              <Textarea
                id="afterEachPromptText"
                value={afterEachPromptText}
                onChange={(e) => setAfterEachPromptText(e.target.value)}
                placeholder="Text to append"
                disabled={!hasApiKey || isGenerating}
                className="mt-1"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 pt-4 border-t">
            <div className="mt-1">
              <SliderWithValue
                label="Images per Prompt"
                value={imagesPerPrompt}
                onChange={setImagesPerPrompt}
                min={1}
                max={16}
                step={1}
                disabled={!hasApiKey || isGenerating}
              />
            </div>
          </div>
          {/* Show starting image and ControlNet for Flux API only */}
          {generationMode === 'flux-api' && (
            <>
              <div>
                <Label htmlFor="starting-image" className="mb-2 block font-medium">Optional Starting Image (Guidance)</Label>
                <FileInput
                  onFileChange={handleFileChange}
                  onFileRemove={handleFileRemove}
                  acceptTypes={['image']}
                  label="Drag & drop an image or click to upload"
                  currentFilePreviewUrl={startingImagePreview}
                  currentFileName={startingImage?.name}
                  disabled={isGenerating || !hasApiKey}
                />
              </div>

              <div className="space-y-6 pt-4 border-t">
                <h3 className="text-md font-semibold">ControlNet Strengths:</h3>
                <SliderWithValue label="Depth Strength" value={depthStrength} onChange={setDepthStrength} disabled={!hasApiKey || isGenerating}/>
                <SliderWithValue label="Soft Edge Strength" value={softEdgeStrength} onChange={setSoftEdgeStrength} disabled={!hasApiKey || isGenerating}/>
              </div>
            </>
          )}
        </div>

        <div className="space-y-6">
          {/* Show LoRA section for Wan and Flux modes */}
          {(generationMode === 'wan-local' || generationMode === 'flux-api') && (
            <div>
              <Label>LoRA Models {generationMode === 'wan-local' ? '(Wan)' : '(Flux)'}</Label>
              <Button type="button" variant="outline" className="w-full mt-1" onClick={() => setIsLoraModalOpen(true)} disabled={isGenerating}>
                Add or Manage LoRA Models
              </Button>
            {availableLoras.length === 0 && !isLoraModalOpen && <p className="text-xs text-muted-foreground mt-1">Loading LoRA models for selection...</p>}
            {selectedLoras.length > 0 && (
              <TooltipProvider delayDuration={300}>
                <div className="mt-4 space-y-4 pt-2 border-t">
                  <h3 className="text-md font-semibold">Active LoRAs:</h3>
                  {selectedLoras.map((lora) => (
                    <div key={lora.id} className="p-3 border rounded-md shadow-sm bg-slate-50">
                      <div className="flex items-start gap-3">
                        {lora.previewImageUrl && (
                          <img 
                            src={lora.previewImageUrl} 
                            alt={`Preview for ${lora.name}`} 
                            className="h-16 w-16 object-cover rounded-md border flex-shrink-0"
                          />
                        )}
                        <div className="flex-grow min-w-0">
                          <div className="flex justify-between items-start mb-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Label htmlFor={`lora-strength-${lora.id}`} className="text-sm font-medium truncate pr-2 cursor-help">
                                  {lora.name}
                                </Label>
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                <p>{lora.name}</p>
                              </TooltipContent>
                            </Tooltip>
                            <Button variant="ghost" size="icon" onClick={() => handleRemoveLora(lora.id)} className="text-destructive hover:bg-destructive/10 h-7 w-7 flex-shrink-0">
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                          <SliderWithValue 
                            label={`Strength`}
                            value={lora.strength}
                            onChange={(newStrength) => handleLoraStrengthChange(lora.id, newStrength)}
                            min={0} max={2} step={0.05}
                            disabled={!hasApiKey || isGenerating}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                                  </div>
                </TooltipProvider>
              )}
            </div>
          )}

          {/* HiDream placeholder */}
          {generationMode === 'hidream-api' && (
            <div className="p-6 border-2 border-dashed border-gray-300 rounded-lg text-center">
              <h3 className="text-lg font-semibold mb-2">HiDream (via API)</h3>
              <p className="text-muted-foreground">Coming soon...</p>
            </div>
          )}
        </div>

        <div className="md:col-span-2 flex justify-center mt-4">
          <Button 
            type="submit" 
            className="w-full md:w-1/2" 
            disabled={isGenerating || !hasApiKey || actionablePromptsCount === 0 || generationMode === 'hidream-api'}
          >
            {isGenerating ? "Generating..." : generationMode === 'hidream-api' ? "Coming Soon" : "Generate Images"}
          </Button>
        </div>
      </form>

      <LoraSelectorModal
        isOpen={isLoraModalOpen}
        onClose={() => setIsLoraModalOpen(false)}
        loras={availableLoras}
        onAddLora={handleAddLora}
        selectedLoraIds={selectedLoras.map(l => l["Model ID"])}
        lora_type={generationMode === 'wan-local' ? "Wan 2.1 14b" : "Flux.dev"}
      />
        
      <PromptEditorModal
        isOpen={isPromptModalOpen}
        onClose={() => setIsPromptModalOpen(false)}
        prompts={prompts}
        onSave={handleSavePromptsFromModal}
        generatePromptId={generatePromptId}
        apiKey={openaiApiKey}
      />
    </>
  );
});

export default ImageGenerationForm;
