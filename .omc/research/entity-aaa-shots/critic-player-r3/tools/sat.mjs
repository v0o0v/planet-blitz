import { loadRgba } from '../../scripts/env-verify/assetColor.mjs';
const [f,x0,y0,x1,y1,lmin]=process.argv.slice(2);
const {w,h,rgba}=loadRgba(f);
const L=(r,g,b)=>0.299*r+0.587*g+0.114*b;
const sat=(r,g,b)=>{const mx=Math.max(r,g,b);return mx<=0?0:((mx-Math.min(r,g,b))/mx)*255;};
const rows=[];
for(let y=+y0;y<=+y1;y++)for(let x=+x0;x<=+x1;x++){const i=(y*w+x)*4;const r=rgba[i],g=rgba[i+1],b=rgba[i+2];const l=L(r,g,b);if(l>=+lmin)rows.push({l,s:sat(r,g,b),r,g,b,x,y});}
rows.sort((a,b)=>b.l-a.l);
const sats=rows.map(o=>o.s).sort((a,b)=>a-b);
const q=p=>sats[Math.min(sats.length-1,Math.floor(p*sats.length))];
const lum=rows.map(o=>o.l).sort((a,b)=>a-b);
const ql=p=>lum[Math.min(lum.length-1,Math.floor(p*lum.length))];
console.log(`n=${rows.length} satMed=${q(0.5)?.toFixed(1)} sat_p05=${q(0.05)?.toFixed(1)} sat_p95=${q(0.95)?.toFixed(1)} lumaP50=${ql(0.5)?.toFixed(1)} lumaP99=${ql(0.99)?.toFixed(1)} lumaMax=${ql(1)?.toFixed(1)}`);
console.log('top5:', rows.slice(0,5).map(o=>`(${o.r},${o.g},${o.b})L${o.l.toFixed(0)}S${o.s.toFixed(0)}@${o.x},${o.y}`).join(' '));
const below=sats.filter(s=>s<60).length;
console.log(`sat<60 비율 ${(100*below/sats.length).toFixed(1)}%`);
