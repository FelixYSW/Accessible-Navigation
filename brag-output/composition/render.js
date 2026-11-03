const {chromium}=require('playwright');const fs=require('fs');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1920,height:1080}});
await p.goto('file://'+__dirname+'/index.html');fs.mkdirSync(process.argv[2],{recursive:true});
const N=600;for(let i=0;i<N;i++){await p.evaluate(t=>window.render(t),i/30);
const png=await p.locator('canvas').screenshot({type:'png'});fs.writeFileSync(`${process.argv[2]}/f${String(i).padStart(4,'0')}.png`,png);}
await b.close();})();
