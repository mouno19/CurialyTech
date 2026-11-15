// Activation Correlation · graph-011
// From the Essential Data Visualization (Curialy component library). Sample data is fictional; pass your own.
import React, { useMemo, useState } from 'react';

// Pass data to replace the sample observations. Bounds are [xMin, xMax, yMin, yMax].
export const sampleConfig = {
  "id": "GRAPH-011",
  "name": "Activation Correlation",
  "type": "Scatter Plot",
  "style": "Scientific research interface",
  "use": "Examine how onboarding completion relates to day-30 retention across signup cohorts.",
  "title": "The activation effect",
  "sub": "Onboarding completion vs. D30 retention · cohorts",
  "metric": "Positive",
  "metricSub": "activation ↗ retention",
  "note": "24 COHORTS  ·  POINTS ARE WEEKLY SIGNUPS",
  "unit": "%",
  "xLabel": "Activation %",
  "yLabel": "Retention %",
  "kind": "scatter",
  "color": "#148b85",
  "accent": "#f1ab50",
  "data": [
    [
      41,
      28
    ],
    [
      44,
      31
    ],
    [
      47,
      29
    ],
    [
      49,
      34
    ],
    [
      51,
      36
    ],
    [
      53,
      35
    ],
    [
      55,
      39
    ],
    [
      57,
      42
    ],
    [
      58,
      40
    ],
    [
      60,
      44
    ],
    [
      61,
      42
    ],
    [
      62,
      47
    ],
    [
      64,
      49
    ],
    [
      65,
      46
    ],
    [
      67,
      51
    ],
    [
      69,
      54
    ],
    [
      70,
      52
    ],
    [
      72,
      56
    ],
    [
      73,
      58
    ],
    [
      75,
      57
    ],
    [
      77,
      61
    ],
    [
      79,
      64
    ],
    [
      81,
      63
    ],
    [
      83,
      68
    ]
  ],
  "bounds": [
    35,
    90,
    20,
    75
  ],
  "tokens": {
    "colors": "#148B85 / #F1AB50 / #F2F7F6",
    "spacing": "24px",
    "typography": "IBM Plex Mono + Inter",
    "radius": "20px"
  }
};

