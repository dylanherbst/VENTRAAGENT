'use client';
import Link from 'next/link';
import {GlassButton,OutlineIcon} from '../design-system/primitives';
import {serviceCategories,type ServiceCategory} from '../../lib/ventra-navigation';
export function CategoryChips({value,onChange}:{value:ServiceCategory;onChange:(value:ServiceCategory)=>void}){return <div className="v-category-strip"><div className="v-chips" role="group" aria-label="Service categories">{serviceCategories.map((title,i)=><GlassButton key={title} aria-pressed={value===title} onClick={()=>onChange(title)}><OutlineIcon name={['grid','chart','bolt','sales','people','edit'][i]}/>{title}</GlassButton>)}</div><span className="v-scroll-hint">Swipe or scroll for more categories</span></div>;}
export function ServiceTile({service}:{service:{title:string;description:string;href:string;icon:string;status:string}}){return <Link className="v-service v-glass" href={service.href}><span className="v-icon-tile"><OutlineIcon name={service.icon}/></span><span className="v-service-copy"><strong>{service.title}</strong><span>{service.description}</span><small>{service.status}</small></span><span className="v-arrow"><OutlineIcon name="arrow"/></span></Link>;}
