import { loadRgba, luma } from '../../../../scripts/env-verify/assetColor.mjs';
const [a,b] = process.argv.slice(2);
const A = loadRgba(a), B = loadRgba(b);
const w=A.w,h=A.h;
let x0=1e9,y0=1e9,x1=-1,y1=-1,n=0,sum=0,maxd=0,sumLA=0,sumLB=0;
for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=(y*w+x)*4;
  const d=Math.abs(A.rgba[i]-B.rgba[i])+Math.abs(A.rgba[i+1]-B.rgba[i+1])+Math.abs(A.rgba[i+2]-B.rgba[i+2]);
  if(d>3){ n++; sum+=d; if(d>maxd)maxd=d; if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;
    sumLA+=luma(A.rgba[i],A.rgba[i+1],A.rgba[i+2]); sumLB+=luma(B.rgba[i],B.rgba[i+1],B.rgba[i+2]); }
}
console.log(JSON.stringify({px:n, box:[x0,y0,x1,y1], bw:x1-x0+1, bh:y1-y0+1, meanD:+(sum/Math.max(n,1)).toFixed(2), maxD:maxd, lumaA:+(sumLA/Math.max(n,1)).toFixed(2), lumaB:+(sumLB/Math.max(n,1)).toFixed(2), dLuma:+((sumLA-sumLB)/Math.max(n,1)).toFixed(2)}));
