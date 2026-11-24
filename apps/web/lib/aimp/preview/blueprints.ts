// Tested blueprints for the public "Build my business" preview (website plan §01/§02).
// There is no AI key yet, so the preview is assembled from these authored blueprints. Every product, price and pin here
// is something the production engines can actually make; nothing promises sales or earnings.
import type { BusinessModel } from '../contracts.ts';
import type { CoverStyle, ProductFormat, StoreFont } from '../storefront/schema.ts';

export interface BlueprintProduct {
  slug: string;
  title: string;
  summary: string;
  /** One or two plain sentences used as the product page description. */
  detail: string;
  format: ProductFormat;
  pages?: number;
  /** Whole cents, AUD incl. GST. */
  priceMinor: number;
  cover: { style: CoverStyle; label: string };
  includes: string[];
}

export interface PinIdea {
  /** ≤100 chars (Pinterest title limit). */
  title: string;
  description: string;
  board: string;
  /** Product whose cover the pin visual uses. */
  productSlug: string;
}

export interface NicheVariant {
  id: string;
  label: string;
  /** Who buys, in one line. */
  audience: string;
  names: string[];
  tagline: string;
  heroHeading: string;
  heroSubheading: string;
  ctaLabel: string;
  font: Extract<StoreFont, 'serif' | 'sans'>;
  tags: string[];
  products: BlueprintProduct[];
  bundle: { slug: string; title: string; summary: string; productSlugs: string[]; priceMinor: number };
  pins: PinIdea[];
  pricingRationale: string;
}

export interface Blueprint {
  id: BusinessModel;
  version: number;
  title: string;
  description: string;
  exampleProducts: string[];
  startupCost: string;
  weeklyHours: string;
  primaryChannel: 'Pinterest';
  /** Extra FAQ that only applies to this kind of product. */
  faq: { question: string; answer: string }[];
  niches: NicheVariant[];
}

