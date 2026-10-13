/* FAQ accordion: one question open at a time (et-runtime.js, RevampSections.accordion). */
RevampSections.register('faq', function (section) {
  RevampSections.accordion(section, { item: '.accordion-bx', trigger: '.accordion-btn', panel: '.panel' });
});
