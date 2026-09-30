// Meta Pixel（推流）. Mintlify 会在页面可交互后执行与 docs.json 同级的根 JS。
// 正式发布时还会把同一段代码插进每个页面的 <head>。这里若发现 fbq 已存在就直接返回，避免 PageView 打两次。
(() => {
  if (window.fbq) return;
  !function(f,b,e,v,n,t,s)
  {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t,s)}(window, document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', '1593130218851842');
  fbq('track', 'PageView');
})();