const digitalTemplates: Blueprint = {
  id: 'digital-templates',
  version: 1,
  title: 'Digital templates & planners',
  description: 'Printable and spreadsheet templates people download and use straight away.',
  exampleProducts: ['Wedding budget spreadsheet', 'Teacher term planner', '90-day habit tracker'],
  startupCost: 'Usually under A$50 on top of your plan. Free design-tool tiers are enough to start.',
  weeklyHours: 'About 2–5 hours a week once live, mostly reviewing products and approving pins.',
  primaryChannel: 'Pinterest',
  faq: [{ question: 'Which apps do I need?', answer: 'PDFs print from any computer. Spreadsheet templates open in free Google Sheets or in Microsoft Excel.' }],
  niches: [
    {
      id: 'wedding-planning',
      label: 'Wedding planning',
      audience: 'Couples planning a wedding on a budget',
      names: ['Vow & Ledger', 'Petal Plan Co', 'The Calm Aisle', 'Little Ceremony Studio'],
      tagline: 'Printable and spreadsheet planners for a calmer wedding year',
      heroHeading: 'Plan your wedding without the spreadsheet panic.',
      heroSubheading: 'Budget trackers, guest lists and day-of timelines that work in Google Sheets or print at home. Download instantly and start tonight.',
      ctaLabel: 'Browse planners',
      font: 'serif',
      tags: ['wedding', 'planner'],
      products: [
        {
          slug: 'wedding-budget-tracker', title: 'Wedding Budget Tracker',
          summary: 'Set a total, split it across 18 categories and see what is left after every deposit.',
          detail: 'Enter your total budget once and the sheet suggests a split across venue, catering, attire, photography and 14 more categories. Log quotes and deposits as they arrive; the remaining balance and upcoming due dates update automatically.',
          format: 'Google Sheets', priceMinor: 1400, cover: { style: 'grid', label: 'Budget Tracker' },
          includes: ['Google Sheets and Excel versions', '18 budget categories you can rename', 'Deposit and due-date tracker', 'One-page setup instructions'],
        },
        {
          slug: 'guest-list-rsvp-manager', title: 'Guest List & RSVP Manager',
          summary: 'Track invites, RSVPs, meal choices and table numbers in one sheet.',
          detail: 'One row per guest with RSVP status, dietary needs and table number. Headcount and meal totals update as replies come in, ready to send to your caterer.',
          format: 'Google Sheets', priceMinor: 1200, cover: { style: 'lines', label: 'Guest List & RSVP' },
          includes: ['Google Sheets and Excel versions', 'Automatic headcount and meal totals', 'Printable seating summary'],
        },
        {
          slug: 'wedding-day-timeline', title: 'Wedding Day Timeline',
          summary: 'An hour-by-hour run sheet for the day, ready to share with suppliers.',
          detail: 'Plan the day from hair and make-up to the last dance. A worked example for a 3pm ceremony shows typical timings you can adjust.',
          format: 'PDF', pages: 4, priceMinor: 900, cover: { style: 'lines', label: 'Day-of Timeline' },
          includes: ['Editable and printable PDF', 'Supplier contact sheet', 'Worked example for a 3pm ceremony'],
        },
        {
          slug: 'vendor-comparison-sheets', title: 'Vendor Comparison Sheets',
          summary: 'Compare up to five quotes per supplier side by side before you book.',
          detail: 'Six comparison pages for venue, catering, photography, florist, music and attire, each with the questions worth asking before you pay a deposit.',
          format: 'PDF', pages: 6, priceMinor: 800, cover: { style: 'dots', label: 'Vendor Compare' },
          includes: ['Six supplier categories', 'Questions to ask each supplier', 'A4 and US Letter versions'],
        },
        {
          slug: 'wedding-planner-binder', title: 'Complete Wedding Planner Binder',
          summary: 'A 40-page printable planner from engagement to thank-you cards.',
          detail: 'Everything in one binder: a 12-month countdown, budget pages, guest lists, supplier notes and a day-of run sheet. Print the pages you need.',
          format: 'PDF', pages: 40, priceMinor: 2400, cover: { style: 'arch', label: 'Wedding Planner' },
          includes: ['40 printable pages', '12-month countdown checklist', 'A4 and US Letter versions'],
        },
      ],
      bundle: { slug: 'wedding-essentials-bundle', title: 'Wedding Essentials Bundle', summary: 'Budget tracker, guest list and day-of timeline together.', productSlugs: ['wedding-budget-tracker', 'guest-list-rsvp-manager', 'wedding-day-timeline'], priceMinor: 2600 },
      pins: [
        { title: 'Wedding budget template: split your total across 18 categories', description: 'A Google Sheets wedding budget tracker that shows what is left after every deposit. Instant download; works on phone and laptop.', board: 'Wedding Budget Tips', productSlug: 'wedding-budget-tracker' },
        { title: 'Wedding day timeline example for a 3pm ceremony', description: 'An hour-by-hour run sheet you can copy for your own day, then share with your photographer and venue.', board: 'Wedding Day Timeline Ideas', productSlug: 'wedding-day-timeline' },
        { title: 'Guest list spreadsheet with RSVP and meal tracking', description: 'Track replies, dietary needs and table numbers in one sheet. Headcounts update automatically for your caterer.', board: 'Wedding Planning Printables', productSlug: 'guest-list-rsvp-manager' },
      ],
      pricingRationale: 'Single tools at A$8–14 keep the first purchase low-risk; the 40-page binder carries the higher price because it replaces several separate templates.',
    },
    {
      id: 'small-business-bookkeeping',
      label: 'Small-business bookkeeping',
      audience: 'Sole traders and side-hustlers who track money in spreadsheets',
      names: ['Tidy Ledger Co', 'Sole Trader Desk', 'Clear Books Studio'],
      tagline: 'Simple spreadsheets for sole traders who want tidy numbers',
      heroHeading: 'Know where your business money went this month.',
      heroSubheading: 'Income and expense trackers, invoice templates and a GST helper built for Australian sole traders. Works in Google Sheets and Excel.',
      ctaLabel: 'See the spreadsheets',
      font: 'sans',
      tags: ['bookkeeping', 'sole trader'],
      products: [
        {
          slug: 'income-expense-tracker', title: 'Income & Expense Tracker',
          summary: 'Log sales and costs each month; a dashboard totals profit by category for the year.',
          detail: 'Twelve monthly tabs feed an annual summary that shows income, expenses and profit by category. Built for sole traders who want tidy records without accounting software.',
          format: 'Google Sheets', priceMinor: 1900, cover: { style: 'grid', label: 'Income & Expenses' },
          includes: ['Google Sheets and Excel versions', '12 monthly tabs plus annual summary', 'Customisable expense categories'],
        },
        {
          slug: 'gst-bas-helper', title: 'GST & BAS Helper Sheet',
          summary: 'Tallies GST collected and paid each quarter so BAS time takes less digging.',
          detail: 'Enter sales and purchases with their GST and the sheet totals each quarter. It organises your figures; it does not lodge anything or replace advice from your accountant.',
          format: 'Google Sheets', priceMinor: 1500, cover: { style: 'lines', label: 'GST Helper' },
          includes: ['Quarterly GST summary', 'Plain notes on what the sheet covers', 'Not tax advice: check with your accountant'],
        },
        {
          slug: 'invoice-template-pack', title: 'Invoice Template Pack',
          summary: 'Five clean invoice layouts with ABN, GST and payment-terms fields.',
          detail: 'Five invoice designs with the fields Australian invoices need, including ABN and GST lines. Edit in Google Docs or Word and save as PDF.',
          format: 'ZIP', priceMinor: 1200, cover: { style: 'lines', label: 'Invoice Pack' },
          includes: ['5 editable invoice designs', 'Google Docs and Word versions', 'Tax invoice checklist'],
        },
        {
          slug: 'vehicle-logbook-sheet', title: 'Vehicle Logbook Sheet',
          summary: 'Record business trips and odometer readings over a 12-week period.',
          detail: 'A 12-week trip log that works out your business-use percentage as you go. Print it for the glovebox or fill it in on your phone.',
          format: 'Google Sheets', priceMinor: 900, cover: { style: 'dots', label: 'Vehicle Logbook' },
          includes: ['12-week logbook layout', 'Automatic business-use percentage', 'Printable PDF copy'],
        },
        {
          slug: 'cash-flow-forecast', title: '13-Week Cash Flow Forecast',
          summary: 'See the next quarter of money in and out, week by week.',
          detail: 'Enter expected sales and bills and see which weeks run tight before they arrive. A worked example tab shows how to fill it in.',
          format: 'XLSX', priceMinor: 1700, cover: { style: 'grid', label: 'Cash Flow 13 Weeks' },
          includes: ['Excel file, Google Sheets compatible', 'Worked example tab', 'Low-balance warning column'],
        },
      ],
      bundle: { slug: 'sole-trader-starter-kit', title: 'Sole Trader Starter Kit', summary: 'Income tracker, GST helper and invoice pack together.', productSlugs: ['income-expense-tracker', 'gst-bas-helper', 'invoice-template-pack'], priceMinor: 3400 },
      pins: [
        { title: 'Simple income and expense spreadsheet for sole traders', description: 'Twelve monthly tabs and an annual profit summary in Google Sheets. No accounting software needed.', board: 'Small Business Spreadsheets', productSlug: 'income-expense-tracker' },
        { title: 'How to keep a 12-week vehicle logbook (template)', description: 'A trip log that works out your business-use percentage as you go. Print it or fill it in on your phone.', board: 'Sole Trader Tips', productSlug: 'vehicle-logbook-sheet' },
        { title: 'Five invoice templates with ABN and GST fields', description: 'Clean invoice layouts for Australian sole traders. Edit in Google Docs or Word and send as a PDF.', board: 'Invoice Templates', productSlug: 'invoice-template-pack' },
      ],
      pricingRationale: 'Business buyers pay for time saved every month, so ongoing trackers sit at A$15–19 while one-off forms like the logbook stay under A$10.',
    },
    {
      id: 'teacher-planners',
      label: 'Teacher planners',
      audience: 'Primary teachers planning terms and lessons',
      names: ['Chalk & Term', 'Bright Bell Planners', 'The Organised Classroom', 'Recess Ready Studio'],
      tagline: 'Undated planners built around the Australian school term',
      heroHeading: 'Plan a whole term before the first bell.',
      heroSubheading: 'Undated lesson planners, term overviews and class trackers sized for A4 binders. Print what you need and skip what you do not.',
      ctaLabel: 'Browse planners',
      font: 'sans',
      tags: ['teacher', 'planner'],
      products: [
        {
          slug: 'term-overview-planner', title: 'Term Overview Planner',
          summary: 'A ten-week spread for units, assessments, excursions and reports.',
          detail: 'See the whole term on one spread: units of work, assessment dates, excursions and report deadlines. Undated, so it works for any term and any year.',
          format: 'PDF', pages: 6, priceMinor: 800, cover: { style: 'grid', label: 'Term Overview' },
          includes: ['Undated 10-week layout', 'A4 and A3 versions', 'Four-term year plan page'],
        },
        {
          slug: 'weekly-lesson-planner', title: 'Weekly Lesson Planner',
          summary: 'A five-day lesson grid with up to seven periods per day.',
          detail: 'Plan each week with a clear grid for subjects, resources and notes. A reflection column helps you adjust next week’s lessons.',
          format: 'PDF', pages: 3, priceMinor: 700, cover: { style: 'grid', label: 'Lesson Planner' },
          includes: ['Editable PDF', '5- and 7-period layouts', 'Notes and reflection column'],
        },
        {
          slug: 'class-record-tracker', title: 'Class Record Tracker',
          summary: 'Track attendance, reading levels and assessment marks for up to 30 students.',
          detail: 'One sheet per class with colour-coded progress columns, so patterns stand out before report time.',
          format: 'Google Sheets', priceMinor: 1200, cover: { style: 'dots', label: 'Class Tracker' },
          includes: ['Google Sheets version', 'Printable PDF version', 'Colour-coded progress columns'],
        },
        {
          slug: 'relief-teacher-folder', title: 'Relief Teacher Folder',
          summary: 'Everything a relief teacher needs to run your class for a day.',
          detail: 'Fill in routines, seating, timetable and key contacts once, and your class runs smoothly when you are away.',
          format: 'PDF', pages: 12, priceMinor: 900, cover: { style: 'lines', label: 'Relief Folder' },
          includes: ['Routine and seating plan pages', 'Emergency procedures page', 'Editable fields'],
        },
        {
          slug: 'complete-teacher-planner', title: 'Complete Teacher Planner',
          summary: 'An 80-page undated planner covering the full school year.',
          detail: 'Term planners, weekly grids, class trackers and meeting notes in one binder-ready file.',
          format: 'PDF', pages: 80, priceMinor: 1900, cover: { style: 'arch', label: 'Teacher Planner' },
          includes: ['80 printable pages', 'Term, weekly and tracker pages', 'A4 binder-ready'],
        },
      ],
      bundle: { slug: 'term-ready-bundle', title: 'Term Ready Bundle', summary: 'Term overview, weekly lesson planner and class tracker together.', productSlugs: ['term-overview-planner', 'weekly-lesson-planner', 'class-record-tracker'], priceMinor: 2000 },
      pins: [
        { title: 'Undated term planner for Australian teachers (10-week layout)', description: 'Map units, assessments and excursions for the whole term on one spread. Print on A4 or A3.', board: 'Teacher Planning Ideas', productSlug: 'term-overview-planner' },
        { title: 'What to put in a relief teacher folder: a printable checklist', description: 'Routines, seating plan, timetable and contacts in one folder so your class runs smoothly while you are away.', board: 'Relief Teaching', productSlug: 'relief-teacher-folder' },
        { title: 'Class record tracker for reading levels and attendance', description: 'A colour-coded Google Sheet for up to 30 students. Spot patterns before report time.', board: 'Classroom Organisation', productSlug: 'class-record-tracker' },
      ],
      pricingRationale: 'Single printables stay under A$10 for an easy first purchase; the full-year planner at A$19 is the better-value hero product.',
    },
    {
      id: 'fitness-trackers',
      label: 'Fitness & habit trackers',
      audience: 'People building a training or wellness routine',
      names: ['Rep & Rest', 'Steady Strides Co', 'Small Steps Studio'],
      tagline: 'Printable trackers that make training progress visible',
      heroHeading: 'See your progress on one page.',
      heroSubheading: 'Workout logs, step challenges and habit trackers for home printers. Undated, so you can start on any Monday.',
      ctaLabel: 'Browse trackers',
      font: 'sans',
      tags: ['fitness', 'tracker'],
      products: [
        {
          slug: 'workout-log-12-week', title: '12-Week Workout Log',
          summary: 'Log sets, reps and weights for three training days a week.',
          detail: 'Twelve weeks of training on clean, undated pages with a progress check-in every four weeks.',
          format: 'PDF', pages: 14, priceMinor: 900, cover: { style: 'grid', label: 'Workout Log' },
          includes: ['Undated 12-week layout', 'Progress check-in every 4 weeks', 'A4 and US Letter versions'],
        },
        {
          slug: 'habit-tracker-90-day', title: '90-Day Habit Tracker',
          summary: 'Track up to eight daily habits for a full quarter on one sheet.',
          detail: 'Ninety squares per habit make progress visible at a glance, with a monthly reflection box to adjust rather than quit.',
          format: 'PDF', pages: 3, priceMinor: 700, cover: { style: 'dots', label: '90-Day Habits' },
          includes: ['A4 and US Letter versions', 'Monthly reflection page'],
        },
        {
          slug: 'step-challenge-30-day', title: '30-Day Step Challenge',
          summary: 'A colour-in calendar with daily step targets that build gradually.',
          detail: 'Pick a starting level and colour in each day you hit your target. Targets rise gently across the month.',
          format: 'PDF', pages: 2, priceMinor: 500, cover: { style: 'dots', label: 'Step Challenge' },
          includes: ['Three difficulty levels', 'Colour-in progress calendar'],
        },
        {
          slug: 'meal-prep-planner', title: 'Meal Prep Planner',
          summary: 'Plan a week of meals, prep steps and a grocery list on two pages.',
          detail: 'Plan meals on the left and build the grocery list on the right, grouped by aisle.',
          format: 'PDF', pages: 3, priceMinor: 700, cover: { style: 'lines', label: 'Meal Prep' },
          includes: ['Weekly meal grid', 'Grocery list grouped by aisle', 'A4 and US Letter versions'],
        },
      ],
      bundle: { slug: 'fresh-start-bundle', title: 'Fresh Start Bundle', summary: 'Workout log, habit tracker and meal prep planner together.', productSlugs: ['workout-log-12-week', 'habit-tracker-90-day', 'meal-prep-planner'], priceMinor: 1700 },
      pins: [
        { title: '12-week workout log printable for beginners', description: 'Track sets, reps and weights for three sessions a week, with a check-in every four weeks.', board: 'Workout Planning', productSlug: 'workout-log-12-week' },
        { title: '90-day habit tracker: eight habits on one page', description: 'An undated printable that shows a whole quarter of progress at a glance.', board: 'Habit Tracker Ideas', productSlug: 'habit-tracker-90-day' },
        { title: '30-day step challenge calendar you can colour in', description: 'Three starting levels and gently rising daily targets. Print it and stick it on the fridge.', board: 'Walking Challenges', productSlug: 'step-challenge-30-day' },
      ],
      pricingRationale: 'Trackers are small, quick purchases, so prices stay between A$5 and A$9 and the bundle gives a clear reason to buy three.',
    },
  ],
};

