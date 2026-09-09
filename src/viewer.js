import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {boundsOf,filteredGeometry} from './core.js';

export class MapViewer {
  constructor(stage,onPick){
    this.stage=stage;this.onPick=onPick;this.mode='3d';this.factor=1;this.magnification=1;this.data=null;this.marker=null;this.selected=null;this.labels=[];this.hits=[];
    this.options={low:-Infinity,high:Infinity,layers:[0,1],depth:null,side:'north',ghost:true,edges:false,labels:true};
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});this.renderer.setClearColor(0x090f18);this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.domElement.id='geometry-canvas';this.renderer.domElement.setAttribute('aria-label','Zone geometry. Drag to rotate; scroll to zoom.');stage.prepend(this.renderer.domElement);
    this.overlay=document.getElementById('labels-canvas');this.ctx=this.overlay.getContext('2d');
    this.scene=new THREE.Scene();this.camera=new THREE.OrthographicCamera(-500,500,500,-500,.1,1e7);this.camera.position.set(700,600,900);this.camera.lookAt(0,0,0);this.half=500;
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=false;this.controls.screenSpacePanning=true;this.controls.minZoom=.03;this.controls.maxZoom=1000;this.controls.addEventListener('change',()=>this.requestRender());
    this.geometry=new THREE.Group();this.scene.add(this.geometry);
    // Keep the highlight in the transparent render pass so its renderOrder places it above the teal lines.
    this.materials={context:new THREE.LineBasicMaterial({color:0x6e879e,transparent:true,opacity:.18,depthTest:false}),visible:new THREE.LineBasicMaterial({color:0x65cdd0,transparent:true,opacity:.88,depthTest:false}),vertical:new THREE.LineBasicMaterial({color:0xe9a15b,transparent:true,opacity:1,depthTest:false})};
    for(const kind of ['context','visible','vertical']){this[kind]=new THREE.LineSegments(new THREE.BufferGeometry(),this.materials[kind]);this[kind].renderOrder=kind==='context'?0:kind==='visible'?1:2;this.geometry.add(this[kind]);}
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(stage);
    let down=null;this.renderer.domElement.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY]});
    this.renderer.domElement.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>4)return;const rect=stage.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;const hit=this.hits.find(h=>x>=h.x&&x<=h.x+h.w&&y>=h.y&&y<=h.y+h.h);if(hit)this.onPick(hit.label);});
    this.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();document.getElementById('status').textContent='Graphics context lost. Reload the app to restore the map.';});
    this.resize();
  }
  resize(){const r=this.stage.getBoundingClientRect();this.width=Math.max(1,r.width);this.height=Math.max(1,r.height);this.renderer.setSize(this.width,this.height,false);const dpr=Math.min(devicePixelRatio,2);this.overlay.width=Math.round(this.width*dpr);this.overlay.height=Math.round(this.height*dpr);this.overlay.style.width=this.width+'px';this.overlay.style.height=this.height+'px';this.dpr=dpr;this.updateFrustum();this.requestRender();}
  updateFrustum(){const aspect=this.width/this.height;this.camera.left=-this.half*aspect;this.camera.right=this.half*aspect;this.camera.top=this.half;this.camera.bottom=-this.half;this.camera.updateProjectionMatrix();}
  setData(data){this.data=data;this.marker=null;this.selected=null;this.options.depth=null;this.options.low=Math.floor(data.bounds.min[2]);this.options.high=Math.ceil(data.bounds.max[2]);this.rebuild();this.fit();}
  setOptions(options){Object.assign(this.options,options);this.rebuild();}
  lineGeometry(lines){const vertices=new Float32Array(lines.length*6);let i=0;for(const l of lines){vertices[i++]=l[0];vertices[i++]=l[2];vertices[i++]=l[1];vertices[i++]=l[3];vertices[i++]=l[5];vertices[i++]=l[4];}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(vertices,3));g.computeBoundingSphere();return g;}
  rebuild(){if(!this.data)return;this.filtered=filteredGeometry(this.data.lines,this.options);
    const sliced=this.options.low>this.data.bounds.min[2]||this.options.high<this.data.bounds.max[2];
    for(const [kind,lines] of [['context',this.options.ghost&&sliced?this.filtered.context:[]],['visible',this.filtered.visible],['vertical',this.options.edges?this.filtered.vertical:[]]]){const old=this[kind].geometry;this[kind].geometry=this.lineGeometry(lines);old.dispose();}
    this.geometry.scale.y=this.factor;this.requestRender();
    document.getElementById('map-stats').textContent=`${this.filtered.visible.length.toLocaleString()} segments · Z ${this.options.low.toFixed(1)} to ${this.options.high.toFixed(1)}`+(this.options.depth?' · depth cutaway':'');
  }
  setView(mode){this.mode=mode;this.factor=['north','west'].includes(mode)?this.magnification:1;this.geometry.scale.y=this.factor;
    this.controls.enableRotate=mode==='3d';this.controls.mouseButtons.LEFT=mode==='3d'?THREE.MOUSE.ROTATE:THREE.MOUSE.PAN;
    this.camera.up.set(0,1,0);let dir;
    if(mode==='top'){dir=new THREE.Vector3(0,1,0);this.camera.up.set(0,0,-1);}
    else if(mode==='north')dir=new THREE.Vector3(0,0,1);
    else if(mode==='west')dir=new THREE.Vector3(1,0,0);
    else dir=new THREE.Vector3(.55,.65,1).normalize();
    this.direction=dir;this.options.side=mode==='west'?'west':'north';if(mode==='3d'||mode==='top')this.options.depth=null;
    this.fit();this.rebuild();
  }
  setMagnification(value){this.magnification=value;this.setView(this.mode);}
  fit(slice=false){if(!this.data)return;const b=slice&&this.filtered?.visible.length?boundsOf(this.filtered.visible):this.data.bounds;
    const center=new THREE.Vector3(b.center[0],b.center[2]*this.factor,b.center[1]);
    const direction=this.direction?.clone()||this.camera.position.clone().sub(this.controls.target).normalize();this.direction=null;
    const distance=Math.max(this.data.bounds.span*this.factor*5,1000);this.camera.position.copy(center).addScaledVector(direction,distance);this.controls.target.copy(center);this.camera.near=.1;this.camera.far=distance*20;
    this.camera.lookAt(center);this.camera.updateMatrixWorld(true);
    const inv=this.camera.quaternion.clone().invert();let x=0,y=0;
    for(const a of [b.min[0],b.max[0]])for(const c of [b.min[1],b.max[1]])for(const z of [b.min[2],b.max[2]]){const v=new THREE.Vector3(a,z*this.factor,c).sub(center).applyQuaternion(inv);x=Math.max(x,Math.abs(v.x));y=Math.max(y,Math.abs(v.y));}
    this.half=Math.max(y,x/(this.width/this.height),5)*1.2;this.camera.zoom=1;this.updateFrustum();this.controls.update();this.requestRender();
  }
  focus(point){const target=new THREE.Vector3(point[0],point[2]*this.factor,point[1]),delta=target.clone().sub(this.controls.target);this.controls.target.copy(target);this.camera.position.add(delta);this.controls.update();this.requestRender();}
  zoom(value){this.camera.zoom=Math.max(.03,Math.min(1000,this.camera.zoom*value));this.camera.updateProjectionMatrix();this.controls.update();this.requestRender();}
  project(point){const p=new THREE.Vector3(point[0],point[2]*this.factor,point[1]).project(this.camera);return {x:(p.x+1)*this.width/2,y:(1-p.y)*this.height/2,z:p.z};}
  requestRender(){if(this.frame)return;this.frame=requestAnimationFrame(()=>{this.frame=null;this.render();});}
  render(){this.camera.updateMatrixWorld(true);this.renderer.render(this.scene,this.camera);this.drawOverlay();}
  drawOverlay(){const c=this.ctx,w=this.width,h=this.height;c.setTransform(this.dpr,0,0,this.dpr,0,0);c.clearRect(0,0,w,h);this.hits=[];if(!this.data)return;
    const boxes=[{x:0,y:0,w,h:44},{x:0,y:h-40,w,h:40}];c.font='12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
    if(['north','west'].includes(this.mode)){
      const half=this.half/this.camera.zoom,center=this.controls.target.y/this.factor,approx=half*2/this.factor/7,power=10**Math.floor(Math.log10(Math.max(.001,approx))),step=Math.ceil(approx/power)*power;
      for(let z=Math.ceil((center-half/this.factor)/step)*step;z<center+half/this.factor;z+=step){const p=this.project([this.controls.target.x,this.controls.target.z,z]);if(p.y<55||p.y>h-45)continue;c.strokeStyle='#8ba6bc28';c.beginPath();c.moveTo(56,p.y);c.lineTo(w-12,p.y);c.stroke();c.fillStyle='#9dafc0';c.fillText('Z '+Number(z.toFixed(2)),8,p.y-5);}
    }
    const draw=(text,p,color,label)=>{
      const s=this.project(p);if(s.z< -1||s.z>1||s.x<8||s.x>w-8||s.y<44||s.y>h-38)return;
      c.fillStyle=color;c.beginPath();c.arc(s.x,s.y,label?3:5,0,Math.PI*2);c.fill();
      const maxWidth=Math.min(w-25,250);while(c.measureText(text).width>maxWidth&&text.length>5)text=text.slice(0,-2);if(c.measureText(text).width>=maxWidth-10)text+='…';
      const tw=c.measureText(text).width;
      for(const dy of [-22,9,-41,28]){const box={x:Math.max(8,Math.min(w-tw-18,s.x+8)),y:s.y+dy,w:tw+10,h:21};if(box.y<42||box.y+box.h>h-38||boxes.some(b=>box.x<b.x+b.w+3&&box.x+box.w>b.x-3&&box.y<b.y+b.h+3&&box.y+box.h>b.y-3))continue;
        c.fillStyle='#090f18e8';c.fillRect(box.x,box.y,box.w,box.h);c.fillStyle=color;c.fillText(text,box.x+5,box.y+15);boxes.push(box);if(label)this.hits.push({...box,label});break;}
    };
    if(this.marker)draw(`You · Z ${this.marker[2].toFixed(1)}`,this.marker,'#ffe087',null);
    if(this.selected)draw(`${this.selected.name} · Z ${this.selected.position[2].toFixed(1)}`,this.selected.position,'#ffe087',this.selected);
    if(this.options.labels){let shown=0;for(const l of this.labels){if(l===this.selected||!this.options.layers.includes(l.layer)||l.position[2]<this.options.low||l.position[2]>this.options.high)continue;const d=this.options.depth;if(d&&Math.abs(l.position[this.mode==='west'?0:1]-d.center)>d.width/2)continue;draw(l.name,l.position,l.reference?'#ffca8d':'#e1eff6',l);if(++shown>350)break;}}
    const captions={'3d':'3D · true proportions',top:'Top · north ↑ · east →',north:'Side · looking north · east →',west:'Side · looking west · north →'};
    document.getElementById('map-caption').textContent=captions[this.mode]+(this.factor!==1?` · height ×${this.factor}`:'');
  }
  async png(){this.render();const c=document.createElement('canvas');c.width=this.renderer.domElement.width;c.height=this.renderer.domElement.height;const x=c.getContext('2d');x.drawImage(this.renderer.domElement,0,0);x.drawImage(this.overlay,0,0,c.width,c.height);x.fillStyle='#dce6f1';x.font=`${14*this.dpr}px sans-serif`;x.fillText(`${this.data.name} · ${document.getElementById('map-caption').textContent}`,15*this.dpr,27*this.dpr);return new Promise(resolve=>c.toBlob(resolve,'image/png'));}
}
