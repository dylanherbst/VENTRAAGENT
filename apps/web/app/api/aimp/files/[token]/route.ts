import { createDownloadHandler } from '../../../../../lib/aimp/files/handler.ts';
import { runtime, toolsEnabled } from '../../../../../lib/aimp/files/demo.ts';

export const dynamic = 'force-dynamic';

// GET /api/aimp/files/<token>: verifies the signed, purchase-bound link and streams the private master as an attachment.
// DEMO mode uses the in-memory fixture storage. Failures are a generic 404 or 410; the reason is only in the audit log.
// In production (without AIMP_TOOLS_ENABLED=1) the fixture is not served: 503 until the real storage adapter exists.
export const GET = createDownloadHandler(() => (toolsEnabled() ? runtime().files : null));
