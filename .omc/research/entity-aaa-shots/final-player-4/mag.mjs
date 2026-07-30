import { loadRgba, luma } from '../../../../scripts/env-verify/assetColor.mjs';
const [a,b] = process.argv.slice(2);
const A = loadRgba(a), B = loadRgba(b);
const w=A.w,h=A.h; let n=0,tot=0,maxDrop=0,maxRise=0,g20=0,g10=0,g40=0,sumAbs=0;
for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=(y*w+x)*4;
  const la=luma(A.rgba[i],A.rgba[i+1],A.rgba[i+2]);
  const lb=luma(B.rgba[i],B.rgba[i+1],B.rgba[i+2]);
  const d=la-lb; // A(all) - B(off): 음수면 판면이 어둡게 만든 것
  if(Math.abs(d)>1){ n++; tot+=d; sumAbs+=Math.abs(d);
    if(d<maxDrop)maxDrop=d; if(d>maxRise)maxRise=d;
    if(Math.abs(d)>=10)g10++; if(Math.abs(d)>=20)g20++; if(Math.abs(d)>=40)g40++; }
}
console.log(JSON.stringify({px:n, sumLumaDelta:+tot.toFixed(0), meanAbsDelta:+(sumAbs/Math.max(n,1)).toFixed(2), maxDrop:+maxDrop.toFixed(1), maxRise:+maxRise.toFixed(1), px_ge10:g10, px_ge20:g20, px_ge40:g40}));
