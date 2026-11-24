// Visual labels follow the October master guide; established authoring URLs stay intact.
export const pages = [
 {title:'Home',href:'/app',icon:'home',description:'What happened and what to do next'},
 {title:'Create',href:'/create',icon:'create',description:'Courses, a new business, services and offers, website and store'},
 {title:'Customers',href:'/customers',icon:'leads',description:'Leads, contacts, deals, conversations, AI Setter, AI Receptionist and bookings'},
 {title:'Grow',href:'/grow',icon:'grow',description:'Growth Audit, marketing, content, finding customers, automations'},
 {title:'Money',href:'/money',icon:'money',description:'Orders, quotes, invoices, prices and verified revenue'},
] as const;
// Still reachable and searchable, but not in the main navigation.
const extraPages=[{title:'More',href:'/more',icon:'more',description:'Insights, integrations, team, notifications, account, billing, help'},{title:'Services',href:'/services',icon:'grid',description:'Find tools, services and guidance'},{title:'Automation',href:'/grow?tab=automations',icon:'bolt',description:'Workflow drafts; nothing runs automatically'},{title:'Sales',href:'/sales',icon:'sales',description:'Appointments, orders and invoice drafts'},{title:'Products',href:'/business',icon:'box',description:'Offers, website, courses and delivery'},{title:'Analytics',href:'/insights',icon:'trend',description:'Insights and manual Growth Audit'},{title:'Inbox',href:'/inbox',icon:'phone',description:'Messages, calls and receptionist availability'}, {title:'Settings',href:'/settings',icon:'settings',description:'Profile, integrations, billing, team and help'}];
/** Which main destination a route belongs to (for the active state in the sidebar and bottom bar). */
export function activeSection(pathname:string):string{
 if(pathname==='/'||pathname==='/app')return '/app';
 const is=(...roots:string[])=>roots.some(r=>pathname===r||pathname.startsWith(r+'/'));
 if(is('/create','/business','/onboarding'))return '/create';
 if(is('/grow'))return '/grow';
 if(is('/customers','/inbox'))return '/customers';
 if(is('/money','/sales'))return '/money';
 if(is('/services/growth-audit','/insights'))return '/grow';
 if(is('/more','/settings','/services','/workspace'))return '/more';
 return '';
}
export function searchPages(query:string) { const terms=query.trim().toLowerCase().split(/\s+/).filter(Boolean); return [...pages,...extraPages].filter(p=>terms.every(t=>(p.title+' '+p.description).toLowerCase().includes(t))); }
export function activePage(pathname:string,tab:string|null,href:string){if(href==='/grow?tab=automations')return pathname==='/grow'&&tab==='automations';if(href==='/grow')return pathname==='/grow'&&tab!=='automations';if(href==='/services')return pathname==='/services'||pathname.startsWith('/services/');return pathname===href;}
export const createOptions = [
 {title:'Service',href:'/business?tab=offers&create=service',detail:'Local service and pricing draft.'},
 {title:'Product',href:'/business?tab=offers&create=product',detail:'Local product and delivery draft.'},
 {title:'Course',href:'/business?tab=delivery&create=course',detail:'Local course outline and lesson editor.'},
 {title:'Website / Page',href:'/business?tab=website',detail:'Local page editor and preview.'},
 {title:'Marketing content',href:'/grow?tab=content',detail:'Manually authored local content concept. Not published.'},
 {title:'Automation',href:'/grow?tab=automations',detail:'Unavailable: workflow execution is not connected.'},
] as const;
export const serviceCategories=['All Services','Marketing','Automation','Sales','Clients','Content'] as const;
export type ServiceCategory=typeof serviceCategories[number];
export const services=[
 {title:'Growth Audit',description:'Find your next opportunities with a manual review.',href:'/services/growth-audit',icon:'chart',category:'Marketing',status:'Manual · browser-local'},
 {title:'Automation Setup',description:'Review workflow availability and requirements.',href:'/grow?tab=automations',icon:'bolt',category:'Automation',status:'Execution unavailable'},
 {title:'Customer Acquisition',description:'Record public research and plan a local follow-up.',href:'/grow?tab=leads',icon:'people',category:'Clients',status:'Manual · no outreach'},
 {title:'Personalised Plan',description:'Write a practical, evidence-led 30-day plan.',href:'/insights?tab=audit',icon:'edit',category:'Marketing',status:'Manual · browser-local'},
 {title:'Content concepts',description:'Draft and preview your own channel copy.',href:'/grow?tab=content',icon:'edit',category:'Content',status:'No generation or publishing'},
 {title:'Bookings',description:'Review calendar connection requirements.',href:'/sales?tab=appointments',icon:'calendar',category:'Sales',status:'Not connected'},
 {title:'Website builder',description:'Create and preview a local website draft.',href:'/business?tab=website',icon:'grid',category:'Content',status:'Local draft · not hosted'},
 {title:'Products & courses',description:'Shape an offer or course with your own content.',href:'/business',icon:'box',category:'Sales',status:'Local drafts'},
 {title:'Receptionist availability',description:'View current messaging and call availability.',href:'/inbox',icon:'phone',category:'Clients',status:'Unavailable · no test calls'},
] as const;
export function filterServices(category:ServiceCategory,query=''){const terms=query.trim().toLowerCase().split(/\s+/).filter(Boolean);return services.filter(s=>(category==='All Services'||s.category===category)&&terms.every(t=>(s.title+' '+s.description).toLowerCase().includes(t)));}
/** Account menu entries (presentation only; same destinations the old shell menu used). */
export const accountLinks = [
 {title:'Business profile',href:'/settings?section=profile',note:'Name, services, hours and policies'},
 {title:'AI team settings',href:'/customers/ai-team',note:'Setter and Receptionist rules'},
 {title:'Connections',href:'/settings?section=integrations',note:'Calendar, phone, Instagram, payments'},
 {title:'Insights',href:'/insights',note:'Reports from your saved data'},
 {title:'Team',href:'/settings?section=team',note:'Who can see this workspace'},
 {title:'Billing',href:'/settings?section=billing',note:'Your VENTRA plan'},
 {title:'Help',href:'/settings?section=help',note:'Guides and support'},
 {title:'Account and sign in',href:'/workspace',note:'Workspaces, sign in, export'},
 {title:'Everything else',href:'/more',note:'All tools and settings'},
] as const;
