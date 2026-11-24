'use client';
// Offer builder screen: 1) say what you know, 2) pick an offer, 3) edit the words in the PDF and preview a sample, 4) approve.
// Everything is checked again on the server. Nothing is published from here.
import { useEffect, useState } from 'react';
import { approveProductAction, previewProductAction, suggestOffersAction } from './actions';
import type { PreviewReply } from './actions';
import type { Offer, OfferAnswers, ProductContent } from '../../../../lib/aimp/offers/build';

const dollars = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;

export function OffersClient({ business, initial }: { business: string; initial: { answers: OfferAnswers | null; offerId: string | null; content: ProductContent | null; approvedAt: string | null; approvedPrice: number | null } }) {
  const [answers, setAnswers] = useState<OfferAnswers>(initial.answers ?? { knows: '', helps: '', problem: '' });
  const [offers, setOffers] = useState<Offer[]>([]);
  const [offerId, setOfferId] = useState<string | null>(initial.offerId);
  const [steps, setSteps] = useState((initial.content?.steps ?? []).join('\n'));
  const [questions, setQuestions] = useState((initial.content?.questions ?? []).join('\n'));
  const [price, setPrice] = useState(initial.approvedPrice ?? 0);
  const [preview, setPreview] = useState<PreviewReply | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [approvedAt, setApprovedAt] = useState<string | null>(initial.approvedAt);
  const lines = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean);
  const content = () => ({ steps: lines(steps), questions: lines(questions) });

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  async function suggest() {
    setBusy(true); setMsg(''); setErrors([]);
    const r = await suggestOffersAction(business, answers);
    setBusy(false);
    if (!r.ok) { setErrors(r.errors); return; }
    setOffers(r.offers); setApprovedAt(null); setPreview(null);
    if (r.draft && !steps) { setSteps(r.draft.steps.join('\n')); setQuestions(r.draft.questions.join('\n')); }
  }
  async function showPreview(id = offerId) {
    if (!id) return;
    setBusy(true); setMsg(''); setErrors([]);
    const r = await previewProductAction(business, id, answers, content());
    setBusy(false);
    if (!r.ok) { setErrors(r.errors); setPreview(null); return; }
    setPreview(r); setApprovedAt(null);
    if (!price) setPrice(r.priceMinor);
    if (r.sampleBase64) {
      const bytes = Uint8Array.from(atob(r.sampleBase64), (c) => c.charCodeAt(0));
      setPdfUrl(URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })));
    }
  }
  async function approve() {
    if (!offerId) return;
    setBusy(true); setMsg(''); setErrors([]);
    const r = await approveProductAction(business, offerId, answers, content(), price, true);
    setBusy(false); setMsg(r.message); setErrors(r.errors);
    if (r.ok) setApprovedAt(new Date().toISOString());
  }
  const pick = (o: Offer) => { setOfferId(o.id); setPrice(o.testPriceMinor); setPreview(null); void showPreview(o.id); };
  const field = { display: 'block', width: '100%', minHeight: 44, padding: '.6rem .75rem', borderRadius: 10, border: '1px solid #cfc8e6', font: 'inherit', marginTop: 4 } as const;

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <section aria-labelledby="o1">
        <h2 id="o1">1. What can you help with?</h2>
        {(['knows', 'helps', 'problem'] as const).map((k) => (
          <label key={k} style={{ display: 'block', marginBottom: '.75rem' }}>
            {k === 'knows' ? 'What do you know well?' : k === 'helps' ? 'Who do you want to help?' : 'What problem can you help them solve?'}
            <textarea rows={2} value={answers[k]} maxLength={160} onChange={(e) => setAnswers({ ...answers, [k]: e.target.value })} style={field} />
          </label>
        ))}
        <button type="button" onClick={() => void suggest()} disabled={busy} data-testid="suggest">Suggest offers</button>
      </section>

      {offers.length ? (
        <section aria-labelledby="o2">
          <h2 id="o2">2. Pick an offer</h2>
          <div style={{ display: 'grid', gap: '.75rem' }}>
            {offers.map((o) => (
              <button key={o.id} type="button" onClick={() => pick(o)} aria-pressed={offerId === o.id} data-testid="offer" style={{ textAlign: 'left', padding: '.9rem', borderRadius: 14, border: `2px solid ${offerId === o.id ? '#6a47d6' : '#e0daf2'}`, background: '#fff', font: 'inherit', cursor: 'pointer' }}>
                <strong>{o.title}</strong> <span>· test price {dollars(o.testPriceMinor)}</span>
                <p style={{ margin: '.3rem 0' }}>For: {o.buyer}</p>
                <p style={{ margin: '.3rem 0' }}>{o.includes}</p>
                <p style={{ margin: '.3rem 0' }}>Why they would pay: {o.reason}</p>
                <p style={{ margin: 0, opacity: .75 }}>{o.priceNote} A price to test, not a promise.</p>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {offerId ? (
        <section aria-labelledby="o3">
          <h2 id="o3">3. Make it yours</h2>
          <p>These words go straight into the PDF. Edit them so they say what you actually teach. One per line.</p>
          <label style={{ display: 'block', marginBottom: '.75rem' }}>Steps or checklist items<textarea rows={8} value={steps} onChange={(e) => setSteps(e.target.value)} style={field} data-testid="steps" /></label>
          <label style={{ display: 'block', marginBottom: '.75rem' }}>Questions for the reader<textarea rows={6} value={questions} onChange={(e) => setQuestions(e.target.value)} style={field} data-testid="questions" /></label>
          <button type="button" onClick={() => void showPreview()} disabled={busy} data-testid="preview">Preview my PDF</button>
        </section>
      ) : null}

      {errors.length ? <ul role="alert" data-testid="errors">{errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}

      {preview?.ok ? (
        <section aria-labelledby="o4">
          <h2 id="o4">4. Check it and approve</h2>
          <p>{preview.pages} pages. Buyers get: {preview.buyerGets.join(', ')}. Below is a free sample of three pages.</p>
          {pdfUrl ? <iframe title="Sample of your PDF" src={pdfUrl} style={{ width: '100%', height: 480, border: '1px solid #ddd', borderRadius: 12 }} /> : null}
          <label style={{ display: 'block', margin: '.75rem 0' }}>Price (dollars)
            <input type="number" min={5} max={200} step={1} value={price ? price / 100 : ''} onChange={(e) => setPrice(Math.round(Number(e.target.value) * 100))} style={{ ...field, width: 140 }} data-testid="price" />
          </label>
          <button type="button" onClick={() => void approve()} disabled={busy || !price} data-testid="approve">Approve this product</button>
        </section>
      ) : null}

      {msg ? <p role="status" data-testid="msg">{msg}</p> : null}
      {approvedAt ? <p data-testid="approved">Approved. <a href={`/api/aimp/offers/${business}`}>Open the full PDF</a> · <a href={`/app/${business}/website`}>Put it in your shop</a></p> : null}
    </div>
  );
}
