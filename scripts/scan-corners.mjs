/* The totals corner of every page of one or more scans, tiled in reading order
 * and numbered. Answers "what does each page total?" for a whole bundle in one
 * look, which is the only question a same-total pair actually raises. */
import fs from 'node:fs'
import zlib from 'node:zlib'
const pdfjs = await import(new URL('file:///C:/Users/davga/Skipper%20Management/node_modules/pdfjs-dist/legacy/build/pdf.mjs').href)
const crcT=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})()
const crc=(b)=>{let c=0xffffffff;for(const x of b)c=crcT[(c^x)&0xff]^(c>>>8);return (c^0xffffffff)>>>0}
const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t,'latin1'),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c])}
const grayPng=(w,h,px)=>{const raw=Buffer.alloc((w+1)*h)
  for(let y=0;y<h;y++){raw[y*(w+1)]=0;px.copy(raw,y*(w+1)+1,y*w,y*w+w)}
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=0
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))])}
async function pageGray(doc,n){const page=await doc.getPage(n);const ops=await page.getOperatorList();const names=[]
  for(let i=0;i<ops.fnArray.length;i++) if(ops.fnArray[i]===pdfjs.OPS.paintImageXObject) names.push(ops.argsArray[i][0])
  if(!names.length) return null
  const nm=names[0]; const img=page.objs.has(nm)?page.objs.get(nm):(page.commonObjs&&page.commonObjs.has(nm)?page.commonObjs.get(nm):null); if(!img) return null; //
  const {width:w,height:h,kind,data}=img; const px=Buffer.alloc(w*h)
  if(kind===1){const st=(w+7)>>3;let ones=0
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const b=(data[y*st+(x>>3)]>>(7-(x&7)))&1;ones+=b;px[y*w+x]=b?255:0}
    if(ones<w*h/2)for(let i=0;i<px.length;i++)px[i]=255-px[i]}
  else if(kind===3){for(let i=0,j=0;i<w*h;i++,j+=4)px[i]=(data[j]*3+data[j+1]*6+data[j+2])/10}
  else if(kind===2){for(let i=0,j=0;i<w*h;i++,j+=3)px[i]=(data[j]*3+data[j+1]*6+data[j+2])/10}
  else return null
  return {w,h,px}}
const rot=({w,h,px})=>{const o=Buffer.alloc(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)o[(w-1-x)*h+y]=px[y*w+x];return {w:h,h:w,px:o}}
function crop({w,h,px},x0,x1,y0,y1){const X0=Math.floor(w*x0/100),X1=Math.floor(w*x1/100)
  const Y0=Math.floor(h*y0/100),Y1=Math.floor(h*y1/100),W=X1-X0,H=Y1-Y0
  const o=Buffer.alloc(W*H); for(let y=0;y<H;y++) px.copy(o,y*W,(Y0+y)*w+X0,(Y0+y)*w+X1)
  return {w:W,h:H,px:o}}
function fit({w,h,px},TW,TH){const o=Buffer.alloc(TW*TH,255)
  for(let y=0;y<TH;y++){const y0=Math.floor(y*h/TH),y1=Math.max(y0+1,Math.floor((y+1)*h/TH))
    for(let x=0;x<TW;x++){const x0=Math.floor(x*w/TW),x1=Math.max(x0+1,Math.floor((x+1)*w/TW))
      let s=0,c=0;for(let yy=y0;yy<y1;yy++)for(let xx=x0;xx<x1;xx++){s+=px[yy*w+xx];c++}
      o[y*TW+x]=s/c}}
  return o}
/* a 5x7 dot font, enough for a page number */
const F={'0':'11111100011000110001100011000111111','1':'00100011000010000100001000010001110','2':'11111000010001001000100001000011111','3':'11111000010001000110000010001111110','4':'10001100011000111111000010000100001','5':'11111100001111000001000011000111110','6':'01110100001000011110100011000101110','7':'11111000010001000100010000100001000','8':'01110100011000101110100011000101110','9':'01110100011000101111000010000101110'}
function stamp(canvas,W,x,y,text,scale=3){let cx=x
  for(const ch of text){const g=F[ch]; if(g){for(let r=0;r<7;r++)for(let c=0;c<5;c++) if(g[r*5+c]==='1')
      for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++) canvas[(y+r*scale+dy)*W + cx+c*scale+dx]=0}
    cx+=6*scale}}

const [out,cols,tw,th,x0,x1,y0,y1,...files] = process.argv.slice(2)
const COLS=Number(cols),TW=Number(tw),TH=Number(th)
const tiles=[]
for (const f of files){
  const doc=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(f))}).promise
  for(let n=1;n<=doc.numPages;n++){let g=await pageGray(doc,n); if(!g) continue; if(g.w>g.h) g=rot(g)
    tiles.push({n,px:fit(crop(g,Number(x0),Number(x1),Number(y0),Number(y1)),TW,TH)})}
}
const rows=Math.ceil(tiles.length/COLS)
const GW=COLS*(TW+8)+8, GH=rows*(TH+8)+8
const canvas=Buffer.alloc(GW*GH,70)
tiles.forEach((t,i)=>{const cx=8+(i%COLS)*(TW+8), cy=8+Math.floor(i/COLS)*(TH+8)
  for(let y=0;y<TH;y++) Buffer.from(t.px.subarray(y*TW,y*TW+TW)).copy(canvas,(cy+y)*GW+cx)
  stamp(canvas,GW,cx+4,cy+4,String(t.n))})
fs.writeFileSync(out,grayPng(GW,GH,canvas))
console.log(`${out}  ${tiles.length} pages  ${GW}x${GH}`)
