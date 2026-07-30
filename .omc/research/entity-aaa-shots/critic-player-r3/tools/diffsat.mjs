import { loadRgba } from '../../scripts/env-verify/assetColor.mjs';
const [fa,fb,thr]=process.argv.slice(2);
const A=loadRgba(fa),B=loadRgba(fb);
const L=(r,g,b)=>0.299*r+0.587*g+0.114*b;
const sat=(r,g,b)=>{const mx=Math.max(r,g,b);return mx<=0?0:((mx-Math.min(r,g,b))/mx)*255;};
const rows=[];
for(let i=0;i<A.w*A.h;i++){const k=i*4;
 const d=Math.abs(A.rgba[k]-B.rgba[k])+Math.abs(A.rgba[k+1]-B.rgba[k+1])+Math.abs(A.rgba[k+2]-B.rgba[k+2]);
 if(d>=+(thr||20)){const r=A.rgba[k],g=A.rgba[k+1],b=A.rgba[k+2];rows.push({l:L(r,g,b),s:sat(r,g,b),d,r,g,b,x:i%A.w,y:(i/A.w)|0});}}
const sats=rows.map(o=>o.s).sort((a,b)=>a-b), lum=rows.map(o=>o.l).sort((a,b)=>a-b);
const q=(a,p)=>a[Math.min(a.length-1,Math.floor(p*a.length))];
console.log(`기여 픽셀 n=${rows.length}  satMed=${q(sats,0.5)?.toFixed(1)}  sat_p05=${q(sats,0.05)?.toFixed(1)}  lumaP50=${q(lum,0.5)?.toFixed(1)}  lumaP95=${q(lum,0.95)?.toFixed(1)}  lumaP99=${q(lum,0.99)?.toFixed(1)}  lumaMax=${q(lum,1)?.toFixed(1)}`);
rows.sort((a,b)=>b.l-a.l);
console.log('최고광도 5:',rows.slice(0,5).map(o=>`(${o.r},${o.g},${o.b})L${o.l.toFixed(0)}S${o.s.toFixed(0)}`).join(' '));
console.log(`sat<60 비율 ${(100*sats.filter(s=>s<60).length/sats.length).toFixed(1)}%`);
