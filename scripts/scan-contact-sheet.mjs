/* A contact sheet: every page of a scan, rotated upright and shrunk, tiled into
 * one image. Finding which of eighteen pages carries a firm should not cost
 * eighteen full-size looks. */
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

async function pageGray(doc, n) {
  const page = await doc.getPage(n)
  const ops = await page.getOperatorList()
  const names = []
  for (let i=0;i<ops.fnArray.length;i++) if (ops.fnArray[i]===pdfjs.OPS.paintImageXObject) names.push(ops.argsArray[i][0])
  if (!names.length) return null
  const nm = names[0]
  const img = page.objs.has(nm) ? page.objs.get(nm) : doc.commonObjs.get(nm)
  const {width:w,height:h,kind,data}=img
  const px=Buffer.alloc(w*h)
  if (kind===1){const st=(w+7)>>3;let ones=0
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const b=(data[y*st+(x>>3)]>>(7-(x&7)))&1;ones+=b;px[y*w+x]=b?255:0}
    if(ones<w*h/2)for(let i=0;i<px.length;i++)px[i]=255-px[i]}
  else if (kind===3){for(let i=0,j=0;i<w*h;i++,j+=4)px[i]=(data[j]*3+data[j+1]*6+data[j+2])/10}
  else if (kind===2){for(let i=0,j=0;i<w*h;i++,j+=3)px[i]=(data[j]*3+data[j+1]*6+data[j+2])/10}
  else return null
  return {w,h,px}
}
const rot=({w,h,px})=>{const o=Buffer.alloc(w*h)
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)o[(w-1-x)*h+y]=px[y*w+x]
  return {w:h,h:w,px:o}}
function shrink({w,h,px}, tw, th){                    // box average, keeps thin type legible
  const o=Buffer.alloc(tw*th)
  for(let y=0;y<th;y++){const y0=Math.floor(y*h/th), y1=Math.max(y0+1,Math.floor((y+1)*h/th))
    for(let x=0;x<tw;x++){const x0=Math.floor(x*w/tw), x1=Math.max(x0+1,Math.floor((x+1)*w/tw))
      let s=0,n=0; for(let yy=y0;yy<y1;yy++)for(let xx=x0;xx<x1;xx++){s+=px[yy*w+xx];n++}
      o[y*tw+x]=s/n}}
  return o}

const [src, out, colsArg, twArg] = process.argv.slice(2)
const cols = Number(colsArg||5), TW = Number(twArg||330), TH = Math.round(TW*1.414)
const doc = await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(src))}).promise
const N = doc.numPages, rows = Math.ceil(N/cols)
const GW = cols*(TW+6)+6, GH = rows*(TH+6)+6
const grid = Buffer.alloc(GW*GH, 160)
for (let n=1;n<=N;n++){
  let g = await pageGray(doc,n); if(!g) continue
  if (g.w>g.h) g = rot(g)
  const t = shrink(g,TW,TH)
  const cx=6+((n-1)%cols)*(TW+6), cy=6+Math.floor((n-1)/cols)*(TH+6)
  for(let y=0;y<TH;y++) Buffer.from(t.subarray(y*TW,y*TW+TW)).copy(grid,(cy+y)*GW+cx)
}
fs.writeFileSync(out, grayPng(GW,GH,grid))
console.log(`${out}  ${N} pages  ${GW}x${GH}`)
