/* Backup of the demo/dummy data that used to seed Event_Listing.html, taken 2026-10-08 before replacing
   it with real, dynamically-registered event data (see registerLiveEvent() in create-event.html and the
   localStorage('revamp.liveEvents.v1') merge in Event_Listing.html). This file is NOT loaded by any page —
   it exists purely as a reference snapshot in case the old fake rows/numbers are ever needed again
   (e.g. for a demo account, a design review, or restoring a fallback). Safe to delete once no longer needed.

   Depends on nextId()/mk() from Event_Listing.html, which were kept in the live file. */

var CREATORS = ['Tanishka Bhatia','Arjun Rawat','Sofia Chen','Jonas Meyer','Marcus Osei'];

var DUMMY_EVENTS = [
  mk({ name:'ET CISO Annual Conclave 2026', venue:'Grand Hyatt', city:'Goa', eventNo:4097, type:'ip', portal:'cio', status:'upcoming', start:'2026-09-10T10:00:00', registrations:2645, regTarget:2924, visitors:2923, payment:{type:'paid', amount:482000, txns:212}, createdBy:CREATORS[0] }),
  mk({ name:'RACEx360', venue:'Taj West End', city:'Bengaluru', eventNo:4652, type:'client', portal:'auto', status:'upcoming', start:'2026-09-25T09:30:00', registrations:136, regTarget:113, visitors:113, payment:{type:'free'}, createdBy:CREATORS[1] }),
  mk({ name:'Data Protection & Privacy Summit 2026', venue:'Venue to be confirmed', city:'Mumbai', eventNo:4138, type:'ip', portal:'legal', status:'upcoming', start:'2026-12-02T09:00:00', registrations:122, regTarget:248, visitors:248, payment:{type:'paid', amount:0, txns:0}, createdBy:CREATORS[2] }),
  mk({ name:'ET CISO SecuFest 2027', venue:'Venue to be confirmed', city:'—', eventNo:4545, type:'ip', portal:'cio', status:'upcoming', start:'2027-03-11T08:00:00', registrations:46, regTarget:89, visitors:89, payment:{type:'free'}, createdBy:CREATORS[0] }),
  mk({ name:'Cyber Security Council', venue:'Venue to be confirmed', city:'Delhi NCR', eventNo:2595, type:'roundtable', portal:'legal', status:'upcoming', start:null, registrations:5, regTarget:38, visitors:38, payment:{type:'free'}, createdBy:CREATORS[3] }),
  mk({ name:'AI-Driven SecOps', venue:'Virtual', city:'Online', eventNo:3354, type:'leadgen', portal:'telecom', status:'upcoming', start:null, registrations:88, regTarget:85, visitors:85, payment:{type:'paid', amount:45000, txns:19}, createdBy:CREATORS[4] }),
  mk({ name:'Quest Bant 2025', venue:'Virtual', city:'Online', eventNo:3425, type:'leadgen', portal:'retail', status:'upcoming', start:'2026-10-05T11:00:00', registrations:19, regTarget:90, visitors:63, payment:{type:'free'}, createdBy:CREATORS[1] }),
  mk({ name:'SecurityStroke', venue:'ITC Maratha', city:'Mumbai', eventNo:1627, type:'roundtable', portal:'cio', status:'upcoming', start:'2026-10-19T09:00:00', registrations:95, regTarget:96, visitors:96, payment:{type:'free'}, createdBy:CREATORS[2] }),
  mk({ name:'Manufacturing 4.0 Summit 2026', venue:'Venue to be confirmed', city:'Chennai', eventNo:4471, type:'ip', portal:'manufacturing', status:'upcoming', start:'2026-12-03T09:00:00', registrations:0, regTarget:300, visitors:0, payment:{type:'free'}, createdBy:CREATORS[4] }),

  mk({ name:'Zscaler Secusphere', venue:'Virtual', city:'Online', eventNo:2304, type:'leadgen', portal:'telecom', status:'active', start:'2026-09-07T09:00:00', registrations:75, regTarget:253, visitors:253, payment:{type:'paid', amount:120000, txns:41}, createdBy:CREATORS[3] }),
  mk({ name:'Managing Extensions with Chrome Enterprise', venue:'Virtual', city:'Online', eventNo:3871, type:'editorial', portal:'cio', status:'active', start:'2026-09-07T14:00:00', registrations:21, regTarget:122, visitors:122, payment:{type:'free'}, createdBy:CREATORS[0] }),
  mk({ name:'Optimizing Chrome Enterprise Core', venue:'Virtual', city:'Online', eventNo:3872, type:'editorial', portal:'cio', status:'active', start:'2026-09-07T16:00:00', registrations:36, regTarget:93, visitors:93, payment:{type:'free'}, createdBy:CREATORS[0] }),

  mk({ name:'BFSI Fraud & Risk Conclave 2025', venue:'ITC Grand Central', city:'Mumbai', eventNo:3980, type:'ip', portal:'bfsi', status:'completed', start:'2025-11-18T09:00:00', registrations:850, regTarget:800, visitors:1200, payment:{type:'paid', amount:950000, txns:301}, createdBy:CREATORS[4] }),
  mk({ name:'Healthcare Innovation Awards 2025', venue:'The Leela', city:'New Delhi', eventNo:4012, type:'ip', portal:'health', status:'completed', start:'2025-08-22T18:00:00', registrations:300, regTarget:280, visitors:400, payment:{type:'paid', amount:620000, txns:150}, createdBy:CREATORS[2] }),
  mk({ name:'Legal & Compliance Forum 2025', venue:'Virtual', city:'Online', eventNo:3690, type:'client', portal:'legal', status:'completed', start:'2025-05-14T10:00:00', registrations:60, regTarget:90, visitors:75, payment:{type:'free'}, createdBy:CREATORS[1] }),
  mk({ name:'Redefining Cybersecurity', venue:'Taj Lands End', city:'Mumbai', eventNo:2158, type:'roundtable', portal:'cio', status:'completed', start:'2025-03-02T09:00:00', registrations:134, regTarget:998, visitors:0, payment:{type:'free'}, createdBy:CREATORS[3] }),

  mk({ name:'HRWorld Culture Roundtable 2026', venue:'Zoom Webinar', city:'Online', eventNo:4489, type:'client', portal:'hrworld', status:'cancelled', start:'2026-11-05T00:00:00', registrations:0, regTarget:null, visitors:0, payment:{type:'free'}, createdBy:CREATORS[2] }),
  mk({ name:'Telecom 5G Innovation Forum 2027', venue:'Venue to be confirmed', city:'—', eventNo:4590, type:'ip', portal:'telecom', status:'draft', start:null, registrations:0, regTarget:null, visitors:0, payment:{type:'free'}, createdBy:CREATORS[3] }),

  mk({ name:'Legacy Compliance Roundtable 2024', venue:'Virtual', city:'Online', eventNo:1902, type:'roundtable', portal:'legal', status:'deleted', start:'2024-06-10T10:00:00', registrations:12, regTarget:40, visitors:22, payment:{type:'free'}, createdBy:CREATORS[1] })
];

/* The KPI tiles ("Total Visitors / Registrations / Revenue") used to be driven by this completely
   independent fixture rather than by the real event list — meaning the tiles never matched whatever
   DUMMY_EVENTS/EVENTS actually contained. Event_Listing.html now computes these from real events
   (see renderKPIs()), so this fixture is retired. */
var KPI_BASE_BACKUP = {
  upcoming:  { visitors:10810, registrations:4280, revenue:3260000, dVis:12.5, dReg:8.2, dRev:16.4 },
  active:    { visitors:2870,  registrations:890,  revenue:640000,  dVis:6.1,  dReg:-2.4, dRev:9.8 },
  completed: { visitors:18420, registrations:6210, revenue:8920000, dVis:4.4,  dReg:5.6,  dRev:-3.1 }
};
var RANGE_DELTA_SCALE_BACKUP = { '7':0.65, '10':0.82, '30':1, 'custom':1 };