const printableArt: Blueprint = {
  id: 'printable-art',
  version: 1,
  title: 'Printable wall art',
  description: 'Ready-to-print art files buyers print at home or at a local print shop.',
  exampleProducts: ['Nursery animal prints', 'Australian native botanicals', 'Calm typography posters'],
  startupCost: 'Usually under A$50 on top of your plan. Artwork is generated, then checked before listing.',
  weeklyHours: 'About 2–4 hours a week once live, mostly reviewing new designs and pins.',
  primaryChannel: 'Pinterest',
  faq: [{ question: 'What size can I print?', answer: 'Each print includes high-resolution files for common frame sizes. Use matte paper for the best colour.' }],
  niches: [
    {
      id: 'nursery-wall-art',
      label: 'Nursery wall art',
      audience: 'Parents decorating a nursery or kids’ room',
      names: ['Little Burrow Prints', 'Soft Moon Nursery', 'Hush & Hop Studio'],
      tagline: 'Gentle printable art for calm nurseries',
      heroHeading: 'Calm, gentle art for the nursery wall.',
      heroSubheading: 'Soft-palette animal and alphabet prints sized for standard frames. Download, print at home or at a print shop, and frame the same day.',
      ctaLabel: 'Browse prints',
      font: 'serif',
      tags: ['nursery', 'wall art'],
      products: [
        {
          slug: 'woodland-animal-trio', title: 'Woodland Animal Trio',
          summary: 'Three matching prints: fox, bunny and hedgehog in soft sage and sand.',
          detail: 'A coordinated set of three gentle woodland animals designed to hang together above a cot or change table.',
          format: 'ZIP', priceMinor: 1400, cover: { style: 'arch', label: 'Woodland Trio' },
          includes: ['3 high-resolution prints', 'Sizes from A5 to A2 plus 8×10 in', 'Print-shop guide'],
        },
        {
          slug: 'soft-alphabet-poster', title: 'Soft Alphabet Poster',
          summary: 'A to Z with simple animal shapes in a muted palette.',
          detail: 'A calm alphabet poster with one simple animal per letter. Muted colours suit both neutral and colourful rooms.',
          format: 'PNG', priceMinor: 900, cover: { style: 'grid', label: 'Alphabet' },
          includes: ['High-resolution PNG', 'A3, A4 and 16×20 in sizes'],
        },
        {
          slug: 'moon-and-stars-set', title: 'Moon & Stars Set',
          summary: 'Two minimal prints for a sleepy, neutral nursery.',
          detail: 'A crescent moon and a scattered star field in warm neutrals. Works as a pair or on their own.',
          format: 'ZIP', priceMinor: 1000, cover: { style: 'dots', label: 'Moon & Stars' },
          includes: ['2 high-resolution prints', 'A4, A3 and 8×10 in sizes'],
        },
        {
          slug: 'nursery-name-sign', title: 'Nursery Name Sign',
          summary: 'An editable name print you personalise in Canva before printing.',
          detail: 'Type your baby’s name, choose one of six font pairings and download a print-ready file.',
          format: 'Canva link', priceMinor: 1200, cover: { style: 'arch', label: 'Name Sign' },
          includes: ['Editable Canva template', 'Six font pairings', 'How-to-edit guide'],
        },
      ],
      bundle: { slug: 'nursery-wall-set', title: 'Nursery Wall Set', summary: 'Woodland trio, alphabet poster and moon and stars together.', productSlugs: ['woodland-animal-trio', 'soft-alphabet-poster', 'moon-and-stars-set'], priceMinor: 2400 },
      pins: [
        { title: 'Woodland nursery wall art: fox, bunny and hedgehog prints', description: 'A soft sage and sand print set to frame above the cot. Instant download, print at home or at a print shop.', board: 'Woodland Nursery Ideas', productSlug: 'woodland-animal-trio' },
        { title: 'Neutral nursery decor you can print at home', description: 'Minimal moon and stars prints in warm neutrals. Sized for standard frames.', board: 'Neutral Nursery', productSlug: 'moon-and-stars-set' },
        { title: 'Personalised nursery name sign template (edit in Canva)', description: 'Type the name, pick a font pairing and print. Six styles included.', board: 'Nursery Name Signs', productSlug: 'nursery-name-sign' },
      ],
      pricingRationale: 'Single prints at A$9–10 let parents test a print at home; matching sets are priced higher because they fill a wall in one purchase.',
    },
    {
      id: 'botanical-prints',
      label: 'Botanical & kitchen prints',
      audience: 'Renters and home decorators refreshing a room cheaply',
      names: ['Fern & Folio', 'Leaf Line Prints', 'Pressed Studio'],
      tagline: 'Botanical prints that make a rental feel like home',
      heroHeading: 'Fresh botanical art for any room, printed today.',
      heroSubheading: 'Line-drawn leaves, herbs and native flowers in sets of two and three. Print on matte paper and frame in standard sizes.',
      ctaLabel: 'Browse prints',
      font: 'serif',
      tags: ['botanical', 'wall art'],
      products: [
        {
          slug: 'australian-natives-set', title: 'Australian Natives Set',
          summary: 'Banksia, waratah and wattle as three fine-line prints.',
          detail: 'Three Australian native flowers drawn in fine line with a soft wash of colour. Designed to hang in a row.',
          format: 'ZIP', priceMinor: 1500, cover: { style: 'arch', label: 'Native Botanicals' },
          includes: ['3 high-resolution prints', 'A4, A3 and 8×10 in sizes', 'Framing guide'],
        },
        {
          slug: 'kitchen-herbs-trio', title: 'Kitchen Herbs Trio',
          summary: 'Basil, rosemary and thyme in soft green line work.',
          detail: 'Three herb studies with their names in small type, made for a kitchen wall or open shelf.',
          format: 'ZIP', priceMinor: 1200, cover: { style: 'lines', label: 'Kitchen Herbs' },
          includes: ['3 high-resolution prints', 'A5, A4 and 5×7 in sizes'],
        },
        {
          slug: 'monstera-leaf-print', title: 'Monstera Leaf Print',
          summary: 'One oversized leaf in charcoal on warm white.',
          detail: 'A single bold leaf that fills a large frame. Prints well at A2 at a local print shop.',
          format: 'PNG', priceMinor: 700, cover: { style: 'arch', label: 'Monstera' },
          includes: ['High-resolution PNG', 'A4 to A2 sizes'],
        },
        {
          slug: 'eucalyptus-pair', title: 'Eucalyptus Pair',
          summary: 'Two tall eucalyptus branch prints for a hallway or bedroom.',
          detail: 'A matching pair of long eucalyptus branches in grey-green, sized for tall narrow frames.',
          format: 'ZIP', priceMinor: 1000, cover: { style: 'lines', label: 'Eucalyptus Pair' },
          includes: ['2 high-resolution prints', 'Tall and standard frame sizes'],
        },
        {
          slug: 'pressed-flower-grid', title: 'Pressed Flower Grid',
          summary: 'Nine pressed-flower studies arranged in a neat grid.',
          detail: 'Nine small flower studies on one print, like a pressed-flower collection.',
          format: 'PNG', priceMinor: 800, cover: { style: 'grid', label: 'Pressed Flowers' },
          includes: ['High-resolution PNG', 'A4, A3 and square sizes'],
        },
      ],
      bundle: { slug: 'botanical-gallery-wall', title: 'Botanical Gallery Wall', summary: 'Australian natives, kitchen herbs and eucalyptus pair together.', productSlugs: ['australian-natives-set', 'kitchen-herbs-trio', 'eucalyptus-pair'], priceMinor: 2700 },
      pins: [
        { title: 'Australian native flower prints: banksia, waratah and wattle', description: 'Three fine-line native flower prints to frame in a row. Instant download in common sizes.', board: 'Australian Native Decor', productSlug: 'australian-natives-set' },
        { title: 'Kitchen herb wall art you can print at home', description: 'Basil, rosemary and thyme in soft green line work for a kitchen wall or shelf.', board: 'Kitchen Wall Decor', productSlug: 'kitchen-herbs-trio' },
        { title: 'How to build a botanical gallery wall in a rental', description: 'Mix three-print sets and one large leaf print, then hang with removable strips.', board: 'Rental Decor Ideas', productSlug: 'monstera-leaf-print' },
      ],
      pricingRationale: 'Single prints start at A$7 and sets sit at A$10–15, so a full gallery wall of files costs under A$30.',
    },
    {
      id: 'typography-prints',
      label: 'Typography & quote prints',
      audience: 'People styling a home office or study',
      names: ['Quiet Ambition Prints', 'Desk Notes Studio', 'Plain Words Co'],
      tagline: 'Calm typographic prints for the home office',
      heroHeading: 'Words worth looking at while you work.',
      heroSubheading: 'Clean typographic posters with short, honest lines and no hustle slogans. Sized for standard frames and printed at home.',
      ctaLabel: 'Browse prints',
      font: 'sans',
      tags: ['typography', 'home office'],
      products: [
        {
          slug: 'one-thing-at-a-time', title: 'One Thing at a Time',
          summary: 'A single-line typographic print in charcoal on soft white.',
          detail: 'Three words, set large and quiet. Made to hang above a desk.',
          format: 'PNG', priceMinor: 700, cover: { style: 'lines', label: 'One Thing at a Time' },
          includes: ['High-resolution PNG', 'A4, A3 and 8×10 in sizes'],
        },
        {
          slug: 'progress-over-perfect-set', title: 'Progress Over Perfect Set',
          summary: 'Two coordinating quote prints for either side of a desk.',
          detail: 'A matching pair of short lines about steady progress, in the same type and palette.',
          format: 'ZIP', priceMinor: 1100, cover: { style: 'lines', label: 'Progress Set' },
          includes: ['2 high-resolution prints', 'A4, A3 and 8×10 in sizes'],
        },
        {
          slug: 'weekly-focus-poster', title: 'Weekly Focus Poster',
          summary: 'A print-and-write poster for this week’s three priorities.',
          detail: 'Print it, write three priorities, and pin it where you work. Reprint every Monday.',
          format: 'PDF', pages: 1, priceMinor: 800, cover: { style: 'grid', label: 'Weekly Focus' },
          includes: ['Printable PDF', 'A4 and A3 sizes'],
        },
        {
          slug: 'focus-hours-sign', title: 'Focus Hours Door Sign',
          summary: 'A door sign to print for focused work blocks.',
          detail: 'Two versions: “In a focus block until…” and “Free to chat”. Print and hang on a door handle.',
          format: 'PDF', pages: 2, priceMinor: 500, cover: { style: 'dots', label: 'Focus Hours' },
          includes: ['Printable PDF', 'Door-hanger and A5 versions'],
        },
      ],
      bundle: { slug: 'home-office-set', title: 'Home Office Set', summary: 'One Thing at a Time, the Progress set and the weekly focus poster.', productSlugs: ['one-thing-at-a-time', 'progress-over-perfect-set', 'weekly-focus-poster'], priceMinor: 1900 },
      pins: [
        { title: 'Minimal home office wall art with calm typography', description: 'Short, quiet lines set large in charcoal on soft white. Instant download for standard frames.', board: 'Home Office Ideas', productSlug: 'one-thing-at-a-time' },
        { title: 'Printable weekly focus poster for your desk', description: 'Write three priorities every Monday and pin them where you work.', board: 'Productivity Printables', productSlug: 'weekly-focus-poster' },
        { title: 'Quote prints for your desk without hustle slogans', description: 'A matching pair of prints about steady progress, for either side of a desk.', board: 'Typography Prints', productSlug: 'progress-over-perfect-set' },
      ],
      pricingRationale: 'Typography prints are quick to produce, so prices stay low (A$5–11) and the set price rewards buying a matching group.',
    },
  ],
};

