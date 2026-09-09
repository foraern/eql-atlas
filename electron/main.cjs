const {app,BrowserWindow,ipcMain,dialog,Menu,session,clipboard}=require('electron');
const path=require('node:path'),fs=require('node:fs/promises'),{pathToFileURL}=require('node:url');
const root=path.join(__dirname,'..'),browserTest=process.argv.includes('--browser-test'),selfTest=process.argv.includes('--self-test')||browserTest;
const arg=name=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:null;};
app.setName('EQL Atlas Cross-Platform');
// Packaged app resources are read-only; keep test profiles and reports outside the archive.
const testRoot=selfTest&&app.isPackaged?path.join(app.getPath('temp'),'eql-atlas-test-'+process.pid):root;
if(selfTest){require('node:fs').mkdirSync(path.join(testRoot,'qa','test-profile'),{recursive:true});app.setPath('userData',path.join(testRoot,'qa','test-profile'));}
let win,catalog=null,config={},scanFolder,readZone;
const configPath=()=>path.join(app.getPath('userData'),'atlas.json');
async function setFolder(folder){
  const next=await scanFolder(folder);catalog=next;config.mapsFolder=next.root;
  if(!selfTest){await fs.mkdir(app.getPath('userData'),{recursive:true});await fs.writeFile(configPath(),JSON.stringify(config,null,2));}
  return next;
}
function trusted(event){if(!win||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw Error('Untrusted frame.');}
function handle(name,fn){ipcMain.handle(name,async(event,...args)=>{trusted(event);try{return {ok:true,value:await fn(...args)};}catch(e){return {ok:false,error:e.message};}});}
app.whenReady().then(async()=>{
  ({scanFolder,readZone}=await import(pathToFileURL(path.join(root,'src/node-maps.js'))));
  try{config=JSON.parse(await fs.readFile(configPath(),'utf8'));}catch{}
  const requested=arg('--maps');if(requested)config.mapsFolder=requested;
  win=new BrowserWindow({title:'EQL Atlas Cross-Platform',width:1510,height:960,minWidth:900,minHeight:650,backgroundColor:'#0b1420',show:!selfTest,
    webPreferences:{...(browserTest?{}:{preload:path.join(__dirname,'preload.cjs')}),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,backgroundThrottling:!selfTest}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true}));
  handle('atlas:catalog',async()=>{if(catalog)return catalog;if(config.mapsFolder)return setFolder(config.mapsFolder);return null;});
  handle('atlas:choose',async()=>{
    const picked=await dialog.showOpenDialog(win,{title:'Choose the EQL maps folder',defaultPath:config.mapsFolder,properties:['openDirectory']});
    return picked.canceled?null:setFolder(picked.filePaths[0]);
  });
  handle('atlas:load',async({key,source})=>{
    if(!catalog||typeof key!=='string'||typeof source!=='string'||key.length>200||source.length>200)throw Error('Select a map folder and zone first.');
    return readZone(catalog,key,source);
  });
  handle('atlas:copy-loc',async text=>{if(typeof text!=='string'||text.length>120||!/^[-+\d.]+, [-+\d.]+, [-+\d.]+$/.test(text)||!text.split(',').every(s=>Number.isFinite(Number(s))))throw Error('Invalid location.');clipboard.writeText(text);return true;});
  handle('atlas:export',async({bytes,name})=>{
    if(!(bytes instanceof Uint8Array)||bytes.length>30*1024*1024||!Buffer.from(bytes.subarray(0,8)).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Invalid PNG.');
    const safeName=typeof name==='string'?name.replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80):'atlas-map';
    const selected=await dialog.showSaveDialog(win,{defaultPath:safeName+'.png',filters:[{name:'PNG image',extensions:['png']}]});
    if(selected.canceled)return false;await fs.writeFile(selected.filePath,bytes);return true;
  });
  const template=[];
  if(process.platform==='darwin')template.push({label:app.name,submenu:[{role:'about'},{type:'separator'},{role:'quit'}]});
  template.push({label:'File',submenu:[{label:'Choose Maps Folder…',accelerator:'CmdOrCtrl+O',click:()=>win.webContents.executeJavaScript("document.getElementById('open-folder').click()")},{role:'close'}]},
    {role:'editMenu'},{label:'View',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{type:'separator'},{role:'togglefullscreen'}]});
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  await win.loadFile(path.join(root,'dist/index.html'));
  if(selfTest){try{if(browserTest)await require('./browser-test.cjs')(win,testRoot,requested);else await require('./self-test.cjs')(win,testRoot);console.log('Test reports:',path.join(testRoot,'qa'));app.exit(0);}catch(error){console.error(error);app.exit(1);}}
}).catch(e=>{console.error(e);app.exit(1);});
app.on('window-all-closed',()=>app.quit());
