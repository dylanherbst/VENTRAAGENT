// Server wiring for the Marketing Engine (Phase 1A). In-memory store (lost on restart) until the marketing tables are migrated.
// Writer: MARKETING_TEXT_PROVIDER = 'anthropic' | 'openai' | 'demo'. Default: Claude when ANTHROPIC_API_KEY is set, else OpenAI when
// OPENAI_API_KEY and OPENAI_TEXT_MODEL are set, else the labelled demo writer. Nothing here renders, schedules or publishes.
import { claudeWriter, createEngine, demoWriter, newStore, openaiWriter, type Engine, type StrategyWriter } from '../../../lib/aimp/marketing-engine/index';

export function marketingWriter(): StrategyWriter {
  const want = process.env.MARKETING_TEXT_PROVIDER;
  const f = (u: string, i: { method: string; headers: Record<string, string>; body: string }) => fetch(u, { ...i, signal: AbortSignal.timeout(90_000) });
  const claude = process.env.ANTHROPIC_API_KEY ? claudeWriter({ apiKey: process.env.ANTHROPIC_API_KEY, fetch: f, model: process.env.MARKETING_TEXT_MODEL }) : null;
  const openai = process.env.OPENAI_API_KEY && process.env.OPENAI_TEXT_MODEL ? openaiWriter({ apiKey: process.env.OPENAI_API_KEY, fetch: f, model: process.env.OPENAI_TEXT_MODEL }) : null;
  if (want === 'demo') return demoWriter;
  if (want === 'openai') return openai ?? demoWriter;
  if (want === 'anthropic') return claude ?? demoWriter;
  return claude ?? openai ?? demoWriter;
}

type G = typeof globalThis & { __aimpMarketingEngineV3?: Engine };
export function marketingEngine(): Engine {
  const g = globalThis as G;
  return (g.__aimpMarketingEngineV3 ??= createEngine({ store: newStore(), writer: marketingWriter() }));
}

/** The standalone studio (Dylan's own marketing for AiMoneyPrinter). One private workspace, never a customer's. */
export const STUDIO_WORKSPACE = 'studio:aimoneyprinter';
