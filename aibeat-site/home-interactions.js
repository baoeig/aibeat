// Progressive enhancement. Mintlify embeds root JS automatically.
// Without JS, all platform links remain visible and usable. No auto-downloads.
(() => {
  let currentHome;
  const isZh=()=>location.pathname==='/cn'||location.pathname.startsWith('/cn/');
  const panels=()=>document.querySelectorAll('.aibeat-home-platform-selector');
  const reducedMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;

  function applyTheme(dark,persist=false){
    document.documentElement.classList.toggle('dark',dark);
    document.documentElement.classList.toggle('light',!dark);
    if(persist)try{localStorage.setItem('theme',dark?'dark':'light');localStorage.setItem('isDarkMode',String(dark));}catch{}
    const button=document.querySelector('.aibeat-home-theme-toggle');
    button?.setAttribute('aria-pressed',String(dark));
    button?.setAttribute('aria-label',dark?(isZh()?'切换浅色模式':'Switch to light theme'):(isZh()?'切换深色模式':'Switch to dark theme'));
  }
  function initTheme(home){
    let theme,legacy;
    try{theme=localStorage.getItem('theme');legacy=localStorage.getItem('isDarkMode');}catch{}
    applyTheme(theme==='dark'||(theme!=='light'&&legacy==='true'));
    home.querySelector('.aibeat-home-theme-toggle')?.addEventListener('click',()=>applyTheme(!document.documentElement.classList.contains('dark'),true));
  }

  function setOpen(panel,open,restore=false){
    if(!panel)return;
    if(open)panels().forEach(other=>{if(other!==panel)setOpen(other,false);});
    panel.dataset.open=String(open);
    const button=panel.querySelector('.aibeat-home-platform-summary');
    const menu=panel.querySelector('.aibeat-home-platform-menu');
    button.setAttribute('aria-expanded',String(open));
    menu.hidden=!open;
    if(open){
      const r=panel.getBoundingClientRect(),height=menu.scrollHeight;
      panel.dataset.side=r.bottom+height+8>innerHeight&&r.top>height+120?'above':'below';
    }
    if(restore)button.focus({preventScroll:true});
  }
  async function detectPlatform(){
    const ua=navigator.userAgent||'',platform=navigator.userAgentData?.platform||navigator.platform||'';
    if(/Android|iPhone|iPad|iPod/i.test(ua)||(/MacIntel/i.test(platform)&&navigator.maxTouchPoints>1))return {key:null};
    const mac=/Macintosh|MacIntel|Mac OS X/i.test(ua)||/macOS|Mac/i.test(platform);
    const win=/Win/i.test(ua+' '+platform),linux=/Linux/i.test(ua+' '+platform);
    let arch=null,arm=/arm64|aarch64|armv8/i.test(ua);
    try{
      const hints=await navigator.userAgentData?.getHighEntropyValues(['architecture','bitness']);
      if(hints?.architecture==='arm'){arm=true;arch=hints.bitness==='64'?'arm64':'unsupported';}
      else if(hints?.architecture==='x86')arch=hints.bitness==='64'?'x64':'unsupported';
    }catch{}
    if(mac)return {key:arch&&arch!=='unsupported'?'darwin-'+arch:null,mac:true};
    if(arm)return {key:null}; // No Linux/Windows ARM archives in this release.
    if(!arch&&/Win64|x64|x86_64|amd64/i.test(ua+' '+platform))arch='x64';
    return {key:arch==='x64'?(win?'windows-x64':linux?'linux-x64':null):null};
  }
  async function initDownloads(home){
    home.querySelectorAll('.aibeat-home-platform-selector').forEach(panel=>{
      panel.dataset.enhanced='true';setOpen(panel,false);
      panel.querySelector('.aibeat-home-platform-summary').addEventListener('click',()=>setOpen(panel,panel.dataset.open!=='true'));
      panel.querySelectorAll('.aibeat-home-platform-menu a').forEach(a=>a.addEventListener('click',()=>setOpen(panel,false)));
      if(matchMedia('(pointer: fine)').matches){
        let timer;
        panel.addEventListener('mouseenter',()=>{clearTimeout(timer);setOpen(panel,true);});
        panel.addEventListener('mouseleave',()=>{timer=setTimeout(()=>{if(!panel.contains(document.activeElement))setOpen(panel,false);},150);});
      }
    });
    const detected=await detectPlatform();
    if(currentHome!==home||!home.isConnected)return;
    const labels={
      'linux-x64':'Linux x64','windows-x64':'Windows x64',
      'darwin-arm64':'macOS Apple Silicon','darwin-x64':'macOS Intel',
    };
    const attributes={
      'linux-x64':['linux','x64'],'windows-x64':['windows','x64'],
      'darwin-arm64':['mac','arm64'],'darwin-x64':['mac','x64'],
    };
    home.querySelectorAll('.aibeat-home-download-main').forEach(main=>{
      const product=main.dataset.product;
      const panel=home.querySelector(`.aibeat-home-platform-selector[data-product="${product}"]`);
      const target=attributes[detected.key];
      const option=target&&panel.querySelector(`a[data-os="${target[0]}"][data-arch="${target[1]}"]`);
      if(option){
        main.setAttribute('href',option.getAttribute('href'));
        main.querySelector('span').textContent=isZh()?`下载 ${labels[detected.key]}${product==='agentbeat'?' 预览版':' 版'}`:`Download${product==='agentbeat'?' Preview':''} for ${labels[detected.key]}`;
      }else{
        main.querySelector('span').textContent=detected.mac?(isZh()?'选择 macOS 版本':'Choose macOS version'):(isZh()?'选择系统版本':'Choose your platform');
        main.addEventListener('click',event=>{
          event.preventDefault();setOpen(panel,true,true);
          panel.scrollIntoView({behavior:reducedMotion()?'instant':'smooth',block:'nearest'});
        });
      }
    });
    home.dataset.downloadsReady='true';
  }
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape')panels().forEach(panel=>{if(panel.dataset.open==='true')setOpen(panel,false,panel.contains(document.activeElement));});
  });
  document.addEventListener('click',event=>{
    if(!event.target.closest('.aibeat-home-download-split'))panels().forEach(panel=>setOpen(panel,false));
  });
  function init(){
    const home=document.querySelector('.aibeat-home');
    if(home===currentHome)return;
    currentHome=home;
    if(!home)return;
    initTheme(home);home.dataset.interactionsReady='true';
    initDownloads(home).catch(()=>{
      // If enhancement fails, do not hide the usable download links.
      home.querySelectorAll('.aibeat-home-platform-selector').forEach(panel=>{delete panel.dataset.enhanced;panel.querySelector('.aibeat-home-platform-menu').hidden=false;});
      home.dataset.downloadsReady='fallback';
    });
  }
  function start(){init();new MutationObserver(init).observe(document.body,{childList:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
