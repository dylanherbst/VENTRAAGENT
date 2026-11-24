// Profit calculator (business plan §C05 / §H02): transparent maths over the owner's own assumptions. It never predicts
// sales; the visitor enters them. All amounts are whole cents, AUD.
import { cardFeeMinor } from './generate.ts';

export interface ProfitInput {
  priceMinor: number;        // price per sale, incl. GST
  salesPerMonth: number;     // the owner's own estimate
  planMinor: number;         // monthly plan price, incl. GST
  gstRegistered: boolean;    // registered sellers remit 1/11 of GST-inclusive sales
}
export interface ProfitResult {
  grossMinor: number; cardFeesMinor: number; gstMinor: number; planMinor: number; profitMinor: number;
  perSaleMinor: number;      // what one sale leaves after its card fee (and GST if registered)
  breakEvenSales: number | null; // sales per month needed to cover the plan; null if a sale leaves nothing
}

export function profit({ priceMinor, salesPerMonth, planMinor, gstRegistered }: ProfitInput): ProfitResult {
  const price = Math.max(0, Math.round(priceMinor));
  const sales = Math.max(0, Math.floor(salesPerMonth));
  const fee = price > 0 ? cardFeeMinor(price) : 0;
  const gstPerSale = gstRegistered ? Math.round(price / 11) : 0;
  const perSale = price - fee - gstPerSale;
  const gross = price * sales;
  const cardFees = fee * sales;
  const gst = gstPerSale * sales;
  return {
    grossMinor: gross, cardFeesMinor: cardFees, gstMinor: gst, planMinor, profitMinor: gross - cardFees - gst - planMinor,
    perSaleMinor: perSale,
    breakEvenSales: perSale > 0 ? Math.ceil(planMinor / perSale) : null,
  };
}
