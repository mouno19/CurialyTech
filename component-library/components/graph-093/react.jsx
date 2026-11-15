// Dumbbell Chart · graph-093
// From the Visualization Atlas (Curialy component library). Sample data is fictional; pass your own.
import React from "react";

// The page's own renderer and the helpers it uses (it returns the chart's markup).
const C={mint:'#9df0cb',blue:'#79b8f6',violet:'#b8a4f4',coral:'#f49d91',amber:'#e8c47d',muted:'#81939f',line:'#2b3945'};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const line=(x1,y1,x2,y2,color=C.line,width=1,dash='')=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" ${dash?`stroke-dasharray="${dash}"`:''}/>`;
const text=(x,y,s,fill=C.muted,size=11,anchor='start',weight=400)=>`<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" text-anchor="${anchor}" font-weight="${weight}">${esc(s)}</text>`;
const circle=(x,y,r,fill)=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;
const rect=(x,y,w,h,fill,rx=0)=>`<rect x="${x}" y="${y}" width="${Math.max(0,w)}" height="${Math.max(0,h)}" rx="${rx}" fill="${fill}"/>`;
const path=(pts)=>pts.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
function grid(max=100,labels=[0,25,50,75,100]){return labels.map(v=>line(155,45+(max-v)/max*245,770,45+(max-v)/max*245,C.line,1,'3 5')+text(143,49+(max-v)/max*245,v,C.muted,10,'end')).join('')}
function renderChart(c){
 let s='',d=c.data;
 if(c.kind==='bullet'){s+=grid();d.forEach((a,i)=>{let y=75+i*57,x=155,w=615;s+=text(18,y+5,a.name,'#c4d1d5',12)+rect(x,y-13,w*.55,27,'#26333d',2)+rect(x+w*.55,y-13,w*.20,27,'#34444d')+rect(x+w*.75,y-13,w*.25,27,'#41544f')+rect(x,y-5,w*a.actual/100,11,C.mint,2)+line(x+w*a.target/100,y-19,x+w*a.target/100,y+19,C.coral,3)+text(785,y+4,a.actual+'M',C.mint,12)});s+=text(155,318,'0',C.muted,10)+text(770,318,'100M',C.muted,10,'end')}
 if(c.kind==='lollipop'){s+=grid();d.forEach((a,i)=>{let y=69+i*48,x=155+a.value/100*615;s+=text(18,y+4,a.name,'#c4d1d5',12)+line(155,y,x,y,C.blue,2)+circle(x,y,8,C.blue)+circle(x,y,3,'#101720')+text(x+17,y+4,a.value,C.blue,12)});s+=text(155,318,'0',C.muted,10)+text(770,318,'100',C.muted,10,'end')}
 if(c.kind==='dumbbell'){s+=grid();d.forEach((a,i)=>{let y=73+i*59,x=155+a.before*6.15,z=155+a.after*6.15;s+=text(18,y+4,a.name,'#c4d1d5',12)+line(x,y,z,y,'#596c75',5)+circle(x,y,8,C.violet)+circle(z,y,8,C.mint)+text(x,y-15,a.before+'%',C.violet,11,'middle')+text(z,y-15,a.after+'%',C.mint,11,'middle')});s+=text(155,318,'0%',C.muted,10)+text(770,318,'100%',C.muted,10,'end')}
 if(c.kind==='marimekko'){let x=135,colors=[C.mint,C.blue,C.violet,C.coral];d.forEach(a=>{let w=620*a.revenue/100,y=50;a.shares.forEach((v,j)=>{let h=235*v/100;s+=rect(x,y,w-3,h-3,colors[j],2)+ (h>28&&w>80?text(x+w/2,y+h/2+4,v+'%','#10202a',12,'middle',600):'');y+=h});s+=text(x+w/2,309,a.name,'#c4d1d5',11,'middle')+text(x+w/2,330,'$'+a.revenue+'B',C.muted,10,'middle');x+=w});s+=text(135,38,'100% SHARE',C.muted,10)}
 if(c.kind==='bump'){let colors=[C.mint,C.blue,C.violet,C.coral],xs=[155,295,435,575,715];[1,2,3,4].forEach(r=>{let y=50+(r-1)*75;s+=line(155,y,715,y,C.line,1,'3 5')+text(130,y+4,'#'+r,C.muted,11,'end')});d.forEach((a,j)=>{let pts=a.ranks.map((r,i)=>[xs[i],50+(r-1)*75]);s+=`<path d="${path(pts)}" fill="none" stroke="${colors[j]}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;pts.forEach(p=>s+=circle(p[0],p[1],5,colors[j]));s+=text(735,pts[4][1]+4,a.name,colors[j],11)});xs.forEach((x,i)=>s+=text(x,315,c.config.periods[i],C.muted,10,'middle'))}
 if(c.kind==='stream'){let xs=d.map((_,i)=>145+i*88),scale=2.55,colors=[C.mint,C.blue,C.violet,C.coral];for(let k=0;k<4;k++){let upper=[],lower=[];d.forEach((a,i)=>{let total=a.values.reduce((p,v)=>p+v,0),bottom=175+total*scale/2-a.values.slice(0,k).reduce((p,v)=>p+v,0)*scale;upper.push([xs[i],bottom-a.values[k]*scale]);lower.push([xs[i],bottom])});s+=`<path d="${path(upper)} ${path(lower.reverse()).replace('M','L')} Z" fill="${colors[k]}" fill-opacity=".85" stroke="#101720" stroke-width="2"/>`}d.forEach((a,i)=>s+=text(xs[i],320,a.month,C.muted,10,'middle'));s+=text(145,37,'CHANNEL VOLUME',C.muted,10)}
 if(c.kind==='ridgeline'){let colors=[C.mint,C.blue,C.violet,C.coral];d.forEach((a,j)=>{let base=113+j*64,pts=[];for(let i=0;i<=72;i++){let v=i/8,den=Math.exp(-.5*((v-a.mean)/a.spread)**2),tail=.24*Math.exp(-.5*((v-(a.mean+1.1))/ (a.spread*1.7))**2);pts.push([155+i*8.2,base-(den+tail)*48])}s+=`<path d="${path([[155,base],...pts,[745,base]])} Z" fill="${colors[j]}" fill-opacity=".33" stroke="${colors[j]}" stroke-width="2"/>`;let mx=155+a.median*65.6;s+=line(mx,base-47,mx,base,C.amber,1,'3 3')+text(20,base-6,a.name,'#c4d1d5',12)+text(770,base-6,a.median+'d',C.amber,11)});[0,2,4,6,8].forEach(v=>s+=text(155+v*65.6,340,v+'d',C.muted,10,'middle'))}
 if(c.kind==='waffle'){let colors=[C.mint,C.blue,C.violet,C.coral],counts=d.map(a=>a.value),k=0;for(let row=0;row<10;row++)for(let col=0;col<10;col++){let group=counts.findIndex((_,i)=>k<counts.slice(0,i+1).reduce((p,v)=>p+v,0));s+=rect(118+col*38,34+row*28,31,21,colors[group],3);k++}d.forEach((a,i)=>{let y=66+i*58;s+=circle(575,y-4,5,colors[i])+text(591,y,a.name,'#c4d1d5',12)+text(780,y,a.value+'%',colors[i],18,'end',600)})}
 if(c.kind==='multiples'){d.forEach((a,j)=>{let x=55+(j%2)*390,y=35+Math.floor(j/2)*150,w=340,h=102;s+=rect(x,y,w,h+24,'#17212b',5)+text(x+13,y+20,a.name,'#c4d1d5',11)+line(x+13,y+105,x+w-13,y+105,C.line);let pts=a.values.map((v,i)=>[x+20+i*59,y+105-v/30*66]);s+=`<path d="${path(pts)}" fill="none" stroke="${C.blue}" stroke-width="2.5" stroke-linejoin="round"/>`;pts.forEach((p,i)=>{if(i===5)s+=circle(p[0],p[1],5,C.mint)});s+=text(x+w-16,y+20,'$'+a.values[5]+'M',C.mint,11,'end');s+=text(x+15,y+121,'JAN',C.muted,9)+text(x+w-15,y+121,'JUN',C.muted,9,'end')})}
 if(c.kind==='hybrid'){let xs=d.map((_,i)=>90+i*76),base=275,scale=2,keys=['organic','paid','partner'],colors=[C.mint,C.blue,C.violet];[0,25,50,75,100].forEach(v=>{let y=base-v*scale;s+=line(90,y,625,y,C.line,1,'3 5')+text(75,y+4,v,C.muted,10,'end')});keys.forEach((key,j)=>{let top=[],bottom=[];d.forEach((a,i)=>{let low=keys.slice(0,j).reduce((sum,k)=>sum+a[k],0);bottom.push([xs[i],base-low*scale]);top.push([xs[i],base-(low+a[key])*scale])});s+=`<path d="${path(top)} ${path(bottom.reverse()).replace('M','L')} Z" fill="${colors[j]}" fill-opacity=".8" stroke="#101720" stroke-width="1.5"/>`});s+=`<path d="${path(d.map((a,i)=>[xs[i],base-a.target*scale]))}" fill="none" stroke="${C.amber}" stroke-width="2.5" stroke-dasharray="6 5"/>`;s+=line(xs[3],63,xs[3],276,'#82939d',1,'3 4')+rect(xs[3]+7,37,122,24,'#2b3945',4)+text(xs[3]+17,53,'CAMPAIGN LAUNCH','#dbe5e7',9);d.forEach((a,i)=>s+=text(xs[i],301,a.week,C.muted,10,'middle'));s+=line(656,40,656,305,C.line);s+=text(675,55,'LATEST MIX',C.muted,10);let latest=d[7],yy=83;keys.forEach((key,j)=>{let v=latest[key],h=v*1.42;s+=rect(677,yy,35,h,colors[j],2)+text(721,yy+15,key.toUpperCase(),C.muted,9)+text(800,yy+15,v,C.text||'#e9f0f2',11,'end');yy+=h+3});s+=text(677,286,'100 LEADS',C.mint,12)}
 return `<svg viewBox="0 0 830 355" role="img" aria-label="${esc(c.name+': '+c.description)}">${s}</svg>`
}

export const config = {
  "id": "GRAPH-093",
  "name": "Dumbbell Chart",
  "category": "Comparison",
  "heading": "Before & after the redesign",
  "subtitle": "Task success rate across user journeys · percent",
  "description": "Paired values connected by a line to emphasize direction and magnitude of change.",
  "philosophy": "Show the relationship, not just two numbers. A neutral connector captures distance while distinct endpoints separate baseline from current state.",
  "usecase": "Pre/post evaluations, cohort contrasts and benchmark comparisons.",
  "legend": [
    [
      "Before",
      "#b8a4f4"
    ],
    [
      "After",
      "#9df0cb"
    ]
  ],
  "data": [
    {
      "name": "Find a product",
      "before": 62,
      "after": 84
    },
    {
      "name": "Compare plans",
      "before": 54,
      "after": 78
    },
    {
      "name": "Complete order",
      "before": 68,
      "after": 89
    },
    {
      "name": "Resolve issue",
      "before": 49,
      "after": 72
    }
  ],
  "config": {
    "unit": "%",
    "domain": [
      0,
      100
    ],
    "leftKey": "before",
    "rightKey": "after"
  },
  "kind": "dumbbell"
};

export default function DumbbellChart({ config: definition = config, className = "", style }) {
  return (
    <div className={`cx-atlas-specialized ${className}`.trim()} style={style}>
      <div dangerouslySetInnerHTML={{ __html: renderChart(definition) }} />
    </div>
  );
}
