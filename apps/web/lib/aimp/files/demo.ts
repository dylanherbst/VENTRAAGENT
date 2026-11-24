// Demo wiring (fixtures only): in-memory storage, orders and grants plus the real product service and files service.
// Kept on globalThis so it survives hot reloads. LIVE mode has no storage adapter yet, so runtime() returns no service.
import { blueprintRegistry } from '../blueprints/index.ts';
import { generateProductSpec } from '../factory/generate.ts';
import { DEFAULT_INPUTS } from '../factory/request.ts';
import { createProviderRegistry } from '../providers/index.ts';
import { createMemoryProductStore, createProductService } from '../products/index.ts';
import type { ProductService } from '../products/index.ts';
import { resolveFilesConfig } from './config.ts';
import type { FilesConfig } from './config.ts';
import { createFilesService } from './service.ts';
import type { FilesService } from './service.ts';
import { createMemoryFileStorage, createMemoryOrderBook } from './storage.ts';
import type { MemoryOrderBook } from './storage.ts';

export const MAX_DEMO_ORDERS = 50;
/** The demo tools and the fixture-backed route are off in production unless AIMP_TOOLS_ENABLED=1 (read by name only). */
export const toolsEnabled = (env: Readonly<Record<string, string | undefined>> = process.env): boolean =>
  env.NODE_ENV !== 'production' || env.AIMP_TOOLS_ENABLED === '1';

export const DEMO_WORKSPACE = 'demo-workspace';
export const OTHER_WORKSPACE = 'other-workspace';
export const DEMO_BUSINESS = 'demo-business';
export const demoCtx = { workspaceId: DEMO_WORKSPACE, businessId: DEMO_BUSINESS, actorId: 'demo-merchant' };
export const otherCtx = { workspaceId: OTHER_WORKSPACE, businessId: 'other-business', actorId: 'other-merchant' };

export interface DemoRuntime {
  config: FilesConfig;
  files: FilesService | null;
  products: ProductService;
  orders: MemoryOrderBook;
  state: { orderItemIds: string[]; lastToken: string | null; counter: number };
}
type G = typeof globalThis & { __aimpFilesDemo?: DemoRuntime };

export function runtime(): DemoRuntime {
  const g = globalThis as G;
  if (g.__aimpFilesDemo) return g.__aimpFilesDemo;
  const config = resolveFilesConfig(process.env);
  const store = createMemoryProductStore();
  const llm = createProviderRegistry({ env: process.env }).llm;
  const products = createProductService({
    store,
    generateSpec: async (p) => {
      const bp = blueprintRegistry.find(p.blueprintId);
      if (!bp) throw new Error('That blueprint does not exist.');
      return generateProductSpec({ blueprint: bp, inputs: demoInputs(), provider: llm });
    },
  });
  const orders = createMemoryOrderBook();
  const files = config.mode === 'demo'
    ? createFilesService({ storage: createMemoryFileStorage(), orders, products: store, secret: config.secret, ttlMs: config.ttlMs, maxDownloads: config.maxDownloads })
    : null;
  g.__aimpFilesDemo = { config, files, products, orders, state: { orderItemIds: [], lastToken: null, counter: 0 } };
  return g.__aimpFilesDemo;
}

function demoInputs() {
  return { niche: DEFAULT_INPUTS.niche, audience: DEFAULT_INPUTS.audience, pricePointMinor: Number(DEFAULT_INPUTS.pricePointMinor), weeklyHours: Number(DEFAULT_INPUTS.weeklyHours), budgetMinor: Number(DEFAULT_INPUTS.budgetMinor) };
}

/** Real product service end to end: generate, QA, approve, store master + preview, then a paid order for it. */
export async function createDemoPaidOrder(): Promise<string> {
  const rt = runtime();
  if (!rt.files) throw new Error('Live storage is not connected.');
  if (rt.state.orderItemIds.length >= MAX_DEMO_ORDERS) throw new Error(`The demo is limited to ${MAX_DEMO_ORDERS} orders. Restart the server to reset it.`);
  const bp = blueprintRegistry.find('printable-planner');
  if (!bp) throw new Error('Blueprint missing.');
  const spec = await generateProductSpec({ blueprint: bp, inputs: demoInputs(), provider: createProviderRegistry({ env: process.env }).llm });
  const { product, version } = await rt.products.createProduct(demoCtx, { businessId: DEMO_BUSINESS, spec });
  const approved = await rt.products.approve(demoCtx, version.id);
  const buyer = await rt.products.getBuyerFile(demoCtx, product.id);
  await rt.files.storeMaster(demoCtx, approved.id, { fileName: buyer.fileName, contentType: buyer.contentType, bytes: buyer.bytes });
  const sample = `SAMPLE ONLY: ${spec.title}\nThis is a public preview. Buy the product to download the full files.\n`;
  await rt.files.storePreview(demoCtx, approved.id, { fileName: 'preview.txt', contentType: 'text/plain; charset=utf-8', bytes: new TextEncoder().encode(sample) });
  const n = ++rt.state.counter;
  const itemId = `demo-item-${n}`;
  rt.orders.addPaidOrder({ orderId: `demo-order-${n}`, itemId, workspaceId: DEMO_WORKSPACE, businessId: DEMO_BUSINESS, productId: product.id, productVersion: approved.version });
  rt.state.orderItemIds.push(itemId);
  return itemId;
}