const personalisedDigital: Blueprint = {
  id: 'personalised-digital',
  version: 1,
  title: 'Personalised digital products',
  description: 'Files customised with a buyer’s name, date or details and delivered digitally.',
  exampleProducts: ['Kids’ routine charts with names', 'Editable party invitations', 'Baby milestone cards'],
  startupCost: 'Usually under A$50 on top of your plan. Canva’s free tier works for editable templates.',
  weeklyHours: 'About 4–8 hours a week once live; personalised orders get a quick check before delivery.',
  primaryChannel: 'Pinterest',
  faq: [{ question: 'Do I need a Canva account?', answer: 'Editable templates open in Canva. A free Canva account is enough. Done-for-you versions arrive as a ready-to-print PDF.' }],
  niches: [
    {
      id: 'kids-routine-charts',
      label: 'Kids’ routine charts',
      audience: 'Parents of 3–10 year olds building morning and bedtime routines',
      names: ['Tiny Routines Co', 'Sunup Charts', 'Chore Bear Studio'],
      tagline: 'Personalised routine charts for smoother mornings',
      heroHeading: 'Mornings with fewer reminders.',
      heroSubheading: 'Picture-based morning, after-school and bedtime charts with your child’s name. Edit in Canva or order a personalised PDF.',
      ctaLabel: 'Browse charts',
      font: 'sans',
      tags: ['kids', 'routine chart'],
      products: [
        {
          slug: 'morning-routine-chart', title: 'Personalised Morning Routine Chart',
          summary: 'Eight picture steps from waking up to shoes on, with your child’s name.',
          detail: 'Choose the steps that fit your morning, add your child’s name and print. Picture cards help pre-readers follow along.',
          format: 'Canva link', priceMinor: 900, cover: { style: 'dots', label: 'Morning Routine' },
          includes: ['Editable Canva template', '40 picture cards to choose from', 'Print or show on a tablet'],
        },
        {
          slug: 'bedtime-routine-chart', title: 'Bedtime Routine Chart',
          summary: 'A calm wind-down chart with bath, teeth, story and lights out.',
          detail: 'A gentle evening sequence in soft colours, editable to match your family’s routine.',
          format: 'Canva link', priceMinor: 900, cover: { style: 'dots', label: 'Bedtime Routine' },
          includes: ['Editable Canva template', 'Night-time picture cards', 'A4 and US Letter sizes'],
        },
        {
          slug: 'chore-reward-chart', title: 'Chore & Reward Chart',
          summary: 'Weekly chores with sticker spaces and a reward goal.',
          detail: 'List age-appropriate chores, add a reward goal and let your child mark off each day.',
          format: 'PDF', pages: 2, priceMinor: 800, cover: { style: 'grid', label: 'Chore Chart' },
          includes: ['Printable PDF', 'Chore ideas by age', 'A4 and US Letter sizes'],
        },
        {
          slug: 'routine-picture-cards', title: 'Routine Picture Cards',
          summary: '60 printable picture cards for building any routine.',
          detail: 'Cut-out cards for daily tasks from brushing teeth to packing a school bag. Laminate and reuse.',
          format: 'PDF', pages: 8, priceMinor: 1100, cover: { style: 'grid', label: 'Picture Cards' },
          includes: ['60 picture cards', 'Blank cards to draw your own', 'Cutting guide'],
        },
        {
          slug: 'done-for-you-name-version', title: 'Done-for-You Name Version',
          summary: 'We add your child’s name and favourite colour and send a print-ready PDF.',
          detail: 'Tell us the name, colour and steps at checkout. We check the file and email a print-ready PDF.',
          format: 'PDF', pages: 1, priceMinor: 1600, cover: { style: 'arch', label: 'Made For You' },
          includes: ['Name and colour personalisation', 'Print-ready PDF within 2 business days', 'One round of changes'],
        },
      ],
      bundle: { slug: 'whole-day-routine-set', title: 'Whole Day Routine Set', summary: 'Morning chart, bedtime chart and chore chart together.', productSlugs: ['morning-routine-chart', 'bedtime-routine-chart', 'chore-reward-chart'], priceMinor: 1900 },
      pins: [
        { title: 'Morning routine chart for kids with picture steps', description: 'Eight picture steps from waking up to shoes on, with your child’s name. Edit in Canva and print.', board: 'Kids Routine Charts', productSlug: 'morning-routine-chart' },
        { title: 'Personalised bedtime routine chart (editable in Canva)', description: 'Bath, teeth, story and lights out in soft colours. Add your child’s name in minutes.', board: 'Bedtime Routine Ideas', productSlug: 'bedtime-routine-chart' },
        { title: 'Chore chart with a reward goal for ages 4–10', description: 'Weekly chores with sticker spaces and a goal to work towards. Includes chore ideas by age.', board: 'Chores For Kids', productSlug: 'chore-reward-chart' },
      ],
      pricingRationale: 'Editable templates stay under A$12; the done-for-you version costs more because each order takes a few minutes of checking.',
    },
    {
      id: 'party-invitations',
      label: 'Editable party invitations',
      audience: 'Parents planning kids’ birthday parties',
      names: ['Confetti Draft Co', 'Party Paper Studio', 'Little Invite Lab'],
      tagline: 'Editable invitations you can send tonight',
      heroHeading: 'Party invitations, edited and sent in ten minutes.',
      heroSubheading: 'Editable birthday invitation suites for Canva. Change the words, download, then print or text them to guests.',
      ctaLabel: 'Browse invitations',
      font: 'serif',
      tags: ['party', 'invitation'],
      products: [
        {
          slug: 'dinosaur-party-suite', title: 'Dinosaur Party Suite',
          summary: 'Invitation, thank-you card and food labels in one editable set.',
          detail: 'A friendly dinosaur theme across invitation, thank-you card and food labels. Edit names, dates and details in Canva.',
          format: 'Canva link', priceMinor: 1200, cover: { style: 'arch', label: 'Dino Party' },
          includes: ['Invitation, thank-you card and labels', 'Editable Canva templates', 'Print and phone versions'],
        },
        {
          slug: 'under-the-sea-suite', title: 'Under the Sea Suite',
          summary: 'Ocean-themed invitation, labels and a welcome sign.',
          detail: 'Soft blues and sea creatures across a full party suite. Every word is editable.',
          format: 'Canva link', priceMinor: 1200, cover: { style: 'dots', label: 'Under the Sea' },
          includes: ['Invitation, labels and welcome sign', 'Editable Canva templates', 'Print and phone versions'],
        },
        {
          slug: 'first-birthday-invitation', title: 'First Birthday Invitation',
          summary: 'A soft, minimal first-birthday invite with a photo frame.',
          detail: 'Drop in a photo, edit the details and send. Simple type keeps the focus on the birthday baby.',
          format: 'Canva link', priceMinor: 800, cover: { style: 'arch', label: 'First Birthday' },
          includes: ['Editable Canva template', 'Photo frame placeholder', 'Print and phone versions'],
        },
        {
          slug: 'party-signage-pack', title: 'Party Signage Pack',
          summary: 'Welcome sign, menu card and gift table sign to match any suite.',
          detail: 'Neutral signs that pair with every suite in the shop. Edit and print at A4 or A3.',
          format: 'Canva link', priceMinor: 900, cover: { style: 'lines', label: 'Party Signs' },
          includes: ['Welcome, menu and gift table signs', 'A4 and A3 sizes'],
        },
        {
          slug: 'phone-size-invite', title: 'Phone-Size Digital Invite',
          summary: 'A vertical invite sized to send by text or message.',
          detail: 'Made for screens: edit, download as an image and send straight from your phone.',
          format: 'Canva link', priceMinor: 600, cover: { style: 'grid', label: 'Text Invite' },
          includes: ['Editable Canva template', 'Phone-screen size'],
        },
      ],
      bundle: { slug: 'full-party-kit', title: 'Full Party Kit', summary: 'Dinosaur suite, matching signage and a phone-size invite.', productSlugs: ['dinosaur-party-suite', 'party-signage-pack', 'phone-size-invite'], priceMinor: 2000 },
      pins: [
        { title: 'Editable dinosaur birthday invitation (Canva template)', description: 'Invitation, thank-you card and food labels in one dinosaur set. Edit, print or text to guests.', board: 'Dinosaur Party Ideas', productSlug: 'dinosaur-party-suite' },
        { title: 'First birthday invitation with photo, edited in minutes', description: 'A soft, minimal invite with a photo frame. Send by text or print at home.', board: 'First Birthday Ideas', productSlug: 'first-birthday-invitation' },
        { title: 'Under the sea party printables: invites, labels and signs', description: 'An ocean-themed suite where every word is editable in Canva.', board: 'Under The Sea Party', productSlug: 'under-the-sea-suite' },
      ],
      pricingRationale: 'Single invites sit at A$6–8 and full suites at A$12, because a suite replaces three separate purchases.',
    },
    {
      id: 'baby-milestone-cards',
      label: 'Baby milestone cards',
      audience: 'New parents and baby-shower gift buyers',
      names: ['First Little Moments', 'Milestone & Moss', 'Tiny Days Studio'],
      tagline: 'Printable milestone cards for baby’s first year',
      heroHeading: 'Capture every small first.',
      heroSubheading: 'Printable monthly and milestone cards for photos, with an option to add baby’s name. Print at home on card stock.',
      ctaLabel: 'Browse cards',
      font: 'serif',
      tags: ['baby', 'milestone cards'],
      products: [
        {
          slug: 'monthly-milestone-cards', title: 'Monthly Milestone Cards',
          summary: 'Twelve monthly cards from one to twelve months, plus a newborn card.',
          detail: 'Thirteen cards in soft neutrals to hold up in monthly photos. Print on card stock at home.',
          format: 'PDF', pages: 13, priceMinor: 900, cover: { style: 'arch', label: 'Monthly Cards' },
          includes: ['13 printable cards', 'A5 and 5×7 in sizes', 'Card-stock printing tips'],
        },
        {
          slug: 'first-moments-cards', title: 'First Moments Cards',
          summary: '24 cards for first smile, first food, first steps and more.',
          detail: 'Two dozen milestone cards for the firsts parents want to remember, plus blanks to write your own.',
          format: 'PDF', pages: 24, priceMinor: 1100, cover: { style: 'dots', label: 'First Moments' },
          includes: ['24 milestone cards', '4 blank cards', 'A5 and 5×7 in sizes'],
        },
        {
          slug: 'birth-announcement-template', title: 'Birth Announcement Template',
          summary: 'An editable announcement with name, date, weight and photo.',
          detail: 'Add a photo and the details, then share by message or print a few for family.',
          format: 'Canva link', priceMinor: 900, cover: { style: 'arch', label: 'Birth Announcement' },
          includes: ['Editable Canva template', 'Phone and print sizes'],
        },
        {
          slug: 'personalised-milestone-set', title: 'Personalised Milestone Set',
          summary: 'Monthly cards with baby’s name on each, sent as a print-ready PDF.',
          detail: 'Tell us the name at checkout. We add it to all thirteen monthly cards, check the file and email the PDF.',
          format: 'PDF', pages: 13, priceMinor: 1800, cover: { style: 'arch', label: 'With Baby’s Name' },
          includes: ['Name on all 13 cards', 'Print-ready PDF within 2 business days', 'One round of changes'],
        },
        {
          slug: 'first-year-memory-pages', title: 'First Year Memory Pages',
          summary: 'Ten printable journal pages for notes, firsts and growth.',
          detail: 'Simple pages to record favourite moments, growth and firsts, ready to slip into a binder.',
          format: 'PDF', pages: 10, priceMinor: 800, cover: { style: 'lines', label: 'Memory Pages' },
          includes: ['10 printable pages', 'A4 and US Letter sizes'],
        },
      ],
      bundle: { slug: 'first-year-gift-set', title: 'First Year Gift Set', summary: 'Monthly cards, first moments cards and memory pages together.', productSlugs: ['monthly-milestone-cards', 'first-moments-cards', 'first-year-memory-pages'], priceMinor: 2100 },
      pins: [
        { title: 'Printable monthly milestone cards for baby photos', description: 'Thirteen soft neutral cards from newborn to twelve months. Print on card stock at home.', board: 'Baby Milestone Ideas', productSlug: 'monthly-milestone-cards' },
        { title: 'Baby shower gift idea: personalised milestone cards', description: 'Monthly cards with the baby’s name on each, delivered as a print-ready PDF.', board: 'Baby Shower Gifts', productSlug: 'personalised-milestone-set' },
        { title: 'First moments cards: first smile, first food, first steps', description: 'Twenty-four printable cards for the firsts worth remembering, plus blanks to write your own.', board: 'Baby Photo Ideas', productSlug: 'first-moments-cards' },
      ],
      pricingRationale: 'Printable sets sit at A$8–11; the personalised set is priced higher because each order is checked before it is sent.',
    },
  ],
};

