export type ModelOutput = { text: string | null; model: string; modelVersion: string; promptVersion: string; tokenUsage: { input?: number; output?: number } | null; error?: string };
export interface HugoModelAdapter { generate(input: { message: string; name: string; context: any; history: any[] }): Promise<ModelOutput>; }
