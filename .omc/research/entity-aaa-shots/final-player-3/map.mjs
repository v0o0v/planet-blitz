import { loadRgba, luma } from '../../../../scripts/env-verify/assetColor.mjs';
const [a,b,x0,y0,w,h] = process.argv.slice(2);
const A=loadRgba(a),B=loadRgba(b); const W=A.w;
const X0=+x0,Y0=+y0,BW=+w,BH=+h;
const ch=' .:-=+*#%@';
let out=[];
for(let y=Y0;y<Y0+BH;y++){ let line='';
  for(let x=X0;x<X0+BW;x++){ const i=(y*W+x)*4;
    const d=luma(A.rgba[i],A.rgba[i+1],A.rgba[i+2])-luma(B.rgba[i],B.rgba[i+1],B.rgba[i+2]);
    const m=Math.min(9,Math.floor(Math.abs(d)/4)); line+= Math.abs(d)<=1?' ':ch[m]; }
  out.push(line); }
console.log(out.join('\n'));
