import { useState, useCallback } from 'react';
import OpenAI from 'openai';
import {
  AIPromptItem,
  GeneratePromptsParams,
  EditPromptParams,
  EditPromptResult,
} from '@/types/ai';

// The MOCK_API_KEY constant is no longer needed as a default in the hook.
// const MOCK_API_KEY = 'your-mock-api-key'; 

interface UseAIInteractionServiceOptions {
  apiKey?: string; // API key for the AI service - now strictly relies on this being passed.
  generatePromptId: () => string; // Function to generate unique IDs for new prompts
}

// Helper function to initialize OpenAI client
const getOpenAIClient = (apiKey: string) => {
  return new OpenAI({
    apiKey: apiKey,
    dangerouslyAllowBrowser: true, // As specified in the document
  });
};

export const useAIInteractionService = ({
  apiKey,
  generatePromptId,
}: UseAIInteractionServiceOptions) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);

  const generatePrompts = useCallback(
    async (params: GeneratePromptsParams): Promise<AIPromptItem[]> => {
      if (!apiKey) {
        console.error('AI Service: API key is missing for generatePrompts.');
        return [];
      }
      setIsGenerating(true);
      const openai = getOpenAIClient(apiKey);

      let systemMessageContent = `You are a helpful assistant that generates a list of prompts based on user input.\nOverall goal: ${params.overallPromptText}\nRules to remember: ${params.rulesToRememberText}`;
      if (params.includeExistingContext && params.existingPrompts && params.existingPrompts.length > 0) {
        const existingPromptsText = params.existingPrompts.map(p => `- ${p.text}`).join('\n');
        systemMessageContent += `\n\nExisting Prompts for Context (do not repeat these, but use them as inspiration for new, distinct ideas):\n${existingPromptsText}`;
      }

      const userMessageContent = params.specificPromptsText || "Please generate general prompts based on the overall goal and rules.";
      // The instruction about the output format should be part of the system or user message for chat models.
      const instructionMessage = `Instruction: Generate ${params.numberToGenerate} distinct prompts as a plain text list, each on a new line. Do not number them or add any other formatting. Ensure they are different from any provided context prompts.`;

      try {
        // Changed from openai.completions.create to openai.chat.completions.create
        const response = await openai.chat.completions.create({
          model: 'o3-mini', // As specified
          messages: [
            { role: 'system', content: systemMessageContent },
            { role: 'user', content: `${userMessageContent}\n\n${instructionMessage}` }, // Combined user content and instruction
          ],
          // Parameters for o3-mini: the doc mentions "reasoning: { effort: 'medium' }"
          // This is still not a standard parameter for chat.completions.create.
          // It might be a tag or a behavior influenced by the model name itself or specific prompt phrasing.
          // If there's a specific way to pass this, it would need to be added here, e.g. in metadata or custom fields if supported.
          // For now, relying on model's default behavior or that this is handled implicitly.
          // max_tokens can be used if needed, but o3-mini might have its own way of handling output length based on prompt.
        });

        const outputText = response.choices[0]?.message?.content?.trim() || '';
        const generatedTexts = outputText.split('\n').filter(text => text.trim() !== '');
        
        const newPrompts: AIPromptItem[] = [];
        for (const text of generatedTexts) {
          const newId = generatePromptId();
          let shortText = '';

          if (params.addSummaryForNewPrompts) {
            const summary = await generateSummaryForPromptInternal(text, apiKey);
            shortText = summary || '';
          }
          newPrompts.push({
            id: newId,
            text: text.trim(),
            shortText: shortText,
            hidden: false,
          });
        }
        return newPrompts;
      } catch (error) {
        console.error('AI Service: Error generating prompts:', error);
        return [];
      } finally {
        setIsGenerating(false);
      }
    },
    [apiKey, generatePromptId]
  );

  const generateSummaryForPromptInternal = useCallback(
    async (promptText: string, currentApiKey: string): Promise<string | null> => {
      if (!currentApiKey) {
        console.error('AI Service: API key is missing for generateSummary.');
        return null;
      }
      setIsSummarizing(true);
      const openai = getOpenAIClient(currentApiKey);

      try {
        const response = await openai.chat.completions.create({
          model: 'gpt-4o-mini-2024-07-18',
          messages: [
            {
              role: "user",
              content: `Summarise in <10 words:\\n\\n"${promptText}"`,
            },
          ],
          temperature: 1,
          max_tokens: 50,
          top_p: 1,
        });
        const summary = response.choices[0]?.message?.content?.trim() || null;
        return summary;
      } catch (error) {
        console.error('AI Service: Error generating summary:', error);
        return null;
      } finally {
        setIsSummarizing(false);
      }
    },
    []
  );

  const editPromptWithAI = useCallback(
    async (params: EditPromptParams): Promise<EditPromptResult> => {
      if (!apiKey) {
        console.error('AI Service: API key is missing for editPromptWithAI.');
        return { success: false };
      }
      setIsEditing(true);
      const openai = getOpenAIClient(apiKey);

      const systemMessage = `You are an AI assistant that helps refine user prompts.\nYour task is to edit the provided prompt based on the user's instructions.\nIMPORTANT: Only change what is specifically requested by the instructions. Keep all other parts of the original prompt's integrity as much as possible.\nOutput only the revised prompt text itself, with no additional commentary, preamble, or formatting. Just the edited prompt.\nIf the instructions are unclear or impossible to follow while preserving the original prompt's integrity as much as possible, try your best to interpret the user's intent or indicate if a change isn't feasible by returning the original prompt.`;

      const userMessage = `Original Prompt:\\n"${params.originalPromptText}"\\n\\nEdit Instructions:\\n"${params.editInstructions}"`;

      const model = params.modelType === 'smart' ? 'o3' : 'gpt-4o-mini';
      
      try {
        let newText: string | null = null;
        if (model === 'o3') {
          const response = await openai.chat.completions.create({
            model: 'o3',
            messages: [
              { role: 'system', content: systemMessage },
              { role: 'user', content: userMessage },
            ],
          });
          newText = response.choices[0]?.message?.content?.trim() || params.originalPromptText;

        } else {
          const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: systemMessage },
              { role: 'user', content: userMessage },
            ],
            temperature: 0.5,
            max_tokens: 1024,
          });
          newText = response.choices[0]?.message?.content?.trim() || params.originalPromptText;
        }
        
        return { success: true, newText: newText || params.originalPromptText };
      } catch (error) {
        console.error(`AI Service: Error editing prompt with ${model}:`, error);
        return { success: false, newText: params.originalPromptText };
      } finally {
        setIsEditing(false);
      }
    },
    [apiKey]
  );

  // Expose a version of generateSummaryForPromptInternal that uses the hook's API key.
  const generateSummary = useCallback(
    async (promptText: string): Promise<string | null> => {
      if (!apiKey) {
        console.error('AI Service: API key is missing for generateSummary (exposed).');
        return null;
      }
      // Directly call the internal function, which now takes apiKey as a parameter
      return generateSummaryForPromptInternal(promptText, apiKey);
    },
    [apiKey, generateSummaryForPromptInternal] // Add generateSummaryForPromptInternal to dependency array
  );

  return {
    generatePrompts,
    editPromptWithAI,
    generateSummary, // Expose the summary generation function
    isGenerating,
    isEditing,
    isSummarizing,
    isLoading: isGenerating || isEditing || isSummarizing,
  };
}; 