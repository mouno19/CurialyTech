// Portfolio Allocation Chart · graph-024-alt
// From the Essential Data Visualization (Curialy component library). Sample data is fictional; pass your own.
import React, { useMemo, useState } from 'react';
// Fictional sample data; not live market data. Replace config with your own data.
export const sampleConfig = {
  "id": "GRAPH-024",
  "name": "Portfolio Allocation Chart",
  "kind": "donut",
  "style": "Minimalist portfolio management",
  "use": "Review the asset-class weights in a fictional model portfolio.",
  "title": "Portfolio composition",
  "metric": "$1.25m",
  "labels": [
    "Equities",
    "Bonds",
    "Crypto",
    "Cash",
    "Alternatives"
  ],
  "data": [
    45,
    25,
    15,
    10,
    5
  ],
  "min": 0,
  "max": 100,
  "unit": "%",
  "colors": [
    "#a894ff",
    "#4bd2c3",
    "#f4bd68",
    "#6a9bf0",
    "#ed8fac"
  ],
  "period": "Fictional sample · 2025"
};
const renderFinance = function renderFinance(s){const W=520,H=240,L=49,R=34,T=17,B=35,pw=W-L-R,ph=H-T-B,x=i=>L+(i+.5)*pw/s.labels.length,y=v=>T+(s.max-v)/(s.max-s.min)*ph,c=s.colors,p=[],e=v=>String(v).replace(/[&<>"']/g,a=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[a])),text=(a,b,v,col='#afbed0',size=10,anchor='middle')=>`<text x="${a}" y="${b}" fill="${col}" font-size="${size}" text-anchor="${anchor}">${e(v)}</text>`,mark=(shape,info)=>`<g class="mark" tabindex="0" role="button" data-info="${e(info)}" aria-label="${e(info)}"><title>${e(info)}</title>${shape}</g>`;
 if(s.kind==='donut'){let a=-Math.PI/2; s.data.forEach((v,i)=>{let b=a+v*Math.PI/50,P=t=>[220+69*Math.cos(t),113+69*Math.sin(t)],u=P(a),w=P(b);p.push(mark(`<path d="M${u[0]} ${u[1]} A69 69 0 0 1 ${w[0]} ${w[1]}" fill="none" stroke="${c[i]}" stroke-width="26"/>`,`${s.labels[i]}: ${v}% · $${(v*12500).toLocaleString()}`));a=b;p.push(`<rect x="345" y="${33+i*35}" width="9" height="9" rx="2" fill="${c[i]}"/>${text(361,42+i*35,s.labels[i]+'  '+v+'%','#eaf3ff',10,'start')}`)});p.push(text(220,111,'$1.25m','#fff',21),text(220,130,'MODEL VALUE','#a9b9ca',9))}
 else {for(let i=0;i<=4;i++){let v=s.min+(s.max-s.min)*i/4,yy=y(v);p.push(`<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" stroke="#ffffff22" stroke-dasharray="3 5"/>${text(L-8,yy+3,s.unit==='pt'?Math.round(v):s.unit==='%'?Math.round(v)+'%':'$'+Number(v.toFixed(1))+(s.unit==='$'?'':s.unit.slice(1)),'#9eafc4',9,'end')}`)}s.labels.forEach((l,i)=>p.push(text(x(i),H-10,l,'#aebdd0',9)));
 if(s.kind==='candle'||s.kind==='ohlc')s.data.forEach((d,i)=>{let [o,h,l,z]=d,xx=x(i),col=z>=o?c[0]:c[1],w=17; if(s.volume)p.push(`<rect x="${xx-8}" y="${H-B-s.volume[i]*.7}" width="16" height="${s.volume[i]*.7}" fill="${col}" opacity=".28"/>`);p.push(mark(`<line x1="${xx}" y1="${y(h)}" x2="${xx}" y2="${y(l)}" stroke="${col}" stroke-width="2"/>`+(s.kind==='candle'?`<rect x="${xx-w/2}" y="${y(Math.max(o,z))}" width="${w}" height="${Math.max(2,Math.abs(y(o)-y(z)))}" fill="${col}"/>`:`<path d="M${xx-9} ${y(o)}h9 M${xx} ${y(z)}h9" stroke="${col}" stroke-width="2"/>`),`${s.labels[i]} Jun · Open $${o} · High $${h} · Low $${l} · Close $${z}${s.volume?' · Volume '+s.volume[i]+'k':''}`))});
 if(['line','area','volume'].includes(s.kind)){if(s.kind==='volume')s.volume.forEach((v,i)=>p.push(mark(`<rect x="${x(i)-12}" y="${H-B-v*.43}" width="24" height="${v*.43}" fill="${c[1]}" opacity=".5"/>`,`${s.labels[i]} Jun · Volume ${v}m units · Close $${s.data[i]}`)));let series=s.kind==='line'?s.data:[s.data];series.forEach((d,j)=>{let pts=d.map((v,i)=>`${x(i)},${y(v)}`).join(' ');if(s.kind==='area')p.push(`<polygon points="${x(0)},${y(0)} ${pts} ${x(s.labels.length-1)},${y(0)}" fill="${c[0]}" opacity=".17"/>`);p.push(`<polyline points="${pts}" fill="none" stroke="${c[j]}" stroke-width="3"/>`);d.forEach((v,i)=>p.push(mark(`<circle cx="${x(i)}" cy="${y(v)}" r="5" fill="${c[j]}" stroke="#111d30" stroke-width="2"/>`,`${s.labels[i]} · ${s.series?.[j]||s.title}: ${s.unit==='pt'?v+' index points':'$'+v+(s.unit==='$'?'':s.unit.slice(1))}`)))})}
 if(s.kind==='diverge')s.data.forEach((v,i)=>p.push(mark(`<rect x="${x(i)-16}" y="${y(Math.max(v,0))}" width="32" height="${Math.max(2,Math.abs(y(v)-y(0)))}" rx="3" fill="${v>=0?c[0]:c[1]}"/>`,`${s.labels[i]} · ${v>=0?'+':''}$${v}k ${v>=0?'profit':'loss'}`)));
 if(s.kind==='grouped'||s.kind==='cash')s.labels.forEach((l,i)=>s.data.forEach((d,j)=>{let v=d[i],w=22,xx=x(i)+(j?2:-w-2);p.push(mark(`<rect x="${xx}" y="${y(v)}" width="${w}" height="${y(0)-y(v)}" rx="2" fill="${c[j]}"/>`,`${l} · ${s.series[j]} $${v}k${s.kind==='cash'?' · Net +$'+(s.data[0][i]-s.data[1][i])+'k':''}`))}));
 if(s.kind==='bullet')s.data.forEach((v,i)=>{let yy=30+i*43;p.push(text(L,yy-5,s.labels[i],'#e1ebf5',10,'start'),`<rect x="${L}" y="${yy}" width="${pw}" height="11" rx="4" fill="#ffffff1a"/>`,mark(`<rect x="${L}" y="${yy}" width="${v/s.max*pw}" height="11" rx="4" fill="${v>=100?c[0]:c[1]}"/>`,`${s.labels[i]}: ${v}% of 100% target`),`<line x1="${L+100/s.max*pw}" x2="${L+100/s.max*pw}" y1="${yy-4}" y2="${yy+15}" stroke="white" stroke-width="2"/>`,text(W-R,yy-5,v+'%',v>=100?c[0]:c[1],10,'end'))})
 }return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${e(s.name)}. Fictional sample data, not live market data.">${p.join('')}</svg>`};
export default function PortfolioAllocationChart({config=sampleConfig,height=280,onSelect,ariaLabel=config.name}) {
 const [selected,setSelected]=useState('');
 const html=useMemo(()=>renderFinance(config),[config]);
 function select(e){const m=e.target.closest('[data-info]');if(!m)return;setSelected(m.dataset.info);onSelect?.(m.dataset.info)}
 function key(e){if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-info]')){e.preventDefault();select(e)}}
 return <div role="group" aria-label={ariaLabel} onClick={select} onKeyDown={key} style={{height,width:'100%',position:'relative'}}><div style={{width:'100%',height:'100%'}} dangerouslySetInnerHTML={{__html:html}}/>{selected&&<div role="status" style={{position:'absolute',top:4,right:4,background:'#101a2b',color:'white',padding:9,borderRadius:8,fontSize:11}}>{selected}</div>}</div>;
}