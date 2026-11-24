import { choosePath } from './actions';
import './path-choice.css';

// First screen: one app, two doors. Both reach the same Home and checklist.
export function PathChoice({ business }: { business: string }) {
  const go = choosePath.bind(null, business);
  return (
    <section className="pc" aria-labelledby="pc-title">
      <h1 id="pc-title">Where are you starting from?</h1>
      <p className="pc-sub">You can change how much you see later. Nothing is lost either way.</p>
      <form action={go} className="pc-grid">
        <button type="submit" name="path" value="new" className="pc-card" data-glow="">
          <b>Start from zero</b>
          <span>We guide you one step at a time, from idea to your first order. You only see what you need next.</span>
        </button>
        <button type="submit" name="path" value="existing" className="pc-card">
          <b>I already have a business</b>
          <span>Go straight in. Add products when you want, and start using brand, payments, social, marketing and your inbox.</span>
        </button>
      </form>
    </section>
  );
}
