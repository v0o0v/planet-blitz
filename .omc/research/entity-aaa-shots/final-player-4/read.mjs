import { loadRgba, luma } from '../../../../scripts/env-verify/assetColor.mjs';
const [mask1,mask0,shotOn,shotOff] = process.argv.slice(2).map(loadRgba);
// body footprint = |mask1-mask0|>3  (bodyOnly vs noBodyNoSurf)
const w=mask1.w,h=mask1.h,T=3;
const d=(A,B,i)=>Math.abs(A.rgba[i]-B.rgba[i])+Math.abs(A.rgba[i+1]-B.rgba[i+1])+Math.abs(A.rgba[i+2]-B.rgba[i+2]);
const inb=new Uint8Array(w*h); const stat=(arr)=>{arr.sort((a,b)=>a-b);const q=(p)=>arr[Math.floor(arr.length*p)];return {n:arr.length,p1:+q(0.01).toFixed(1),p5:+q(0.05).toFixed(1),med:+q(0.5).toFixed(1),p95:+q(0.95).toFixed(1)};};
for(let i=0;i<w*h;i++) if(d(mask1,mask0,i*4)>T) inb[i]=1;
// ring: pixels within 4px of body but not body
const ring=new Uint8Array(w*h);
for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++){const i=y*w+x; if(inb[i])continue;
  let near=false; for(let dy=-4;dy<=4&&!near;dy++)for(let dx=-4;dx<=4;dx++){const j=(y+dy)*w+(x+dx); if(j>=0&&j<w*h&&inb[j]){near=true;break;}}
  if(near)ring[i]=1;}
for(const [name,S] of [['ON',shotOn],['OFF',shotOff]]){
  const body=[],rg=[];
  for(let i=0;i<w*h;i++){const l=luma(S.rgba[i*4],S.rgba[i*4+1],S.rgba[i*4+2]); if(inb[i])body.push(l); else if(ring[i])rg.push(l);}
  console.log(name,'hull',JSON.stringify(stat(body)),'ring',JSON.stringify(stat(rg)));
}
