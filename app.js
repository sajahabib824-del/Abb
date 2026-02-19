// app.js - final: improved low-light handling, edit UI for text, watermark, adaptive font sizing
(() => {
  const startBtn = document.getElementById('start');
  const overlay = document.getElementById('overlay');
  const video = document.getElementById('video');
  const container = document.getElementById('three-container');
  const editBtn = document.getElementById('btn-edit');
  const editModal = document.getElementById('editModal');
  const editInput = document.getElementById('editInput');
  const cancelEdit = document.getElementById('cancelEdit');
  const saveEdit = document.getElementById('saveEdit');

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    startBtn.textContent = 'Camera not supported';
    startBtn.disabled = true;
  }

  // device detection
  const ua = navigator.userAgent || '';
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua) || window.innerWidth <= 720;

  // config
  let TOTAL = isMobile ? 1200 : 4200;
  const BASE_PARTICLE_SIZE = isMobile ? 1.2 : 1.8;
  const SMOOTH_FOLLOW = 0.08;
  let TEXT_SAMPLE = (new URL(location.href)).searchParams.get('text') || 'SATURN';

  // update edit input initial value
  editInput.value = TEXT_SAMPLE;

  // three.js setup variables
  let renderer, camera, scene, points, geometry;
  let positions, targets, velocities, colors;
  let state = 'idle';
  let desiredAnchor = new THREE.Vector3(0,0,0);
  let shapeAnchor = new THREE.Vector3(0,0,0);
  let lastTs = performance.now();

  // offscreen canvas for preprocessing (brightness/contrast)
  const offCanvas = document.createElement('canvas');
  const offCtx = offCanvas.getContext('2d');

  // performance control
  let activeCount = TOTAL;
  let fpsHistory = [];
  const FPS_SMOOTH = 8;

  // auto-light adjust vars
  let lightAdjustFrames = 0;
  let brightnessMultiplier = 1.0;
  let contrastMultiplier = 1.0;

  // Start flow
  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    startBtn.textContent = 'Starting camera...';
    try {
      await initApp();
      overlay.style.display = 'none';
    } catch (e) {
      console.error('Init failed', e);
      startBtn.textContent = 'Start failed. See console';
      startBtn.disabled = false;
    }
  });

  // edit modal handlers
  editBtn.addEventListener('click', () => {
    editModal.style.display = 'block';
    editInput.focus();
  });
  cancelEdit.addEventListener('click', () => editModal.style.display = 'none');
  saveEdit.addEventListener('click', () => {
    const v = editInput.value.trim();
    if (v.length > 0) TEXT_SAMPLE = v;
    editModal.style.display = 'none';
  });

  // init app
  async function initApp() {
    // renderer
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    renderer = new THREE.WebGLRenderer({antialias: true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(renderer.domElement);

    camera = new THREE.PerspectiveCamera(50, container.clientWidth/container.clientHeight, 0.1, 2000);
    camera.position.set(0,0,140);
    window.addEventListener('resize', () => {
      renderer.setSize(container.clientWidth, container.clientHeight);
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
    });

    // particle buffers
    setupParticles(TOTAL);

    // start camera & hands
    await startHands();

    // buttons
    document.getElementById('btn-sat').addEventListener('click', () => formSaturnAt(new THREE.Vector3(0,0,0)));
    document.getElementById('btn-disp').addEventListener('click', () => disperseNow());
    document.getElementById('btn-text').addEventListener('click', () => formTextAt(new THREE.Vector3(0,0,0), TEXT_SAMPLE));

    // initial motion
    initialIdleMotion();

    // start loop
    lastTs = performance.now();
    requestAnimationFrame(loop);
  }

  function setupParticles(total) {
    TOTAL = total;
    geometry = new THREE.BufferGeometry();
    positions = new Float32Array(TOTAL * 3);
    targets = new Float32Array(TOTAL * 3);
    velocities = new Float32Array(TOTAL * 3);
    colors = new Float32Array(TOTAL * 3);

    for (let i=0;i<TOTAL;i++){
      positions[i*3+0] = (Math.random()-0.5)*300;
      positions[i*3+1] = (Math.random()-0.5)*300;
      positions[i*3+2] = (Math.random()-0.5)*300;

      targets[i*3+0] = positions[i*3+0];
      targets[i*3+1] = positions[i*3+1];
      targets[i*3+2] = positions[i*3+2];

      velocities[i*3+0] = (Math.random()-0.5)*0.7;
      velocities[i*3+1] = (Math.random()-0.5)*0.7;
      velocities[i*3+2] = (Math.random()-0.5)*0.7;

      const h = 0.56 + Math.random()*0.12;
      const s = 0.55 + Math.random()*0.25;
      const l = 0.45 + Math.random()*0.2;
      const col = new THREE.Color().setHSL(h,s,l);
      colors[i*3+0] = col.r; colors[i*3+1] = col.g; colors[i*3+2] = col.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions,3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors,3));

    const material = new THREE.PointsMaterial({
      size: BASE_PARTICLE_SIZE,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    if (points) scene.remove(points);
    points = new THREE.Points(geometry, material);
    scene.add(points);

    activeCount = TOTAL;
  }

  // shapes
  function buildSaturnTargets(center, planetRadius=18, ringInner=26, ringOuter=46) {
    const list = [];
    const planetCount = Math.floor(TOTAL * 0.55);
    const ringCount = Math.floor(TOTAL * 0.45);
    for (let i=0;i<planetCount;i++){
      const u=Math.random(), v=Math.random();
      const theta=2*Math.PI*u;
      const phi=Math.acos(2*v-1);
      const r=planetRadius*(0.86+Math.random()*0.28);
      const x=r*Math.sin(phi)*Math.cos(theta);
      const y=r*Math.sin(phi)*Math.sin(theta);
      const z=r*Math.cos(phi)*(0.85+Math.random()*0.3);
      list.push([center.x+x, center.y+y, center.z+z]);
    }
    const tilt=0.55; const cosT=Math.cos(tilt), sinT=Math.sin(tilt);
    for (let i=0;i<ringCount;i++){
      const ang=Math.random()*Math.PI*2;
      const rr=Math.sqrt(Math.random())*(ringOuter-ringInner)+ringInner;
      const x0=rr*Math.cos(ang); const y0=rr*Math.sin(ang)*0.64;
      const x=x0; const y=y0*cosT; const z=y0*sinT;
      list.push([center.x+x+(Math.random()-0.5)*1.6, center.y+y+(Math.random()-0.5)*0.6, center.z+z+(Math.random()-0.5)*1.2]);
    }
    return list;
  }

  function computeFontSizeForText(text) {
    const len = Math.max(1, text.length);
    // base: shorter text => larger size; longer => smaller
    // map len 1..40 -> size 220..56
    const maxLen = 40;
    const clamped = Math.min(len, maxLen);
    const size = Math.round(220 - (clamped - 1) * (220 - 56) / (maxLen - 1));
    return Math.max(56, Math.min(220, size));
  }

  function buildTextTargets(center, text=TEXT_SAMPLE) {
    const fontSize = computeFontSizeForText(text);
    const c=document.createElement('canvas'), ctx=c.getContext('2d');
    c.width=1024; c.height=256;
    ctx.fillStyle='black'; ctx.fillRect(0,0,c.width,c.height);
    ctx.fillStyle='white'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.font=`900 ${fontSize}px serif`;
    ctx.fillText(text, c.width/2, c.height/2);
    const img=ctx.getImageData(0,0,c.width,c.height).data;
    const samples=[];
    const step = Math.max(1, Math.floor(isMobile ? 3 : 2));
    for (let y=0;y<c.height;y+=step){
      for (let x=0;x<c.width;x+=step){
        const i=(y*c.width+x)*4;
        const bright=(img[i]+img[i+1]+img[i+2])/3;
        if (bright>200){
          const nx=(x-c.width/2)/(c.width/2);
          const ny=-(y-c.height/2)/(c.height/2);
          const scale = isMobile ? 0.6*40 : 0.8*40;
          const px = center.x + nx*scale;
          const py = center.y + ny*(scale*0.35);
          const pz = center.z + (Math.random()-0.5)*8;
          samples.push([px,py,pz]);
        }
      }
    }
    if (samples.length > Math.floor(TOTAL*0.8)) {
      shuffle(samples);
      samples.length = Math.floor(TOTAL*0.8);
    }
    return samples;
  }

  function shuffle(a){ for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } }

  function applyTargetList(list, anchor) {
    let i=0;
    for (;i<list.length && i<TOTAL;i++){
      targets[i*3+0]=list[i][0]; targets[i*3+1]=list[i][1]; targets[i*3+2]=list[i][2];
    }
    for (;i<TOTAL;i++){
      targets[i*3+0]=anchor.x+(Math.random()-0.5)*80;
      targets[i*3+1]=anchor.y+(Math.random()-0.5)*80;
      targets[i*3+2]=anchor.z+(Math.random()-0.5)*80;
    }
  }

  function formSaturnAt(anchor){ state='saturn'; desiredAnchor.set(anchor.x, anchor.y, anchor.z); const list = buildSaturnTargets(desiredAnchor); applyTargetList(list, desiredAnchor); }
  function disperseNow(){ state='disperse'; for (let i=0;i<TOTAL;i++){ velocities[i*3+0]=(Math.random()-0.5)*(isMobile?6.0:8.0); velocities[i*3+1]=(Math.random()-0.5)*(isMobile?6.0:8.0); velocities[i*3+2]=(Math.random()-0.5)*(isMobile?6.0:8.0); } }
  function formTextAt(anchor, text){ state='text'; desiredAnchor.set(anchor.x, anchor.y, anchor.z); const list = buildTextTargets(desiredAnchor, text||TEXT_SAMPLE); applyTargetList(list, desiredAnchor); }

  // initial idle motion
  function initialIdleMotion(){
    for (let i=0;i<TOTAL;i++){ velocities[i*3+0]+=(Math.random()-0.5)*0.4; velocities[i*3+1]+=(Math.random()-0.5)*0.4; velocities[i*3+2]+=(Math.random()-0.5)*0.4; }
    setInterval(()=>{ if (state==='idle') for (let i=0;i<TOTAL;i++){ velocities[i*3+0]+=(Math.random()-0.5)*0.4; velocities[i*3+1]+=(Math.random()-0.5)*0.4; velocities[i*3+2]+=(Math.random()-0.5)*0.4; } }, 900);
  }

  // animation loop
  let lastFrame = performance.now();
  function loop(ts){
    requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now-lastFrame)/1000);
    lastFrame = now;

    // fps
    const fps = 1/dt;
    fpsHistory.push(fps);
    if (fpsHistory.length>FPS_SMOOTH) fpsHistory.shift();
    const avgFps = fpsHistory.reduce((a,b)=>a+b,0)/fpsHistory.length || fps;

    adaptPerformance(avgFps);

    shapeAnchor.lerp(desiredAnchor, SMOOTH_FOLLOW);

    for (let i=0;i<activeCount;i++){
      const pi = i*3;
      if (state==='disperse'){
        velocities[pi+0]*=0.996; velocities[pi+1]*=0.996; velocities[pi+2]*=0.996;
        positions[pi+0]+=velocities[pi+0]*dt*60; positions[pi+1]+=velocities[pi+1]*dt*60; positions[pi+2]+=velocities[pi+2]*dt*60;
        const dx=positions[pi+0]-shapeAnchor.x, dy=positions[pi+1]-shapeAnchor.y, dz=positions[pi+2]-shapeAnchor.z;
        const d2=dx*dx+dy*dy+dz*dz;
        if (d2>25000){ positions[pi+0]=shapeAnchor.x+(Math.random()-0.5)*160; positions[pi+1]=shapeAnchor.y+(Math.random()-0.5)*160; positions[pi+2]=shapeAnchor.z+(Math.random()-0.5)*160; }
      } else {
        const tx=targets[pi+0], ty=targets[pi+1], tz=targets[pi+2];
        const shiftX=shapeAnchor.x-desiredAnchor.x, shiftY=shapeAnchor.y-desiredAnchor.y, shiftZ=shapeAnchor.z-desiredAnchor.z;
        positions[pi+0]+=((tx+shiftX)-positions[pi+0])*0.12;
        positions[pi+1]+=((ty+shiftY)-positions[pi+1])*0.12;
        positions[pi+2]+=((tz+shiftZ)-positions[pi+2])*0.12;
      }
    }

    for (let i=activeCount;i<TOTAL;i++){
      const pi=i*3;
      positions[pi+0]+=(shapeAnchor.x-positions[pi+0])*0.02;
      positions[pi+1]+=(shapeAnchor.y-positions[pi+1])*0.02;
      positions[pi+2]+=(shapeAnchor.z-positions[pi+2])*0.02;
    }

    geometry.attributes.position.needsUpdate = true;
    points.rotation.y += 0.0009;
    renderer.render(scene, camera);
  }

  function adaptPerformance(avgFps){
    if (!avgFps) return;
    const target = isMobile ? 40 : 50;
    if (avgFps < target - 8 && activeCount > Math.max(300, Math.floor(TOTAL*0.2))) {
      activeCount = Math.max(Math.floor(activeCount*0.86), Math.max(300, Math.floor(TOTAL*0.2)));
      points.material.size = Math.max(0.5, points.material.size * 0.94);
    } else if (avgFps > target + 6 && activeCount < TOTAL) {
      activeCount = Math.min(TOTAL, Math.floor(activeCount * 1.1));
      points.material.size = Math.min(BASE_PARTICLE_SIZE, points.material.size * 1.06);
    }
  }

  // ---------------- MediaPipe Hands with preprocessing ----------------
  let hands, cameraUtils;
  async function startHands(){
    video.style.display = 'block';
    try{
      const stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'user'}, audio: false});
      video.srcObject = stream;
    } catch(e){
      throw new Error('Camera permission denied or not available. ' + (e.message||e));
    }

    hands = new Hands({ locateFile: (f)=>`https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
    hands.setOptions({ selfieMode: true, maxNumHands: 1, minDetectionConfidence: isMobile?0.45:0.55, minTrackingConfidence: isMobile?0.45:0.55 });
    hands.onResults(onHands);

    // camera utils only to trigger frames; we will send an offscreen canvas to Mediapipe for preprocessing
    cameraUtils = new Camera(video, { onFrame: async ()=>{ await preprocessAndSend(); }, width: isMobile?320:640, height: isMobile?240:480 });
    await cameraUtils.start();
  }

  // preprocess: auto-brightness & contrast, draw to offCanvas, send offCanvas to Mediapipe
  let frameCounter = 0;
  async function preprocessAndSend() {
    if (!video || video.readyState < 2) return;
    // choose size for offscreen: keep small for performance
    const w = isMobile ? 320 : 640;
    const h = isMobile ? 240 : 480;
    offCanvas.width = w;
    offCanvas.height = h;

    // periodically compute average luminance
    frameCounter++;
    // compute avg luminance every 6 frames to save CPU
    if (frameCounter % 6 === 0) {
      // draw current frame quickly without filters to temp small canvas for sampling
      offCtx.drawImage(video, 0, 0, w, h);
      try {
        const img = offCtx.getImageData(0,0,w,h).data;
        let sum = 0; let count = 0;
        // sample pixels every 8th pixel for speed
        const step = 8;
        for (let y=0;y<h;y+=step){
          for (let x=0;x<w;x+=step){
            const i = (y*w + x)*4;
            const r = img[i], g = img[i+1], b = img[i+2];
            const lum = 0.2126*r + 0.7152*g + 0.0722*b;
            sum += lum; count++;
          }
        }
        const avg = sum / count;
        // map avg luminance (0..255) to brightness multiplier 0.8..2.2
        // darker -> larger multiplier
        const targetBrightness = Math.max(0.8, Math.min(2.2, 1.5 - (avg - 80)/140));
        const targetContrast = Math.max(0.8, Math.min(1.6, 1.05 - (avg - 100)/500));
        // smooth over frames
        brightnessMultiplier += (targetBrightness - brightnessMultiplier) * 0.18;
        contrastMultiplier += (targetContrast - contrastMultiplier) * 0.12;

        // adjust mediapipe sensitivity if very dark
        if (avg < 70) {
          hands.setOptions({ minDetectionConfidence: 0.4, minTrackingConfidence: 0.4 });
        } else {
          hands.setOptions({ minDetectionConfidence: isMobile?0.45:0.55, minTrackingConfidence: isMobile?0.45:0.55 });
        }
      } catch (err) {
        // getImageData may throw on cross-origin or not ready; ignore
      }
    }

    // now draw frame with filters applied
    offCtx.save();
    offCtx.clearRect(0,0,offCanvas.width, offCanvas.height);
    offCtx.filter = `brightness(${brightnessMultiplier.toFixed(2)}) contrast(${contrastMultiplier.toFixed(2)}) saturate(1.05)`;
    offCtx.drawImage(video, 0, 0, offCanvas.width, offCanvas.height);
    offCtx.restore();

    try {
      await hands.send({ image: offCanvas });
    } catch(e){
      // ignore occasional send errors
    }
  }

  function countFingersUp(lms){
    if (!lms || lms.length<21) return 0;
    const tips=[4,8,12,16,20];
    const pips=[2,6,10,14,18];
    let cnt=0;
    for (let i=1;i<5;i++){
      const tip=lms[tips[i]], pip=lms[pips[i]];
      if (tip && pip && tip.y < pip.y - 0.02) cnt++;
    }
    const wrist=lms[0], thumbTip=lms[4], thumbIp=lms[2];
    if (wrist && thumbTip && thumbIp){
      const horiz=Math.abs(thumbTip.x - thumbIp.x);
      const distW=Math.abs(thumbTip.x - wrist.x);
      if (distW > 0.06 && horiz > 0.02) cnt++;
    }
    return cnt;
  }

  let lastG=null, hold=0;
  function onHands(results){
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length===0){
      hold=0; lastG=null; return;
    }
    const lm = results.multiHandLandmarks[0];
    let ax=0, ay=0, az=0;
    for (let i=0;i<lm.length;i++){ ax+=lm[i].x; ay+=lm[i].y; az+=lm[i].z; }
    ax/=lm.length; ay/=lm.length; az/=lm.length;
    const handPos = handToScene(ax, ay, az, 40);
    const fingers = countFingersUp(lm);
    let gesture='unknown';
    if (fingers <= 1) gesture='fist';
    else if (fingers === 2) gesture='two';
    else if (fingers >= 4) gesture='palm';

    if (gesture === lastG) hold++; else { lastG = gesture; hold = 1; }
    if (hold >= 4) {
      if (gesture === 'fist') formSaturnAt({x:handPos.x, y:handPos.y, z:handPos.z - 8});
      else if (gesture === 'palm') disperseNow();
      else if (gesture === 'two') formTextAt({x:handPos.x, y:handPos.y, z:handPos.z - 8}, TEXT_SAMPLE);
    }

    if (state === 'saturn' || state === 'text') {
      desiredAnchor.set(handPos.x, handPos.y, handPos.z - 8);
    }
  }

  function handToScene(nx, ny, nz=0, depthScale=100){
    const x = (nx-0.5)*2*(container.clientWidth/container.clientHeight)*60;
    const y = (0.5-ny)*2*60;
    const z = (nz||0)*depthScale;
    return {x,y,z};
  }

  // start particles offscreen
  setupParticles(TOTAL);

  function setupParticles(total){
    TOTAL = total;
    geometry = new THREE.BufferGeometry();
    positions = new Float32Array(TOTAL*3);
    targets = new Float32Array(TOTAL*3);
    velocities = new Float32Array(TOTAL*3);
    colors = new Float32Array(TOTAL*3);
    for (let i=0;i<TOTAL;i++){
      positions[i*3+0] = (Math.random()-0.5)*300;
      positions[i*3+1] = (Math.random()-0.5)*300;
      positions[i*3+2] = (Math.random()-0.5)*300;
      targets[i*3+0] = positions[i*3+0]; targets[i*3+1] = positions[i*3+1]; targets[i*3+2] = positions[i*3+2];
      velocities[i*3+0] = (Math.random()-0.5)*0.7; velocities[i*3+1] = (Math.random()-0.5)*0.7; velocities[i*3+2] = (Math.random()-0.5)*0.7;
      const h = 0.56 + Math.random()*0.12;
      const s = 0.55 + Math.random()*0.25;
      const l = 0.45 + Math.random()*0.2;
      const col = new THREE.Color().setHSL(h,s,l);
      colors[i*3+0]=col.r; colors[i*3+1]=col.g; colors[i*3+2]=col.b;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions,3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors,3));
    const material = new THREE.PointsMaterial({ size: BASE_PARTICLE_SIZE, vertexColors:true, transparent:true, opacity:0.95, depthWrite:false, blending:THREE.AdditiveBlending });
    if (points) scene.remove(points);
    points = new THREE.Points(geometry, material);
    scene.add(points);
    activeCount = TOTAL;
  }

  // expose simple keyboard controls
  window.addEventListener('keydown', (e)=>{ if (e.key==='1') formSaturnAt(new THREE.Vector3(0,0,0)); if (e.key==='2') disperseNow(); if (e.key==='3') formTextAt(new THREE.Vector3(0,0,0), TEXT_SAMPLE); });

  // expose startHands for init
  async function startHands(){
    video.style.display = 'block';
    try{
      const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'}, audio:false});
      video.srcObject = stream;
    } catch(e){
      throw new Error('Camera permission denied or not available. ' + (e.message||e));
    }

    hands = new Hands({ locateFile: (f)=>`https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
    hands.setOptions({ selfieMode: true, maxNumHands: 1, minDetectionConfidence: isMobile?0.45:0.55, minTrackingConfidence: isMobile?0.45:0.55 });
    hands.onResults(onHands);
    cameraUtils = new Camera(video, { onFrame: async ()=>{ await preprocessAndSend(); }, width: isMobile?320:640, height: isMobile?240:480 });
    await cameraUtils.start();
  }

  // kick off initialIdleMotion
  initialIdleMotion();

  // helper for modal: pressing Enter saves
  editInput.addEventListener('keydown', (e)=>{ if (e.key==='Enter') { saveEdit.click(); } });

  // finally start rendering loop after user presses start (initApp called on click)
  async function initApp() {
    // already have renderer/camera if setupParticles called earlier? ensure renderer present
    if (!renderer) {
      // build renderer & camera
      const rend = new THREE.WebGLRenderer({antialias:true});
      renderer = rend;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2));
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.outputEncoding = THREE.sRGBEncoding;
      container.appendChild(renderer.domElement);
      camera = new THREE.PerspectiveCamera(50, container.clientWidth/container.clientHeight, 0.1, 2000);
      camera.position.set(0,0,140);
      window.addEventListener('resize', ()=>{ renderer.setSize(container.clientWidth, container.clientHeight); camera.aspect = container.clientWidth / container.clientHeight; camera.updateProjectionMatrix(); });
    }
    // start hands & camera
    await startHands();
    // start animation loop
    lastFrame = performance.now();
    requestAnimationFrame(loop);
  }

})();