const renderAdvanced = function renderAdvanced(s){
 const W=520,H=240,L=47,R=31,T=14,B=39, pw=W-L-R,ph=H-T-B, [xmin,xmax,ymin,ymax]=s.bounds;
 const X=v=>L+(v-xmin)/(xmax-xmin)*pw,Y=v=>T+ph-(v-ymin)/(ymax-ymin)*ph;
 const dark=['bubble','violin','waterfall'].includes(s.kind),grid=dark?'#ffffff25':'#263c4a20',text=dark?'#b8c8d4':'#667582';
 const e=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let parts=[],mark=(shape,label)=>`<g class="mark" tabindex="0" role="button" aria-label="${e(label)}" data-info="${e(label)}"><title>${e(label)}</title>${shape}</g>`;
 for(let i=0;i<=4;i++){let v=ymin+(ymax-ymin)*i/4,yy=Y(v);parts.push(`<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" stroke="${grid}" stroke-dasharray="3 5"/><text x="${L-9}" y="${yy+3}" text-anchor="end" fill="${text}" font-size="10">${s.kind==='density'?(v*100).toFixed(0)+'%':Math.round(v)}</text>`)}
 const txt=(x,y,t,fill=text,size=10,anchor='middle')=>`<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" text-anchor="${anchor}">${e(t)}</text>`;
 if(s.kind==='scatter'||s.kind==='bubble'){
  for(let i=0;i<=4;i++){let v=xmin+(xmax-xmin)*i/4;parts.push(txt(X(v),H-16,Math.round(v)+'%'))}
  if(s.kind==='scatter'){parts.push(`<line x1="${X(41)}" y1="${Y(27)}" x2="${X(83)}" y2="${Y(66)}" stroke="${s.accent}" stroke-width="2" stroke-dasharray="5 5"/>`);s.data.forEach((d,i)=>parts.push(mark(`<circle cx="${X(d[0])}" cy="${Y(d[1])}" r="${i===23?6:4}" fill="${i===23?s.accent:s.color}" opacity=".85"/>`,`Cohort ${i+1}: activation ${d[0]}%, D30 retention ${d[1]}%`)))}
  else{s.data.forEach((d,i)=>{let r=Math.sqrt(d.size/8400)*23;parts.push(mark(`<circle cx="${X(d.x)}" cy="${Y(d.y)}" r="${r}" fill="${i%2?s.accent:s.color}" fill-opacity=".55" stroke="${i%2?s.accent:s.color}" stroke-width="2"/>${txt(X(d.x),Y(d.y)+3,d.label,'#fff',9)}`,`${d.label}: ${d.size.toLocaleString()} users, ${d.x}% activation, ${d.y}% D30 retention`))})}
 }else if(s.kind==='histogram'){s.data.forEach((v,i)=>{let x=X(i*2),w=pw/10-2;parts.push(mark(`<rect x="${x+1}" y="${Y(v)}" width="${w}" height="${Y(0)-Y(v)}" fill="${i===2?s.accent:s.color}" opacity=".9"/>`,`${i*2}–${i*2+2} hours: ${v} users`));if(i%2===0)parts.push(txt(x+w/2,H-16,String(i*2)))})}
 else if(s.kind==='box'){s.data.forEach((d,i)=>{let x=L+(i+.5)*pw/4,w=40;parts.push(mark(`<line x1="${x}" y1="${Y(d.max)}" x2="${x}" y2="${Y(d.min)}" stroke="${s.color}" stroke-width="2"/><line x1="${x-13}" x2="${x+13}" y1="${Y(d.max)}" y2="${Y(d.max)}" stroke="${s.color}" stroke-width="2"/><line x1="${x-13}" x2="${x+13}" y1="${Y(d.min)}" y2="${Y(d.min)}" stroke="${s.color}" stroke-width="2"/><rect x="${x-w/2}" y="${Y(d.q3)}" width="${w}" height="${Y(d.q1)-Y(d.q3)}" fill="${s.color}" fill-opacity=".5" stroke="${s.color}" stroke-width="2"/><line x1="${x-w/2}" x2="${x+w/2}" y1="${Y(d.median)}" y2="${Y(d.median)}" stroke="${s.accent}" stroke-width="3"/>${d.out.map(v=>`<circle cx="${x}" cy="${Y(v)}" r="3" fill="${s.accent}"/>`).join('')}`,`${d.label}: median ${d.median}%, Q1 ${d.q1}%, Q3 ${d.q3}%, whiskers ${d.min}–${d.max}%, outliers ${d.out.join(', ')}%`));parts.push(txt(x,H-16,d.label))})}
 else if(s.kind==='violin'){s.data.forEach((d,i)=>{let x=L+(i+.5)*pw/4,pts=d.weights.map((v,j)=>[x-v*30,Y(j+1)]),right=d.weights.map((v,j)=>[x+v*30,Y(j+1)]).reverse(),path=[...pts,...right].map((p,j)=>`${j?'L':'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')+'Z';parts.push(mark(`<path d="${path}" fill="${i%2?s.accent:s.color}" fill-opacity=".65" stroke="${i%2?s.accent:s.color}" stroke-width="1.5"/><circle cx="${x}" cy="${Y(d.median)}" r="4" fill="#fff"/>`,`${d.label}: median ${d.median} sessions per user; mirrored estimated density`));parts.push(txt(x,H-16,d.label))})}
 else if(s.kind==='density'){s.data.forEach(d=>{let pts=d.values.map((v,i)=>[X(4+i*1.6),Y(v)]),path=`M${pts[0][0]},${Y(0)} `+pts.map(p=>`L${p[0]},${p[1]}`).join(' ')+` L${pts.at(-1)[0]},${Y(0)} Z`;parts.push(mark(`<path d="${path}" fill="${d.color}" fill-opacity=".22" stroke="${d.color}" stroke-width="2.5"/>`,`${d.label}: normalized conversion-rate density`))});for(let v=4;v<=20;v+=4)parts.push(txt(X(v),H-16,v+'%'));parts.push(txt(W-R-8,T+12,'● Q1   ● Q2',s.color,10,'end'))}
 else if(s.kind==='error'){s.data.forEach((d,i)=>{let x=L+(i+.5)*pw/5;parts.push(mark(`<line x1="${x}" y1="${Y(d.lo)}" x2="${x}" y2="${Y(d.hi)}" stroke="${s.color}" stroke-width="3"/><path d="M${x-9} ${Y(d.lo)}h18 M${x-9} ${Y(d.hi)}h18" stroke="${s.color}" stroke-width="2"/><circle cx="${x}" cy="${Y(d.value)}" r="6" fill="${s.accent}" stroke="white" stroke-width="2"/>`,`${d.label}: ${d.value}% activation, 95% CI ${d.lo}–${d.hi}%, n=${d.n}`));parts.push(txt(x,H-16,d.label))})}
 else if(s.kind==='waterfall'){let base=0;s.data.forEach((d,i)=>{let x=L+(i+.5)*pw/5,w=52,start=i===0||i===4?0:base,end=i===0||i===4?d.delta:base+d.delta;if(i<4)base=end;let top=Math.max(start,end),bottom=Math.min(start,end),col=d.delta<0?s.accent:s.color;parts.push(mark(`<rect x="${x-w/2}" y="${Y(top)}" width="${w}" height="${Math.max(2,Y(bottom)-Y(top))}" fill="${col}" opacity=".86" rx="2"/>`,`${d.label}: ${i===0||i===4?'$'+d.delta+'k':(d.delta>0?'+':'')+'$'+d.delta+'k'}; ending $${end}k`));parts.push(txt(x,H-16,d.label));parts.push(txt(x,Y(top)-5,(d.delta>0?'+':'')+d.delta, col,10))})}
 else if(s.kind==='funnel'){s.data.forEach((d,i)=>{let cy=T+20+i*38,w=d.value/10000*pw*.82,x=W/2-w/2,col=i===4?s.color:s.accent;parts.push(mark(`<rect x="${x}" y="${cy-14}" width="${w}" height="29" rx="4" fill="${col}" fill-opacity="${.38+i*.13}"/><text x="${W/2}" y="${cy+4}" text-anchor="middle" fill="${i===4?'white':'#4f2836'}" font-size="11" font-weight="600">${e(d.label)} · ${d.value.toLocaleString()}</text>`,`${d.label}: ${d.value.toLocaleString()} users; ${i?Math.round(d.value/s.data[i-1].value*100)+'% from previous stage':'100% entry cohort'}`))})}
 else if(s.kind==='pareto'){let total=s.data.reduce((a,d)=>a+d.value,0),sum=0,points=[];s.data.forEach((d,i)=>{let x=L+(i+.5)*pw/6,w=pw/6-12;sum+=d.value;let pct=Math.round(sum/total*100);parts.push(mark(`<rect x="${x-w/2}" y="${Y(d.value)}" width="${w}" height="${Y(0)-Y(d.value)}" fill="${s.color}" rx="2"/>`,`${d.label}: ${d.value} cancellations; cumulative ${pct}%`));points.push([x,Y(pct/100*350)]);parts.push(txt(x,H-16,d.label,text,8))});parts.push(`<path d="${points.map((p,i)=>`${i?'L':'M'}${p[0]} ${p[1]}`).join(' ')}" fill="none" stroke="${s.accent}" stroke-width="3"/>`);points.forEach((p,i)=>parts.push(`<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${s.accent}"/>`));parts.push(txt(W-R,T+8,'100%',s.accent,9,'end'))}
 return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${e(s.name)}: ${e(s.use)}"><line x1="${L}" y1="${Y(ymin)}" x2="${W-R}" y2="${Y(ymin)}" stroke="${grid}"/>${parts.join('')}</svg>`;
};

export default function ActivationCorrelation({
  data = sampleConfig.data,
  bounds = sampleConfig.bounds,
  height = 280,
  onSelect,
  ariaLabel = sampleConfig.name + ': ' + sampleConfig.use
}) {
  const [selected, setSelected] = useState('');
  const config = useMemo(() => ({ ...sampleConfig, data, bounds }), [data, bounds]);
  const markup = useMemo(() => renderAdvanced(config), [config]);
  function handleSelect(event) {
    const mark = event.target.closest('[data-info]');
    if (!mark) return;
    const info = mark.dataset.info;
    setSelected(info);
    onSelect?.(info);
  }
  function handleKeyDown(event) {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-info]')) {
      event.preventDefault(); handleSelect(event);
    }
  }
  return <div style={{ height, width: '100%', position: 'relative' }}
    role="group" aria-label={ariaLabel} onClick={handleSelect} onKeyDown={handleKeyDown}>
    <div style={{ width: '100%', height: '100%' }} dangerouslySetInnerHTML={{ __html: markup }} />
    {selected && <div role="status" style={{ position: 'absolute', top: 0, right: 0,
      background: '#172033', color: '#fff', padding: 8, borderRadius: 6,
      fontSize: 12, maxWidth: 220 }}>{selected}</div>}
  </div>;
}