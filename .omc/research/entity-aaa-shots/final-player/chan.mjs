import { loadRgba, luma } from '../../../../scripts/env-verify/assetColor.mjs';
const [a,b] = process.argv.slice(2);
const A = loadRgba(a), B = loadRgba(b);
const w=A.w,h=A.h;
let n=0,dR=0,dG=0,dB=0,dL=0,x0=1e9,y0=1e9,x1=-1,y1=-1,maxd=0;
for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=(y*w+x)*4;
  const d=Math.abs(A.rgba[i]-B.rgba[i])+Math.abs(A.rgba[i+1]-B.rgba[i+1])+Math.abs(A.rgba[i+2]-B.rgba[i+2]);
  if(d>3){ n++; if(d>maxd)maxd=d; if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;
    dR+=B.rgba[i]-A.rgba[i]; dG+=B.rgba[i+1]-A.rgba[i+1]; dB+=B.rgba[i+2]-A.rgba[i+2];
    dL+=luma(B.rgba[i],B.rgba[i+1],B.rgba[i+2])-luma(A.rgba[i],A.rgba[i+1],A.rgba[i+2]); }
}
const f=(v)=>+(v/Math.max(n,1)).toFixed(2);
console.log(JSON.stringify({px:n,box:[x0,y0,x1,y1],maxD:maxd,'하강 dR':f(dR),'dG':f(dG),'dB':f(dB),'광도하강':f(dL)}));
