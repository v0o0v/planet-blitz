import { loadRgba } from '../../scripts/env-verify/assetColor.mjs';
const [fa,fb,x0,y0,x1,y1]=process.argv.slice(2);
const A=loadRgba(fa),B=loadRgba(fb);
// 선체(청록) 픽셀: g>r+30 && g>90
let n=0,ar=0,ag=0,ab=0,br=0,bg=0,bb=0,maxd=0;
for(let y=+y0;y<=+y1;y++)for(let x=+x0;x<=+x1;x++){const i=(y*A.w+x)*4;
 const r=B.rgba[i],g=B.rgba[i+1],b=B.rgba[i+2];
 if(g>r+30&&g>90){n++;ar+=A.rgba[i];ag+=A.rgba[i+1];ab+=A.rgba[i+2];br+=r;bg+=g;bb+=b;
  const d=Math.abs(A.rgba[i]-r)+Math.abs(A.rgba[i+1]-g)+Math.abs(A.rgba[i+2]-b); if(d>maxd)maxd=d;}}
const f=(v)=>(v/n).toFixed(1);
console.log(`선체 픽셀 n=${n}\n  ON  (${f(ar)},${f(ag)},${f(ab)})\n  OFF (${f(br)},${f(bg)},${f(bb)})\n  평균 ΔR ${((ar-br)/n).toFixed(2)}  ΔG ${((ag-bg)/n).toFixed(2)}  ΔB ${((ab-bb)/n).toFixed(2)}  최대 픽셀 Δ합 ${maxd}`);
