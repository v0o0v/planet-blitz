import { loadRgba, luma } from '../../../../scripts/env-verify/assetColor.mjs';
const files = process.argv.slice(2);
for(const f of files){ const A=loadRgba(f); let b200=0,b220=0,b240=0,sum=0; const n=A.w*A.h;
 for(let i=0;i<n;i++){ const j=i*4; const l=luma(A.rgba[j],A.rgba[j+1],A.rgba[j+2]); sum+=l;
  if(l>=200)b200++; if(l>=220)b220++; if(l>=240)b240++; }
 console.log(f, JSON.stringify({meanLuma:+(sum/n).toFixed(3), pct200:+(100*b200/n).toFixed(4), pct220:+(100*b220/n).toFixed(4), pct240:+(100*b240/n).toFixed(4)}));}