const marketingAssets: Blueprint = {
  id: 'marketing-assets',
  version: 1,
  title: 'Marketing templates for small businesses',
  description: 'Ready-to-edit social, email and print templates that help small businesses look professional.',
  exampleProducts: ['Real-estate listing posts', 'Salon price lists', 'Coach launch kits'],
  startupCost: 'Usually under A$50 on top of your plan. Canva’s free tier is enough to start.',
  weeklyHours: 'About 4–8 hours a week once live; business buyers expect quicker answers to questions.',
  primaryChannel: 'Pinterest',
  faq: [{ question: 'Can I use these for my clients?', answer: 'Each purchase covers one business. Agencies and freelancers working for several clients need one licence per client.' }],
  niches: [
    {
      id: 'real-estate-social',
      label: 'Real-estate social templates',
      audience: 'Independent agents and small agencies',
      names: ['Open Home Studio', 'Listing Light Co', 'Keys & Captions'],
      tagline: 'Polished social posts for independent real-estate agents',
      heroHeading: 'Listing posts that look agency-made.',
      heroSubheading: 'Editable Canva templates for just-listed, open-home and sold posts, with caption starters to adapt. Brand colours change in one click.',
      ctaLabel: 'See the templates',
      font: 'sans',
      tags: ['real estate', 'social media'],
      products: [
        {
          slug: 'just-listed-pack', title: 'Just Listed Post Pack',
          summary: '20 editable square and story templates for new listings.',
          detail: 'Feature photos, price guide and inspection times in clean layouts. Change colours and fonts once and every template follows.',
          format: 'Canva link', priceMinor: 2900, cover: { style: 'grid', label: 'Just Listed' },
          includes: ['20 editable templates', 'Square and story sizes', 'Brand colour guide'],
        },
        {
          slug: 'open-home-pack', title: 'Open Home Pack',
          summary: 'Open-home announcements, reminders and thank-you posts.',
          detail: 'A complete open-home sequence: announcement, day-before reminder, on-the-day story and a thank-you post.',
          format: 'Canva link', priceMinor: 2400, cover: { style: 'grid', label: 'Open Home' },
          includes: ['16 editable templates', 'Square and story sizes'],
        },
        {
          slug: 'sold-celebration-pack', title: 'Sold Celebration Pack',
          summary: 'Sold, under-offer and client-thank-you posts.',
          detail: 'Celebrate results without over-claiming: simple sold and under-offer layouts with space for a client thank-you.',
          format: 'Canva link', priceMinor: 1900, cover: { style: 'arch', label: 'Sold' },
          includes: ['12 editable templates', 'Square and story sizes'],
        },
        {
          slug: 'listing-caption-starters', title: 'Listing Caption Starters',
          summary: '60 caption starters to adapt for listings, suburbs and open homes.',
          detail: 'Starting points you rewrite in your own voice, with notes on avoiding misleading property claims.',
          format: 'PDF', pages: 18, priceMinor: 1500, cover: { style: 'lines', label: 'Caption Starters' },
          includes: ['60 caption starters', 'Notes on avoiding misleading claims'],
        },
        {
          slug: 'agent-brand-kit', title: 'Agent Brand Kit',
          summary: 'Business card, email signature and social profile templates.',
          detail: 'A matching set of everyday brand pieces so every touchpoint looks consistent.',
          format: 'Canva link', priceMinor: 3400, cover: { style: 'dots', label: 'Agent Brand Kit' },
          includes: ['Business card and email signature', 'Profile and cover images', 'Brand colour guide'],
        },
      ],
      bundle: { slug: 'listing-marketing-bundle', title: 'Listing Marketing Bundle', summary: 'Just listed, open home and sold packs together.', productSlugs: ['just-listed-pack', 'open-home-pack', 'sold-celebration-pack'], priceMinor: 4900 },
      pins: [
        { title: 'Just listed Instagram templates for real-estate agents', description: 'Twenty editable square and story layouts. Change your brand colours once in Canva.', board: 'Real Estate Marketing', productSlug: 'just-listed-pack' },
        { title: 'Open home social post ideas (editable in Canva)', description: 'Announcement, reminder, on-the-day story and thank-you post in one pack.', board: 'Open Home Ideas', productSlug: 'open-home-pack' },
        { title: 'Real-estate caption starters for new listings', description: 'Sixty starting points to rewrite in your own voice, with notes on avoiding misleading claims.', board: 'Real Estate Social Media', productSlug: 'listing-caption-starters' },
      ],
      pricingRationale: 'Business buyers pay for time saved, so packs sit at A$15–34 and the bundle stays under A$50 to make it an easy expense to approve.',
    },
    {
      id: 'salon-promo-templates',
      label: 'Salon & beauty promo templates',
      audience: 'Hair, nail and beauty salon owners',
      names: ['Glow Post Studio', 'Salon Feed Co', 'Chair & Caption'],
      tagline: 'Promo templates that keep a salon’s feed consistent',
      heroHeading: 'A consistent salon feed without starting from scratch.',
      heroSubheading: 'Editable Canva posts and stories for promotions, price lists and booking reminders. Swap in your colours, photos and prices.',
      ctaLabel: 'See the templates',
      font: 'serif',
      tags: ['salon', 'social media'],
      products: [
        {
          slug: 'salon-price-list', title: 'Salon Price List Templates',
          summary: 'Six editable price-list layouts for print, story and screen.',
          detail: 'Clear price lists for the front desk, Instagram stories and your booking page, all from one design.',
          format: 'Canva link', priceMinor: 1900, cover: { style: 'lines', label: 'Price List' },
          includes: ['6 editable layouts', 'Print, story and screen sizes'],
        },
        {
          slug: 'monthly-promo-pack', title: 'Monthly Promo Post Pack',
          summary: '30 square posts for promotions, new services and quiet-day offers.',
          detail: 'A month of post layouts covering offers, new services, staff spotlights and reviews.',
          format: 'Canva link', priceMinor: 2900, cover: { style: 'grid', label: 'Promo Posts' },
          includes: ['30 editable posts', 'Caption prompts for each post'],
        },
        {
          slug: 'booking-reminder-stories', title: 'Booking Reminder Stories',
          summary: '15 story templates for reminders, availability and reviews.',
          detail: 'Story layouts that show open appointments, remind regulars to rebook and share client reviews.',
          format: 'Canva link', priceMinor: 1900, cover: { style: 'dots', label: 'Booking Stories' },
          includes: ['15 editable stories', 'Availability and review layouts'],
        },
        {
          slug: 'salon-gift-voucher', title: 'Gift Voucher Template',
          summary: 'Printable and digital gift vouchers with editable value and expiry.',
          detail: 'Print vouchers for the counter or send them as images. Includes fields for value, expiry and voucher number.',
          format: 'Canva link', priceMinor: 1500, cover: { style: 'arch', label: 'Gift Voucher' },
          includes: ['Print and digital versions', 'Voucher number and expiry fields'],
        },
      ],
      bundle: { slug: 'salon-social-kit', title: 'Salon Social Kit', summary: 'Promo posts, booking stories and price lists together.', productSlugs: ['monthly-promo-pack', 'booking-reminder-stories', 'salon-price-list'], priceMinor: 4500 },
      pins: [
        { title: 'Salon price list template you can edit in Canva', description: 'Six layouts for the front desk, Instagram stories and your booking page.', board: 'Salon Marketing Ideas', productSlug: 'salon-price-list' },
        { title: 'Instagram story templates for beauty salons', description: 'Show open appointments, remind regulars to rebook and share reviews.', board: 'Beauty Business Tips', productSlug: 'booking-reminder-stories' },
        { title: 'Printable salon gift voucher template', description: 'Print for the counter or send as an image, with value, expiry and voucher number fields.', board: 'Salon Gift Vouchers', productSlug: 'salon-gift-voucher' },
      ],
      pricingRationale: 'Single packs sit at A$15–29 so a salon can try one; the kit groups the three most-used packs for under A$50.',
    },
    {
      id: 'coach-launch-kits',
      label: 'Coach & consultant launch kits',
      audience: 'New coaches and consultants launching an offer',
      names: ['Clear Offer Studio', 'Launch Notes Co', 'First Client Kit'],
      tagline: 'Templates for coaches launching their first offer',
      heroHeading: 'Launch your offer with clear, honest materials.',
      heroSubheading: 'Sales page outline, discovery call script, onboarding pack and social templates. Edit, add your voice and launch on your own schedule.',
      ctaLabel: 'See the kits',
      font: 'serif',
      tags: ['coaching', 'launch'],
      products: [
        {
          slug: 'sales-page-outline', title: 'Sales Page Outline',
          summary: 'A section-by-section outline with prompts for your offer page.',
          detail: 'Twelve sections from headline to FAQ, each with prompts and plain examples. Write in your own voice; no hype formulas.',
          format: 'PDF', pages: 12, priceMinor: 1900, cover: { style: 'lines', label: 'Sales Page Outline' },
          includes: ['12-section outline', 'Prompts and examples', 'Editable Google Docs version'],
        },
        {
          slug: 'discovery-call-script', title: 'Discovery Call Script',
          summary: 'A 30-minute call structure with questions and next-step wording.',
          detail: 'A calm structure for first calls: understand the problem, check fit, and agree a clear next step.',
          format: 'PDF', pages: 6, priceMinor: 1500, cover: { style: 'lines', label: 'Discovery Call' },
          includes: ['30-minute call structure', 'Question bank', 'Follow-up email template'],
        },
        {
          slug: 'client-onboarding-pack', title: 'Client Onboarding Pack',
          summary: 'Welcome guide, intake form and session agreement templates.',
          detail: 'Everything a new client receives in their first week, ready to edit with your details.',
          format: 'ZIP', priceMinor: 3400, cover: { style: 'grid', label: 'Client Onboarding' },
          includes: ['Welcome guide and intake form', 'Session agreement template', 'Have agreements reviewed by a lawyer'],
        },
        {
          slug: 'launch-social-templates', title: 'Launch Social Templates',
          summary: '24 Canva posts to announce and explain your offer.',
          detail: 'Posts that explain who the offer is for, what is included and how to book, without countdown pressure.',
          format: 'Canva link', priceMinor: 2400, cover: { style: 'dots', label: 'Launch Posts' },
          includes: ['24 editable posts', 'Square and story sizes'],
        },
        {
          slug: 'welcome-email-sequence', title: 'Welcome Email Sequence',
          summary: 'Five welcome emails to adapt for new subscribers.',
          detail: 'A short sequence that introduces you, shares something useful and explains your offer plainly.',
          format: 'PDF', pages: 10, priceMinor: 1900, cover: { style: 'lines', label: 'Welcome Emails' },
          includes: ['5 email drafts', 'Subject line options', 'Editable Google Docs version'],
        },
      ],
      bundle: { slug: 'offer-launch-kit', title: 'Offer Launch Kit', summary: 'Sales page outline, discovery call script and launch posts together.', productSlugs: ['sales-page-outline', 'discovery-call-script', 'launch-social-templates'], priceMinor: 3900 },
      pins: [
        { title: 'Sales page outline for coaches: 12 sections with prompts', description: 'Write your offer page section by section in your own voice. No hype formulas.', board: 'Coaching Business Tips', productSlug: 'sales-page-outline' },
        { title: 'Discovery call script: a calm 30-minute structure', description: 'Understand the problem, check fit and agree a clear next step. Includes a follow-up email.', board: 'Discovery Call Ideas', productSlug: 'discovery-call-script' },
        { title: 'Client onboarding pack for new coaches', description: 'Welcome guide, intake form and session agreement templates to edit with your details.', board: 'Client Onboarding', productSlug: 'client-onboarding-pack' },
      ],
      pricingRationale: 'Coaches buy these to save hours of writing, so single kits sit at A$15–34 and the launch kit bundles the three they need first.',
    },
  ],
};

export const blueprints: readonly Blueprint[] = [digitalTemplates, printableArt, personalisedDigital, marketingAssets];

export function getBlueprint(model: BusinessModel): Blueprint {
  const found = blueprints.find((b) => b.id === model);
  if (!found) throw new Error(`Unknown business model: ${model}`);
  return found;
}

export function findNiche(model: BusinessModel, nicheId: string): NicheVariant | undefined {
  return blueprints.find((b) => b.id === model)?.niches.find((n) => n.id === nicheId);
}
