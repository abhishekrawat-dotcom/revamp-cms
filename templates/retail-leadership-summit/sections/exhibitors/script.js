/* Exhibitor categories: an accordion, one category open at a time (et-runtime.js, RevampSections.accordion).
   The live page reused its FAQ widget for this list, hence the FAQ class names. */
RevampSections.register('exhibitors', function (section) {
  RevampSections.accordion(section, { item: '.accordion-bx', trigger: '.accordion-btn', panel: '.panel' });
});
