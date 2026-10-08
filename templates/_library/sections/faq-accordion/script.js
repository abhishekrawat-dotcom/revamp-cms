/* FAQ accordion behaviour: one item open at a time, clicks inside an open answer don't close it. Runs per
   section (RevampSections.register), working only from `section` — never a global DOM query — so a
   duplicated FAQ section gets an accordion of its own and sections added in the editor open/close too. */
RevampSections.register('faq-accordion', function (section) {
  function setOpen(item, open) {
    item.classList.toggle('active', open);
    var q = item.querySelector('.faq-question');
    if (q) q.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  section.addEventListener('click', function (event) {
    var item = event.target.closest('.faq-item');
    if (!item || !section.contains(item) || event.target.closest('.faq-answer-wrap')) return;
    var isActive = item.classList.contains('active');
    section.querySelectorAll('.faq-item').forEach(function (other) { if (other !== item) setOpen(other, false); });
    setOpen(item, !isActive);
  });
});
