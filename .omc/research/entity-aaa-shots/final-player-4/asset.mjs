import { loadRgba } from '../../../../scripts/env-verify/assetColor.mjs';
const A = loadRgba('../../../../assets/player.png');
const w=A.w,h=A.h; let minX=1e9,maxX=-1,minY=1e9,maxY=-1,n=0,sr=0,sg=0,sb=0;
for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4; if(A.rgba[i+3]>128){n++;
  if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
  sr+=A.rgba[i];sg+=A.rgba[i+1];sb+=A.rgba[i+2];}}
console.log(JSON.stringify({w,h,opaque:n,
 xHalfTexel:+(Math.max(w/2-minX,maxX+1-w/2)).toFixed(2), yHalfTexel:+(Math.max(h/2-minY,maxY+1-h/2)).toFixed(2),
 xHalfPx15:+(Math.max(w/2-minX,maxX+1-w/2)*1.5).toFixed(2), yHalfPx15:+(Math.max(h/2-minY,maxY+1-h/2)*1.5).toFixed(2),
 mean:{r:+(sr/n).toFixed(1),g:+(sg/n).toFixed(1),b:+(sb/n).toFixed(1)}}));
