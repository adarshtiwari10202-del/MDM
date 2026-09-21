// ============================================================
// Sample normalized submissions — used for offline dev, the dashboard
// preview, and flag-engine tests. Shape matches what the Phase 1 reader
// produces from the live daily Sheet (4 food stages, no children photo).
//
// The `ai` readings here use the legacy field subset the flag engine +
// dashboard consume; in live mode the pipeline produces the rich v2
// reading and merges these same legacy fields in (see pipeline.js).
// ============================================================

const SCHOOLS = {
  '09250100101': { udise: '09250100101', name: 'PS Hargaon Purab', block: 'Hargaon', location: { lat: 27.5325, lng: 80.7561 } },
  '09250100205': { udise: '09250100205', name: 'PS Ataria', block: 'Hargaon', location: { lat: 27.6012, lng: 80.7788 } },
  '09250100309': { udise: '09250100309', name: 'UPS Laharpur Road', block: 'Hargaon', location: { lat: 27.5540, lng: 80.7402 } },
};

const ai = (o) => ({
  scene_type: 'other', food_present: null, dishes_visible: [], menu_items_present: {},
  cooking_in_progress: null, plate_fullness: null, notes: '', ...o,
});

export const SAMPLE_SUBMISSIONS = [
  // 1) Clean submission — no flags.
  {
    id: 'S-0001', school: SCHOOLS['09250100101'], date: '2026-09-13',
    menu: ['rice', 'dal', 'sabzi'], headcountReported: 118, submittedAt: '2026-09-13T11:20:00+05:30',
    files: {
      cooking: { url: 'sample://cooking-1.jpg', uploadedAt: '2026-09-13T11:05:00+05:30', location: { lat: 27.5326, lng: 80.7562 }, hash: 'a1',
        ai: ai({ scene_type: 'cooking', cooking_in_progress: true, food_present: true, notes: 'Cook stirring a large vessel over flame.' }) },
      cooked_meal: { url: 'sample://meal-1.jpg', uploadedAt: '2026-09-13T11:14:00+05:30', location: { lat: 27.5325, lng: 80.7561 }, hash: 'a2',
        ai: ai({ scene_type: 'cooked_meal_in_vessel', food_present: true, dishes_visible: ['rice', 'dal', 'sabzi'], menu_items_present: { rice: true, dal: true, sabzi: true }, notes: 'Three dishes in separate vessels.' }) },
      serving_video: { url: 'sample://serve-1.mp4', uploadedAt: '2026-09-13T11:18:00+05:30', hash: 'a3',
        ai: ai({ scene_type: 'serving', food_present: true, dishes_visible: ['rice', 'dal'], notes: 'Server ladles rice and dal onto plate.' }) },
      plate: { url: 'sample://plate-1.jpg', uploadedAt: '2026-09-13T11:20:00+05:30', hash: 'a4',
        ai: ai({ scene_type: 'served_plate', food_present: true, dishes_visible: ['rice', 'dal', 'sabzi'], menu_items_present: { rice: true, dal: true, sabzi: true }, plate_fullness: 'adequate', notes: 'Full plate with rice, dal and sabzi.' }) },
    },
  },

  // 2) Missing menu item (sabzi absent) + thin portion.
  {
    id: 'S-0002', school: SCHOOLS['09250100205'], date: '2026-09-13',
    menu: ['rice', 'dal', 'sabzi'], headcountReported: 95, submittedAt: '2026-09-13T11:40:00+05:30',
    files: {
      cooking: { url: 'sample://cooking-2.jpg', uploadedAt: '2026-09-13T11:30:00+05:30', hash: 'b1',
        ai: ai({ scene_type: 'cooking', cooking_in_progress: true, food_present: true }) },
      cooked_meal: { url: 'sample://meal-2.jpg', uploadedAt: '2026-09-13T11:35:00+05:30', hash: 'b2',
        ai: ai({ scene_type: 'cooked_meal_in_vessel', food_present: true, dishes_visible: ['rice', 'dal'], menu_items_present: { rice: true, dal: true, sabzi: false }, notes: 'Only rice and dal visible.' }) },
      serving_video: { url: 'sample://serve-2.mp4', uploadedAt: '2026-09-13T11:38:00+05:30', hash: 'b3',
        ai: ai({ scene_type: 'serving', food_present: true, dishes_visible: ['rice', 'dal'] }) },
      plate: { url: 'sample://plate-2.jpg', uploadedAt: '2026-09-13T11:40:00+05:30', hash: 'b4',
        ai: ai({ scene_type: 'served_plate', food_present: true, dishes_visible: ['rice', 'dal'], menu_items_present: { rice: true, dal: true, sabzi: false }, plate_fullness: 'sparse', notes: 'Rice and dal only, thin covering.' }) },
    },
  },

  // 3) Geo mismatch + duplicate reused photo (both red).
  {
    id: 'S-0003', school: SCHOOLS['09250100309'], date: '2026-09-13',
    menu: ['tehri', 'kadhi'], headcountReported: 140, submittedAt: '2026-09-13T09:50:00+05:30',
    files: {
      cooking: { url: 'sample://cooking-3.jpg', uploadedAt: '2026-09-13T09:50:00+05:30', location: { lat: 27.5800, lng: 80.7900 }, hash: 'c1',
        ai: ai({ scene_type: 'cooking', cooking_in_progress: true }) },
      cooked_meal: { url: 'sample://meal-3.jpg', uploadedAt: '2026-09-13T09:50:20+05:30', location: { lat: 27.5800, lng: 80.7900 }, hash: 'c2',
        ai: ai({ scene_type: 'cooked_meal_in_vessel', food_present: true, dishes_visible: ['tehri', 'kadhi'], menu_items_present: { tehri: true, kadhi: true } }) },
      serving_video: { url: 'sample://serve-3.mp4', uploadedAt: '2026-09-13T09:50:35+05:30', hash: 'c3',
        ai: ai({ scene_type: 'serving', food_present: true }) },
      plate: { url: 'sample://plate-3.jpg', uploadedAt: '2026-09-13T09:50:50+05:30', hash: 'c4', duplicateOf: 'UPS Laharpur Road [09250100309] on 2026-09-11 (Plate)',
        ai: ai({ scene_type: 'served_plate', food_present: true, dishes_visible: ['tehri', 'kadhi'], plate_fullness: 'adequate' }) },
    },
  },

  // 4) Incomplete — video not submitted.
  {
    id: 'S-0004', school: SCHOOLS['09250100101'], date: '2026-09-12',
    menu: ['roti', 'sabzi'], headcountReported: 110, submittedAt: '2026-09-12T11:25:00+05:30',
    files: {
      cooking: { url: 'sample://cooking-4.jpg', uploadedAt: '2026-09-12T11:10:00+05:30', hash: 'd1', ai: ai({ scene_type: 'cooking', cooking_in_progress: true }) },
      cooked_meal: { url: 'sample://meal-4.jpg', uploadedAt: '2026-09-12T11:18:00+05:30', hash: 'd2', ai: ai({ scene_type: 'cooked_meal_in_vessel', food_present: true, dishes_visible: ['roti', 'sabzi'], menu_items_present: { roti: true, sabzi: true } }) },
      serving_video: { missing: true },
      plate: { url: 'sample://plate-4.jpg', uploadedAt: '2026-09-12T11:25:00+05:30', hash: 'd4', ai: ai({ scene_type: 'served_plate', food_present: true, dishes_visible: ['roti', 'sabzi'], menu_items_present: { roti: true, sabzi: true }, plate_fullness: 'adequate' }) },
    },
  },
];
