// Test Lab: every store template side by side on the demo store, using the real shop stylesheet and renderer settings.
import { demoStore } from '../../../lib/aimp/storefront/demo-store';
import { applyTemplate, resolvePalette, templates } from '../../../lib/aimp/storefront/templates';
import { TemplatePreview } from '../../s/[store]/_ui/template-preview';
import { sampleFrom } from '../../../lib/aimp/storefront/preview-sample';

export const metadata = { title: 'Template gallery · Test Lab' };

export default function Gallery() {
  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: '1.5rem 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '1.6rem' }}>Store templates ({templates.length})</h1>
      <p style={{ color: '#555' }}>The same demo store in each template. <a href="/test-lab">Back to Test Lab</a></p>
      {templates.map((t) => {
        const r = applyTemplate(demoStore, t.id);
        if (!r.ok) return null;
        const pal = resolvePalette(t, r.config.brand.accent);
        const rc = { palette: pal.ok ? pal.palette : t.palette };
        return (
          <section key={t.id} style={{ margin: '2rem 0' }} data-template={t.id}>
            <h2 style={{ fontSize: '1.1rem' }}>{t.name} <small style={{ fontWeight: 400, color: '#666' }}>· {t.bestFor}</small></h2>
            <TemplatePreview tpl={t} palette={rc.palette} sample={sampleFrom(r.config)} />
          </section>
        );
      })}
    </main>
  );
}
