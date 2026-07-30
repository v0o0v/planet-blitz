import { loadRgba } from '../../../../scripts/env-verify/assetColor.mjs';
const [bodyOnly, noBodyNoSurf, noBody] = process.argv.slice(2).map(loadRgba);
const w=bodyOnly.w,h=bodyOnly.h; const T=3;
const d=(A,B,i)=>Math.abs(A.rgba[i]-B.rgba[i])+Math.abs(A.rgba[i+1]-B.rgba[i+1])+Math.abs(A.rgba[i+2]-B.rgba[i+2]);
let bodyPx=0,surfPx=0,outside=0,maxOut=0,outBox=[1e9,1e9,-1,-1];
for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;
  const inBody=d(bodyOnly,noBodyNoSurf,i)>T; const inSurf=d(noBody,noBodyNoSurf,i)>T;
  if(inBody)bodyPx++; if(inSurf){surfPx++; if(!inBody){outside++; const v=d(noBody,noBodyNoSurf,i); if(v>maxOut)maxOut=v;
    if(x<outBox[0])outBox[0]=x; if(y<outBox[1])outBox[1]=y; if(x>outBox[2])outBox[2]=x; if(y>outBox[3])outBox[3]=y;}}}
console.log(JSON.stringify({bodyPx,surfPx,outsideBodyPx:outside,maxOutsideD:maxOut,outBox}));
