import type { LlmProviderId, Persona, Product, ScriptSegment, TtsProviderId } from '@lingbo/shared';

export interface ScriptDraft {
  segments: ScriptSegment[];
  provider: LlmProviderId;
}

export interface AnswerDraft {
  text: string;
  provider: LlmProviderId;
}

export interface LlmProvider {
  readonly id: LlmProviderId;
  generateScript(input: { product: Product; persona: Persona }): Promise<ScriptDraft>;
  answerQuestion(input: { product: Product; persona: Persona; question: string }): Promise<AnswerDraft>;
}

export interface SpeechClip {
  text: string;
  durationMs: number;
  audioUrl: string | null;
  provider: TtsProviderId;
}

export interface TtsProvider {
  readonly id: TtsProviderId;
  synthesize(text: string, persona: Persona): Promise<SpeechClip>;
}
