const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('    function setKeepScreenAwake'), html.indexOf('    function setTrackingText'));
function setup(request) {
 const status={textContent:''}, document={visibilityState:'visible',getElementById:()=>status};
 const context=vm.createContext({document,navigator:{wakeLock:{request}},onError(){}});
 vm.runInContext('let wakeLockSupported=true, keepScreenAwake=false, wakeLockPending=false, wakeLock=null;'+source,context);
 return {context,document,status,enable:value=>vm.runInContext(`keepScreenAwake=${value}; updateWakeLock()`,context)};
}
function sentinel(){return {released:false,listener:null,addEventListener(_,fn){this.listener=fn},async release(){this.released=true;this.listener?.()}};}
test('off by default; enable and disable acquire and release',async()=>{
 const lock=sentinel();let calls=0;const app=setup(async()=>{calls++;return lock});
 await app.context.updateWakeLock();assert.equal(calls,0);
 await app.enable(true);assert.equal(calls,1);assert.match(app.status.textContent,/stay awake/);
 await app.enable(false);assert(lock.released);assert.match(app.status.textContent,/Off/);
});
test('a request resolving after opt-out is immediately released',async()=>{
 let resolve;const lock=sentinel();const app=setup(()=>new Promise(r=>resolve=r));
 const pending=app.enable(true);await app.enable(false);resolve(lock);await pending;assert(lock.released);
});
test('returning to a visible page reacquires only when opted in',async()=>{
 const locks=[];const app=setup(async()=>{const lock=sentinel();locks.push(lock);return lock});
 await app.enable(true);app.document.visibilityState='hidden';await app.context.updateWakeLock();assert(locks[0].released);
 app.document.visibilityState='visible';await app.context.updateWakeLock();assert.equal(locks.length,2);
 await app.enable(false);await app.context.updateWakeLock();assert.equal(locks.length,2);
});
test('request rejection is surfaced without an unhandled rejection',async()=>{
 const app=setup(async()=>{throw Error('denied')});await app.enable(true);assert.match(app.status.textContent,/Could not/);
});
test('browser release is reflected and simultaneous requests are deduplicated',async()=>{
 let resolve,calls=0;const lock=sentinel();const app=setup(()=>{calls++;return new Promise(r=>resolve=r)});
 const first=app.enable(true);await app.context.updateWakeLock();assert.equal(calls,1);resolve(lock);await first;
 await lock.release();assert.match(app.status.textContent,/paused/);
});
