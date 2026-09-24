const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('    function routePointDistance'),html.indexOf('    async function setBrouterProfile'));
function setup(fetch) {
 let route=null, alerts=[], loading=[], markers=[], sources={}, layers={};
 const element=()=>({style:{},children:[],textContent:'',appendChild(child){this.children.push(child)},setAttribute(){}});
 const list=element(),options=element();
 const context=vm.createContext({URLSearchParams,fetch,document:{getElementById:id=>id==='route-points-list'?list:options,createElement:element},map:{getSource:id=>sources[id],getLayer:id=>layers[id],addSource:(id,source)=>sources[id]={...source,setData(data){this.data=data}},addLayer:layer=>layers[layer.id]=layer},mapboxgl:{Marker:class{constructor(element){markers.push(element)}setLngLat(){return this}addTo(){return this}remove(){}}},setBrouterProfile:async()=> 'test-profile',setBrouterRoute(){},toggleLoader:value=>loading.push(value),handleGeoJsonResponse:data=>route=data,onException(){},alert:message=>alerts.push(message)});
 vm.runInContext('let routeWaypoints=[],routeExclusions=[],routePointMarkers=[],routeRequestVersion=0,brouterRoute=null,brouterCustomProfile=null,startLocation=null,endLocation=null;'+source,context);
 return {context,list,alerts,loading,markers,sources,get route(){return route},run:code=>vm.runInContext(code,context)};
}
const start={lng:-78.65,lat:35.78},end={lng:-78.62,lat:35.80};
test('route includes ordered stops and 100 m nogos',async()=>{
 let url;const app=setup(async input=>{url=new URL(input);return {ok:true,json:async()=>({id:'route'})}});
 app.run('routeWaypoints=[{lng:-78.64,lat:35.79},{lng:-78.63,lat:35.79}];routeExclusions=[{lng:-78.66,lat:35.80}]');
 await app.context.fetchRouteFromBRouter(start,end);
 assert.equal(url.searchParams.get('lonlats'),'-78.65,35.78|-78.64,35.79|-78.63,35.79|-78.62,35.8');
 assert.equal(url.searchParams.get('nogos'),'-78.66,35.8,100');assert.equal(app.route.id,'route');
});
test('plain routes omit nogos',async()=>{
 let url;const app=setup(async input=>{url=new URL(input);return {ok:true,json:async()=>({})}});await app.context.fetchRouteFromBRouter(start,end);assert(!url.searchParams.has('nogos'));
});
test('exclusions at a stop are rejected before contacting BRouter',async()=>{
 const app=setup(()=>{throw Error('must not fetch')});app.run('routeExclusions=[{lng:-78.65,lat:35.78}]');await app.context.fetchRouteFromBRouter(start,end);assert.match(app.alerts[0],/within 100 m/);
});
test('older responses cannot overwrite a newer route',async()=>{
 const resolve=[];const app=setup(()=>new Promise(r=>resolve.push(r)));
 const first=app.context.fetchRouteFromBRouter(start,end);await new Promise(setImmediate);
 const second=app.context.fetchRouteFromBRouter(start,end);await new Promise(setImmediate);
 resolve[1]({ok:true,json:async()=>({id:'new'})});await second;
 resolve[0]({ok:true,json:async()=>({id:'old'})});await first;assert.equal(app.route.id,'new');
});
test('cleared routes discard in-flight responses',async()=>{
 let resolve;const app=setup(()=>new Promise(r=>resolve=r));const pending=app.context.fetchRouteFromBRouter(start,end);await new Promise(setImmediate);app.run('routeRequestVersion++');resolve({ok:true,json:async()=>({id:'old'})});await pending;assert.equal(app.route,null);
});
test('stops can be reordered, removed and cleared alongside avoid points',()=>{
 const app=setup();app.context.addRoutePoint('stop',1,1);app.context.addRoutePoint('stop',2,2);
 const last=app.list.children.at(-1);last.children[1].onclick();assert.equal(app.run('routeWaypoints[0].lng'),2);
 app.list.children.at(-1).children.at(-1).onclick();assert.equal(app.run('routeWaypoints.length'),1);
 app.context.addRoutePoint('avoid',3,3);app.context.clearRoutePoints();assert.equal(app.run('routeWaypoints.length+routeExclusions.length+routePointMarkers.length'),0);
});

test('avoid circles have a 100 m radius and clicking their map marker removes them',()=>{
 const app=setup();app.context.addRoutePoint('avoid',-78.64,35.78);
 const ring=app.sources['route-avoid-areas'].data.features[0].geometry.coordinates[0];
 assert.equal(ring.length,65);assert.deepEqual(ring[0],ring.at(-1));
 for(const [lng,lat] of ring) assert.ok(Math.abs(app.context.routePointDistance({lng:-78.64,lat:35.78},{lng,lat})-100)<0.01);
 app.markers.at(-1).onclick({stopPropagation(){}});
 assert.equal(app.run('routeExclusions.length'),0);
 assert.equal(app.sources['route-avoid-areas'].data.features.length,0);
});
test('stop controls can move down and map markers remove the current numbered stop',()=>{
 const app=setup();app.context.addRoutePoint('stop',1,1);app.context.addRoutePoint('stop',2,2);
 const row=app.list.children.at(-2);
 assert.equal(row.children[0].textContent,'Stop 1');
 assert.equal(row.children[1].disabled,true);
 row.children[2].onclick();assert.equal(app.run('routeWaypoints[0].lng'),2);
 app.markers.at(-2).onclick({stopPropagation(){}});
 assert.equal(app.run('routeWaypoints.length'),1);assert.equal(app.run('routeWaypoints[0].lng'),1);
});
