/* ET banner widget — the banner's background media, for every template whose banner is ET's
   (template.json → sections[].widget: "et-banner").

   A banner has one picture, img.banner-bg-image, and may have one video the event's owner supplied, inside
   .bnr-bg-video. The video is written without a src (data-src) and is fetched here the way ET's platform does
   it: after the page has fully loaded plus a delay (longer on low-end devices) and an idle slot, or at once on
   the first click / touch / scroll; it fades in over the picture when it can play. It is never fetched on a
   screen narrower than 768px, for a visitor who asked their browser to save data, or while editing.

   A page saved before banners had one authoritative picture still carries the template's own footage of
   another event (video.lazy-video) and repeats the picture as the section's CSS background: both are taken
   out, so what the owner set as the banner is what shows. */
RevampSections.widget('et-banner', function (section) {
  var host = section.querySelector('.bnr-bg-video');
  var stale = host && host.querySelector('video.lazy-video');
  if (stale) host.textContent = '';

  var picture = section.querySelector('img.banner-bg-image');
  if (picture && picture.getAttribute('src') && /url\(/.test(section.style.backgroundImage)) {
    section.style.background = '';
    if (!section.getAttribute('style')) section.removeAttribute('style');
  }

  var video = host && host.querySelector('video[data-src]');
  if (!video || RevampSections.editing()) return;
  if (window.innerWidth < 768 || (navigator.connection && navigator.connection.saveData)) return;

  function isLowEnd() {
    var hc = navigator.hardwareConcurrency || 0, dm = navigator.deviceMemory || 0;
    return (hc && hc <= 4) || (dm && dm <= 4);
  }
  function onIdle(cb) {
    if ('requestIdleCallback' in window) return requestIdleCallback(cb, { timeout: 2500 });
    return setTimeout(cb, 0);
  }
  function load() {
    if (video.dataset.loaded === '1') return;
    var src = video.getAttribute('data-src');
    if (!src) return;
    video.muted = true;               // an attribute added by script does not mute, and an unmuted video may not start
    video.src = src;
    video.dataset.loaded = '1';
    video.load();
    video.addEventListener('canplay', function () {
      video.classList.add('loaded');
      video.play().catch(function () {});
    }, { once: true });
    video.addEventListener('error', function () { video.style.display = 'none'; }, { once: true });
  }
  function start() {
    setTimeout(function () { onIdle(load); }, isLowEnd() ? 6000 : 3000);
  }

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });

  ['click', 'touchstart', 'scroll'].forEach(function (evt) {
    document.addEventListener(evt, load, { once: true, passive: true });
  });
});
